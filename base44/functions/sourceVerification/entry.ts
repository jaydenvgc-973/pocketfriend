import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── QUERY 1: Default list() with no parameters ─────────────────────────
    const defaultList = await base44.asServiceRole.entities.Character.list();
    
    // ── QUERY 2: list() with very high limit ───────────────────────────────
    const unlimitedList = await base44.asServiceRole.entities.Character.list(null, 10000);

    // ── QUERY 3: Get all via filter with no constraints ───────────────────
    const allViaFilter = await base44.asServiceRole.entities.Character.filter({}, null, 10000);

    // ── QUERY 4: Filter by status = active only ────────────────────────────
    const statusActive = await base44.asServiceRole.entities.Character.filter(
      { status: 'active' },
      null,
      10000
    );

    // ── QUERY 5: Filter to include all statuses ────────────────────────────
    const allStatuses = await base44.asServiceRole.entities.Character.filter(
      { status: { $in: ['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'] } },
      null,
      10000
    );

    // ── QUERY 6: Count by character_type ──────────────────────────────────
    const allRecords = unlimitedList;
    const typeBreakdown = {};
    for (const char of allRecords) {
      const type = char.character_type || 'unknown';
      if (!typeBreakdown[type]) typeBreakdown[type] = [];
      typeBreakdown[type].push(char.name);
    }

    return Response.json({
      source_verification: {
        entity_queried: 'Character',
        app_id: user.id,
        user_email: user.email,
        service_role_used: true,
        environment: 'production (assumed)'
      },
      queries: {
        default_list_no_params: {
          returned: defaultList.length,
          records: defaultList.map(c => ({ name: c.name, status: c.status, type: c.character_type }))
        },
        list_with_10000_limit: {
          returned: unlimitedList.length,
          limit_applied: 10000
        },
        filter_empty_10000_limit: {
          returned: allViaFilter.length,
          filter: '{}',
          limit_applied: 10000
        },
        filter_status_active_only: {
          returned: statusActive.length,
          filter: 'status: active'
        },
        filter_all_statuses: {
          returned: allStatuses.length,
          filter: 'status: {$in: [active, moved_away, deleted, soft_deleted, merged]}'
        }
      },
      character_breakdown: {
        total_found: unlimitedList.length,
        by_type: typeBreakdown,
        expected_from_export: 43,
        discrepancy: 43 - unlimitedList.length
      },

      diagnosis: {
        queries_match: defaultList.length === unlimitedList.length && unlimitedList.length === allViaFilter.length,
        all_records_retrieved: unlimitedList.length === 43,
        missing_count: 43 - unlimitedList.length,
        possible_causes: [
          unlimitedList.length < 43 ? 'Records may be archived/soft-deleted and excluded by default' : null,
          unlimitedList.length < 43 ? 'RLS rules may be filtering records despite service role' : null,
          unlimitedList.length < 43 ? 'Multiple Character entities may exist' : null,
          unlimitedList.length < 43 ? 'Export may contain records from different app or account' : null,
          defaultList.length !== unlimitedList.length ? 'Default pagination limit is cutting off records' : null
        ].filter(Boolean)
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});