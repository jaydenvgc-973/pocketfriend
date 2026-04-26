import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── QUERY 1: All records with status = active ──────────────────────────
    const statusActive = await base44.asServiceRole.entities.Character.filter(
      { status: 'active' },
      null,
      10000
    );

    // ── QUERY 2: All records with status = moved_away ───────────────────────
    const statusMovedAway = await base44.asServiceRole.entities.Character.filter(
      { status: 'moved_away' },
      null,
      10000
    );

    // ── QUERY 3: All records with status = deleted ─────────────────────────
    const statusDeleted = await base44.asServiceRole.entities.Character.filter(
      { status: 'deleted' },
      null,
      10000
    );

    // ── QUERY 4: All records with status = soft_deleted ────────────────────
    const statusSoftDeleted = await base44.asServiceRole.entities.Character.filter(
      { status: 'soft_deleted' },
      null,
      10000
    );

    // ── QUERY 5: All records with status = merged ──────────────────────────
    const statusMerged = await base44.asServiceRole.entities.Character.filter(
      { status: 'merged' },
      null,
      10000
    );

    // ── QUERY 6: ALL records (truly unrestricted) ──────────────────────────
    const absolutely_all = await base44.asServiceRole.entities.Character.filter(
      {},
      null,
      10000
    );

    // ── BREAKDOWN ──────────────────────────────────────────────────────────
    const breakdown = {};
    for (const char of absolutely_all) {
      const status = char.status || 'NULL_STATUS';
      const type = char.character_type || 'unknown';
      const key = `${status}::${type}`;
      if (!breakdown[key]) breakdown[key] = [];
      breakdown[key].push(char.name);
    }

    // ── EXTRACT MISSING CHARACTERS ─────────────────────────────────────────
    const statusGroups = {
      active: statusActive,
      moved_away: statusMovedAway,
      deleted: statusDeleted,
      soft_deleted: statusSoftDeleted,
      merged: statusMerged
    };

    const activeCreatedByStatus = {};
    const npcFictitiousByStatus = {};
    for (const [statusVal, records] of Object.entries(statusGroups)) {
      activeCreatedByStatus[statusVal] = records.filter(c => c.character_type === 'active_created_character');
      npcFictitiousByStatus[statusVal] = records.filter(c => c.character_type === 'npc_fictitious');
    }

    return Response.json({
      summary: {
        total_all_records: absolutely_all.length,
        expected_from_export: 43,
        records_found: {
          status_active: statusActive.length,
          status_moved_away: statusMovedAway.length,
          status_deleted: statusDeleted.length,
          status_soft_deleted: statusSoftDeleted.length,
          status_merged: statusMerged.length,
          grand_total: statusActive.length + statusMovedAway.length + statusDeleted.length + statusSoftDeleted.length + statusMerged.length
        }
      },
      breakdown_by_status_and_type: breakdown,
      active_created_character_by_status: {
        active: activeCreatedByStatus.active.map(c => c.name),
        moved_away: activeCreatedByStatus.moved_away.map(c => c.name),
        deleted: activeCreatedByStatus.deleted.map(c => c.name),
        soft_deleted: activeCreatedByStatus.soft_deleted.map(c => c.name),
        merged: activeCreatedByStatus.merged.map(c => c.name)
      },
      npc_fictitious_by_status: {
        active: npcFictitiousByStatus.active.map(c => c.name),
        moved_away: npcFictitiousByStatus.moved_away.map(c => c.name),
        deleted: npcFictitiousByStatus.deleted.map(c => c.name),
        soft_deleted: npcFictitiousByStatus.soft_deleted.map(c => c.name),
        merged: npcFictitiousByStatus.merged.map(c => c.name)
      },
      all_active_created_characters: {
        total_found: absolutely_all.filter(c => c.character_type === 'active_created_character').length,
        list: absolutely_all.filter(c => c.character_type === 'active_created_character').map(c => ({
          name: c.name,
          status: c.status,
          owner_email: c.owner_email,
          created_by: c.created_by
        }))
      },
      diagnosis: {
        missing_from_active_only_query: 15 - (activeCreatedByStatus.active?.length || 0),
        records_in_non_active_statuses: statusMovedAway.length + statusDeleted.length + statusSoftDeleted.length + statusMerged.length,
        is_service_role_working: absolutely_all.length > 21 ? 'YES - found non-active records' : 'NO - service role may be restricted'
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});