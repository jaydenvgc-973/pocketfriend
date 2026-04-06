import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * CLEAR Matt Lopez Wrong Assignments
 * 
 * For any character currently at Matt Lopez's home but who should NOT be there,
 * clear current_location_id and rebuild to correct location.
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

    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    const report = {
      mattHomeName: mattHome.name,
      cleared: 0,
      fixes: []
    };

    // Find all characters at Matt's home
    const atMattHome = characters.filter(c => 
      c.current_location_id === mattHome.id && c.id !== mattLopez.id
    );

    for (const char of atMattHome) {
      // Check if they should actually be there
      const isResident = mattHome.resident_character_ids?.includes(char.id);
      const isFamily = mattHome.resident_family_members?.some(m => 
        m.name.toLowerCase() === char.name.toLowerCase()
      );
      const isMattRelative = mattLopez.family_members?.some(m => 
        m.name.toLowerCase() === char.name.toLowerCase()
      );

      // If NOT a valid resident/family member, reassign
      if (!isResident && !isFamily && !isMattRelative) {
        const correctLoc = getCorrectLocation(char, characters, locations, currentHour, dayOfWeek);
        
        await base44.entities.Character.update(char.id, {
          current_location_id: correctLoc.id
        });

        report.cleared++;
        report.fixes.push({
          characterId: char.id,
          characterName: char.name,
          removedFrom: mattHome.name,
          assignedTo: correctLoc.name,
          reason: correctLoc.reason
        });
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function getCorrectLocation(character, allCharacters, locations, currentHour, dayOfWeek) {
  // Determine correct location

  const wakeTime = character.wake_up_time ? parseInt(character.wake_up_time.split(':')[0]) : 7;
  const sleepTime = character.sleep_start_time ? parseInt(character.sleep_start_time.split(':')[0]) : 23;
  const isSleeping = currentHour >= sleepTime || currentHour < wakeTime;

  if (isSleeping && character.current_home_location_id) {
    const homeLoc = locations.find(l => l.id === character.current_home_location_id);
    if (homeLoc) return { id: homeLoc.id, name: homeLoc.name, reason: 'HOME_SLEEPING' };
  }

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

  if (character.student_status === 'enrolled' && character.education_location_id) {
    const eduLoc = locations.find(l => l.id === character.education_location_id);
    if (eduLoc) return { id: eduLoc.id, name: eduLoc.name, reason: 'AT_SCHOOL' };
  }

  if (character.current_home_location_id) {
    const homeLoc = locations.find(l => l.id === character.current_home_location_id);
    if (homeLoc) return { id: homeLoc.id, name: homeLoc.name, reason: 'AT_HOME' };
  }

  const publicLoc = locations.find(l => l.category !== 'home');
  if (publicLoc) return { id: publicLoc.id, name: publicLoc.name, reason: 'PUBLIC_LOCATION' };

  if (locations.length > 0) {
    return { id: locations[0].id, name: locations[0].name, reason: 'FALLBACK' };
  }

  return { id: null, name: 'Unknown', reason: 'ERROR' };
}