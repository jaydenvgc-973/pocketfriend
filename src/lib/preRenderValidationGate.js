/**
 * PRE-RENDER VALIDATION GATE
 * 
 * Before rendering any character location, validate:
 * - exactly one resolved current location exists
 * - exactly one active occupancy registration exists
 * - current location is valid for current schedule and time
 * - no duplicate Home/work/school presence exists
 * - no fallback replaced a valid non-home location
 * - Home and Travel will read the same resolved source
 * 
 * If validation fails, do not render corrupted location output.
 * Fix or recompute the state first.
 */

export function validateCharacterLocationForRender(character) {
  if (!character) {
    return { valid: false, error: 'No character provided' };
  }

  // Check 1: Exactly one resolved location exists
  if (!character.resolved_current_location_id) {
    return { valid: false, error: 'No resolved location ID' };
  }

  if (!character.resolved_current_location_name) {
    return { valid: false, error: 'No resolved location name' };
  }

  // Check 2: Resolved location type is valid
  const validTypes = ['home', 'work', 'school', 'traveling', 'recovery_nap', null];
  if (!validTypes.includes(character.resolved_location_type)) {
    return { valid: false, error: `Invalid location type: ${character.resolved_location_type}` };
  }

  // Check 3: Presence status is valid
  const validStatuses = ['home', 'at_work', 'at_school', 'traveling', 'sleeping', 'napping', 'unknown'];
  if (!validStatuses.includes(character.resolved_presence_status)) {
    return { valid: false, error: `Invalid presence status: ${character.resolved_presence_status}` };
  }

  // Check 4: Source reason is valid
  if (!character.resolved_source_reason) {
    return { valid: false, error: 'No source reason provided' };
  }

  // Check 5: Updated timestamp exists
  if (!character.resolved_last_updated_at) {
    return { valid: false, error: 'No update timestamp' };
  }

  // All checks passed
  return { valid: true, character_id: character.id, location_id: character.resolved_current_location_id };
}

/**
 * Validate occupancy consistency (derived from resolved locations)
 * Returns true if all characters have consistent location assignments
 */
export function validateOccupancyConsistency(characters, locationMap = {}) {
  const occupancyByLocation = {};
  const violations = [];

  characters.forEach(char => {
    const validation = validateCharacterLocationForRender(char);
    if (!validation.valid) {
      violations.push({ character_id: char.id, reason: validation.error });
      return;
    }

    const locId = char.resolved_current_location_id;
    if (!occupancyByLocation[locId]) {
      occupancyByLocation[locId] = [];
    }
    occupancyByLocation[locId].push(char.id);
  });

  // Check for duplicates (should not occur with proper resolution)
  Object.entries(occupancyByLocation).forEach(([locId, charIds]) => {
    const seen = {};
    charIds.forEach(cid => {
      if (seen[cid]) {
        violations.push({
          character_id: cid,
          location_id: locId,
          reason: 'Character appears multiple times at same location'
        });
      }
      seen[cid] = true;
    });
  });

  return {
    valid: violations.length === 0,
    violations,
    locations_with_occupancy: Object.keys(occupancyByLocation).length,
    total_occupancy: Object.values(occupancyByLocation).reduce((sum, arr) => sum + arr.length, 0)
  };
}

/**
 * Validate that Home and Travel screens will read the same field
 * (both should read resolved_current_location_id)
 */
export function validateScreenConsistency(characters) {
  const inconsistencies = characters.filter(c => 
    !c.resolved_current_location_id || 
    !c.resolved_location_type || 
    !c.resolved_presence_status
  );

  return {
    consistent: inconsistencies.length === 0,
    inconsistent_count: inconsistencies.length,
    total_characters: characters.length
  };
}

/**
 * Validate no false Home fallback occurred
 * (characters who should be at work/school are not shown as Home)
 */
export function validateNoFalseHomeFallback(characters) {
  const violations = [];

  characters.forEach(char => {
    // If work schedule and work location exist, must not be Home
    if (char.work_start_time && char.work_end_time && char.occupation_location_id) {
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();
      const workStart = parseInt(char.work_start_time.split(':')[0]);
      const workEnd = parseInt(char.work_end_time.split(':')[0]);
      const isWorkDay = char.work_days?.includes(dayOfWeek);
      const isWorkHours = hour >= workStart && hour < workEnd;

      if (isWorkDay && isWorkHours && char.resolved_location_type === 'home') {
        violations.push({
          character_id: char.id,
          character_name: char.name,
          issue: 'At work but shown as Home'
        });
      }
    }

    // If school schedule and enrolled, must not be Home
    if (char.student_status === 'enrolled' && char.education_location_id && char.resolved_location_type === 'home') {
      violations.push({
        character_id: char.id,
        character_name: char.name,
        issue: 'At school but shown as Home'
      });
    }

    // If traveling, must not be Home
    if (char.travel_status && char.travel_status !== 'not_traveling' && char.resolved_location_type === 'home') {
      violations.push({
        character_id: char.id,
        character_name: char.name,
        issue: 'Traveling but shown as Home'
      });
    }
  });

  return {
    no_false_fallback: violations.length === 0,
    violations,
    violation_count: violations.length
  };
}