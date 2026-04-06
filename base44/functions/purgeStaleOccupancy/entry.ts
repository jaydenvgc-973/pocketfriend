/**
 * PURGE: Remove all resident_character_ids and worker_character_ids from all Location records.
 * Occupancy is now PURELY COMPUTED from character current_location_id.
 * These arrays must NEVER be written to again.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Fetch all locations
    const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const locations = res?.data?.locations || [];

    const purged = [];
    const updates = [];

    for (const loc of locations) {
      const hasStaleResidents = (loc.resident_character_ids || []).length > 0;
      const hasStaleWorkers = (loc.worker_character_ids || []).length > 0;

      if (hasStaleResidents || hasStaleWorkers) {
        purged.push({
          locationId: loc.id,
          locationName: loc.name,
          removedResidents: loc.resident_character_ids || [],
          removedWorkers: loc.worker_character_ids || [],
        });

        // Prepare update to clear these arrays
        const updateData = {};
        if (hasStaleResidents) {
          updateData.resident_character_ids = [];
          updateData.resident_character_names = [];
        }
        if (hasStaleWorkers) {
          updateData.worker_character_ids = [];
        }

        updates.push(
          base44.entities.LocationReference.update(loc.id, updateData)
        );
      }
    }

    // Execute all updates in parallel
    await Promise.all(updates);

    return Response.json({
      status: 'success',
      message: 'Stale occupancy purged',
      locationsCleared: purged.length,
      details: purged,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});