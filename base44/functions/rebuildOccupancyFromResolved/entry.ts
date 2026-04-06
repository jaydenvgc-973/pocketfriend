import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * OCCUPANCY REBUILD: Derive occupancy ONLY from resolved_current_location_id
 * 
 * This function:
 * 1. Reads all characters' resolved locations
 * 2. Groups by location
 * 3. Updates location resident/worker lists to match resolved state
 * 4. Clears any stale occupancy
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

    const report = {
      locations_updated: 0,
      residents_synced: 0,
      workers_synced: 0,
      changes: []
    };

    // Group characters by their resolved location
    const occupancyMap = {};
    for (const char of characters) {
      if (char.status === 'deleted' || char.status === 'soft_deleted') continue;
      
      const locId = char.resolved_current_location_id;
      if (!locId) continue;

      if (!occupancyMap[locId]) {
        occupancyMap[locId] = { residents: [], workers: [] };
      }

      // Classify by location type
      const loc = locations.find(l => l.id === locId);
      if (loc) {
        if (loc.category === 'home' || loc.category === 'workplace' || char.resolved_location_type === 'home') {
          occupancyMap[locId].residents.push(char.id);
        } else if (char.resolved_location_type === 'work') {
          occupancyMap[locId].workers.push(char.id);
        }
      }
    }

    // Update each location with correct occupancy
    for (const loc of locations) {
      const expected = occupancyMap[loc.id] || { residents: [], workers: [] };
      
      let updated = false;
      const updates = {};

      // Only update if different
      const currentResidents = loc.resident_character_ids || [];
      const currentWorkers = loc.worker_character_ids || [];

      if (JSON.stringify(currentResidents.sort()) !== JSON.stringify(expected.residents.sort())) {
        updates.resident_character_ids = expected.residents;
        updated = true;
        report.residents_synced++;
      }

      if (JSON.stringify(currentWorkers.sort()) !== JSON.stringify(expected.workers.sort())) {
        updates.worker_character_ids = expected.workers;
        updated = true;
        report.workers_synced++;
      }

      if (updated) {
        // Only update non-protected fields; skip subtype/zones
        try {
          await base44.entities.LocationReference.update(loc.id, updates);
          report.locations_updated++;
          report.changes.push({
            location_id: loc.id,
            location_name: loc.name,
            residents_count: expected.residents.length,
            workers_count: expected.workers.length
          });
        } catch (err) {
          // If update fails, log and continue
          report.changes.push({
            location_id: loc.id,
            location_name: loc.name,
            error: err.message
          });
        }
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});