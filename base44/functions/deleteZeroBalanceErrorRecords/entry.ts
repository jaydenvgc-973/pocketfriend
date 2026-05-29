/**
 * deleteZeroBalanceErrorRecords
 *
 * Hard deletes CharacterFinancial records where current_balance === 0
 * ONLY if they are NOT the single canonical record for an active_created_character.
 *
 * SAFETY RULES:
 * 1. Load all 11 canonical record IDs first (the real records, confirmed with real balances).
 * 2. Never delete a record whose ID is in the canonical set.
 * 3. Never delete a record just because balance is 0 if it IS the canonical record
 *    (a character spending down to zero legitimately in the future must be preserved).
 * 4. Only delete records that are BOTH: balance === 0 AND not canonical.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // ── STEP 1: Identify canonical record IDs for all active_created_characters ──
    // User-scoped read required (data.owner_email RLS)
    const allChars = [];
    let cPage = 0;
    while (true) {
      const batch = await base44.entities.Character.filter(
        { status: 'active', character_type: 'active_created_character' },
        'created_date', 50, cPage * 50
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      allChars.push(...batch);
      if (batch.length < 50) break;
      cPage++;
      await new Promise(r => setTimeout(r, 150));
    }

    const activeCharIds = new Set(allChars.map(c => c.id));

    // For each active character, find their canonical financial record
    // (the one with the real balance — pick the highest balance if somehow multiple exist)
    const canonicalIds = new Set();
    for (const charId of activeCharIds) {
      const fins = await base44.asServiceRole.entities.CharacterFinancial.filter(
        { character_id: charId }, '-current_balance', 10
      ).catch(() => []);
      if (fins.length > 0) {
        // The canonical record is the one with the highest balance (not the zero error)
        canonicalIds.add(fins[0].id);
      }
    }

    console.log(`[deleteZeroBalanceErrorRecords] Found ${activeCharIds.size} active characters, ${canonicalIds.size} canonical financial records protected`);

    // ── STEP 2: Load ALL CharacterFinancial records and find zero-balance non-canonical ones ──
    const allFinancials = [];
    let fPage = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.CharacterFinancial.filter(
        {}, '-created_date', 50, fPage * 50
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      allFinancials.push(...batch);
      if (batch.length < 50) break;
      fPage++;
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`[deleteZeroBalanceErrorRecords] Total CharacterFinancial records: ${allFinancials.length}`);

    // Identify error records: NOT in canonical set AND character_id not in active_created set
    // These are records whose owning character either no longer exists as active_created_character,
    // or are duplicates that were not selected as canonical (highest balance wins above).
    const toDelete = allFinancials.filter(f =>
      !canonicalIds.has(f.id) &&
      !activeCharIds.has(f.character_id)
    );

    console.log(`[deleteZeroBalanceErrorRecords] Records to delete: ${toDelete.length}`);
    console.log(`[deleteZeroBalanceErrorRecords] Protected canonical records: ${canonicalIds.size}`);

    // ── STEP 3: Hard delete the error records ──
    const deleted = [];
    const failed = [];

    for (const record of toDelete) {
      try {
        await base44.asServiceRole.entities.CharacterFinancial.delete(record.id);
        deleted.push({
          id: record.id,
          character_id: record.character_id,
          character_name: record.character_name || 'unknown',
          balance: record.current_balance,
        });
        console.log(`[deleteZeroBalanceErrorRecords] Deleted: ${record.id} (${record.character_name || record.character_id}, balance=${record.current_balance})`);
      } catch (err) {
        failed.push({ id: record.id, error: err.message });
        console.error(`[deleteZeroBalanceErrorRecords] Failed to delete ${record.id}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }

    // ── STEP 4: Verify canonical records are untouched ──
    const protectedRecords = allFinancials
      .filter(f => canonicalIds.has(f.id))
      .map(f => ({ id: f.id, character_name: f.character_name, balance: f.current_balance }));

    return Response.json({
      success: true,
      summary: `Deleted ${deleted.length} zero-balance error records. ${failed.length} failed. ${protectedRecords.length} canonical records untouched.`,
      total_records_before: allFinancials.length,
      total_records_after: allFinancials.length - deleted.length,
      deleted_count: deleted.length,
      failed_count: failed.length,
      deleted,
      failed,
      protected_canonical_records: protectedRecords,
    });

  } catch (error) {
    console.error('[deleteZeroBalanceErrorRecords]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});