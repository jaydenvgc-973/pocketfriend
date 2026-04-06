/**
 * AUDIT: Find all Location records with non-empty resident_character_ids or worker_character_ids
 * This will identify stale occupancy data that needs to be purged.
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

    const staleOccupancy = [];
    let totalStaleResidents = 0;
    let totalStaleWorkers = 0;

    for (const loc of locations) {
      const residentCount = (loc.resident_character_ids || []).length;
      const workerCount = (loc.worker_character_ids || []).length;

      if (residentCount > 0 || workerCount > 0) {
        staleOccupancy.push({
          locationId: loc.id,
          locationName: loc.name,
          resident_character_ids: loc.resident_character_ids || [],
          resident_count: residentCount,
          worker_character_ids: loc.worker_character_ids || [],
          worker_count: workerCount,
        });
        totalStaleResidents += residentCount;
        totalStaleWorkers += workerCount;
      }
    }

    return Response.json({
      status: 'success',
      message: 'Audit complete',
      totalLocations: locations.length,
      locationsWithStaleOccupancy: staleOccupancy.length,
      totalStaleResidents,
      totalStaleWorkers,
      details: staleOccupancy,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});