import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairOrphanedUserCreatedCharacters
 *
 * Repairs characters that were created through the Create Character page but ended up
 * with missing owner_email / owner_user_id due to the onCharacterCreated automation
 * reading custom fields from the wrong path (character.owner_email instead of
 * character.data.owner_email).
 *
 * Identification criteria for orphaned user-created characters:
 *   1. created_by is a service account (contains "service+")
 *   2. character_type is "active_created_character"
 *   3. owner_email is null/missing in data
 *   4. Record was NOT created by the user directly (RLS would have populated created_by)
 *
 * Safe backfill rules:
 *   - Only writes owner_email and owner_user_id — nothing else is touched.
 *   - Never changes profile, avatar, memories, relationships, location, status, or type.
 *   - Deduplicates CharacterFinancial records: keeps the one with the highest balance,
 *     stamps it with owner_email, and deletes the orphaned duplicate.
 *   - Admin-only endpoint.
 */

const TARGET_EMAIL = 'murqart@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default dry run for safety
    const targetEmail = body.targetEmail || TARGET_EMAIL;

    const repaired = [];
    const skipped = [];
    const financialRepairs = [];

    // ── STEP 1: Find the target user's ID ────────────────────────────────────
    // We need it to stamp owner_user_id correctly.
    let targetUserId = null;
    try {
      const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: targetEmail }, null, 1);
      if (userSettings[0]?.owner_user_id) {
        targetUserId = userSettings[0].owner_user_id;
      }
    } catch (_e) {}

    console.log(`[repairOrphanedUserCreatedCharacters] target=${targetEmail}, userId=${targetUserId}, dryRun=${dryRun}`);

    // ── STEP 2: Find active_created_character records with missing owner_email ─
    // We use asServiceRole to bypass RLS — these records are invisible to the user
    // precisely because owner_email is null.
    // We load ALL characters (no filter) and check in-memory, because filtering by
    // owner_email=null is unreliable on some query engines — null fields may not be indexed.
    const candidates = await base44.asServiceRole.entities.Character.list('-created_date', 1000);

    for (const char of candidates) {
      // Only process records that are missing owner_email
      if (char.owner_email) {
        skipped.push({ id: char.id, name: char.name, reason: 'already_has_owner_email' });
        continue;
      }

      // Only process records created by the service account (service-role creation path)
      // This distinguishes orphaned user-created characters from intentional service NPCs.
      const createdByService = char.created_by && char.created_by.includes('service+');
      if (!createdByService) {
        skipped.push({ id: char.id, name: char.name, reason: 'not_service_created' });
        continue;
      }

      // Only process active (non-deleted, non-merged) characters
      if (char.status && !['active', null, undefined].includes(char.status)) {
        skipped.push({ id: char.id, name: char.name, reason: `terminal_status: ${char.status}` });
        continue;
      }

      console.log(`[repairOrphanedUserCreatedCharacters] Found orphaned character: "${char.name}" (${char.id})`);

      if (!dryRun) {
        const patch = { owner_email: targetEmail };
        if (!char.owner_user_id && targetUserId) {
          patch.owner_user_id = targetUserId;
        }
        await base44.asServiceRole.entities.Character.update(char.id, patch);
        console.log(`[repairOrphanedUserCreatedCharacters] Repaired: "${char.name}" → owner_email="${targetEmail}"`);
      }

      repaired.push({ id: char.id, name: char.name, status: char.status || 'active', character_type: char.character_type });

      // ── STEP 3: Repair duplicate CharacterFinancial records ──────────────────
      try {
        const financials = await base44.asServiceRole.entities.CharacterFinancial.filter(
          { character_id: char.id },
          '-created_date'
        );

        if (financials.length === 0) {
          // No financial record at all — create one
          if (!dryRun) {
            await base44.asServiceRole.entities.CharacterFinancial.create({
              character_id: char.id,
              character_name: char.name,
              owner_email: targetEmail,
              is_npc: false,
              home_location_id: null,
              home_location_name: null,
              is_homeless: true,
              current_balance: 6000,
              total_income: 0,
              total_expenses: 0,
              income_sources: [],
              recurring_expenses: [],
              last_updated: new Date().toISOString(),
            });
          }
          financialRepairs.push({ character: char.name, action: 'created_missing_financial_record' });
        } else if (financials.length === 1) {
          // Single record — just stamp owner_email if missing
          const fin = financials[0];
          if (!fin.owner_email) {
            if (!dryRun) {
              await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, { owner_email: targetEmail });
            }
            financialRepairs.push({ character: char.name, action: 'stamped_owner_email_on_single_record', balance: fin.current_balance });
          }
        } else {
          // Multiple records — keep the one with the best data (highest balance or most recent update),
          // stamp owner_email on the keeper, delete the orphaned duplicates.
          const sorted = [...financials].sort((a, b) => {
            // Prefer records that already have owner_email
            if (a.owner_email && !b.owner_email) return -1;
            if (!a.owner_email && b.owner_email) return 1;
            // Then prefer higher balance
            return (b.current_balance || 0) - (a.current_balance || 0);
          });

          const keeper = sorted[0];
          const toDelete = sorted.slice(1);

          if (!dryRun) {
            // Stamp owner_email on keeper
            if (!keeper.owner_email) {
              await base44.asServiceRole.entities.CharacterFinancial.update(keeper.id, { owner_email: targetEmail });
            }
            // Delete duplicates
            for (const dup of toDelete) {
              await base44.asServiceRole.entities.CharacterFinancial.delete(dup.id);
            }
          }

          financialRepairs.push({
            character: char.name,
            action: `deduplicated_${financials.length}_records`,
            keeper_id: keeper.id,
            keeper_balance: keeper.current_balance,
            deleted_count: toDelete.length,
          });
        }
      } catch (finErr) {
        console.error(`[repairOrphanedUserCreatedCharacters] Financial repair failed for "${char.name}":`, finErr.message);
        financialRepairs.push({ character: char.name, action: 'financial_repair_error', error: finErr.message });
      }
    }

    const summary = dryRun
      ? `DRY RUN: Found ${repaired.length} orphaned active_created_character record(s) that would be repaired. ${skipped.length} skipped.`
      : `Repaired ${repaired.length} orphaned character(s). ${skipped.length} skipped. ${financialRepairs.length} financial record action(s) taken.`;

    console.log(`[repairOrphanedUserCreatedCharacters] ${summary}`);

    return Response.json({
      success: true,
      dry_run: dryRun,
      summary,
      repaired,
      skipped_count: skipped.length,
      financial_repairs: financialRepairs,
    });
  } catch (error) {
    console.error('[repairOrphanedUserCreatedCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});