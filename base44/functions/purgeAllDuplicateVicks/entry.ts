import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * purgeAllDuplicateVicks
 *
 * Service-role scan across ALL accounts.
 * For each account (owner_email), keeps only the NEWEST Vick Servicio record
 * (by created_date) and hard-deletes all older duplicates.
 *
 * Safety rules:
 * - Only targets character_type = 'npc_world_service' AND name = 'Vick Servicio'
 * - Keeps the most-recently-created record per account (canonical)
 * - Never deletes the last remaining Vick for any account
 * - dry_run=true (default) previews without deleting
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { dry_run = true } = await req.json().catch(() => ({}));

    // Service-role fetch ALL npc_world_service characters across all accounts
    const allVicks = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_world_service' },
      '-created_date',
      200
    );

    // Further filter to only "Vick Servicio" by name
    const vickRecords = allVicks.filter(c =>
      c.name === 'Vick Servicio' || c.display_name === 'Vick Servicio' || c.full_name === 'Victor Servicio'
    );

    console.log(`[purgeAllDuplicateVicks] Total Vick records found: ${vickRecords.length}`);

    // Group by owner_email (or created_by as fallback)
    const byAccount = {};
    for (const v of vickRecords) {
      const key = v.owner_email || v.created_by || 'unknown';
      if (!byAccount[key]) byAccount[key] = [];
      byAccount[key].push(v);
    }

    const report = {};
    const deleted = [];
    const failed = [];
    const kept = [];

    for (const [account, records] of Object.entries(byAccount)) {
      // Sort newest first (created_date descending)
      records.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

      const canonical = records[0];
      const duplicates = records.slice(1);

      kept.push({ account, id: canonical.id, created_date: canonical.created_date });

      report[account] = {
        total: records.length,
        canonical_id: canonical.id,
        canonical_created: canonical.created_date,
        duplicates_count: duplicates.length,
        duplicate_ids: duplicates.map(d => d.id),
      };

      console.log(`[purgeAllDuplicateVicks] Account=${account}: ${records.length} Vicks, keeping ${canonical.id}, deleting ${duplicates.length}`);

      if (!dry_run) {
        for (const dup of duplicates) {
          try {
            await base44.asServiceRole.entities.Character.delete(dup.id);
            deleted.push({ account, id: dup.id });
            console.log(`[purgeAllDuplicateVicks] DELETED ${dup.id} for ${account}`);
          } catch (err) {
            failed.push({ account, id: dup.id, error: err.message });
            console.error(`[purgeAllDuplicateVicks] FAILED to delete ${dup.id}: ${err.message}`);
          }
        }
      }
    }

    const totalDuplicates = Object.values(report).reduce((sum, r) => sum + r.duplicates_count, 0);

    return Response.json({
      success: true,
      dry_run,
      total_vick_records: vickRecords.length,
      total_duplicates_found: totalDuplicates,
      accounts_affected: Object.keys(report).length,
      per_account: report,
      kept,
      deleted: dry_run ? [] : deleted,
      failed: dry_run ? [] : failed,
      message: dry_run
        ? `DRY RUN: Would delete ${totalDuplicates} duplicate Vick records across ${Object.keys(report).length} accounts.`
        : `EXECUTED: Deleted ${deleted.length} duplicates. Failed: ${failed.length}.`,
    });

  } catch (error) {
    console.error('[purgeAllDuplicateVicks]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});