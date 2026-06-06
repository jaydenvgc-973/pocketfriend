import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * auditAllVickRecords — READ ONLY, NO WRITES
 *
 * Full service-role audit of every Vick Servicio character record
 * and every VGC Recovery Yard across both accounts.
 * Returns complete proof: id, owner_email, character_type, status,
 * and linked yard for each record found.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // ── 1. Find ALL Vick Servicio characters via service role ─────────────────
    // Strategy: multiple filter passes to catch records regardless of character_type field
    const pass1 = await base44.asServiceRole.entities.Character.filter(
      { name: 'Vick Servicio' }, '-created_date', 100
    ).catch(() => []);

    const pass2 = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_world_service' }, '-created_date', 100
    ).catch(() => []);

    const pass3 = await base44.asServiceRole.entities.Character.filter(
      { full_name: 'Victor Servicio' }, '-created_date', 100
    ).catch(() => []);

    // Merge + deduplicate
    const seen = new Set();
    const allVicks = [];
    for (const c of [...pass1, ...pass2, ...pass3]) {
      if (!c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      allVicks.push(c);
    }

    // ── 2. Find ALL VGC Recovery Yards via service role ───────────────────────
    const allYards = await base44.asServiceRole.entities.LocationReference.filter(
      { name: 'VGC Recovery Yard' }, '-created_date', 50
    ).catch(() => []);

    // ── 3. Build proof report ─────────────────────────────────────────────────
    const vickReport = allVicks.map(c => ({
      id: c.id,
      name: c.name,
      full_name: c.full_name,
      owner_email: c.owner_email,
      character_type: c.character_type,
      status: c.status,
      is_world_service: c.is_world_service,
      is_protected: c.is_protected,
      current_home_location_id: c.current_home_location_id,
      resolved_current_location_id: c.resolved_current_location_id,
      created_date: c.created_date,
    }));

    const yardReport = allYards.map(y => ({
      id: y.id,
      name: y.name,
      owner_email: y.owner_email,
      owner_character_id: y.owner_character_id,
      owner_character_name: y.owner_character_name,
      worker_character_ids: y.worker_character_ids,
      resident_character_ids: y.resident_character_ids,
      created_date: y.created_date,
    }));

    // ── 4. Cross-reference: does each yard's owner_character_id exist in vickReport?
    const crossCheck = yardReport.map(y => {
      const linkedVick = vickReport.find(v => v.id === y.owner_character_id);
      return {
        yard_id: y.id,
        yard_owner_email: y.owner_email,
        owner_character_id: y.owner_character_id,
        linked_vick_found: !!linkedVick,
        linked_vick_owner_email: linkedVick?.owner_email || null,
        linked_vick_status: linkedVick?.status || null,
        mismatch: linkedVick ? linkedVick.owner_email !== y.owner_email : true,
      };
    });

    // ── 5. Account groupings ───────────────────────────────────────────────────
    const byAccount = {};
    for (const v of vickReport) {
      const acct = v.owner_email || 'NO_OWNER_EMAIL';
      if (!byAccount[acct]) byAccount[acct] = [];
      byAccount[acct].push(v);
    }

    const yardsByAccount = {};
    for (const y of yardReport) {
      const acct = y.owner_email || 'NO_OWNER_EMAIL';
      if (!yardsByAccount[acct]) yardsByAccount[acct] = [];
      yardsByAccount[acct].push(y);
    }

    // ── 6. Verdict ────────────────────────────────────────────────────────────
    const problems = [];
    for (const [acct, vicks] of Object.entries(byAccount)) {
      const active = vicks.filter(v => v.status === 'active');
      if (active.length === 0) problems.push(`${acct}: NO active Vick`);
      if (active.length > 1) problems.push(`${acct}: ${active.length} active Vicks (duplicates)`);
    }
    for (const cc of crossCheck) {
      if (!cc.linked_vick_found) problems.push(`Yard ${cc.yard_id} (${cc.yard_owner_email}): owner_character_id ${cc.owner_character_id} NOT FOUND in any Vick record`);
      if (cc.mismatch && cc.linked_vick_found) problems.push(`Yard ${cc.yard_id}: owner_email mismatch — yard=${cc.yard_owner_email}, linked vick owner=${cc.linked_vick_owner_email}`);
    }

    console.log(`[auditAllVickRecords] Total Vick records: ${allVicks.length}`);
    console.log(`[auditAllVickRecords] Total Recovery Yards: ${allYards.length}`);
    console.log(`[auditAllVickRecords] Problems: ${problems.length}`);
    problems.forEach(p => console.log(`  PROBLEM: ${p}`));

    return Response.json({
      success: true,
      total_vick_records: allVicks.length,
      total_recovery_yards: allYards.length,
      problems_found: problems.length,
      problems,
      vick_records: vickReport,
      recovery_yards: yardReport,
      cross_check: crossCheck,
      by_account: byAccount,
      yards_by_account: yardsByAccount,
    });

  } catch (error) {
    console.error('[auditAllVickRecords]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});