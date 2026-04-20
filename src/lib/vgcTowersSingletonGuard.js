/**
 * VGC Towers Singleton Guard
 * Prevents duplicate VGC Towers creation at the frontend
 * Blocks operations if VGC Towers already exists
 */

export function checkVGCTowersExists(locations) {
  return locations.some(l => l.name && l.name.toLowerCase().includes('vgc towers'));
}

export function getVGCTowersLocation(locations) {
  return locations.find(l => l.name && l.name.toLowerCase().includes('vgc towers'));
}

export function preventVGCTowersDuplication(locationName, existingLocations) {
  // If trying to create something that sounds like VGC Towers
  const isSuspectedVGC = locationName.toLowerCase().includes('vgc') || 
                         locationName.toLowerCase().includes('towers') ||
                         locationName.toLowerCase().includes('vgc towers');
  
  if (!isSuspectedVGC) return { blocked: false };
  
  // Check if VGC Towers already exists
  const vgcExists = checkVGCTowersExists(existingLocations);
  
  if (vgcExists && isSuspectedVGC) {
    return {
      blocked: true,
      reason: 'VGC Towers already exists on this account. Only one instance allowed.',
      existingVGC: getVGCTowersLocation(existingLocations),
    };
  }
  
  return { blocked: false };
}

export function validateCharacterPresence(character, allCharacters, locationMap) {
  const violations = [];

  // Check omnipresence: character can only be in one place
  const locations = [];
  if (character.current_home_location_id) locations.push(character.current_home_location_id);
  if (character.resolved_current_location_id) locations.push(character.resolved_current_location_id);

  const uniqueLocations = new Set(locations.filter(Boolean));
  if (uniqueLocations.size > 1) {
    violations.push({
      type: 'OMNIPRESENT',
      message: 'Character exists in multiple locations',
      locations: Array.from(uniqueLocations),
    });
  }

  // Check invalid travel states
  const invalidStates = ['traveling', 'commuting', 'on_the_way', 'in_transit'];
  if (invalidStates.includes(character.travel_status)) {
    violations.push({
      type: 'INVALID_TRAVEL_STATE',
      message: `Invalid travel state: ${character.travel_status}`,
      state: character.travel_status,
    });
  }

  // Check for unknown location
  if (!character.resolved_current_location_id && !character.current_home_location_id) {
    violations.push({
      type: 'UNKNOWN_LOCATION',
      message: 'Character has no valid location',
    });
  } else {
    // Validate location exists
    const locId = character.resolved_current_location_id || character.current_home_location_id;
    if (!locationMap[locId]) {
      violations.push({
        type: 'INVALID_LOCATION_REFERENCE',
        message: 'Location does not exist',
        locationId: locId,
      });
    }
  }

  return violations;
}

export function validateLocationValidity(location) {
  const violations = [];

  // Check for placeholder-like names
  const placeholderPatterns = ['generic', 'unknown', 'placeholder', 'temp', 'undefined', 'tbd'];
  const name = (location.name || '').toLowerCase();
  
  if (placeholderPatterns.some(p => name.includes(p))) {
    violations.push({
      type: 'PLACEHOLDER_LOCATION',
      message: `Location name suggests placeholder: "${location.name}"`,
    });
  }

  // Check for missing name
  if (!location.name || location.name.trim() === '') {
    violations.push({
      type: 'MISSING_NAME',
      message: 'Location has no name',
    });
  }

  return violations;
}

export function ensureSinglePresence(character) {
  // If character has conflicting location assignments, resolve to canonical
  const homeId = character.current_home_location_id;
  const resolvedId = character.resolved_current_location_id;

  if (homeId && resolvedId && homeId !== resolvedId) {
    // Prefer resolved location as it's more current
    return {
      ...character,
      current_home_location_id: resolvedId === character.current_home_location_id ? homeId : resolvedId,
    };
  }

  return character;
}