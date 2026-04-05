import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { isCharacterAtWork, isCharacterAtSchool, isCharacterAtGym } from './lib/workScheduleUtils.js';
import { isCharacterInPrayer } from './lib/religionUtils.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const characterId = body.characterId;

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch character
    const chars = await base44.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const character = chars[0];

    // Fetch all locations to build locationMap
    const locations = await base44.entities.LocationReference.list();
    const locMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // Get work, education, religion, gym locations
    const workLocation = character.occupation_location_id ? locMap[character.occupation_location_id] : null;
    const eduLocation = character.education_location_id ? locMap[character.education_location_id] : null;
    const religionLocation = locations.find(l => l.category === 'religion' && !l.is_default_generic) || null;
    const gymLocation = character.current_school_location_id ? locMap[character.current_school_location_id] : null;

    // Explicit current location (if set)
    const currentLocation = character.current_location_id ? locMap[character.current_location_id] : null;

    // Determine where character is NOW
    const prayer = isCharacterInPrayer(character);
    const atWork = isCharacterAtWork(character, workLocation);
    const atSchool = isCharacterAtSchool(character, eduLocation);
    const atGym = isCharacterAtGym(character, gymLocation);

    // Build real-time location report
    const report = {
      timestamp: new Date().toISOString(),
      characterId: character.id,
      characterName: character.name,
      currentActivity: character.current_activity || 'none',
      healthStatus: character.health_status || 'healthy',
      emotionalState: character.emotional_state || 'calm',
      
      // Work status
      hasWorkLocation: !!workLocation,
      workLocationName: workLocation?.name || 'None',
      isAtWork: atWork,
      workSchedule: character.work_days || [1,2,3,4,5],
      workStartTime: character.work_start_time || '09:00',
      workEndTime: character.work_end_time || '17:00',
      
      // School status
      hasEducationLocation: !!eduLocation,
      educationLocationName: eduLocation?.name || 'None',
      isAtSchool: atSchool.attending,
      
      // Prayer status
      isInPrayer: prayer.active,
      prayerName: prayer.name || null,
      
      // Gym status
      hasGymMembership: !!gymLocation,
      gymLocationName: gymLocation?.name || 'None',
      isAtGym: atGym,
      
      // Explicit location
      hasExplicitLocation: !!currentLocation,
      explicitLocationName: currentLocation?.name || 'None',
      
      // Derived status
      determinedLocation: currentLocation ? `at ${currentLocation.name}` : 
                         atWork ? `at ${workLocation?.name || 'work'}` :
                         atSchool.attending ? `at ${eduLocation?.name || 'school'}` :
                         isAtGym ? `at ${gymLocation?.name || 'gym'}` :
                         prayer.active ? 'praying' :
                         'unknown/at home',
    };

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});