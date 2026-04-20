/**
 * Creation & Update Guards — Prevent violations before they occur
 */

/**
 * Guard against duplicate VGC Towers creation
 * @returns {boolean} true if creation should be blocked
 */
export async function preventDuplicateVGCTowers(base44, newLocationName, userEmail) {
  if (!newLocationName?.toLowerCase().includes('vgc towers')) {
    return false; // Not a VGC Towers, allow creation
  }

  const existing = await base44.asServiceRole.entities.LocationReference.filter(
    {
      $or: [
        { created_by: userEmail, name: { $regex: 'VGC Towers', $options: 'i' } },
        { owner_email: userEmail, name: { $regex: 'VGC Towers', $options: 'i' } },
      ],
    },
    '-created_date',
    10
  ).catch(() => []);

  if (existing.length > 0) {
    throw new Error(
      `VGC Towers already exists (Rule 1 violation). ` +
      `Use existing location ID: ${existing[0].id}`
    );
  }

  return false; // Creation is safe
}

/**
 * Guard against character omnipresence
 * Ensure character doesn't exist in multiple locations
 */
export function preventOmnipresence(characterData) {
  const locations = [];
  if (characterData.current_home_location_id) {
    locations.push(characterData.current_home_location_id);
  }
  if (characterData.resolved_current_location_id) {
    locations.push(characterData.resolved_current_location_id);
  }

  const uniqueLocations = new Set(locations.filter(Boolean));
  if (uniqueLocations.size > 1) {
    throw new Error(
      `Character cannot exist in multiple locations (Rule 4 violation). ` +
      `Resolve to single location: ${characterData.resolved_current_location_id}`
    );
  }
}

/**
 * Guard against invalid travel states
 * Travel must be instant switching, not "in motion"
 */
export function preventInvalidTravelState(characterData) {
  const invalidStates = ['traveling', 'commuting', 'on_the_way', 'in_transit'];
  
  if (invalidStates.includes(characterData.travel_status)) {
    throw new Error(
      `Invalid travel state: "${characterData.travel_status}" (Rule 6 violation). ` +
      `Valid states: "not_traveling" or location switches.`
    );
  }
}

/**
 * Guard against unknown location
 * Character must always have a valid location reference
 */
export function preventUnknownLocation(characterData) {
  const hasValidLocation = !!characterData.resolved_current_location_id || 
                          !!characterData.current_home_location_id;
  
  if (!hasValidLocation) {
    throw new Error(
      `Character must have valid location assignment (Rule 5 violation). ` +
      `Assign resolved_current_location_id or current_home_location_id.`
    );
  }
}

/**
 * Guard against sleeping during travel time
 * NPCs must be awake and distributed during 4-9 AM ET
 */
export function preventSleepDuringTravelTime(characterData) {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etTime.getHours();
  const isTravelTime = hour >= 4 && hour < 9;
  const isSleeping = characterData.resolved_presence_status === 'sleeping' || 
                    characterData.resolved_presence_status === 'napping';

  if (isTravelTime && isSleeping) {
    throw new Error(
      `NPCs cannot sleep during travel time 4-9 AM ET (Rule 9 violation). ` +
      `Current time: ${etTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}. ` +
      `Character should be awake and distributed.`
    );
  }
}

/**
 * Guard against placeholder/vague locations
 */
export function preventPlaceholderLocation(location) {
  if (!location) return;
  
  const placeholderPatterns = ['generic', 'unknown', 'placeholder', 'temp', 'undefined', 'vague'];
  const name = (location.name || '').toLowerCase();
  
  if (placeholderPatterns.some(p => name.includes(p))) {
    throw new Error(
      `Location name is placeholder/vague (Rule 11 violation). ` +
      `Use descriptive location name: "${location.name}"`
    );
  }
}

/**
 * Validate character update against all rules
 */
export function validateCharacterUpdate(characterData) {
  try {
    preventOmnipresence(characterData);
    preventInvalidTravelState(characterData);
    preventUnknownLocation(characterData);
    preventSleepDuringTravelTime(characterData);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Sanitize character data to prevent violations
 * Corrects recoverable issues automatically
 */
export function sanitizeCharacterData(characterData, fallbackLocationId) {
  const sanitized = { ...characterData };

  // Remove invalid travel states
  const invalidStates = ['traveling', 'commuting', 'on_the_way', 'in_transit'];
  if (invalidStates.includes(sanitized.travel_status)) {
    sanitized.travel_status = 'not_traveling';
  }

  // Resolve omnipresence: prefer resolved_current_location_id
  const locations = [];
  if (sanitized.current_home_location_id) locations.push(sanitized.current_home_location_id);
  if (sanitized.resolved_current_location_id) locations.push(sanitized.resolved_current_location_id);

  if (new Set(locations.filter(Boolean)).size > 1) {
    // Keep resolved_current_location_id as primary, clear conflicting home location
    // Only if they're different
    if (sanitized.current_home_location_id !== sanitized.resolved_current_location_id) {
      // This is a conflict — keep resolved as source of truth
      // Don't auto-clear home_location_id; instead log it as a conflict for manual review
    }
  }

  // Ensure at least one valid location
  if (!sanitized.resolved_current_location_id && !sanitized.current_home_location_id) {
    if (fallbackLocationId) {
      sanitized.resolved_current_location_id = fallbackLocationId;
      sanitized.resolved_presence_status = 'home';
    }
  }

  return sanitized;
}