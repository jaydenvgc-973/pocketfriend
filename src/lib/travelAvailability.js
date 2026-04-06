import { getCharacterStatusDisplay } from './characterStatusUtils';
import { getAuthoritativeCharacterLocation } from './authoritativeLocationResolver';
import { isCharacterAsleep } from './sleepUtils';
import { isCharacterAtWork } from './workScheduleUtils';
import { toDisplay12h } from './timeFormat';

/**
 * Returns availability info for a character for travel.
 * { available: boolean, reason: { iconType, message, color }, availableAt: string|null }
 */
export function getCharacterTravelAvailability(character, locationMap = {}) {
  if (!character) return { available: false, reason: { iconType: 'out', message: 'Unknown status', color: 'text-muted-foreground' }, availableAt: null };

  // Build complete locationData for proper resolution
  const homeLocation = character.current_home_location_id ? locationMap[character.current_home_location_id] : null;
  const workLocation = character.occupation_location_id ? locationMap[character.occupation_location_id] : null;
  const educationLocation = character.education_location_id ? locationMap[character.education_location_id] : null;
  const currentLocation = character.current_location_id ? locationMap[character.current_location_id] : null;

  const statusDisplay = getCharacterStatusDisplay(character, { 
    homeLocation, 
    workLoc: workLocation, 
    eduLoc: educationLocation, 
    currentLoc: currentLocation 
  });
  const iconType = statusDisplay?.iconType || 'calm';

  if (iconType === 'sleep') {
    const wakeTime = character.wake_up_time || '07:00';
    return {
      available: false,
      reason: { iconType: 'sleep', message: `${character.name} is asleep right now and can't join.`, color: 'text-blue-300' },
      availableAt: `May be free after ${toDisplay12h(wakeTime)}`,
    };
  }

  if (iconType === 'work') {
    // Only block if the character actually has a defined job
    const hasJob = character?.work_details?.job_title || character?.occupation_location_id;
    if (!hasJob) return { available: true, reason: null, availableAt: null };

    // Look up the real shift end from the location's worker_shifts first
    let workEnd = null;
    if (character.occupation_location_id && locationMap[character.occupation_location_id]) {
      const workLoc = locationMap[character.occupation_location_id];
      const shift = workLoc.worker_shifts?.[character.id];
      if (shift?.end) workEnd = shift.end;
    }
    // Fall back to character's own work_end_time only if no shift data found
    if (!workEnd) workEnd = character.work_end_time || null;

    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is at work${workEnd ? ` until ${toDisplay12h(workEnd)}` : ''}`,
      availableAt: workEnd ? `May be free after ${toDisplay12h(workEnd)}` : null,
    };
  }

  if (iconType === 'school') {
    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is at school right now`,
      availableAt: null,
    };
  }

  if (iconType === 'hospital') {
    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is at the hospital right now`,
      availableAt: null,
    };
  }

  if (iconType === 'prayer') {
    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is praying right now`,
      availableAt: 'Should be free soon',
    };
  }

  return { available: true, reason: null, availableAt: null };
}

/**
 * Returns true if a character is currently at home (not at work, school, etc.)
 * CRITICAL: Uses authoritative resolver to determine actual location
 */
export function isCharacterHome(character, locationMap = {}) {
  const authLoc = getAuthoritativeCharacterLocation(character, locationMap);
  // They're home only if their authoritative location is their home location
  if (!authLoc || !character.current_home_location_id) return false;
  return authLoc.id === character.current_home_location_id;
}