import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * CONSOLIDATE CHARACTER LOCATION TRUTH
 * 
 * Implements unified location model:
 * 1. Each character has ONE authoritative current_location_id
 * 2. Priority: work > school > home
 * 3. Register character in that location's resident/worker lists
 * 4. Clear any conflicting assignments
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email }, "-updated_date");
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const activeChars = characters.filter(c => 
      c.status !== 'deleted' && 
      c.status !== 'moved_away' && 
      c.character_type !== 'npc'
    );

    const repairs = [];

    for (const char of activeChars) {
      // Step 1: Determine authoritative location (priority: work > school > home)
      let authLocId = null;
      let authLocName = null;
      let authReason = null;

      if (char.occupation_location_id && locationMap[char.occupation_location_id]) {
        authLocId = char.occupation_location_id;
        authLocName = locationMap[authLocId].name;
        authReason = 'work';
      } else if (char.education_location_id && locationMap[char.education_location_id]) {
        authLocId = char.education_location_id;
        authLocName = locationMap[authLocId].name;
        authReason = 'school';
      } else if (char.current_home_location_id && locationMap[char.current_home_location_id]) {
        authLocId = char.current_home_location_id;
        authLocName = locationMap[authLocId].name;
        authReason = 'home';
      }

      if (!authLocId) continue; // Skip characters with no location assignments

      // Step 2: Ensure current_location_id is set to authoritative location
      if (char.current_location_id !== authLocId) {
        await base44.entities.Character.update(char.id, {
          current_location_id: authLocId
        });
        repairs.push({
          character: char.name,
          action: 'SET_CURRENT_LOCATION',
          location: authLocName,
          reason: authReason
        });
      }

      // Step 3: Register character in location's presence lists (residents)
      const authLoc = locationMap[authLocId];
      if (authLoc) {
        const residents = authLoc.resident_character_ids || [];
        const residentNames = authLoc.resident_character_names || [];
        
        const alreadyRegistered = residents.includes(char.id) || residentNames.includes(char.name);
        
        if (!alreadyRegistered) {
          await base44.entities.LocationReference.update(authLocId, {
            resident_character_ids: [...residents, char.id],
            resident_character_names: [...residentNames, char.name]
          });
          repairs.push({
            character: char.name,
            action: 'REGISTER_OCCUPANCY',
            location: authLocName,
            reason: authReason
          });
        }
      }
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      totalActive: activeChars.length,
      repairsApplied: repairs.length,
      repairs,
      systemStatus: 'LOCATION_TRUTH_CONSOLIDATED'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});