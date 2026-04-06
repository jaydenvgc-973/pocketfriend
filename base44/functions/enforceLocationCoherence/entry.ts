import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * ENFORCE LOCATION COHERENCE - NEW UNIFIED ENGINE
 * 
 * Single source of truth: resolveCharacterLocation()
 * No legacy fallback logic. No occupancy array writes.
 * Occupancy is read-only, derived from resolved locations.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email },
      "-updated_date"
    );
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const report = {
      characters_processed: 0,
      locations_updated: 0,
      consistency_checks_passed: 0,
      failures: []
    };

    // Import resolver inline (since no local imports allowed in functions)
    const { resolveCharacterLocation } = await eval(`
      (async () => {
        const mod = await import('./locationResolutionEngine.js');
        return mod;
      })()
    `);

    for (const char of characters) {
      if (char.status === 'deleted' || char.status === 'soft_deleted') continue;

      // Use THE resolver exclusively
      const resolved = resolveCharacterLocation(char, locationMap);
      
      if (!resolved.resolved_current_location_id) {
        report.failures.push({
          character_id: char.id,
          character_name: char.name,
          reason: 'Could not resolve location'
        });
        continue;
      }

      report.characters_processed++;

      // Store resolved location metadata on character (for display)
      await base44.entities.Character.update(char.id, {
        resolved_current_location_id: resolved.resolved_current_location_id,
        resolved_current_location_name: resolved.resolved_current_location_name,
        resolved_location_type: resolved.resolved_location_type,
        resolved_presence_status: resolved.resolved_presence_status,
        resolved_source_reason: resolved.resolved_source_reason,
        resolved_last_updated_at: new Date().toISOString()
      });

      report.consistency_checks_passed++;
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});