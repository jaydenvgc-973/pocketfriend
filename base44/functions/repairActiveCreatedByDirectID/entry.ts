import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REPAIR IS_ACTIVE_CHARACTER BY DIRECT CSV ID
 * 
 * Uses explicit CSV IDs for all 15 active_created_character records.
 * Updates each directly, verifies before/after.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // All 15 active_created_character IDs from CSV
    const ACTIVE_CREATED_IDS = [
      '69dc124ddcbb6c398e71c40b', // Ken
      '69dfcd6c96f06a0babbef844', // Chris Brown
      '69e1cbaf2dae540ad7f9042a', // Alden Spencer
      '69e723823c06d08253e79c94', // Jayden Jackson (double space)
      // 11 more from CSV — user must provide complete list
    ];

    const results = {
      before: [],
      after: [],
      updated: 0,
      failed: []
    };

    for (const id of ACTIVE_CREATED_IDS) {
      try {
        // GET before
        const before = await base44.asServiceRole.entities.Character.get(id);
        if (!before) {
          results.failed.push({ id, reason: 'Record not found' });
          continue;
        }

        results.before.push({
          id: before.id,
          name: before.name,
          character_type: before.character_type,
          is_active_character: before.is_active_character
        });

        // UPDATE if false
        if (before.is_active_character !== true) {
          await base44.asServiceRole.entities.Character.update(id, {
            is_active_character: true
          });
          results.updated++;
        }

        // GET after
        const after = await base44.asServiceRole.entities.Character.get(id);
        results.after.push({
          id: after.id,
          name: after.name,
          character_type: after.character_type,
          is_active_character: after.is_active_character
        });

      } catch (err) {
        results.failed.push({ id, reason: err.message });
      }
    }

    return Response.json({
      task: 'REPAIR_ACTIVE_CREATED_BY_DIRECT_ID',
      expected_total: ACTIVE_CREATED_IDS.length,
      updated_count: results.updated,
      before_after: results,
      status: results.updated === ACTIVE_CREATED_IDS.length ? 'COMPLETE' : 'INCOMPLETE — NEED ALL 15 CSV IDS'
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});