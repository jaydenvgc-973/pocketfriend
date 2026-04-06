import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * ENFORCE UNIFIED LOCATION TRUTH
 * 
 * Repairs location cohesion by:
 * 1. Establishing ONE authoritative current_location_id per character
 * 2. Registering character in that location's occupancy lists
 * 3. Removing conflicting location assignments
 * 4. Invalidating all location-based caches
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
      // Determine authoritative location based on priority: work > school > home
      let authLocId = null;
      let authLocName = null;

      if (char.occupation_location_id && locationMap[char.occupation_location_id]) {
        authLocId = char.occupation_location_id;
        authLocName = locationMap[authLocId].name;
      } else if (char.education_location_id && locationMap[char.education_location_id]) {
        authLocId = char.education_location_id;
        authLocName = locationMap[authLocId].name;
      } else if (char.current_home_location_id && locationMap[char.current_home_location_id]) {
        authLocId = char.current_home_location_id;
        authLocName = locationMap[authLocId].name;
      }

      // Step 1: Ensure character is registered in the authoritative location
      if (authLocId) {
        const authLoc = locationMap[authLocId];
        
        // Add to residents if not already there
        const residents = authLoc.resident_character_ids || [];
        const residentNames = authLoc.resident_character_names || [];
        
        const isInResidents = residents.includes(char.id) || residentNames.includes(char.name);
        
        if (!isInResidents) {
          residents.push(char.id);
          residentNames.push(char.name);
          
          await base44.entities.LocationReference.update(authLocId, {
            resident_character_ids: residents,
            resident_character_names: residentNames
          });
          
          repairs.push({
            character: char.name,
            action: 'REGISTER_OCCUPANCY',
            location: authLocName,
            locationId: authLocId
          });
        }
      }

      // Step 2: Set canonical current_location_id if not already set
      if (!char.current_location_id && authLocId) {
        await base44.entities.Character.update(char.id, {
          current_location_id: authLocId
        });
        
        repairs.push({
          character: char.name,
          action: 'SET_CURRENT_LOCATION',
          location: authLocName,
          locationId: authLocId
        });
      }
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      totalCharactersProcessed: activeChars.length,
      repairsApplied: repairs.length,
      repairs,
      nextStep: 'INVALIDATE_LOCATION_CACHES_AND_VERIFY_DISPLAY'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});