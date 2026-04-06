/**
 * AUTHORITATIVE LOCATION RESOLVER
 * 
 * Single source of truth for character current location.
 * All UI surfaces (card, Travel, context) must use this function.
 * 
 * Priority order (highest to lowest):
 * 1. Active work schedule → work location
 * 2. Active school schedule → school location
 * 3. Active travel/event state → travel destination
 * 4. No active obligation → home location (true fallback, not override)
 */

import { isCharacterAsleep } from './sleepUtils';
import { isCharacterInPrayer } from './religionUtils';

export function getAuthoritativeCharacterLocation(character, locationMap = {}) {
  if (!character) return null;

  // SLEEP takes absolute priority (above all schedules)
  if (isCharacterAsleep(character)) {
    return {
      id: character.current_home_location_id,
      name: locationMap[character.current_home_location_id]?.name || 'Home',
      source: 'sleeping_at_home',
      authoritative: true
    };
  }

  // PRAYER that blocks response (above schedules)
  const prayer = isCharacterInPrayer(character);
  if (prayer.active && prayer.blocks_response) {
    return {
      id: character.current_home_location_id,
      name: locationMap[character.current_home_location_id]?.name || 'Home',
      source: 'praying_at_home',
      authoritative: true
    };
  }

  // === SCHEDULE CHECKING (highest priority when awake) ===
  // SCHEDULES MUST BE CHECKED BEFORE CURRENT_LOCATION
  // because current_location might be stale or set to home by default

  // 1. WORK SCHEDULE — check if scheduled NOW
  if (character.work_start_time && character.work_end_time && character.work_days) {
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    const workStart = parseInt(character.work_start_time.split(':')[0]);
    const workEnd = parseInt(character.work_end_time.split(':')[0]);
    const isWorkDay = character.work_days.includes(dayOfWeek);
    const isWorkHours = currentHour >= workStart && currentHour < workEnd;

    // CRITICAL: If scheduled for work, they MUST be at work
    // This OVERRIDES current_location and home fallback
    if (isWorkDay && isWorkHours && character.occupation_location_id) {
      const workLoc = locationMap[character.occupation_location_id];
      if (workLoc && workLoc.name) {
        return {
          id: character.occupation_location_id,
          name: workLoc.name,
          source: 'active_work_schedule',
          authoritative: true
        };
      }
    }
  }

  // 2. SCHOOL SCHEDULE — check if enrolled
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLoc = locationMap[character.education_location_id];
    if (schoolLoc && schoolLoc.name) {
      // Character is enrolled in school — they are there (unless on break/graduated)
      return {
        id: character.education_location_id,
        name: schoolLoc.name,
        source: 'active_school_schedule',
        authoritative: true
      };
    }
  }

  // 3. EXPLICIT CURRENT LOCATION — may be set by travel, event, or manual placement
  // BUT: Only trust it if it's NOT the home location (home is the fallback, not an explicit choice)
  // If current_location_id equals home_location_id, ignore it and fall through to home fallback
  if (character.current_location_id && character.current_location_id !== character.current_home_location_id) {
    const currentLoc = locationMap[character.current_location_id];
    if (currentLoc && currentLoc.name) {
      return {
        id: character.current_location_id,
        name: currentLoc.name,
        source: 'explicit_current_location',
        authoritative: true
      };
    }
  }

  // === NO ACTIVE OBLIGATION — HOME IS VALID FALLBACK ===
  // This is where home belongs: only when no higher-priority obligation exists
  if (character.current_home_location_id) {
    const homeLoc = locationMap[character.current_home_location_id];
    if (homeLoc && homeLoc.name) {
      return {
        id: character.current_home_location_id,
        name: homeLoc.name,
        source: 'home_fallback_no_obligation',
        authoritative: true
      };
    }
  }

  // LAST RESORT: No valid location found (data integrity error)
  return {
    id: null,
    name: 'Unknown Location',
    source: 'error_no_location',
    authoritative: false
  };
}

/**
 * Check if a character is currently scheduled for work
 * Returns: { isScheduledNow: bool, workLocationId: string, startTime: string, endTime: string }
 */
export function isCharacterScheduledForWorkNow(character) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return { isScheduledNow: false };
  }

  const now = new Date();
  const currentHour = now.getHours();
  const dayOfWeek = now.getDay();

  const workStart = parseInt(character.work_start_time.split(':')[0]);
  const workEnd = parseInt(character.work_end_time.split(':')[0]);
  const isWorkDay = character.work_days.includes(dayOfWeek);
  const isWorkHours = currentHour >= workStart && currentHour < workEnd;

  return {
    isScheduledNow: isWorkDay && isWorkHours,
    workLocationId: character.occupation_location_id,
    startTime: character.work_start_time,
    endTime: character.work_end_time
  };
}

/**
 * Check if a character is close to their work schedule start time (approaching)
 * Returns: { approachingWork: bool, minutesUntil: number, startTime: string }
 */
export function isCharacterApproachingWorkTime(character, minutesWindow = 5) {
  if (!character.work_start_time || !character.work_days) {
    return { approachingWork: false };
  }

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const dayOfWeek = now.getDay();

  const [workStartHour, workStartMin] = character.work_start_time.split(':').map(Number);
  const isWorkDay = character.work_days.includes(dayOfWeek);

  if (!isWorkDay) {
    return { approachingWork: false };
  }

  // Convert to minutes for easier calculation
  const nowTotalMin = currentHour * 60 + currentMinute;
  const workStartTotalMin = workStartHour * 60 + workStartMin;
  const minutesUntilWork = workStartTotalMin - nowTotalMin;

  const isApproaching = minutesUntilWork > 0 && minutesUntilWork <= minutesWindow;

  return {
    approachingWork: isApproaching,
    minutesUntil: minutesUntilWork,
    startTime: character.work_start_time
  };
}