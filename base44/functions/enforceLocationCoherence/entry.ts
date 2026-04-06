import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * ENFORCE LOCATION COHERENCE
 * 
 * For every character, ensure:
 * 1. current_location_id is set to correct location
 * 2. character is registered in that location's occupancy lists
 * 3. card and travel systems will show the same location
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

    const report = {
      enforced: 0,
      fixes: [],
      occurrencyUpdates: 0
    };

    for (const char of characters) {
      if (char.status === 'deleted') continue;

      // Determine the authoritative location
      const authLoc = getAuthoritativeLocation(char, locationMap);
      
      if (!authLoc || !authLoc.id) continue;

      // 1. Ensure current_location_id matches
      if (char.current_location_id !== authLoc.id) {
        await base44.entities.Character.update(char.id, {
          current_location_id: authLoc.id
        });
        report.enforced++;
        report.fixes.push({
          characterId: char.id,
          characterName: char.name,
          fixed: 'CURRENT_LOCATION_ID',
          newLocationId: authLoc.id,
          newLocationName: authLoc.name
        });
      }

      // 2. Ensure character is registered in location occupancy
      const location = locationMap[authLoc.id];
      if (location) {
        const needsResidentRegistration = 
          (authLoc.type === 'home' || authLoc.type === 'residence') &&
          !location.resident_character_ids?.includes(char.id);

        const needsWorkerRegistration = 
          authLoc.type === 'work' &&
          !location.worker_character_ids?.includes(char.id);

        if (needsResidentRegistration || needsWorkerRegistration) {
          const updates = {};
          
          if (needsResidentRegistration) {
            updates.resident_character_ids = [
              ...(location.resident_character_ids || []),
              char.id
            ];
          }
          
          if (needsWorkerRegistration) {
            updates.worker_character_ids = [
              ...(location.worker_character_ids || []),
              char.id
            ];
          }

          await base44.entities.LocationReference.update(location.id, updates);
          report.occurrencyUpdates++;
          report.fixes.push({
            characterId: char.id,
            characterName: char.name,
            fixed: 'OCCUPANCY_REGISTRATION',
            locationId: authLoc.id,
            locationName: authLoc.name,
            registrationType: needsResidentRegistration ? 'resident' : 'worker'
          });
        }
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getAuthoritativeLocation(character, locationMap) {
  // Determine THE ONE TRUE LOCATION for this character
  // Priority:
  // 1. current_location_id if valid
  // 2. current_home_location_id if valid
  // 3. occupation location if working now
  // 4. education location if in school
  // 5. fallback to home

  if (character.current_location_id) {
    const loc = locationMap[character.current_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, type: 'current' };
    }
  }

  if (character.current_home_location_id) {
    const loc = locationMap[character.current_home_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, type: 'home' };
    }
  }

  // Check schedule-based locations
  const now = new Date();
  const currentHour = now.getHours();
  const dayOfWeek = now.getDay();

  if (character.work_start_time && character.work_end_time) {
    const workStart = parseInt(character.work_start_time.split(':')[0]);
    const workEnd = parseInt(character.work_end_time.split(':')[0]);
    const isWorkDay = character.work_days?.includes(dayOfWeek);
    const isWorkHours = currentHour >= workStart && currentHour < workEnd;

    if (isWorkDay && isWorkHours && character.occupation_location_id) {
      const loc = locationMap[character.occupation_location_id];
      if (loc && loc.name) {
        return { id: loc.id, name: loc.name, type: 'work' };
      }
    }
  }

  if (character.student_status === 'enrolled' && character.education_location_id) {
    const loc = locationMap[character.education_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, type: 'school' };
    }
  }

  // Final fallback to home
  if (character.current_home_location_id) {
    const loc = locationMap[character.current_home_location_id];
    if (loc && loc.name) {
      return { id: loc.id, name: loc.name, type: 'home' };
    }
  }

  return null;
}