import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    // Fetch character
    const chars = await base44.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const character = chars[0];

    // Fetch all locations for location context
    const locations = await base44.entities.LocationReference.filter({});

    // Determine current schedule context
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentMinutes = et.getHours() * 60 + et.getMinutes();
    const currentDay = et.getDay();

    let scheduleStatus = {
      hasSchedule: false,
      isAtWork: false,
      isAtSchool: false,
    };

    // Check work schedule
    if (character.work_details?.job_title) {
      const workStart = (character.work_start_time || '09:00').split(':').map(Number);
      const workEnd = (character.work_end_time || '17:00').split(':').map(Number);
      const workStartMin = workStart[0] * 60 + workStart[1];
      const workEndMin = workEnd[0] * 60 + workEnd[1];
      const workDays = character.work_days || [1, 2, 3, 4, 5];

      if (workDays.includes(currentDay) && currentMinutes >= workStartMin && currentMinutes < workEndMin) {
        scheduleStatus.hasSchedule = true;
        scheduleStatus.isAtWork = true;
        scheduleStatus.locationId = character.occupation_location_id;
      }
    }

    // Check school schedule
    if (character.current_education_activity && character.current_education_activity !== 'none') {
      const schoolStart = 8 * 60; // 8am
      const schoolEnd = 15 * 60; // 3pm
      
      if (currentMinutes >= schoolStart && currentMinutes < schoolEnd) {
        scheduleStatus.hasSchedule = true;
        scheduleStatus.isAtSchool = true;
        scheduleStatus.locationId = character.education_location_id;
      }
    }

    // Get current home location
    const homeLocation = locations.find(l =>
      l.resident_character_ids?.includes(character.id) && l.category === 'home'
    );

    return Response.json({
      success: true,
      character: {
        id: character.id,
        name: character.name,
      },
      schedule: scheduleStatus,
      currentTime: {
        minutes: currentMinutes,
        day: currentDay,
      },
      homeLocationId: homeLocation?.id,
      homeLocationName: homeLocation?.name,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});