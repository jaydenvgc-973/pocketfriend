/**
 * LOCATION VALIDATION ENGINE
 *
 * Runs strict validation checks on character location state.
 * Ensures all UI systems are synchronized with the backend source of truth.
 */

/**
 * Comprehensive sync check
 * Validates that all location-related systems show the same location
 */
export function validateLocationSync(character, dialogueLocationContext = null) {
  const failures = [];

  // Check 1: Character must have resolved location
  if (!character.resolved_current_location_id) {
    failures.push({
      code: 'NO_RESOLVED_LOCATION',
      severity: 'critical',
      message: 'Character has no resolved location'
    });
  }

  // Check 2: Recent location history should not be empty (unless brand new)
  if (!character.recent_location_history || character.recent_location_history.length === 0) {
    if (character.created_date && new Date() - new Date(character.created_date) > 3600000) { // 1 hour old
      failures.push({
        code: 'EMPTY_LOCATION_HISTORY',
        severity: 'warning',
        message: 'Character has no location history despite being created >1 hour ago'
      });
    }
  }

  // Check 3: If traveling, must have valid destination
  if (character.location_status === 'traveling' && !character.traveling_to_location_id) {
    failures.push({
      code: 'TRAVELING_NO_DESTINATION',
      severity: 'critical',
      message: 'Character marked as traveling but has no destination'
    });
  }

  // Check 4: Dialogue location should match resolved location (if provided)
  if (dialogueLocationContext && dialogueLocationContext.mentioned_location_id) {
    if (dialogueLocationContext.mentioned_location_id !== character.resolved_current_location_id) {
      failures.push({
        code: 'DIALOGUE_LOCATION_MISMATCH',
        severity: 'warning',
        message: `Dialogue references ${dialogueLocationContext.mentioned_location_name} but character is at ${character.resolved_current_location_name}`
      });
    }
  }

  // Check 5: Last update time should be recent
  if (character.last_location_update_time) {
    const lastUpdate = new Date(character.last_location_update_time);
    const hoursSinceUpdate = (new Date() - lastUpdate) / 3600000;
    if (hoursSinceUpdate > 24) {
      failures.push({
        code: 'STALE_LOCATION_UPDATE',
        severity: 'warning',
        message: `Location not updated in ${Math.floor(hoursSinceUpdate)} hours`
      });
    }
  }

  // Check 6: Home should not be override when stronger logic exists
  if (character.resolved_location_type === 'home' && character.resolved_source_reason === 'home_resting') {
    // Verify this is actually appropriate
    if (character.emotional_state === 'bored' || character.emotional_state === 'lonely') {
      failures.push({
        code: 'HOME_INCORRECT_FOR_EMOTION',
        severity: 'warning',
        message: `Character at home due to resting, but emotional state is ${character.emotional_state} (should consider other locations)`
      });
    }
  }

  return {
    isValid: failures.length === 0,
    failures
  };
}

/**
 * Check if character location matches actual movement logic
 */
export function validateLocationAgainstSchedule(character) {
  const failures = [];

  // If character is on work schedule, should be at work (not home)
  if (character.work_start_time && character.work_end_time && character.work_days) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const isWorkDay = character.work_days.includes(dayOfWeek);
    const hour = now.getHours();
    const [workStartH] = character.work_start_time.split(':').map(Number);
    const [workEndH] = character.work_end_time.split(':').map(Number);

    if (isWorkDay && hour >= workStartH && hour < workEndH) {
      if (character.resolved_location_type !== 'work' && character.resolved_source_reason !== 'work_schedule') {
        failures.push({
          code: 'SCHEDULE_LOCATION_MISMATCH',
          severity: 'critical',
          message: `Character should be at work now (${workStartH}:00-${workEndH}:00) but is at ${character.resolved_current_location_name}`
        });
      }
    }
  }

  // If character is enrolled in school, verify school location during school hours
  if (character.student_status === 'enrolled' && character.education_location_id) {
    // School hours roughly 8am-3pm
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 8 && hour < 15) {
      if (character.resolved_location_type !== 'school' && character.resolved_source_reason !== 'school_schedule') {
        failures.push({
          code: 'SCHOOL_LOCATION_MISMATCH',
          severity: 'warning',
          message: `Character enrolled in school but not at school during school hours (${character.resolved_current_location_name})`
        });
      }
    }
  }

  return {
    isValid: failures.length === 0,
    failures
  };
}

/**
 * Validate that character location is reflected in who's-here presence
 */
export function validateLocationPresence(character, presenceList = []) {
  const failures = [];

  if (!character.resolved_current_location_id) {
    return { isValid: true, failures };
  }

  // Check if character appears in presence list for their location
  const appearingAtLocation = presenceList.find(
    p => p.location_id === character.resolved_current_location_id && p.character_id === character.id
  );

  if (!appearingAtLocation && character.location_visibility_state === 'visible') {
    failures.push({
      code: 'CHARACTER_NOT_IN_PRESENCE_LIST',
      severity: 'warning',
      message: `Character is at ${character.resolved_current_location_name} but not appearing in presence list`
    });
  }

  return {
    isValid: failures.length === 0,
    failures
  };
}

/**
 * Run full validation suite
 */
export function runFullLocationValidation(character, dialogueLocationContext = null, presenceList = []) {
  const syncCheck = validateLocationSync(character, dialogueLocationContext);
  const scheduleCheck = validateLocationAgainstSchedule(character);
  const presenceCheck = validateLocationPresence(character, presenceList);

  const allFailures = [
    ...syncCheck.failures,
    ...scheduleCheck.failures,
    ...presenceCheck.failures
  ];

  return {
    isFullyValid: allFailures.length === 0,
    allFailures,
    criticalFailures: allFailures.filter(f => f.severity === 'critical'),
    warnings: allFailures.filter(f => f.severity === 'warning')
  };
}

/**
 * Auto-correct common location sync failures
 */
export function autoCorrectLocationSync(character) {
  const corrections = {};

  // If traveling but no last_location_update_time, set it
  if (character.location_status === 'traveling' && !character.last_location_update_time) {
    corrections.last_location_update_time = new Date().toISOString();
  }

  // If location_status is null/undefined, set based on resolved_location_type
  if (!character.location_status) {
    corrections.location_status = character.resolved_location_type === 'home' ? 'home' : 'at_location';
  }

  // If location_visibility_state is not set, default to visible
  if (!character.location_visibility_state) {
    corrections.location_visibility_state = 'visible';
  }

  // Ensure recent_location_history exists
  if (!character.recent_location_history) {
    corrections.recent_location_history = [];
  }

  return corrections.length === 0 ? null : corrections;
}