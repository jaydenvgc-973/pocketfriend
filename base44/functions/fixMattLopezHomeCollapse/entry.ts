import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * FIX: Matt Lopez Home Location Collapse
 * 
 * Removes all incorrectly assigned characters from Matt Lopez's home,
 * rebuilds their correct current location from system truth (time, schedule, home),
 * and re-syncs all location state.
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

    // Find Matt Lopez
    const mattLopez = characters.find(c => 
      c.name?.toLowerCase().includes('matt') && c.name?.toLowerCase().includes('lopez')
    );
    
    if (!mattLopez) {
      return Response.json({ error: 'Matt Lopez not found' }, { status: 404 });
    }

    const mattHome = locationMap[mattLopez.current_home_location_id];
    if (!mattHome) {
      return Response.json({ error: 'Matt home not found' }, { status: 404 });
    }

    const report = {
      mattLopezHome: { id: mattHome.id, name: mattHome.name },
      fixedCharacters: [],
      validOccupancy: [],
      occupancyRebuilt: false
    };

    // Get current time
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    // Identify all characters at Matt's home
    const charactersAtMattHome = characters.filter(c => 
      (c.current_location_id === mattHome.id || c.current_home_location_id === mattHome.id) &&
      c.id !== mattLopez.id
    );

    // For each character, determine if they should actually be there
    for (const char of charactersAtMattHome) {
      const isActualResident = mattHome.resident_character_ids?.includes(char.id);
      const isFamily = mattHome.resident_family_members?.some(m => 
        m.name.toLowerCase() === char.name.toLowerCase()
      );
      const isMattLopezRelative = mattLopez.family_members?.some(m => 
        m.name.toLowerCase() === char.name.toLowerCase()
      );
      const isSitterForHome = char.is_sitter && char.sitter_assigned_to_location_id === mattHome.id;

      // If NOT a valid resident/family/sitter, reassign to correct location
      if (!isActualResident && !isFamily && !isMattLopezRelative && !isSitterForHome) {
        const correctLocation = getCharacterCorrectLocation(char, characters, locations, currentHour, dayOfWeek);
        
        // Update character's location
        await base44.entities.Character.update(char.id, {
          current_location_id: correctLocation.id,
          current_home_location_id: char.current_home_location_id || correctLocation.id
        });

        report.fixedCharacters.push({
          characterId: char.id,
          characterName: char.name,
          removedFrom: mattHome.name,
          reassignedTo: correctLocation.name,
          reason: correctLocation.reason
        });
      } else {
        // Valid occupant
        report.validOccupancy.push({
          characterId: char.id,
          characterName: char.name,
          reason: isActualResident ? 'resident' : isFamily ? 'family' : isSitterForHome ? 'sitter' : 'relative'
        });
      }
    }

    // Rebuild Matt's home occupancy from valid residents only
    const validResidents = characters.filter(c => {
      if (c.status === 'deleted') return false;
      const isResident = mattHome.resident_character_ids?.includes(c.id);
      const isFamily = mattHome.resident_family_members?.some(m => 
        m.name.toLowerCase() === c.name.toLowerCase()
      );
      const isMattRelative = mattLopez.family_members?.some(m => 
        m.name.toLowerCase() === c.name.toLowerCase()
      );
      const isSitter = c.is_sitter && c.sitter_assigned_to_location_id === mattHome.id;
      
      return isResident || isFamily || isMattRelative || isSitter || c.id === mattLopez.id;
    });

    const validResidentIds = validResidents.map(c => c.id);
    const validResidentNames = validResidents.map(c => c.name);

    await base44.entities.LocationReference.update(mattHome.id, {
      resident_character_ids: validResidentIds,
      resident_character_names: validResidentNames
    });

    report.occupancyRebuilt = true;
    report.newOccupancyCount = validResidentIds.length;

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getCharacterCorrectLocation(character, allCharacters, locations, currentHour, dayOfWeek) {
  // Determine where this character should actually be right now

  // 1. If sleeping, at their home
  const sleepStart = character.sleep_start_time ? parseInt(character.sleep_start_time.split(':')[0]) : 23;
  const wakeTime = character.wake_up_time ? parseInt(character.wake_up_time.split(':')[0]) : 7;
  const isSleeping = currentHour >= sleepStart || currentHour < wakeTime;
  
  if (isSleeping && character.current_home_location_id) {
    const homeLoc = allCharacters.find(l => l.id === character.current_home_location_id) || 
                    locations.find(l => l.id === character.current_home_location_id);
    if (homeLoc) return { id: character.current_home_location_id, name: homeLoc.name || 'Home', reason: 'SLEEPING_AT_HOME' };
  }

  // 2. If at work
  if (character.work_start_time && character.work_end_time && character.work_days) {
    const workStart = parseInt(character.work_start_time.split(':')[0]);
    const workEnd = parseInt(character.work_end_time.split(':')[0]);
    const isWorkDay = character.work_days.includes(dayOfWeek);
    const isWorkHours = currentHour >= workStart && currentHour < workEnd;

    if (isWorkDay && isWorkHours && character.occupation_location_id) {
      const workLoc = locations.find(l => l.id === character.occupation_location_id);
      if (workLoc) return { id: character.occupation_location_id, name: workLoc.name || 'Work', reason: 'AT_WORK' };
    }
  }

  // 3. If in school
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const eduLoc = locations.find(l => l.id === character.education_location_id);
    if (eduLoc) return { id: character.education_location_id, name: eduLoc.name || 'School', reason: 'AT_SCHOOL' };
  }

  // 4. Default to their actual home
  if (character.current_home_location_id) {
    const homeLoc = locations.find(l => l.id === character.current_home_location_id);
    if (homeLoc) return { id: character.current_home_location_id, name: homeLoc.name || 'Home', reason: 'AT_HOME_DEFAULT' };
  }

  // 5. If no home assigned, put them at a generic public location (not Matt's home!)
  const publicLoc = locations.find(l => l.category === 'public' || l.category === 'social');
  if (publicLoc) return { id: publicLoc.id, name: publicLoc.name || 'Public Space', reason: 'FALLBACK_PUBLIC_LOCATION' };

  // Last resort
  return { id: locations[0].id, name: locations[0].name || 'Location', reason: 'EMERGENCY_FALLBACK' };
}