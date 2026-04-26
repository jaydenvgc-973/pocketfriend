import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * TRACE: Find all Character records regardless of status.
 * Check if missing 22 records are hidden in different status values.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Query each status value individually
    const statuses = ['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'];
    const resultsByStatus = {};
    let totalRecords = 0;

    for (const status of statuses) {
      const records = await base44.asServiceRole.entities.Character.filter(
        { status },
        null,
        1000
      );
      resultsByStatus[status] = {
        count: records.length,
        names: records.map(r => r.name)
      };
      totalRecords += records.length;
    }

    // Also query with NO status filter at all
    const allRecords = await base44.asServiceRole.entities.Character.list(
      null,
      1000
    );

    return Response.json({
      TRACE: 'CHARACTER_STATUS_AUDIT',
      user_email: user.email,
      expected_from_export: 43,
      results_by_status: resultsByStatus,
      total_by_status: Object.values(resultsByStatus).reduce((s, r) => s + r.count, 0),
      total_from_unfiltered_list: allRecords.length,
      unfiltered_names: allRecords.map(c => c.name),
      DISCREPANCY: 43 - allRecords.length,
      KEY_FINDING: allRecords.length === 21 ? 'Status filter is NOT the issue — even unfiltered returns 21' : 'Discrepancy resolved — found all records'
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});