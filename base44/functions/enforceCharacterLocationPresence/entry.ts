// TEMPORARY INLINE RESOLVER — Phase 4A manual enforcement only
// Must be kept aligned with lib/locationResolutionEngine.js until shared backend-safe resolver exists.
// This function performs owner-scoped, manual synchronization of character location presence.
// 
// PHASE 4A FLOW: compute → compare → write once only if changed

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// HELPER: Check if character is on work schedule right now
function isCharacterOnWorkSchedule(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return false;
  }
  const now = etTime.getTime();
  const dayOfWeek = etTime.getDay();
  const isWorkDay = character.work_days.includes(dayOfWeek);
  if (!isWorkDay) return false;

  const [workStartHour, workStartMin] = character.work_start_time.split(':').map(Number);
  const [workEndHour, workEndMin] = character.work_end_time.split(':').map(Number);

  const workStartMs = new Date(etTime).setHours(workStartHour, workStartMin, 0, 0);
  const workEndMs = new Date(etTime).setHours(workEndHour, workEndMin, 0, 0);

  return now >= workStartMs && now < workEndMs;
}

// HELPER: Check if character is sleeping
function isCharacterSleeping(character, etTime) {
  if (!character.sleep_start_time || !character.wake_up_time) return false;
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const sleepStart = parseInt(character.sleep_start_time.split(':')[0]);
  const sleepStartMin = parseInt(character.sleep_start_time.split(':')[1] || 0);
  const wakeUp = parseInt(character.wake_up_time.split(':')[0]);
  const wakeUpMin = parseInt(character.wake_up_time.split(':')[1] || 0);

  const currentTotalMins = hour * 60 + minute;
  const sleepStartTotalMins = sleepStart * 60 + sleepStartMin;
  const wakeUpTotalMins = wakeUp * 60 + wakeUpMin;

  // Overnight sleep (e.g., 23:00 to 07:00)
  if (sleepStartTotalMins > wakeUpTotalMins) {
    return currentTotalMins >= sleepStartTotalMins || currentTotalMins < wakeUpTotalMins;
  }
  // Same-day sleep (e.g., 14:00 to 16:00)
  return currentTotalMins >= sleepStartTotalMins && currentTotalMins < wakeUpTotalMins;
}

// HELPER: Check if nap time (1-3pm)
function isNapTime(etTime) {
  const hour = etTime.getHours();
  return hour >= 13 && hour < 16;
}

// HELPER: Check if has unpaid sleep debt
function hasUnpaidSleepDebt(character) {
  return character.sleep_debt_hours && character.sleep_debt_hours > 0;
}

