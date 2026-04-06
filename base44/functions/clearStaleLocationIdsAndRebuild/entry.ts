import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * CLEAR STALE LOCATION IDS AND REBUILD
 * 
 * Identifies characters with invalid current_location_id (pointing to non-existent or wrong locations),
 * clears them, and rebuilds correct location state based on time + schedule + home.
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

    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    const report = {
      charactersProcessed: 0,
      staleLocationsCleared: 0,
      locationsRebuilt: 0,
      fixes: []
    };

    for (const char of characters) {
      if (char.status === 'deleted') continue;
      report.charactersProcessed++;

      const currentLoc = locationMap[char.current_location_id];
      const hasValidLocation = currentLoc && currentLoc.id;

      // If location doesn't exist or is invalid, clear it
      if (!hasValidLocation && char.current_location_id) {
        report.staleLocationsCleared++;
        
        const correctLoc = getCorrectCharacterLocation(
          char, 
          characters, 
          locations, 
          currentHour, 
          dayOfWeek
        );

        await base44.entities.Character.update(char.id, {
          current_location_id: correctLoc.id
        });

        report.fixes.push({
          characterId: char.id,
          characterName: char.name,
          action: 'CLEARED_STALE_AND_REBUILT',
          oldLocationId: char.current_location_id,
          newLocationId: correctLoc.id,
          newLocationName: correctLoc.name,
          reason: correctLoc.reason
        });

        report.locationsRebuilt++;
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getCorrectCharacterLocation(character, allCharacters, locations, currentHour, dayOfWeek) {
  // Determine correct location based on time, schedule, and home

  // 1. Check if sleeping
  const wakeTime = character.wake_up_time ? parseInt(character.wake_up_time.split(':')[0]) : 7;
  const sleepTime = character.sleep_start_time ? parseInt(character.sleep_start_time.split(':')[0]) : 23;
  const isSleeping = currentHour >= sleepTime || currentHour < wakeTime;

  if (isSleeping) {
    const homeLoc = locations.find(l => l.id === character.current_home_location_id);
    if (homeLoc) return { id: homeLoc.id, name: homeLoc.name, reason: 'SLEEPING_AT_HOME' };
  }

  // 2. Check if at work
  if (character.work_start_time && character.work_end_time && character.work_days) {
    const workStart = parseInt(character.work_start_time.split(':')[0]);
    const workEnd = parseInt(character.work_end_time.split(':')[0]);
    const isWorkDay = character.work_days.includes(dayOfWeek);
    const isWorkHours = currentHour >= workStart && currentHour < workEnd;

    if (isWorkDay && isWorkHours && character.occupation_location_id) {
      const workLoc = locations.find(l => l.id === character.occupation_location_id);
      if (workLoc) return { id: workLoc.id, name: workLoc.name, reason: 'AT_WORK' };
    }
  }

  // 3. Check if at school
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const eduLoc = locations.find(l => l.id === character.education_location_id);
    if (eduLoc) return { id: eduLoc.id, name: eduLoc.name, reason: 'AT_SCHOOL' };
  }

  // 4. Default to home
  if (character.current_home_location_id) {
    const homeLoc = locations.find(l => l.id === character.current_home_location_id);
    if (homeLoc) return { id: homeLoc.id, name: homeLoc.name, reason: 'AT_HOME_DEFAULT' };
  }

  // 5. Fallback to first available public location (NOT a residential home)
  const publicLoc = locations.find(l => 
    (l.category === 'public' || l.category === 'social' || l.category === 'outdoor') &&
    l.category !== 'home'
  );
  if (publicLoc) return { id: publicLoc.id, name: publicLoc.name, reason: 'PUBLIC_FALLBACK' };

  // Last resort
  if (locations.length > 0) {
    return { id: locations[0].id, name: locations[0].name, reason: 'EMERGENCY_FALLBACK' };
  }

  return { id: null, name: 'Unknown', reason: 'NO_LOCATIONS_AVAILABLE' };
}