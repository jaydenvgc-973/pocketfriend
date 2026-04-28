// TEMPORARY INLINE RESOLVER — Phase 4A manual enforcement only
// Must be kept aligned with lib/locationResolutionEngine.js until shared backend-safe resolver exists.
// This function performs owner-scoped, manual synchronization of character location presence.
// It uses a minimal resolver subset to determine ONE true current location per character.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

    // ========== MINIMAL INLINE RESOLVER ==========
    // Applies strict precedence to determine ONE current location
    
    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayET = etTime.toISOString().slice(0, 10);

    // Check for valid callout (work exception)
    const hasValidCallout =
      character.work_exception_status === 'called_out' &&
      character.work_exception_date === todayET;

    // HELPER: Check if character is on work schedule right now
    function isCharacterOnWorkSchedule() {
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
    function isCharacterSleeping() {
      if (!character.sleep_start_time || !character.wake_up_time) return false;
      const hour = etTime.getHours();
      const sleepStart = parseInt(character.sleep_start_time.split(':')[0]);
      const wakeUp = parseInt(character.wake_up_time.split(':')[0]);

      if (sleepStart > wakeUp) {
        return hour >= sleepStart || hour < wakeUp;
      }
      return hour >= sleepStart && hour < wakeUp;
    }

    // HELPER: Check if nap time (1-3pm)
    function isNapTime() {
      const hour = etTime.getHours();
      return hour >= 13 && hour < 16;
    }

    // HELPER: Check if has unpaid sleep debt
    function hasUnpaidSleepDebt() {
      return character.sleep_debt_hours && character.sleep_debt_hours > 0;
    }

    // LAYER 1: Work schedule (skip if valid callout exists)
    if (!hasValidCallout && character.occupation_location_id) {
      const workLocation = locationMap[character.occupation_location_id];
      if (workLocation && isCharacterOnWorkSchedule()) {
        const timestamp = etTime.toISOString();
        await base44.entities.Character.update(character_id, {
          resolved_current_location_id: character.occupation_location_id,
          resolved_current_location_name: workLocation.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
          resolved_zone: null,
          resolved_last_updated_at: timestamp,
          home_resolution_failed: false
        });

        return Response.json({
          status: 'updated',
          character_id,
          owner_email,
          change: 'work_schedule',
          timestamp
        });
      }
    }

    // LAYER 2: School schedule
    if (character.student_status === 'enrolled' && character.education_location_id) {
      const schoolLocation = locationMap[character.education_location_id];
      if (schoolLocation) {
        const timestamp = etTime.toISOString();
        await base44.entities.Character.update(character_id, {
          resolved_current_location_id: character.education_location_id,
          resolved_current_location_name: schoolLocation.name || 'School',
          resolved_location_type: 'school',
          resolved_presence_status: 'at_school',
          resolved_source_reason: 'school_schedule',
          resolved_zone: null,
          resolved_last_updated_at: timestamp,
          home_resolution_failed: false
        });

        return Response.json({
          status: 'updated',
          character_id,
          owner_email,
          change: 'school_schedule',
          timestamp
        });
      }
    }

    // LAYER 3: Active travel
    if (character.travel_status && character.travel_status !== 'not_traveling' && character.travel_destination_location_id) {
      const destLocation = locationMap[character.travel_destination_location_id];
      if (destLocation) {
        const timestamp = etTime.toISOString();
        await base44.entities.Character.update(character_id, {
          resolved_current_location_id: character.travel_destination_location_id,
          resolved_current_location_name: destLocation.name || 'Traveling',
          resolved_location_type: 'traveling',
          resolved_presence_status: 'traveling',
          resolved_source_reason: character.travel_status,
          resolved_zone: null,
          resolved_last_updated_at: timestamp,
          home_resolution_failed: false
        });

        return Response.json({
          status: 'updated',
          character_id,
          owner_email,
          change: 'travel_status',
          timestamp
        });
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
        const timestamp = etTime.toISOString();
        await base44.entities.Character.update(character_id, {
          resolved_current_location_id: resolvedLocIdForVisit,
          resolved_current_location_name: socialLocation.name || character.resolved_current_location_name || 'Visiting',
          resolved_location_type: 'visit',
          resolved_presence_status: character.resolved_presence_status || 'visiting',
          resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
          resolved_zone: null,
          resolved_last_updated_at: timestamp,
          home_resolution_failed: false
        });

        return Response.json({
          status: 'updated',
          character_id,
          owner_email,
          change: 'visit_status',
          timestamp
        });
      }
    }

    // PHASE 4: RESOLVE HOME BASE (TEMPORARY HOUSING PRIORITY)
    let resolvedHomeId = null;

    if (character.is_temporarily_housed === true && character.temporary_housing_location_id) {
      // Temporary housing takes absolute priority over permanent home
      resolvedHomeId = character.temporary_housing_location_id;
    } else {
      // Fall back to permanent home
      resolvedHomeId = character.current_home_location_id || character.home_location_id || null;
    }

    // LAYER 5: Sleep state (valid resting location)
    if (isCharacterSleeping()) {
      if (resolvedHomeId) {
        const homeLocation = locationMap[resolvedHomeId];
        const timestamp = etTime.toISOString();
        await base44.entities.Character.update(character_id, {
          resolved_current_location_id: resolvedHomeId,
          resolved_current_location_name: homeLocation?.name || 'Home',
          resolved_location_type: 'home',
          resolved_presence_status: 'sleeping',
          resolved_source_reason: 'home_sleeping',
          resolved_zone: null,
          resolved_last_updated_at: timestamp,
          home_resolution_failed: !homeLocation
        });

        return Response.json({
          status: 'updated',
          character_id,
          owner_email,
          change: 'sleep_state',
          timestamp
        });
      }
    }

    // LAYER 6: Recovery nap
    if (hasUnpaidSleepDebt() && isNapTime()) {
      if (resolvedHomeId) {
        const homeLocation = locationMap[resolvedHomeId];
        const timestamp = etTime.toISOString();
        await base44.entities.Character.update(character_id, {
          resolved_current_location_id: resolvedHomeId,
          resolved_current_location_name: homeLocation?.name || 'Home',
          resolved_location_type: 'recovery_nap',
          resolved_presence_status: 'napping',
          resolved_source_reason: 'recovery_nap',
          resolved_zone: null,
          resolved_last_updated_at: timestamp,
          home_resolution_failed: !homeLocation
        });

        return Response.json({
          status: 'updated',
          character_id,
          owner_email,
          change: 'nap_state',
          timestamp
        });
      }
    }

    // LAYER 7: Home base fallback
    if (resolvedHomeId) {
      const homeLocation = locationMap[resolvedHomeId];
      const timestamp = etTime.toISOString();
      await base44.entities.Character.update(character_id, {
        resolved_current_location_id: resolvedHomeId,
        resolved_current_location_name: homeLocation?.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'fallback_to_home_base',
        resolved_zone: null,
        resolved_last_updated_at: timestamp,
        home_resolution_failed: !homeLocation
      });

      return Response.json({
        status: 'updated',
        character_id,
        owner_email,
        change: 'home_base_fallback',
        timestamp
      });
    }

    // LAYER 8: No home found — character is truly homeless
    const timestamp = etTime.toISOString();
    await base44.entities.Character.update(character_id, {
      resolved_current_location_id: null,
      resolved_current_location_name: 'Away',
      resolved_location_type: 'rabbit_hole',
      resolved_presence_status: 'rabbit_hole',
      resolved_source_reason: 'no_home_no_temp_housing',
      resolved_zone: null,
      resolved_last_updated_at: timestamp,
      home_resolution_failed: false
    });

    return Response.json({
      status: 'updated',
      character_id,
      owner_email,
      change: 'no_home_fallback',
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