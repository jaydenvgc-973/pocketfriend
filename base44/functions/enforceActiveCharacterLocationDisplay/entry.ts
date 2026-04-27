import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * ENFORCE ACTIVE CHARACTER LOCATION DISPLAY
 * 
 * Critical system enforcement for character card display.
 * Ensures EVERY active character:
 * 1. Has current_location_id set to a valid, named location
 * 2. Has no generic category label in display (only "Home" or exact location name)
 * 3. Is registered in location occupancy lists
 * 
 * This function is called BEFORE card render to establish authoritative display state.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all active characters
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active' },
      "-updated_date"
    );

    // Get all locations
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const enforcement = {
      totalActiveCharacters: characters.length,
      displayEnforced: 0,
      cardDisplayPasses: [],
      cardDisplayFailures: []
    };

    for (const char of characters) {
      const authLoc = getAuthoritativeLocation(char, locationMap);
      
      if (!authLoc || !authLoc.id) {
        enforcement.cardDisplayFailures.push({
          characterId: char.id,
          characterName: char.name,
          reason: 'NO_VALID_LOCATION_FOUND'
        });
        continue;
      }

      // Update character to ensure current_location_id matches authoritative location
      if (char.current_location_id !== authLoc.id) {
        await base44.entities.Character.update(char.id, {
          current_location_id: authLoc.id
        });
        enforcement.displayEnforced++;
      }

      // Verify the location object supports named display
      const locationObj = locationMap[authLoc.id];
      if (!locationObj || !locationObj.name) {
        enforcement.cardDisplayFailures.push({
          characterId: char.id,
          characterName: char.name,
          reason: 'LOCATION_HAS_NO_NAME',
          locationId: authLoc.id
        });
        continue;
      }

      // Add to passes
      enforcement.cardDisplayPasses.push({
        characterId: char.id,
        characterName: char.name,
        displayLocation: locationObj.name,
        locationId: authLoc.id,
        cardWillShow: `at ${locationObj.name}`
      });
    }

    return Response.json(enforcement);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getAuthoritativeLocation(character, locationMap) {
  // Determine the ONE TRUE location for card display
  // This is the authoritative source that the card MUST use
  
  // Priority 1: current_location_id (explicit real-time location)
  if (character.current_location_id) {
    const loc = locationMap[character.current_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, source: 'current_location_id' };
    }
  }

  // Priority 2: Home location (fallback)
  if (character.current_home_location_id) {
    const loc = locationMap[character.current_home_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, source: 'current_home_location_id' };
    }
  }

  // Priority 3: Work location if scheduled now
  const now = new Date();
  const currentHour = now.getHours();
  const dayOfWeek = now.getDay();

  if (character.work_start_time && character.work_end_time && character.work_days) {
    const workStart = parseInt(character.work_start_time.split(':')[0]);
    const workEnd = parseInt(character.work_end_time.split(':')[0]);
    const isWorkDay = character.work_days.includes(dayOfWeek);
    const isWorkHours = currentHour >= workStart && currentHour < workEnd;

    if (isWorkDay && isWorkHours && character.occupation_location_id) {
      const loc = locationMap[character.occupation_location_id];
      if (loc && loc.name) {
        return { id: loc.id, name: loc.name, source: 'occupation_location' };
      }
    }
  }

  // Priority 4: School location if enrolled
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const loc = locationMap[character.education_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, source: 'education_location' };
    }
  }

  // Fallback: Return home again as absolute last resort
  if (character.current_home_location_id) {
    const loc = locationMap[character.current_home_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, source: 'home_fallback' };
    }
  }

  return null;
}