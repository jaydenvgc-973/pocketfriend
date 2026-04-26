import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * TRACE EXPORT VS DIAGNOSTIC
 * 
 * Find exactly why the export shows 43 records but diagnostic shows 21.
 * Compare the EXACT data sources side by side.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userEmail = user.email;

    // ── ATTEMPT 1: Standard user SDK (no service role) ────────────────────────
    // This is what the dashboard UI would use
    const userList1 = await base44.entities.Character.list();
    const userList1Count = userList1.length;
    const userList1Names = userList1.map(c => c.name);

    // ── ATTEMPT 2: Service role with no params ──────────────────────────────
    const serviceList1 = await base44.asServiceRole.entities.Character.list();
    const serviceList1Count = serviceList1.length;
    const serviceList1Names = serviceList1.map(c => c.name);

    // ── ATTEMPT 3: Filter by owner_email (user context) ─────────────────────
    const userFiltered = await base44.entities.Character.filter({ owner_email: userEmail });
    const userFilteredCount = userFiltered.length;
    const userFilteredNames = userFiltered.map(c => c.name);

    // ── ATTEMPT 4: Service role + owner_email filter ──────────────────────
    const serviceFiltered = await base44.asServiceRole.entities.Character.filter({ owner_email: userEmail });
    const serviceFilteredCount = serviceFiltered.length;
    const serviceFilteredNames = serviceFiltered.map(c => c.name);

    // ── ATTEMPT 5: created_by filter (user context) ──────────────────────────
    const userByCreated = await base44.entities.Character.filter({ created_by: userEmail });
    const userByCreatedCount = userByCreated.length;
    const userByCreatedNames = userByCreated.map(c => c.name);

    // ── ATTEMPT 6: Service role + created_by filter ──────────────────────────
    const serviceByCreated = await base44.asServiceRole.entities.Character.filter({ created_by: userEmail });
    const serviceByCreatedCount = serviceByCreated.length;
    const serviceByCreatedNames = serviceByCreated.map(c => c.name);

    // ── ATTEMPT 7: Raw list with very high limit (user context) ──────────────
    const userListHigh = await base44.entities.Character.list(null, 10000);
    const userListHighCount = userListHigh.length;

    // ── ATTEMPT 8: Raw list with very high limit (service role) ──────────────
    const serviceListHigh = await base44.asServiceRole.entities.Character.list(null, 10000);
    const serviceListHighCount = serviceListHigh.length;

    // ── ATTEMPT 9: Inspect first record structure ──────────────────────────────
    const firstRecord = serviceListHigh[0];
    const topLevelKeys = firstRecord ? Object.keys(firstRecord) : [];
    const hasCharacterTypeTopLevel = topLevelKeys.includes('character_type');
    const hasOwnerEmailTopLevel = topLevelKeys.includes('owner_email');

    // ── BUILD COMPARISON MATRIX ──────────────────────────────────────────────
    const matrix = [
      { method: 'User SDK list()', count: userList1Count, names: userList1Names },
      { method: 'Service Role list()', count: serviceList1Count, names: serviceList1Names },
      { method: 'User filter(owner_email)', count: userFilteredCount, names: userFilteredNames },
      { method: 'Service filter(owner_email)', count: serviceFilteredCount, names: serviceFilteredNames },
      { method: 'User filter(created_by)', count: userByCreatedCount, names: userByCreatedNames },
      { method: 'Service filter(created_by)', count: serviceByCreatedCount, names: serviceByCreatedNames },
      { method: 'User list(null, 10000)', count: userListHighCount, names: 'see_field_below' },
      { method: 'Service list(null, 10000)', count: serviceListHighCount, names: 'see_field_below' },
    ];

    // ── FIND HIGHEST COUNT ──────────────────────────────────────────────────
    const maxCount = Math.max(...matrix.map(m => m.count));

    // ── DEDUPLICATE AND FIND UNION ──────────────────────────────────────────
    const allNames = new Set();
    matrix.forEach(m => {
      if (Array.isArray(m.names)) {
        m.names.forEach(n => allNames.add(n));
      }
    });

    // ── IDENTIFY WHICH METHODS REACH 43 ──────────────────────────────────────
    const reachesHighCount = matrix.filter(m => m.count >= 40);

    return Response.json({
      user_email: userEmail,
      expected_from_export: 43,
      first_record_structure: {
        has_character_type_top_level: hasCharacterTypeTopLevel,
        has_owner_email_top_level: hasOwnerEmailTopLevel,
        top_level_keys: topLevelKeys.length,
        sample_keys: topLevelKeys.slice(0, 15),
      },
      method_comparison: matrix,
      highest_single_method_count: maxCount,
      methods_reaching_40_plus: reachesHighCount.map(m => m.method),
      total_unique_names_across_all_methods: allNames.size,
      unique_names: Array.from(allNames).sort(),
      DATA_SOURCE_MISMATCH: maxCount < 43 ? 'CONFIRMED' : 'NOT_FOUND',
      mismatch_detail: {
        export_shows: 43,
        highest_query_returns: maxCount,
        gap: 43 - maxCount,
        explanation: maxCount < 43 
          ? 'At least one data source is filtering or truncating records'
          : 'Export and queries return same data — no mismatch detected'
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});