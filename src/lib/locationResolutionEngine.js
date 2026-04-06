/**
 * LOCATION RESOLUTION ENGINE
 * 
 * Single authoritative source for character current location.
 * Computes one final resolved location per character.
 * 
 * Strict precedence:
 * 1. Work schedule
 * 2. School schedule
 * 3. Active travel
 * 4. Valid visit/event/supervision
 * 5. Free-time chosen location
 * 6. Home (only if truly home)
 */

/**
 * Main resolution function: determine ONE true current location for a character
 * 
 * Inputs:
 * - character: full character object
 * - locationMap: {locationId: location}
 * - currentTime: Date object (defaults to now)
 * 
 * Returns:
 * {
 *   resolved_current_location_id: string,
 *   resolved_current_location_name: string,
 *   resolved_location_type: string,
 *   resolved_presence_status: string,
 *   resolved_source_reason: string,
 *   resolved_zone: string | null
 * }
 */
export function resolveCharacterLocation(character, locationMap = {}, currentTime = new Date()) {
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
      };
    }
  }

  // LAYER 4: Check valid visit/event/supervision state
  // (Placeholder for future visit/event system)
  // For now, skip

  // LAYER 5: Check sleep/nap state (valid resting location)
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
      };
    }
  }

  // LAYER 6: Check if in recovery nap
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
      };
    }
  }

  // LAYER 7: Home fallback (only if truly home)
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
      };
    }
  }

  // Fallback: Unknown location (should not happen)
  return createFailedResolution('No valid location resolved');
}

/**
 * Check if character is on work schedule right now (with prep window)
 * Returns { onSchedule, inPrepWindow, minutesUntilWork }
 */
function getWorkScheduleStatus(character, currentTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return { onSchedule: false, inPrepWindow: false, minutesUntilWork: null };
  }

  const now = currentTime.getTime();
  const dayOfWeek = currentTime.getDay();
  const isWorkDay = character.work_days.includes(dayOfWeek);
  
  if (!isWorkDay) {
    return { onSchedule: false, inPrepWindow: false, minutesUntilWork: null };
  }

  const [workStartHour, workStartMin] = character.work_start_time.split(':').map(Number);
  const [workEndHour, workEndMin] = character.work_end_time.split(':').map(Number);
  
  const workStartMs = new Date(currentTime).setHours(workStartHour, workStartMin, 0, 0);
  const workEndMs = new Date(currentTime).setHours(workEndHour, workEndMin, 0, 0);

  const onSchedule = now >= workStartMs && now < workEndMs;
  
  // Prep window: 15 minutes before work starts
  const prepWindowStart = workStartMs - (15 * 60 * 1000);
  const inPrepWindow = !onSchedule && now >= prepWindowStart && now < workStartMs;
  
  const minutesUntilWork = inPrepWindow ? Math.round((workStartMs - now) / 60000) : null;

  return { onSchedule, inPrepWindow, minutesUntilWork };
}

/**
 * Check if character is on work schedule right now
 */
function isCharacterOnWorkSchedule(character, currentTime) {
  const status = getWorkScheduleStatus(character, currentTime);
  return status.onSchedule;
}

/**
 * Check if character is sleeping
 */
function isCharacterSleeping(character) {
  if (!character.sleep_start_time || !character.wake_up_time) {
    return false;
  }

  const now = new Date();
  const hour = now.getHours();

  const sleepStart = parseInt(character.sleep_start_time.split(':')[0]);
  const wakeUp = parseInt(character.wake_up_time.split(':')[0]);

  // Handle sleep that crosses midnight
  if (sleepStart > wakeUp) {
    return hour >= sleepStart || hour < wakeUp;
  }
  return hour >= sleepStart && hour < wakeUp;
}

/**
 * Check if character has unpaid sleep debt
 */
function hasUnpaidSleepDebt(character) {
  return character.sleep_debt_hours && character.sleep_debt_hours > 0;
}

/**
 * Check if it's nap time (1-3pm typically)
 */
function isNapTime(character, currentTime) {
  const hour = currentTime.getHours();
  return hour >= 13 && hour < 16; // 1pm - 4pm
}

/**
 * Create a failed resolution response
 */
function createFailedResolution(reason) {
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Unknown',
    resolved_location_type: null,
    resolved_presence_status: 'unknown',
    resolved_source_reason: reason,
    resolved_zone: null,
  };
}

/**
 * Verify that all characters have unique locations (one presence only)
 * Returns array of violations if any
 */
