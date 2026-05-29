/**
 * deleteZeroBalanceErrorRecords
 *
 * Hard-deletes CharacterFinancial records that are confirmed errors:
 * - current_balance === 0 (exactly zero, not just low)
 * - AND another CharacterFinancial record exists for the same character_id with a real balance > 0
 *
 * This means: only deletes the zero-balance DUPLICATE when the real record exists.
 * It does NOT delete a zero-balance record if it is the ONLY record for that character
 * (that would be a legitimate zero from spending, not an error record).
 *
 * Also covers ALL character types — not just active_created_character.
 * NPCs, family members, fictitious characters — all character types have financial records
 * with a default of $6,000. A record showing exactly $0 alongside a real record is an error.
 *
 * SAFETY RULES:
 * - Only deletes when a sibling record with balance > 0 exists for the same character_id
 * - Never deletes the last/only record for a character
 * - Never deletes records with balance > 0
 * - Admin only
 * - Dry-run mode available (pass { dry_run: true } to preview without deleting)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // Default to dry_run=true for safety

    // ── Load ALL CharacterFinancial records (no RLS on this entity) ──
    const allFinancials = [];
    let fPage = 0;
    const PAGE = 50;
    while (true) {
      const batch = await base44.asServiceRole.entities.CharacterFinancial.filter(
        {},
        '-created_date',
        PAGE,
        fPage * PAGE
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      allFinancials.push(...batch);
      if (batch.length < PAGE) break;
      fPage++;
      await new Promise(r => setTimeout(r, 150));
    }

    // ── Group by character_id ──
    const byCharId = new Map();
    for (const fin of allFinancials) {
      const cid = fin.character_id;
      if (!cid) continue;
      if (!byCharId.has(cid)) byCharId.set(cid, []);
      byCharId.get(cid).push(fin);
    }

    // ── Identify error records to delete ──
    // Rule: a record is an error if:
    //   1. current_balance === 0 (exactly zero)
    //   2. At least one OTHER record for the same character_id has current_balance > 0
    const toDelete = [];
    const safeZeros = []; // zero-balance records that are the ONLY record — do not delete

    for (const [charId, records] of byCharId.entries()) {
      if (records.length === 1) {
        // Only one record — if it's zero, it may be legitimate (character spent all money)
        // Do NOT delete it
        if (records[0].current_balance === 0) {
          safeZeros.push({
            character_id: charId,
            character_name: records[0].character_name || 'unknown',
            record_id: records[0].id,
            reason: 'only_record_for_character — cannot confirm it is an error',
          });
        }
        continue;
      }

      // Multiple records — find which ones are zero-balance errors
      const realRecords = records.filter(r => (r.current_balance ?? 0) > 0);
      const zeroRecords = records.filter(r => (r.current_balance ?? 0) === 0);

      if (realRecords.length > 0 && zeroRecords.length > 0) {
        // Confirmed: real record(s) exist with balance > 0, zero-balance records are errors
        for (const zr of zeroRecords) {
          toDelete.push({
            record_id: zr.id,
            character_id: charId,
            character_name: zr.character_name || records[0].character_name || 'unknown',
            zero_balance: zr.current_balance,
            real_record_id: realRecords[0].id,
            real_balance: realRecords[0].current_balance,
          });
        }
      }
    }

    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        message: 'DRY RUN — no records deleted. Pass { dry_run: false } to execute.',
        total_financial_records: allFinancials.length,
        characters_with_financials: byCharId.size,
        error_records_identified: toDelete.length,
        safe_zeros_not_deleted: safeZeros.length,
        records_to_delete: toDelete,
        safe_zeros: safeZeros,
      });
    }

    // ── Execute hard deletes ──
    const deleted = [];
    const failed = [];

    for (const rec of toDelete) {
      try {
        await base44.asServiceRole.entities.CharacterFinancial.delete(rec.record_id);
        deleted.push(rec);
        console.log(`[deleteZeroBalanceErrorRecords] DELETED: ${rec.character_name} (char: ${rec.character_id}) record ${rec.record_id} — was $0, real record is $${rec.real_balance}`);
      } catch (err) {
        failed.push({ ...rec, error: err.message });
        console.error(`[deleteZeroBalanceErrorRecords] FAILED to delete ${rec.record_id}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return Response.json({
      success: true,
      dry_run: false,
      total_financial_records_before: allFinancials.length,
      error_records_found: toDelete.length,
      deleted_count: deleted.length,
      failed_count: failed.length,
      safe_zeros_preserved: safeZeros.length,
      deleted,
      failed,
      safe_zeros_not_touched: safeZeros,
    });

  } catch (error) {
    console.error('[deleteZeroBalanceErrorRecords]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});