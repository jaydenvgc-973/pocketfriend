import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * CRITICAL FIX: Remove duplicate presence registrations
 * 
 * Rule: A character may exist in EXACTLY ONE location's occupancy list at a time.
 * 
 * This function:
 * 1. Identifies characters registered in multiple locations
 * 2. Determines their TRUE authoritative current location
 * 3. Deregisters them from all other locations
 * 4. Re-registers them ONLY in their true location
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.role === 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Get all data
    const [characters, locations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }),
      base44.entities.LocationReference.filter({ created_by: user.email })
    ]);

    const fixes = [];
    const locationMap = {};
    locations.forEach(loc => {
      locationMap[loc.id] = loc;
    });

    // For each character, determine TRUE location and fix occupancy
    for (const char of characters) {
      // Determine TRUE authoritative location
      let trueLocationId = null;
      let reason = 'unknown';

      // Priority: current_location_id if set and valid
      if (char.current_location_id && locationMap[char.current_location_id]) {
        trueLocationId = char.current_location_id;
        reason = 'explicit_current_location';
      }
      // Fallback: home
      else if (char.current_home_location_id && locationMap[char.current_home_location_id]) {
        trueLocationId = char.current_home_location_id;
        reason = 'home_fallback';
      }

      if (!trueLocationId) continue;

      // Find all locations where this character is currently registered
      const currentRegistrations = [];
      locations.forEach(loc => {
        if (loc.resident_character_ids?.includes(char.id)) {
          currentRegistrations.push({ locId: loc.id, type: 'resident' });
        }
        if (loc.worker_character_ids?.includes(char.id)) {
          currentRegistrations.push({ locId: loc.id, type: 'worker' });
        }
      });

      // If more than one registration or wrong location, fix it
      if (currentRegistrations.length > 1 || (currentRegistrations.length === 1 && currentRegistrations[0].locId !== trueLocationId)) {
        // Deregister from ALL locations
        for (const loc of locations) {
          let updated = false;
          
          if (loc.resident_character_ids?.includes(char.id)) {
            loc.resident_character_ids = loc.resident_character_ids.filter(id => id !== char.id);
            updated = true;
          }
          if (loc.worker_character_ids?.includes(char.id)) {
            loc.worker_character_ids = loc.worker_character_ids.filter(id => id !== char.id);
            updated = true;
          }
          
          if (updated) {
            await base44.entities.LocationReference.update(loc.id, {
              resident_character_ids: loc.resident_character_ids,
              worker_character_ids: loc.worker_character_ids
            });
          }
        }

        // Re-register ONLY in true location (as resident)
        const trueLoc = locationMap[trueLocationId];
        if (!trueLoc.resident_character_ids) trueLoc.resident_character_ids = [];
        if (!trueLoc.resident_character_ids.includes(char.id)) {
          trueLoc.resident_character_ids.push(char.id);
          await base44.entities.LocationReference.update(trueLocationId, {
            resident_character_ids: trueLoc.resident_character_ids
          });
        }

        fixes.push({
          character: char.name,
          id: char.id,
          true_location: trueLoc.name,
          registrations_removed: currentRegistrations.length,
          reason
        });
      }
    }

    return Response.json({
      status: 'success',
      characters_fixed: fixes.length,
      fixes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});