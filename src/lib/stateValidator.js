/**
 * State Validator
 * 
 * Prevents contradictions and impossible states before they reach the UI.
 * Rejects combinations like:
 * - critical health at a club
 * - asleep but actively texting from a restaurant
 * - marked at hospital but appearing in a gym scene
 * - broke but repeatedly choosing expensive options
 */

/**
 * Validate character state for contradictions
 * @param {Object} character - full character data
 * @param {Object} context - current context (location, activity, etc)
 * @returns {Object} { isValid: boolean, errors: string[], warnings: string[], fixes: Object }
 */
export function validateCharacterState(character, context = {}) {
  if (!character) return { isValid: false, errors: ['No character data'] };

  const errors = [];
  const warnings = [];
  const fixes = {};

  // Core state
  const health = character.health_value ?? 75;
  const energy = character.energy_value ?? 75;
  const hunger = character.hunger_value ?? 70;
  const currentLocation = character.resolved_current_location_id;
  const money = character.current_balance ?? 6000;
  const emotional_state = character.emotional_state || 'calm';
  const is_asleep = character.sleep_start_time && !character.wake_up_time; // rough check

  // 1. CRITICAL HEALTH CONTRADICTIONS
  if (health < 20) {
    // Must be home, clinic, or hospital
    const validLocations = ['home', 'hospital', 'clinic', 'urgent_care', 'ER'];
    const isValidHealth = !currentLocation || validLocations.some(loc => 
      currentLocation.toLowerCase().includes(loc)
    );
    
    if (!isValidHealth) {
      errors.push(`Critical health (${health}%) cannot be at non-medical location "${currentLocation}"`);
      fixes.currentLocation = 'hospital';
    }
  }

  // 2. ENERGY CONTRADICTIONS
  if (energy < 20) {
    // Should be home or hospital, not at club, gym, or party
    const invalidForVeryLow = ['club', 'bar', 'gym', 'party', 'restaurant', 'event'];
    const isInvalid = invalidForVeryLow.some(loc => 
      currentLocation?.toLowerCase().includes(loc)
    );
    
    if (isInvalid) {
      warnings.push(`Extremely low energy (${energy}%) but at active location. Should be home or resting.`);
      fixes.primaryAction = 'rest_at_home';
    }
  }

  // 3. HUNGER CONTRADICTIONS
  if (hunger < 15) {
    // Must pursue food or rest, not leisure
    if (context.currentActivity === 'entertainment' || context.currentActivity === 'shopping') {
      errors.push(`Starving (${hunger}%) but pursuing leisure activity. Must eat first.`);
      fixes.primaryAction = 'seek_food';
    }
  }

  // 4. LOCATION CONSISTENCY CHECKS
  // Card location must match scene location (context.sceneLocation if provided)
  if (context.sceneLocation && currentLocation !== context.sceneLocation) {
    errors.push(`Location mismatch: character card says "${currentLocation}" but scene shows "${context.sceneLocation}"`);
    fixes.sceneLocation = currentLocation; // prioritize card truth
  }

  // 5. MONEY CONTRADICTIONS
  if (money < 100) {
    // Cannot repeatedly choose expensive activities
    const expensiveActions = ['club', 'fine_dining', 'shopping_spree', 'luxury_activity'];
    if (context.recentActions && context.recentActions.some(a => expensiveActions.includes(a))) {
      warnings.push(`Low money (${money}) but recently chose expensive activities. Behavior inconsistent.`);
      fixes.financialBehavior = 'cost_conscious';
    }
  }

  // 6. EMOTIONAL CONTRADICTIONS
  if (emotional_state === 'grief' || emotional_state === 'despair') {
    // Should not be at party/club casually
    if (currentLocation?.toLowerCase().includes('club') || 
        currentLocation?.toLowerCase().includes('party')) {
      warnings.push(`Severe emotional state (${emotional_state}) but at social venue. Emotional bypass detected.`);
      fixes.location = 'home';
    }
  }

  // 7. HYGIENE CONTRADICTIONS
  const hygiene = character.hygiene_value ?? 75;
  if (hygiene < 20) {
    // Should not be at romantic/intimate setting or visible social venue
    const intimatePlaces = ['date', 'romantic', 'family_event', 'party', 'nightclub'];
    if (context.activityType && intimatePlaces.some(p => context.activityType.includes(p))) {
      warnings.push(`Very low hygiene (${hygiene}%) but in social/intimate setting. Character should clean up first.`);
      fixes.requiredAction = 'clean_up';
    }
  }

  // 8. SCHEDULE VS LOCATION CONTRADICTION
  if (character.current_work_location_id && character.wake_up_time) {
    const hour = new Date().getHours();
    const inWorkHours = hour >= 9 && hour < 17;
    const atWorkLocation = currentLocation === character.current_work_location_id;
    
    if (inWorkHours && !atWorkLocation && !character.schedule_override_active) {
      warnings.push(`During work hours but not at work location. Schedule conflict or override needed.`);
      fixes.scheduleCheck = 'verify_override_or_enforce';
    }
  }

  // 9. CONVERSATION TONE VS STATE CONTRADICTION
  if (context.recentTone && emotional_state !== 'calm') {
    // If tone is super energetic but emotional state is depression, flag it
    if (context.recentTone === 'bubbly' && ['grief', 'despair', 'hopelessness', 'burnt out'].includes(emotional_state)) {
      warnings.push(`Tone (bubbly) contradicts emotional state (${emotional_state}). Masking detected or tone needs update.`);
    }
  }

  // 10. MEMORY CONTRADICTION (if memory exists but dialogue ignores it)
  if (character.fictional_relationships && context.recentDialogue) {
    // Check if character mentions someone they should remember
    const recentConflict = character.fictional_relationships.find(r => 
      r.tension_score > 70 && context.recentDialogue
    );
    if (recentConflict && context.recentDialogue.includes('love you')) {
      warnings.push(`Recent tension with relationship (${recentConflict.person_name}) but dialogue expresses affection. Memory/state mismatch.`);
    }
  }

  // 11. PRESENCE CONTRADICTION (multiple locations at once)
  if (context.otherCharactersAtLocation && context.otherCharactersAtLocation.includes(character.id)) {
    // This character appears in two places simultaneously somehow
    errors.push(`Character appears in multiple locations simultaneously. Data corruption or sync issue.`);
    fixes.syncRequired = true;
  }

  // Determine final validity
  const isValid = errors.length === 0;

  return {
    isValid,
    errors,
    warnings,
    fixes,
    shouldAutoFix: errors.length > 0 && Object.keys(fixes).length > 0
  };
}

