import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * backfillFinancialsForAllCharacters
 *
 * CANONICAL RULE: CharacterFinancial records belong to characters, not to owner_email.
 * 
 * PREVIOUS BUG (now fixed): backfillCharacterFinancialOwnerEmail skipped any character
 * where char.owner_email was missing/null. This excluded service-created, automation-created,
 * NPC, lifecycle-generated, and imported characters from financial records permanently.
 *
 * THIS FUNCTION:
 * - Fetches ALL Character records (no owner_email filter)
 * - Fetches ALL CharacterFinancial records
 * - Creates missing CharacterFinancial records for EVERY character that lacks one
 * - The ONLY exclusion is confirmed deleted/merged/soft_deleted status
 * - owner_email is stored on the financial record when available (for RLS-scoped reads)
 *   but is NOT required for record creation
 *
 * SUCCESS CONDITION: character count == CharacterFinancial count (excluding deleted/merged)
 *
 * Safe to run multiple times. Does not delete or alter existing records.
 * Admin only.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    console.log('[backfillFinancialsForAllCharacters] Starting character-scoped financial backfill...');

    // ── STEP 1: Load ALL characters — no owner_email filter ───────────────────
    // CRITICAL: Do NOT filter by owner_email here. Characters created by service accounts,
    // automations, lifecycle events, and NPC systems may have no owner_email on the
    // Character record, but they are still valid world citizens who need financial records.
    const allCharacters = await base44.asServiceRole.entities.Character.list(null, 1000);
    
    console.log(`[backfillFinancialsForAllCharacters] Loaded ${allCharacters.length} total characters`);

    // Exclude only confirmed removed records — NOT missing-owner_email records
    const eligibleCharacters = allCharacters.filter(char => {
      if (!char.id || !char.name) return false; // corrupt record — no id or name
      if (char.status === 'deleted') return false;
      if (char.status === 'soft_deleted') return false;
      if (char.status === 'merged') return false;
      return true;
    });

    console.log(`[backfillFinancialsForAllCharacters] ${eligibleCharacters.length} eligible characters (excluded ${allCharacters.length - eligibleCharacters.length} deleted/merged)`);

    // ── STEP 2: Load ALL existing CharacterFinancial records ──────────────────
    const allFinancials = await base44.asServiceRole.entities.CharacterFinancial.list(null, 1000);
    const existingCharacterIds = new Set(allFinancials.map(f => f.character_id).filter(Boolean));

    console.log(`[backfillFinancialsForAllCharacters] ${existingCharacterIds.size} existing CharacterFinancial records`);

    // ── STEP 3: Identify characters with no financial record ──────────────────
    const missing = eligibleCharacters.filter(char => !existingCharacterIds.has(char.id));

    console.log(`[backfillFinancialsForAllCharacters] ${missing.length} characters need financial records created`);

    if (missing.length === 0) {
      return Response.json({
        success: true,
        message: 'All characters already have CharacterFinancial records.',
        total_characters: eligibleCharacters.length,
        existing_financial_records: existingCharacterIds.size,
        created: 0,
        errors: 0,
      });
    }

    // ── STEP 4: Create missing records — character-scoped, no owner_email required ──
    let created = 0;
    let errors = 0;
    const createReport = [];

    for (const char of missing) {
      try {
        const isNpc = (
          char.character_type === 'npc_regular' ||
          char.character_type === 'npc_family_member' ||
          char.character_type === 'npc_fictitious'
        );

        await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: char.id,
          character_name: char.name,
          // owner_email stored when available — for RLS-scoped reads on the finance page.
          // Null when absent (service/automation-created chars). Record is still valid and created.
          owner_email: char.owner_email || null,
          is_npc: isNpc,
          home_location_id: char.current_home_location_id || char.home_location_id || null,
          home_location_name: null, // avoids stale name — will be updated by financial systems
          is_homeless: !(char.current_home_location_id || char.home_location_id),
          current_balance: 6000,
          total_income: 0,
          total_expenses: 0,
          income_sources: [],
          recurring_expenses: [],
          other_monthly_expenses: [],
          last_updated: new Date().toISOString(),
        });

        existingCharacterIds.add(char.id);
        createReport.push({
          character_id: char.id,
          character_name: char.name,
          character_type: char.character_type || 'unknown',
          owner_email: char.owner_email || null,
          result: 'created',
        });
        created++;

        // Pace writes to avoid 429 — 200ms between creates
        await new Promise(r => setTimeout(r, 200));

      } catch (err) {
        console.error(`[backfillFinancialsForAllCharacters] Failed to create for ${char.name} (${char.id}):`, err.message);
        createReport.push({
          character_id: char.id,
          character_name: char.name,
          character_type: char.character_type || 'unknown',
          result: 'error',
          error: err.message,
        });
        errors++;
      }
    }

    // ── STEP 5: Verification — count should now reconcile ─────────────────────
    const finalFinancials = await base44.asServiceRole.entities.CharacterFinancial.list(null, 1000);
    const finalCount = finalFinancials.filter(f => f.character_id).length;
    const reconciled = finalCount >= eligibleCharacters.length;

    console.log(`[backfillFinancialsForAllCharacters] Complete. Created: ${created}, Errors: ${errors}, Final financial count: ${finalCount}, Eligible chars: ${eligibleCharacters.length}, Reconciled: ${reconciled}`);

    return Response.json({
      success: true,
      total_characters_scanned: allCharacters.length,
      eligible_characters: eligibleCharacters.length,
      existing_before: existingCharacterIds.size - created,
      created,
      errors,
      final_financial_record_count: finalCount,
      reconciled,
      reconciliation_note: reconciled
        ? 'SUCCESS: All eligible characters now have CharacterFinancial records.'
        : `WARNING: ${eligibleCharacters.length - finalCount} characters may still be missing records. Re-run to resolve.`,
      // Include full report for audit
      created_records: createReport.filter(r => r.result === 'created'),
      errored_records: createReport.filter(r => r.result === 'error'),
    });

  } catch (error) {
    console.error('[backfillFinancialsForAllCharacters] Fatal error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});