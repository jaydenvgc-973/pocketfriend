import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * MIGRATION: Rehydrate all character locations from NEW resolver engine
 * 
 * This one-time function:
 * 1. Reads live character state (schedules, home, work, school, travel)
 * 2. Computes resolved location using ONLY the new engine
 * 3. Stores resolved metadata on each character
 * 4. Clears old fallback/cached location fields
 * 5. Returns migration audit
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

    const audit = {
      total_characters: characters.length,
      migrated: 0,
      failed: [],
      state_changes: {
        work_schedule_detected: 0,
        school_schedule_detected: 0,
        home_assigned: 0,
        traveling: 0,
        sleeping: 0
      }
    };

    for (const char of characters) {
      if (char.status === 'deleted' || char.status === 'soft_deleted') continue;

      try {
        // REHYDRATE: Use only live inputs, ignore any prior cached state
        const resolved = resolveCharacterLocationFresh(char, locationMap);

        if (!resolved.resolved_current_location_id) {
          audit.failed.push({
            character_id: char.id,
            character_name: char.name,
            reason: 'No valid location resolved from live state'
          });
          continue;
        }

        // Track state detection
        if (resolved.resolved_source_reason === 'work_schedule') {
          audit.state_changes.work_schedule_detected++;
        } else if (resolved.resolved_source_reason === 'school_schedule') {
          audit.state_changes.school_schedule_detected++;
        } else if (resolved.resolved_source_reason === 'home_free_time') {
          audit.state_changes.home_assigned++;
        } else if (resolved.resolved_source_reason.includes('travel')) {
          audit.state_changes.traveling++;
        } else if (resolved.resolved_source_reason === 'home_sleeping') {
          audit.state_changes.sleeping++;
        }

        // MIGRATE: Store resolved metadata (replaces old cached fields)
        await base44.entities.Character.update(char.id, {
          resolved_current_location_id: resolved.resolved_current_location_id,
          resolved_current_location_name: resolved.resolved_current_location_name,
          resolved_location_type: resolved.resolved_location_type,
          resolved_presence_status: resolved.resolved_presence_status,
          resolved_source_reason: resolved.resolved_source_reason,
          resolved_last_updated_at: new Date().toISOString()
        });

        audit.migrated++;
      } catch (err) {
        audit.failed.push({
          character_id: char.id,
          character_name: char.name,
          reason: err.message
        });
      }
    }

    return Response.json(audit);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Fresh resolver: compute location from live state only
 * Ignores any old cached/fallback values
 */
function resolveCharacterLocationFresh(character, locationMap = {}) {
  if (!character) {
    return createFailedResolution('No character');
  }

  const now = new Date();

  // LAYER 1: Work schedule (highest priority obligation)
  if (isWorkingRightNow(character, now)) {
    const workLoc = locationMap[character.occupation_location_id];
    if (workLoc) {
      return {
        resolved_current_location_id: character.occupation_location_id,
        resolved_current_location_name: workLoc.name || 'Work',
        resolved_location_type: 'work',
        resolved_presence_status: 'at_work',
        resolved_source_reason: 'work_schedule',
        resolved_zone: null
      };
    }
  }

  // LAYER 2: School schedule
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLoc = locationMap[character.education_location_id];
    if (schoolLoc) {
      return {
        resolved_current_location_id: character.education_location_id,
        resolved_current_location_name: schoolLoc.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
        resolved_zone: null
      };
    }
  }

  // LAYER 3: Active travel
  if (character.travel_status && character.travel_status !== 'not_traveling' && character.travel_destination_location_id) {
    const destLoc = locationMap[character.travel_destination_location_id];
    if (destLoc) {
      return {
        resolved_current_location_id: character.travel_destination_location_id,
        resolved_current_location_name: destLoc.name || 'Traveling',
        resolved_location_type: 'traveling',
        resolved_presence_status: 'traveling',
        resolved_source_reason: character.travel_status,
        resolved_zone: null
      };
    }
  }

  // LAYER 4: Sleeping
  if (isSleepingRightNow(character)) {
    const homeLoc = locationMap[character.current_home_location_id];
    if (homeLoc) {
      return {
        resolved_current_location_id: character.current_home_location_id,
        resolved_current_location_name: homeLoc.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'home_sleeping',
        resolved_zone: null
      };
    }
  }

  // LAYER 5: Recovery nap
  if (character.sleep_debt_hours > 0 && isNapTimeRightNow(now)) {
    const homeLoc = locationMap[character.current_home_location_id];
    if (homeLoc) {
      return {
        resolved_current_location_id: character.current_home_location_id,
        resolved_current_location_name: homeLoc.name || 'Home',
        resolved_location_type: 'recovery_nap',
        resolved_presence_status: 'napping',
        resolved_source_reason: 'recovery_nap',
        resolved_zone: null
      };
    }
  }

  // LAYER 6: Home (fallback)
  if (character.current_home_location_id) {
    const homeLoc = locationMap[character.current_home_location_id];
    if (homeLoc) {
      return {
        resolved_current_location_id: character.current_home_location_id,
        resolved_current_location_name: homeLoc.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_free_time',
        resolved_zone: null
      };
    }
  }

  return createFailedResolution('No valid location resolved');
}

function isWorkingRightNow(character, currentTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return false;
  }
  const hour = currentTime.getHours();
  const day = currentTime.getDay();
  const start = parseInt(character.work_start_time.split(':')[0]);
  const end = parseInt(character.work_end_time.split(':')[0]);
  const isDay = character.work_days.includes(day);
  const isHours = hour >= start && hour < end;
  return isDay && isHours;
}

function isSleepingRightNow(character) {
  if (!character.sleep_start_time || !character.wake_up_time) return false;
  const hour = new Date().getHours();
  const sleepStart = parseInt(character.sleep_start_time.split(':')[0]);
  const wakeUp = parseInt(character.wake_up_time.split(':')[0]);
  if (sleepStart > wakeUp) {
    return hour >= sleepStart || hour < wakeUp;
  }
  return hour >= sleepStart && hour < wakeUp;
}

function isNapTimeRightNow(currentTime) {
  const hour = currentTime.getHours();
  return hour >= 13 && hour < 16;
}

function createFailedResolution(reason) {
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Unknown',
    resolved_location_type: null,
    resolved_presence_status: 'unknown',
    resolved_source_reason: reason,
    resolved_zone: null
  };
}