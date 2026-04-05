/**
 * Movement Validation System
 * Enforces strict rule: characters cannot be in two places at once
 * Validates movement sequence and prevents invalid state
 */

/**
 * Validate character presence across all locations
 * @param {Object} character
 * @param {Array} locations - all LocationReference entities
 * @returns {Object} { valid: boolean, issues: Array, currentLocations: Array }
 */
export function validateCharacterPresence(character, locations) {
  const issues = [];
  const currentLocations = [];

  if (!character || !locations) {
    return { valid: false, issues: ['Missing character or locations data'], currentLocations: [] };
  }

  // Check where character appears in location occupancy
  for (const loc of locations) {
    const inResidents = loc.resident_character_ids?.includes(character.id);
    const inNames = loc.resident_character_names?.includes(character.name);

    if (inResidents || inNames) {
      currentLocations.push({
        id: loc.id,
        name: loc.name,
        category: loc.category,
      });
    }
  }

  // Enforce single location rule
  if (currentLocations.length > 1) {
    issues.push(
      `CRITICAL: ${character.name} appears in ${currentLocations.length} locations simultaneously: ${currentLocations.map(l => l.name).join(', ')}`
    );
  }

  return {
    valid: currentLocations.length <= 1,
    issues,
    currentLocations,
  };
}

/**
 * Execute safe character movement
 * Removes from old location, places in new location, updates occupancy
 * @param {Object} character
 * @param {String} destinationLocationId
 * @param {Array} locations - all LocationReference entities (mutable)
 * @returns {Object} { success: boolean, error?: string, movedFrom?: Object, movedTo?: Object }
 */
export async function moveCharacterToLocation(character, destinationLocationId, locations) {
  if (!character || !destinationLocationId || !locations) {
    return { success: false, error: 'Missing required parameters' };
  }

  // Step 1: Find current valid location
  const currentLocations = locations.filter(l =>
    l.resident_character_ids?.includes(character.id) ||
    l.resident_character_names?.includes(character.name)
  );

  if (currentLocations.length > 1) {
    return {
      success: false,
      error: `Character already in multiple locations: ${currentLocations.map(l => l.name).join(', ')}. Cannot move.`,
    };
  }

  // Step 2: Find destination
  const destination = locations.find(l => l.id === destinationLocationId);
  if (!destination) {
    return { success: false, error: 'Destination location not found' };
  }

  // Step 3: Prevent moving to same location
  if (currentLocations.length === 1 && currentLocations[0].id === destinationLocationId) {
    return { success: false, error: 'Character already at destination' };
  }

  const movedFrom = currentLocations[0] || null;

  // Step 4: Remove from current location
  if (movedFrom) {
    movedFrom.resident_character_ids = (movedFrom.resident_character_ids || []).filter(id => id !== character.id);
    movedFrom.resident_character_names = (movedFrom.resident_character_names || []).filter(name => name !== character.name);
  }

  // Step 5: Add to destination
  if (!destination.resident_character_ids) destination.resident_character_ids = [];
  if (!destination.resident_character_names) destination.resident_character_names = [];

  if (!destination.resident_character_ids.includes(character.id)) {
    destination.resident_character_ids.push(character.id);
  }
  if (!destination.resident_character_names.includes(character.name)) {
    destination.resident_character_names.push(character.name);
  }

  return {
    success: true,
    movedFrom,
    movedTo: destination,
  };
}

/**
 * Check if movement would cause schedule conflict
 * @param {Object} character
 * @param {Object} destination
 * @param {Object} holiday - current holiday (if any)
 * @returns {Object} { canMove: boolean, conflict?: string }
 */
export function checkMovementConflict(character, destination, holiday = null) {
  if (!character || !destination) {
    return { canMove: false, conflict: 'Missing character or destination' };
  }

  // Check if destination is closed
  if (holiday && destination.holiday_closures?.includes(holiday.id)) {
    return { canMove: false, conflict: `${destination.name} is closed for ${holiday.name}` };
  }

  // Check work schedule conflict
  if (character.work_start_time && character.work_end_time) {
    const now = new Date();
    const hours = now.getHours();
    const mins = now.getMinutes();
    const currentTime = hours * 60 + mins;

    const [workStart, workStartMin] = character.work_start_time.split(':').map(Number);
    const [workEnd, workEndMin] = character.work_end_time.split(':').map(Number);
    const workStartTime = workStart * 60 + workStartMin;
    const workEndTime = workEnd * 60 + workEndMin;

    if (currentTime >= workStartTime && currentTime < workEndTime) {
      if (destination.category !== 'workplace' && destination.id !== character.occupation_location_id) {
        return { canMove: false, conflict: `${character.name} is currently working` };
      }
    }
  }

  return { canMove: true };
}

/**
 * Record movement event for memory/logging
 * @param {Object} character
 * @param {Object} movedFrom
 * @param {Object} movedTo
 * @returns {Object} event - movement event record
 */
export function createMovementEvent(character, movedFrom, movedTo) {
  return {
    characterId: character.id,
    characterName: character.name,
    timestamp: new Date().toISOString(),
    action: 'movement',
    from: movedFrom ? { id: movedFrom.id, name: movedFrom.name } : null,
    to: movedTo ? { id: movedTo.id, name: movedTo.name } : null,
  };
}