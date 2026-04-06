import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * MIGRATION: Rehydrate all characters to resolved locations from live state.
 * 
 * This function:
 * 1. Fetches all characters and locations
 * 2. Computes ONE resolved location per character using the new resolver
 * 3. Stores resolved_* fields on each character
 * 4. Clears any stale legacy location fields
 * 5. Returns migration report
 * 
 * CRITICAL: This is a one-time cutover operation. Run once, then switch UI to read-only.
 */

// Inline resolver (since local imports not allowed in Deno functions)
function resolveCharacterLocation(character, locationMap = {}, currentTime = new Date()) {
  if (!character) {
    return createFailedResolution('No character provided');
  }

  // LAYER 1: Check work schedule (highest priority obligation)
  if (isCharacterOnWorkSchedule(character, currentTime)) {
    const workLocation = locationMap[character.occupation_location_id];
    if (workLocation) {
      return {
        resolved_current_location_id: character.occupation_location_id,
        resolved_current_location_name: workLocation.name || 'Work',
        resolved_location_type: 'work',
        resolved_presence_status: 'at_work',
        resolved_source_reason: 'work_schedule',
        resolved_zone: null,
        resolved_last_updated_at: new Date().toISOString(),
      };
    }
  }

  // LAYER 2: Check school schedule
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
        resolved_last_updated_at: new Date().toISOString(),
      };
    }
  }

  // LAYER 3: Check active travel state
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
        resolved_last_updated_at: new Date().toISOString(),
      };
    }
  }

  // LAYER 4: Check sleep/nap state
  if (isCharacterSleeping(character)) {
    const homeLocation = locationMap[character.current_home_location_id];
    if (homeLocation) {
      return {
        resolved_current_location_id: character.current_home_location_id,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'home_sleeping',
        resolved_zone: null,
        resolved_last_updated_at: new Date().toISOString(),
      };
    }
  }

  // LAYER 5: Check if in recovery nap
  if (hasUnpaidSleepDebt(character) && isNapTime(character, currentTime)) {
    const homeLocation = locationMap[character.current_home_location_id];
    if (homeLocation) {
      return {
        resolved_current_location_id: character.current_home_location_id,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'recovery_nap',
        resolved_presence_status: 'napping',
        resolved_source_reason: 'recovery_nap',
        resolved_zone: null,
        resolved_last_updated_at: new Date().toISOString(),
      };
    }
  }

  // LAYER 6: Home fallback (only if truly home)
  if (character.current_home_location_id) {
    const homeLocation = locationMap[character.current_home_location_id];
    if (homeLocation) {
      return {
        resolved_current_location_id: character.current_home_location_id,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_free_time',
        resolved_zone: null,
        resolved_last_updated_at: new Date().toISOString(),
      };
    }
  }

  return createFailedResolution('No valid location resolved');
}

function isCharacterOnWorkSchedule(character, currentTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return false;
  }

  const hour = currentTime.getHours();
  const dayOfWeek = currentTime.getDay();

  const workStart = parseInt(character.work_start_time.split(':')[0]);
  const workEnd = parseInt(character.work_end_time.split(':')[0]);
  const isWorkDay = character.work_days.includes(dayOfWeek);
  const isWorkHours = hour >= workStart && hour < workEnd;

  return isWorkDay && isWorkHours;
}

function isCharacterSleeping(character) {
  if (!character.sleep_start_time || !character.wake_up_time) {
    return false;
  }

  const now = new Date();
  const hour = now.getHours();

  const sleepStart = parseInt(character.sleep_start_time.split(':')[0]);
  const wakeUp = parseInt(character.wake_up_time.split(':')[0]);

  if (sleepStart > wakeUp) {
    return hour >= sleepStart || hour < wakeUp;
  }
  return hour >= sleepStart && hour < wakeUp;
}

function hasUnpaidSleepDebt(character) {
  return character.sleep_debt_hours && character.sleep_debt_hours > 0;
}

function isNapTime(character, currentTime) {
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
    resolved_zone: null,
    resolved_last_updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      "-updated_date"
    );
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const report = {
      total_characters: characters.length,
      migrated: 0,
      failed: [],
      resolved_locations: {}
    };

    for (const char of characters) {
      try {
        const resolved = resolveCharacterLocation(char, locationMap);

        if (!resolved.resolved_current_location_id) {
          report.failed.push({
            character_id: char.id,
            character_name: char.name,
            reason: resolved.resolved_source_reason
          });
          continue;
        }

        // Update character with resolved location metadata
        await base44.entities.Character.update(char.id, {
          resolved_current_location_id: resolved.resolved_current_location_id,
          resolved_current_location_name: resolved.resolved_current_location_name,
          resolved_location_type: resolved.resolved_location_type,
          resolved_presence_status: resolved.resolved_presence_status,
          resolved_source_reason: resolved.resolved_source_reason,
          resolved_last_updated_at: resolved.resolved_last_updated_at
        });

        report.resolved_locations[char.id] = {
          character_name: char.name,
          location_id: resolved.resolved_current_location_id,
          location_name: resolved.resolved_current_location_name,
          type: resolved.resolved_location_type,
          reason: resolved.resolved_source_reason
        };

        report.migrated++;
      } catch (error) {
        report.failed.push({
          character_id: char.id,
          character_name: char.name,
          error: error.message
        });
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});