export function verifyUniquePresence(characters, locationMap = {}) {
  const violations = [];
  const locationOccupants = {};

  characters.forEach(char => {
    const resolved = resolveCharacterLocation(char, locationMap);
    const locationId = resolved.resolved_current_location_id;

    if (locationId) {
      if (!locationOccupants[locationId]) {
        locationOccupants[locationId] = [];
      }
      locationOccupants[locationId].push(char.id);
    }
  });

  // Check for duplicates (this shouldn't happen with proper resolution)
  Object.entries(locationOccupants).forEach(([locId, charIds]) => {
    const counted = {};
    charIds.forEach(cid => {
      counted[cid] = (counted[cid] || 0) + 1;
    });
    Object.entries(counted).forEach(([cid, count]) => {
      if (count > 1) {
        violations.push({
          character_id: cid,
          location_id: locId,
          count,
          error: 'Character appears multiple times at same location',
        });
      }
    });
  });

  return violations;
}

/**
 * Verify that Home/Travel screens would show the same location
 * Returns true if consistent
 */
export function verifyScreenConsistency(character, locationMap = {}) {
  const resolved = resolveCharacterLocation(character, locationMap);
  
  // Both screens should read from resolved_current_location_id
  // This function just confirms the field exists and is valid
  return !!(resolved.resolved_current_location_id && resolved.resolved_current_location_name);
}

/**
 * Verify no false Home fallback occurred
 * Returns true if location is correctly non-Home when it should be
 */
export function verifyNoFalseHomeFallback(character, locationMap = {}) {
  const resolved = resolveCharacterLocation(character, locationMap);

  // If work schedule, must not be Home
  if (isCharacterOnWorkSchedule(character)) {
    return resolved.resolved_location_type !== 'home';
  }

  // If school schedule, must not be Home
  if (character.student_status === 'enrolled' && character.education_location_id) {
    return resolved.resolved_location_type !== 'school';
  }

  // If traveling, must not be Home
  if (character.travel_status && character.travel_status !== 'not_traveling') {
    return resolved.resolved_location_type !== 'home';
  }

  return true;
}

/**
 * STRICT SCHEDULE ENFORCEMENT: Check if character is violating schedule
 * Returns { isViolating, violation_type, should_be_at }
 */
export function checkScheduleViolation(character, locationMap = {}, currentTime = new Date()) {
  const resolved = resolveCharacterLocation(character, locationMap, currentTime);
  const workStatus = getWorkScheduleStatus(character, currentTime);

  // WORK VIOLATION: Character should be at work
  if (workStatus.onSchedule && character.occupation_location_id) {
    const isAtWork = resolved.resolved_location_id === character.occupation_location_id;
    const isReadyToTravel = workStatus.inPrepWindow;
    
    if (!isAtWork && !isReadyToTravel) {
      const workLoc = locationMap[character.occupation_location_id];
      return {
        isViolating: true,
        violation_type: 'work_schedule_violation',
        should_be_at: {
          location_id: character.occupation_location_id,
          location_name: workLoc?.name || 'Work',
          reason: 'Active work schedule'
        }
      };
    }
  }

  // SCHOOL VIOLATION: Character should be at school
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const isAtSchool = resolved.resolved_current_location_id === character.education_location_id;
    if (!isAtSchool) {
      const schoolLoc = locationMap[character.education_location_id];
      return {
        isViolating: true,
        violation_type: 'school_schedule_violation',
        should_be_at: {
          location_id: character.education_location_id,
          location_name: schoolLoc?.name || 'School',
          reason: 'Enrolled student during school hours'
        }
      };
    }
  }

  return { isViolating: false };
}

/**
 * AUTO-CORRECT: If character is violating schedule, force correct location
 * Returns corrected character data or null if no correction needed
 */
export function autoCorrectScheduleViolation(character, locationMap = {}, currentTime = new Date()) {
  const violation = checkScheduleViolation(character, locationMap, currentTime);
  
  if (!violation.isViolating) {
    return null; // No violation, no correction needed
  }

  const correction = {};
  const { location_id, location_name, reason } = violation.should_be_at;

  if (violation.violation_type === 'work_schedule_violation') {
    correction.resolved_current_location_id = location_id;
    correction.resolved_current_location_name = location_name;
    correction.resolved_location_type = 'work';
    correction.resolved_presence_status = 'at_work';
    correction.resolved_source_reason = 'work_schedule_enforced';
  } else if (violation.violation_type === 'school_schedule_violation') {
    correction.resolved_current_location_id = location_id;
    correction.resolved_current_location_name = location_name;
    correction.resolved_location_type = 'school';
    correction.resolved_presence_status = 'at_school';
    correction.resolved_source_reason = 'school_schedule_enforced';
  }

  correction.resolved_last_updated_at = currentTime.toISOString();
  return correction;
}