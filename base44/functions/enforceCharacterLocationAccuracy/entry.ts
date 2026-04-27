import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * enforceCharacterLocationAccuracy
 * 
 * System that maintains true, real-time character location awareness.
 * Called by character status queries to determine actual location based on:
 * - work schedules (if character is working now)
 * - home location (if not working)
 * - narrative updates with location tags
 * - character activities
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId } = body;

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch character data
    const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const character = chars[0];

    // Fetch all locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      owner_email: user.email
    });
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    // Determine true location based on schedule
    let actualLocation = null;
    let locationSource = 'default';

    // 1. Check if character is currently working
    if (character.occupation_location_id) {
      const workLoc = locationMap[character.occupation_location_id];
      if (workLoc) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        // Check work schedule
        const scheduleProfile = character.schedule_profile_id
          ? (await base44.asServiceRole.entities.CharacterScheduleProfile.filter({ id: character.schedule_profile_id }))[0]
          : null;
        
        const workDays = scheduleProfile?.active_days || character.work_days || [];
        const isWorkDay = workDays.includes(dayOfWeek);
        
        if (isWorkDay) {
          const workStart = scheduleProfile?.work_start || character.work_start_time || '09:00';
          const workEnd = scheduleProfile?.work_end || character.work_end_time || '17:00';
          
          if (timeStr >= workStart && timeStr < workEnd) {
            actualLocation = workLoc;
            locationSource = 'work_schedule';
          }
        }
      }
    }

    // 2. Check additional work locations (secondary jobs)
    if (!actualLocation && character.additional_occupation_locations?.length > 0) {
      for (const addlWork of character.additional_occupation_locations) {
        const workLoc = locationMap[addlWork.location_id];
        if (workLoc) {
          const now = new Date();
          const dayOfWeek = now.getDay();
          const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          
          // Check if working now (simplified)
          // Full implementation would check shift schedules stored in location
          if (workLoc.worker_shifts?.[characterId]) {
            const shift = workLoc.worker_shifts[characterId];
            const shiftDays = shift.days || [1,2,3,4,5];
            if (shiftDays.includes(dayOfWeek) && timeStr >= shift.start && timeStr < shift.end) {
              actualLocation = workLoc;
              locationSource = 'additional_work';
              break;
            }
          }
        }
      }
    }

    // 3. Fall back to home location
    if (!actualLocation) {
      const homeLoc = character.home_location_id
        ? locationMap[character.home_location_id]
        : null;
      
      if (homeLoc) {
        actualLocation = homeLoc;
        locationSource = 'home';
      }
    }

    return Response.json({
      success: true,
      characterId,
      characterName: character.name,
      actualLocation: actualLocation ? {
        id: actualLocation.id,
        name: actualLocation.name,
        category: actualLocation.category,
      } : null,
      locationSource,
      isWorking: locationSource === 'work_schedule' || locationSource === 'additional_work',
    });
  } catch (error) {
    console.error('[enforceCharacterLocationAccuracy]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});