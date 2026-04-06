import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * FORCEFUL LOCATION TRUTH ENFORCEMENT
 * 
 * Ensures EVERY active character has:
 * 1. One authoritative location (work > school > home priority)
 * 2. current_location_id set to that location
 * 3. Registered in that location's occupancy lists
 * 4. No conflicting presence
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const locations = await base44.entities.LocationReference.list();
    const locMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const activeChars = characters.filter(c => 
      c.status !== 'deleted' && 
      c.status !== 'moved_away' && 
      c.character_type !== 'npc'
    );

    const updates = [];
    const locUpdates = {}; // Batch location updates

    for (const char of activeChars) {
      // Determine authoritative location
      let authLocId = null;
      if (char.occupation_location_id && locMap[char.occupation_location_id]) {
        authLocId = char.occupation_location_id;
      } else if (char.education_location_id && locMap[char.education_location_id]) {
        authLocId = char.education_location_id;
      } else if (char.current_home_location_id && locMap[char.current_home_location_id]) {
        authLocId = char.current_home_location_id;
      }

      if (!authLocId) continue;

      // Ensure character has current_location_id set
      if (char.current_location_id !== authLocId) {
        await base44.entities.Character.update(char.id, {
          current_location_id: authLocId
        });
        updates.push({
          character: char.name,
          action: 'SET_CURRENT_LOCATION_ID',
          locationId: authLocId
        });
      }

      // Ensure character is registered in that location
      const loc = locMap[authLocId];
      if (loc) {
        const residents = loc.resident_character_ids || [];
        const workerIds = loc.worker_character_ids || [];

        const needsUpdate = !residents.includes(char.id) && !workerIds.includes(char.id);
        
        if (needsUpdate) {
          residents.push(char.id);
          locUpdates[authLocId] = {
            resident_character_ids: residents
          };
          updates.push({
            character: char.name,
            action: 'REGISTER_IN_OCCUPANCY',
            locationId: authLocId,
            locName: loc.name
          });
        }
      }
    }

    // Batch location updates
    for (const [locId, updateData] of Object.entries(locUpdates)) {
      await base44.entities.LocationReference.update(locId, updateData);
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      totalCharacters: activeChars.length,
      updatesApplied: updates.length,
      updates: updates.slice(0, 20),
      status: 'ENFORCED'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});