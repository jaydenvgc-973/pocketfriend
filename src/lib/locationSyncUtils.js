/**
 * Real-Time Location Sync System
 * 
 * Ensures characters' displayed locations match their actual scheduled position.
 * Syncs schedule system with character card display.
 */

import {
  isCharacterAtWork,
  isCharacterAtSchool,
  isCharacterAsleep,
  resolveCharacterCurrentLocation,
} from './workScheduleUtils';
import { getCharacterScheduleContext } from './scheduleAwarenessUtils';

/**
 * Get the authoritative current location for a character.
 * This is what ACTUALLY should be displayed on character cards.
 * 
 * Priority:
 *   1. Active travel override (user pulled them away)
 *   2. Scheduled location (work/school if in session)
 *   3. Resolved location from location system
 *   4. Home
 *   5. Unknown
 */
export function getCharacterRealTimeLocation(
  character,
  allLocations = [],
  travelOverride = null,
  workLocation = null,
  educationLocation = null
) {
  if (!character || !allLocations) return null;

  // 1. ACTIVE TRAVEL OVERRIDE (user pulled them away)
  if (travelOverride?.overrideActive) {
    const overrideLocation = allLocations.find(l => l.id === travelOverride.currentLocationId);
    if (overrideLocation) {
      return {
        location: overrideLocation,
        status: 'traveling_with_user',
        scheduledLocation: travelOverride.scheduledLocation,
        isOverride: true,
      };
    }
  }

  // 2. SCHEDULED LOCATION (work/school if currently in session)
  const scheduleContext = getCharacterScheduleContext(character, workLocation);
  
  if (scheduleContext?.status === 'at_location') {
    const scheduledLoc = allLocations.find(l => l.id === scheduleContext.locationId);
    if (scheduledLoc) {
      return {
        location: scheduledLoc,
        status: 'at_scheduled_location',
        scheduleContext,
        isOverride: false,
      };
    }
  }

  // 3. RESOLVED LOCATION FROM LOCATION SYSTEM
  const resolved = resolveCharacterCurrentLocation(character, allLocations);
  if (resolved?.location) {
    return {
      location: resolved.location,
      status: resolved.status,
      isOverride: false,
    };
  }

  // 4. HOME (fallback)
  const homeLocation = allLocations.find(l =>
    l.resident_character_ids?.includes(character.id) && l.category === 'home'
  );
  if (homeLocation) {
    return {
      location: homeLocation,
      status: 'at_home',
      isOverride: false,
    };
  }

  return {
    location: null,
    status: 'location_unknown',
    isOverride: false,
  };
}

/**
 * Validate location sync: check for mismatches between schedule and display.
 * Returns array of sync issues.
 */
export function validateLocationSync(character, scheduleContext, displayedLocation) {
  const issues = [];

  if (!scheduleContext?.hasSchedule) {
    return issues; // No schedule to validate against
  }

  if (scheduleContext.status !== 'at_location') {
    return issues; // Not in an active shift
  }

  if (displayedLocation?.id !== scheduleContext.locationId) {
    issues.push({
      type: 'location_mismatch',
      message: `${character.name} should be at ${scheduleContext.location} but displayed location doesn't match`,
      scheduledLocation: scheduleContext.location,
      displayedLocation: displayedLocation?.name,
      severity: 'high',
    });
  }

  return issues;
}

/**
 * Get location description for schedule context.
 * Used in dialogue and memory to reference the right place.
 */
export function getLocationLabel(location, scheduleContext) {
  if (!location) return 'unknown location';

  // If they work there, show it as "work"
  if (scheduleContext?.scheduleType === 'work' && scheduleContext.status === 'at_location') {
    return 'work';
  }

  // If they study there, show it as "school" or the actual name
  if (scheduleContext?.scheduleType === 'school' && scheduleContext.status === 'at_location') {
    return location.name || 'school';
  }

  // Otherwise use actual location name
  return location.name || 'location';
}

/**
 * Determine if a character SHOULD be at a specific location right now.
 * Used to detect inconsistencies.
 */
export function shouldCharacterBeAtLocation(character, location, scheduleContext) {
  if (!scheduleContext?.hasSchedule || scheduleContext.status !== 'at_location') {
    return false;
  }

  return location?.id === scheduleContext.locationId;
}

/**
 * When time advances, check if character's location should change.
 * Returns { shouldUpdate: boolean, newLocation: Location|null }
 */
export function checkLocationUpdateNeeded(
  character,
  currentLocation,
  allLocations,
  scheduleContext
) {
  if (!character || !allLocations) {
    return { shouldUpdate: false };
  }

  // If schedule context changed status (e.g., from "at_location" to "off_schedule")
  const newScheduleContext = getCharacterScheduleContext(character, allLocations[0]);
  
  if (newScheduleContext?.status !== scheduleContext?.status) {
    // Schedule status changed — location might need to update
    
    if (newScheduleContext.status === 'off_schedule' && currentLocation?.id === scheduleContext.locationId) {
      // Character's shift ended — they should leave
      const homeLocation = allLocations.find(l =>
        l.resident_character_ids?.includes(character.id) && l.category === 'home'
      );
      
      return {
        shouldUpdate: true,
        newLocation: homeLocation || null,
        reason: 'shift ended',
      };
    }
  }

  return { shouldUpdate: false };
}