// MINIMAL INLINE RESOLVER: Compute ONE resolved location object
function computeResolvedLocation(character, locationMap, etTime) {
  const todayET = etTime.toISOString().slice(0, 10);
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;

  // LAYER 1: Work schedule (skip if valid callout exists)
  if (!hasValidCallout && character.occupation_location_id) {
    const workLocation = locationMap[character.occupation_location_id];
    if (workLocation && isCharacterOnWorkSchedule(character, etTime)) {
      return {
        resolved_current_location_id: character.occupation_location_id,
        resolved_current_location_name: workLocation.name || 'Work',
        resolved_location_type: 'work',
        resolved_presence_status: 'at_work',
        resolved_source_reason: 'work_schedule',
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
  }

  // LAYER 2: School schedule
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLocation = locationMap[character.education_location_id];
    if (schoolLocation) {
      return {
        resolved_current_location_id: character.education_location_id,
        resolved_current_location_name: schoolLocation.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
  }

  // LAYER 3: Active travel
  if (character.travel_status && character.travel_status !== 'not_traveling' && character.travel_destination_location_id) {
    const destLocation = locationMap[character.travel_destination_location_id];
    if (destLocation) {
      return {
        resolved_current_location_id: character.travel_destination_location_id,
        resolved_current_location_name: destLocation.name || 'Traveling',
        resolved_location_type: 'traveling',
        resolved_presence_status: 'traveling',
        resolved_source_reason: character.travel_status,
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
  }

  // LAYER 4: Active explicit visit (system-placed away from home)
  const homeIdForVisitCheck = character.current_home_location_id || character.home_location_id;
  const resolvedLocIdForVisit = character.resolved_current_location_id;
  const isAwayFromHome = resolvedLocIdForVisit && resolvedLocIdForVisit !== homeIdForVisitCheck;

  const isSystemPlacedVisit =
    character.presence_state === 'social_visit' ||
    character.resolved_presence_status === 'visiting' ||
    character.resolved_source_reason === 'autonomous_needs_driven' ||
    character.resolved_source_reason === 'autonomous_movement' ||
    character.resolved_source_reason === 'user_travel';

  if (isAwayFromHome && isSystemPlacedVisit) {
    const socialLocation = locationMap[resolvedLocIdForVisit];
    if (socialLocation) {
      return {
        resolved_current_location_id: resolvedLocIdForVisit,
        resolved_current_location_name: socialLocation.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
  }

  // PHASE 4: RESOLVE HOME BASE (TEMPORARY HOUSING PRIORITY)
  let resolvedHomeId = null;

  if (character.is_temporarily_housed === true && character.temporary_housing_location_id) {
    resolvedHomeId = character.temporary_housing_location_id;
  } else {
    resolvedHomeId = character.current_home_location_id || character.home_location_id || null;
  }

  // LAYER 5: Sleep state (valid resting location)
  if (isCharacterSleeping(character, etTime)) {
    if (resolvedHomeId) {
      const homeLocation = locationMap[resolvedHomeId];
      return {
        resolved_current_location_id: resolvedHomeId,
        resolved_current_location_name: homeLocation?.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'home_sleeping',
        resolved_zone: null,
        home_resolution_failed: !homeLocation
      };
    }
  }

  // LAYER 6: Recovery nap
  if (hasUnpaidSleepDebt(character) && isNapTime(etTime)) {
    if (resolvedHomeId) {
      const homeLocation = locationMap[resolvedHomeId];
      return {
        resolved_current_location_id: resolvedHomeId,
        resolved_current_location_name: homeLocation?.name || 'Home',
        resolved_location_type: 'recovery_nap',
        resolved_presence_status: 'napping',
        resolved_source_reason: 'recovery_nap',
        resolved_zone: null,
        home_resolution_failed: !homeLocation
      };
    }
  }

  // LAYER 7: Home base fallback
  if (resolvedHomeId) {
    const homeLocation = locationMap[resolvedHomeId];
    return {
      resolved_current_location_id: resolvedHomeId,
      resolved_current_location_name: homeLocation?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'fallback_to_home_base',
      resolved_zone: null,
      home_resolution_failed: !homeLocation
    };
  }

  // LAYER 8: No home found — character is truly homeless
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Away',
    resolved_location_type: 'rabbit_hole',
    resolved_presence_status: 'rabbit_hole',
    resolved_source_reason: 'no_home_no_temp_housing',
    resolved_zone: null,
    home_resolution_failed: false
  };
}

// Build stored state from character
function buildStoredState(character) {
  return {
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || null,
    resolved_location_type: character.resolved_location_type || null,
    resolved_presence_status: character.resolved_presence_status || null,
    resolved_source_reason: character.resolved_source_reason || null,
    resolved_zone: character.resolved_zone || null,
    home_resolution_failed: character.home_resolution_failed || false
  };
}

// Deep compare resolved vs stored
function hasChanged(resolved, stored) {
  return (
    resolved.resolved_current_location_id !== stored.resolved_current_location_id ||
    resolved.resolved_current_location_name !== stored.resolved_current_location_name ||
    resolved.resolved_location_type !== stored.resolved_location_type ||
    resolved.resolved_presence_status !== stored.resolved_presence_status ||
    resolved.resolved_source_reason !== stored.resolved_source_reason ||
    (resolved.resolved_zone || null) !== stored.resolved_zone ||
    (resolved.home_resolution_failed || false) !== stored.home_resolution_failed
  );
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character_id, owner_email } = await req.json();

    // Verify ownership match (owner_email must equal current user)
    if (owner_email !== user.email) {
      return Response.json({ error: 'Ownership mismatch' }, { status: 403 });
    }

    // Load character with owner_email filter (ownership-scoped)
    const characters = await base44.entities.Character.filter({
      id: character_id,
      owner_email
    });

    if (!characters || characters.length === 0) {
      return Response.json({
        status: 'error',
        message: 'Character not found or ownership mismatch',
        character_id
      }, { status: 404 });
    }

    const character = characters[0];

    // Load locations with owner_email filter (ownership-scoped)
    const locations = await base44.entities.LocationReference.filter({
      owner_email
    });

    // Build locationMap for resolver
    const locationMap = {};
    for (const loc of locations) {
      locationMap[loc.id] = loc;
    }

    // Eastern Time for all calculations
    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // STEP 1: Compute resolved location
    const resolved = computeResolvedLocation(character, locationMap, etTime);

    // STEP 2: Build stored state
    const stored = buildStoredState(character);

    // STEP 3: Compare
    if (!hasChanged(resolved, stored)) {
      return Response.json({
        status: 'no_change',
        character_id,
        owner_email,
        message: 'Character location already matches resolver output'
      });
    }

    // STEP 4: Write once (only if changed)
    const timestamp = etTime.toISOString();
    const updateData = {
      resolved_current_location_id: resolved.resolved_current_location_id,
      resolved_current_location_name: resolved.resolved_current_location_name,
      resolved_location_type: resolved.resolved_location_type,
      resolved_presence_status: resolved.resolved_presence_status,
      resolved_source_reason: resolved.resolved_source_reason,
      resolved_zone: resolved.resolved_zone,
      resolved_last_updated_at: timestamp,
      home_resolution_failed: resolved.home_resolution_failed
    };

    await base44.entities.Character.update(character_id, updateData);

    return Response.json({
      status: 'updated',
      character_id,
      owner_email,
      changes: {
        location_id: { from: stored.resolved_current_location_id, to: resolved.resolved_current_location_id },
        location_type: { from: stored.resolved_location_type, to: resolved.resolved_location_type },
        presence_status: { from: stored.resolved_presence_status, to: resolved.resolved_presence_status },
        source_reason: { from: stored.resolved_source_reason, to: resolved.resolved_source_reason }
      },
      timestamp
    });

  } catch (error) {
    console.error('enforceCharacterLocationPresence error:', error);
    return Response.json({
      status: 'error',
      message: error.message
    }, { status: 500 });
  }
});