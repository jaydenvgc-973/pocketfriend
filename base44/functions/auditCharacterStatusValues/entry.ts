import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * TRACE: Check what status values actually exist in Character records.
 * If backend is missing records, they might have a status value not in the enum.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Status enum from Character entity definition
    const statusEnum = ['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'];

    // Get ALL records (no filter, no status constraint)
    const allRecords = await base44.asServiceRole.entities.Character.list(
      null,
      1000
    );

    // Group by actual status values in the database
    const statusBreakdown = {};
    for (const char of allRecords) {
      const statusVal = char.status || 'undefined';
      if (!statusBreakdown[statusVal]) {
        statusBreakdown[statusVal] = [];
      }
      statusBreakdown[statusVal].push({ name: char.name, id: char.id.slice(0, 8) });
    }

    return Response.json({
      TRACE: 'CHARACTER_STATUS_SCHEMA_AUDIT',
      schema_allowed_statuses: statusEnum,
      total_characters_in_db: allRecords.length,
      actual_status_values_found: Object.keys(statusBreakdown),
      breakdown: statusBreakdown,
      discrepancy_count: 43 - allRecords.length,
      CRITICAL_FINDING: Object.keys(statusBreakdown).length > statusEnum.length
        ? `UNEXPECTED STATUS VALUES FOUND: ${Object.keys(statusBreakdown).filter(s => !statusEnum.includes(s) && s !== 'undefined').join(', ')}`
        : 'No unexpected status values'
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});