/**
 * Auto-apply safe fixes to character data
 */
export function applyStateFixes(character, fixes) {
  if (!character || !fixes) return character;

  const updated = { ...character };

  if (fixes.currentLocation) {
    updated.resolved_current_location_id = fixes.currentLocation;
  }

  if (fixes.primaryAction) {
    updated.current_activity = fixes.primaryAction;
  }

  if (fixes.requiredAction) {
    updated.pending_action = fixes.requiredAction;
  }

  if (fixes.financialBehavior) {
    updated.financial_behavior_override = fixes.financialBehavior;
  }

  if (fixes.scheduleCheck) {
    // Flag for manual review, don't auto-override schedule
    updated.schedule_conflict_flagged = true;
  }

  return updated;
}

/**
 * Check if a character's current state makes a proposed action impossible
 */
export function isActionPossible(character, proposedAction) {
  const health = character.health_value ?? 75;
  const energy = character.energy_value ?? 75;
  const hunger = character.hunger_value ?? 70;
  const money = character.current_balance ?? 6000;
  const emotional_state = character.emotional_state || 'calm';

  const blockers = {
    'go_to_hospital': health < 20 ? false : 'not_critical', // can go but shouldn't unless critical
    'rest_at_home': true, // always possible
    'seek_food': true, // always possible
    'socialize_at_club': health < 20 || energy < 20 || money < 100 ? false : true,
    'go_to_gym': health < 20 || energy < 25 ? false : true,
    'attend_schedule': energy >= 30 ? true : false, // can attend unless exhausted
    'romance_activity': character.hygiene_value < 20 ? false : true,
    'solo_activity': true // nearly always possible
  };

  return blockers[proposedAction] !== false;
}

/**
 * Get recommended correction for a contradiction
 */
export function getStateFix(character, contradiction) {
  if (contradiction === 'critical_health_at_social_venue') {
    return {
      action: 'move_to_hospital',
      reason: 'Critical health incompatible with social location',
      priority: 'high'
    };
  }

  if (contradiction === 'asleep_but_texting') {
    return {
      action: 'wake_up_or_silence_messages',
      reason: 'Cannot be asleep and actively messaging',
      priority: 'high'
    };
  }

  if (contradiction === 'location_mismatch') {
    return {
      action: 'sync_to_character_location',
      reason: 'Scene must match character location',
      priority: 'high'
    };
  }

  if (contradiction === 'broke_expensive_behavior') {
    return {
      action: 'adjust_spending_choice',
      reason: 'Cannot afford expensive activity',
      priority: 'medium'
    };
  }

  return {
    action: 'manual_review',
    reason: 'Contradiction detected, manual review required',
    priority: 'low'
  };
}

export default validateCharacterState;