import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * initializeCharacterFinancials
 *
 * Idempotent financial record initializer. Safe to call at any time.
 *
 * OWNERSHIP RULE: owner_email is always read from the saved Character record,
 * never from the calling user session. This prevents service-account contamination
 * and ensures all financial records are ownership-consistent with their parent character.
 *
 * IDEMPOTENCY RULE:
 * - If a CharacterFinancial record already exists for this character, this function
 *   only backfills a missing owner_email — it never resets balances, transactions,
 *   or any other financial data.
 * - If no record exists, it creates one with the correct owner_email and default balance.
 * - It will never create a duplicate. One record per character. Always.
 *
 * DUPLICATE GUARD: If multiple records are found (pipeline debris), the keeper is the
 * record with the highest balance. All others are deleted to prevent dashboard/ownership
 * confusion. The keeper's owner_email is backfilled if missing.
 *
 * This function is called by:
 * - The onCharacterCreated automation (primary path — runs automatically on creation)
 * - Admin backfill tools (repair path — safe to call manually)
 *
 * It must NOT be called from the CreateCharacter frontend page directly, because:
 * - The frontend call runs before onCharacterCreated has a chance to fire
 * - The frontend call uses the user session which may not match service-role context
 * - This creates a race condition that produces duplicate ownerless records
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const characterId = body.characterId || body.character_id;
    const characterName = body.characterName || body.character_name;

    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    // ── STEP 1: Read owner_email from the authoritative Character record ──────
    // NEVER use user.email as owner_email for financial records.
    // The character record itself is the single source of truth for ownership.
    const character = await base44.asServiceRole.entities.Character.get(characterId);
    if (!character) {
      return Response.json({ error: `Character ${characterId} not found` }, { status: 404 });
    }

    const ownerEmail = character.owner_email || null;
    const resolvedName = characterName || character.name;
    const isNpc = ['npc_regular', 'npc_family_member', 'npc_fictitious', 'npc_world_service'].includes(character.character_type);

    if (!ownerEmail) {
      console.error(`[initializeCharacterFinancials] Character "${resolvedName}" (${characterId}) has no owner_email. Cannot initialize financials without ownership.`);
      return Response.json({
        success: false,
        error: 'Character has no owner_email. Financial record cannot be created without ownership.',
        character_id: characterId,
      }, { status: 422 });
    }

    // ── STEP 2: Check for existing financial records ───────────────────────────
    const existing = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId });

    if (existing.length === 1) {
      const record = existing[0];
      // Backfill missing owner_email only — never touch balances
      if (!record.owner_email) {
        await base44.asServiceRole.entities.CharacterFinancial.update(record.id, { owner_email: ownerEmail });
        console.log(`[initializeCharacterFinancials] Backfilled owner_email on existing record for "${resolvedName}"`);
        return Response.json({ success: true, action: 'backfilled_owner_email', financial_record_id: record.id });
      }
      // Already correct — nothing to do
      return Response.json({ success: true, action: 'already_initialized', financial_record_id: record.id, current_balance: record.current_balance });
    }

    if (existing.length > 1) {
      // Duplicate records — deduplicate: keep the highest balance, delete the rest
      const sorted = [...existing].sort((a, b) => {
        if (a.owner_email && !b.owner_email) return -1;
        if (!a.owner_email && b.owner_email) return 1;
        return (b.current_balance || 0) - (a.current_balance || 0);
      });
      const keeper = sorted[0];
      const toDelete = sorted.slice(1);
      for (const dup of toDelete) {
        await base44.asServiceRole.entities.CharacterFinancial.delete(dup.id);
        console.log(`[initializeCharacterFinancials] Deleted duplicate financial record ${dup.id} for "${resolvedName}"`);
      }
      if (!keeper.owner_email) {
        await base44.asServiceRole.entities.CharacterFinancial.update(keeper.id, { owner_email: ownerEmail });
      }
      return Response.json({
        success: true,
        action: `deduplicated_${existing.length}_records`,
        financial_record_id: keeper.id,
        deleted_count: toDelete.length,
        current_balance: keeper.current_balance,
      });
    }

    // ── STEP 3: No record exists — create one ─────────────────────────────────
    const newRecord = await base44.asServiceRole.entities.CharacterFinancial.create({
      character_id: characterId,
      character_name: resolvedName,
      owner_email: ownerEmail,
      is_npc: isNpc,
      home_location_id: character.current_home_location_id || null,
      home_location_name: null,
      is_homeless: !character.current_home_location_id,
      current_balance: 6000,
      total_income: 0,
      total_expenses: 0,
      income_sources: [],
      recurring_expenses: [],
      last_updated: new Date().toISOString(),
    });

    console.log(`[initializeCharacterFinancials] Created financial record for "${resolvedName}" (${characterId}) owner=${ownerEmail}`);

    return Response.json({
      success: true,
      action: 'created',
      financial_record_id: newRecord.id,
      initial_balance: 6000,
      owner_email: ownerEmail,
    });
  } catch (error) {
    console.error('[initializeCharacterFinancials]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});