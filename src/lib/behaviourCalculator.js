/**
 * Unified Behaviour Calculator
 * 
 * Single decision engine that evaluates all character state and outputs
 * the most believable current action based on combined needs, personality,
 * schedule, money, time, relationships, and location.
 * 
 * Every system (Chat, Scene, Travel, Home, Card) references this to ensure
 * one shared reality.
 */

const HOUR = new Date().getHours();
const DAY_OF_WEEK = new Date().getDay();
const IS_WEEKEND = DAY_OF_WEEK === 0 || DAY_OF_WEEK === 6;

/**
 * Priority stack: which need overrides which when multiple are urgent
 */
const PRIORITY_ORDER = [
  'critical_health',
  'extreme_energy',
  'extreme_hunger',
  'schedule_obligation',
  'emotional_overload',
  'social_need',
  'fun_need',
  'hygiene_concern'
];

/**
 * Main calculator: given a character's full state, output weighted actions
 * @param {Object} character - full character data with needs, location, schedule, etc
 * @param {Object} context - additional context (currentTime, locationId, etc)
 * @returns {Object} decision object with primary action, fallbacks, tone, delays, etc
 */
export function calculateCharacterBehaviour(character, context = {}) {
  if (!character) return null;

  // Extract all state
  const health = character.health_value ?? 75;
  const energy = character.energy_value ?? 75;
  const hunger = character.hunger_value ?? 70;
  const hygiene = character.hygiene_value ?? 75;
  const social = character.social_value ?? 65;
  const fun = character.fun_value ?? 70;
  const mental = character.mental_value ?? 70;
  const comfort = character.comfort_value ?? 70;

  const money = character.current_balance ?? 6000;
  const currentLocation = character.resolved_current_location_id;
  const personality = character.personality_summary || '';
  const archetype = character.archetype || '';
  const emotional_state = character.emotional_state || 'calm';
  const is_health_conscious = personality.toLowerCase().includes('health') || archetype.toLowerCase().includes('health');
  const is_extrovert = character.social_energy === 'extrovert' || character.social_energy === 'mostly_extrovert';
  const is_introvert = character.social_energy === 'introvert' || character.social_energy === 'mostly_introvert';

  // Evaluate each tier
  const criticalIssues = evaluateCritical(health, energy, hunger);
  const stateModifiers = evaluateModifiers(emotional_state, social, mental);
  const constraints = evaluateConstraints(character.current_school_location_id, character.current_work_location_id, character.wake_up_time, character.sleep_start_time);
  
  // Personality filters
  const personalityFilters = {
    is_health_conscious,
    is_extrovert,
    is_introvert,
    is_hospital_avoidant: personality.toLowerCase().includes('avoid') || personality.toLowerCase().includes('fear'),
    is_self_neglectful: personality.toLowerCase().includes('neglect') || emotional_state === 'burnt out'
  };

  // ── UNIFIED NEEDS ENFORCEMENT ENGINE ────────────────────────────────────────
  // This gate runs BEFORE schedule, personality, or any preference logic.
  // Critical needs are non-optional. Personality can shape HOW, never WHETHER.
  // Priority: health → hunger → energy → mental → schedule → everything else

  let primaryAction = null;
  let blockedReason = null;
  let actionWeight = {};
  let forcedByNeed = false;

  // 1. Critical health — overrides absolutely everything
  if (health < 20) {
    primaryAction = 'go_to_hospital';
    blockedReason = 'critical_health_emergency';
    forcedByNeed = true;
  }
  // 2. Critical hunger — survival stat, cannot be ignored, overrides schedule
  else if (hunger < 15) {
    primaryAction = 'seek_food';
    blockedReason = 'critical_hunger';
    forcedByNeed = true;
  }
  // 3. Critical energy — forced rest, overrides schedule
  else if (energy < 15) {
    primaryAction = 'rest_at_home';
    blockedReason = 'extreme_energy_depletion';
    forcedByNeed = true;
  }
  // 4. Critical mental — forced regulation before any normal activity
  else if (mental < 15) {
    primaryAction = personalityFilters.is_introvert ? 'isolate_safely' : 'seek_trusted_support';
    blockedReason = 'critical_mental_state';
    forcedByNeed = true;
  }
  // 5. Urgent hunger (not yet critical but strong bias — still overrides schedule)
  else if (hunger < 25) {
    primaryAction = 'seek_food';
    blockedReason = 'urgent_hunger';
    forcedByNeed = true;
  }
  // 6. Schedule obligation — only runs if no critical need is forcing action
  else if (isCurrentlyScheduled(character, context)) {
    primaryAction = 'attend_schedule';
    blockedReason = null;
  }
  // 7. Emotional overload
  else if (stateModifiers.emotional_overload) {
    primaryAction = personalityFilters.is_introvert ? 'isolate_safely' : 'seek_trusted_support';
    blockedReason = 'high_emotional_strain';
  }
  // 8. Social critical — slow-burn, but enforced once truly low
  else if (social < 15) {
    primaryAction = personalityFilters.is_introvert ? 'seek_trusted_support' : 'socialize';
    blockedReason = 'critical_social_isolation';
  }
  // 9. Lower priorities
  else {
    // Combine all lower needs into weighted pool
    actionWeight = calculateActionWeights({
      health,
      energy,
      hunger,
      hygiene,
      social,
      fun,
      money,
      emotional_state,
      is_weekend: IS_WEEKEND,
      is_extrovert,
      is_introvert,
      is_health_conscious,
      time_of_day: HOUR
    });

    primaryAction = Object.keys(actionWeight).reduce((a, b) => actionWeight[a] > actionWeight[b] ? a : b);
  }

  // Apply constraints and blocks
  const isValid = !checkActionBlockers(primaryAction, { health, energy, hunger, money, emotional_state, personalityFilters });

  // Build fallback actions
  const fallbackActions = generateFallbacks(primaryAction, {
    health,
    energy,
    hunger,
    social,
    fun,
    is_introvert,
    is_extrovert,
    money,
    is_health_conscious
  });

  // Infer tone from state
  const tone = inferTone(emotional_state, energy, hunger, health, social, mental);

  // Response delay (how long before they reply)
  const responseDelay = inferResponseDelay(primaryAction, energy, emotional_state, HOUR);

  // Location pool (where they're likely to be/go)
  const likelyLocations = inferLocations(primaryAction, {
    health,
    energy,
    hunger,
    money,
    is_introvert,
    is_extrovert,
    is_health_conscious,
    is_weekend: IS_WEEKEND
  });

  // ── FAILSAFE: if critical need detected but primary action is not resolving it ──
  if (hunger < 15 && primaryAction !== 'seek_food') {
    console.warn('[BEHAVIOUR_FAILSAFE] HUNGER_NOT_ENFORCED — overriding to seek_food');
    primaryAction = 'seek_food';
    blockedReason = 'critical_hunger';
    forcedByNeed = true;
  }
  if (health < 20 && primaryAction !== 'go_to_hospital') {
    console.warn('[BEHAVIOUR_FAILSAFE] HEALTH_NOT_ENFORCED — overriding to go_to_hospital');
    primaryAction = 'go_to_hospital';
    blockedReason = 'critical_health_emergency';
    forcedByNeed = true;
  }
  if (energy < 15 && primaryAction !== 'rest_at_home' && primaryAction !== 'go_to_hospital') {
    console.warn('[BEHAVIOUR_FAILSAFE] ENERGY_NOT_ENFORCED — overriding to rest_at_home');
    primaryAction = 'rest_at_home';
    blockedReason = 'extreme_energy_depletion';
    forcedByNeed = true;
  }

  return {
    primaryAction,
    fallbackActions,
    tone,
    responseDelay,
    likelyLocations,
    actionWeight,
    blockedReason,
    forcedByNeed,
    isValid,
    stateSnap: {
      health,
      energy,
      hunger,
      hygiene,
      social,
      fun,
      mental,
      money,
      emotional_state,
      hour: HOUR,
      is_weekend: IS_WEEKEND
    }
  };
}

/**
 * Identify critical emergencies
 */
function evaluateCritical(health, energy, hunger) {
  return {
    critical_health: health < 20,
    extreme_energy: energy < 15,
    extreme_hunger: hunger < 15
  };
}

/**
 * Evaluate emotional and relational modifiers
 */
function evaluateModifiers(emotional_state, social, mental) {
  const highStress = ['irritated', 'defensive', 'overwhelmed', 'anxious', 'angry', 'panic'].includes(emotional_state);
  const emotionalShutdown = ['burnt out', 'grief', 'loneliness', 'hopelessness', 'despair', 'detachment', 'numbness'].includes(emotional_state);

  return {
    emotional_overload: highStress || emotionalShutdown || mental < 20,
    is_withdrawn: emotionalShutdown || mental < 30,
    is_reactive: highStress || mental < 40,
    social_deficit: social < 25
  };
}

/**
 * Check current schedule obligations
 */
function evaluateConstraints(schoolId, workId, wakeTime, sleepTime) {
  const hour = HOUR;
  
  // Simple check: if there's a scheduled location and we're in a reasonable active hour, they may be obligated
  const hasSchedule = !!schoolId || !!workId;
  
  return { hasSchedule, hour };
}

/**
 * Is character currently on a schedule obligation?
 */
function isCurrentlyScheduled(character, context) {
  const workLocId = character.current_work_location_id;
  const schoolLocId = character.current_school_location_id;
  const hour = HOUR;

  // Rough check: during typical work/school hours and they have a location assigned
  const inWorkHours = hour >= 9 && hour < 17;
  const inSchoolHours = hour >= 8 && hour < 15;

  if (inWorkHours && workLocId) return true;
  if (inSchoolHours && schoolLocId) return true;

  return false;
}

/**
 * Weighted action pool for non-emergency states
 */
function calculateActionWeights(state) {
  const weights = {
    rest_at_home: 0,
    seek_food: 0,
    clean_up: 0,
    go_to_gym: 0,
    go_to_park: 0,
    go_to_church: 0,
    socialize: 0,
    entertainment: 0,
    work_or_school: 0,
    doctor_visit: 0
  };

  // Hygiene first (if very low, blocks other things)
  if (state.hygiene < 25) {
    weights.clean_up += 100;
  }

  // Health-driven
  if (state.health < 40 && state.health > 19) {
    weights.doctor_visit += 50;
  }
  if (state.health >= 40) {
    weights.go_to_gym += state.is_health_conscious ? 40 : 10;
  }

  // Energy-driven
  if (state.energy < 40) {
    weights.rest_at_home += 80;
  } else if (state.energy >= 60) {
    weights.work_or_school += 30;
    weights.socialize += state.is_extrovert ? 50 : 20;
    weights.entertainment += state.fun < 40 ? 60 : 20;
  }

  // Hunger-driven
  if (state.hunger < 35) {
    weights.seek_food += 100;
  }

  // Social-driven
  if (state.social < 30 && state.energy >= 40) {
    weights.socialize += state.is_introvert ? 40 : 80;
  }

  // Fun-driven
  if (state.fun < 30 && state.energy >= 40 && !state.is_introvert) {
    weights.entertainment += 70;
    weights.socialize += 50;
  }

  // Weekend shift
  if (state.is_weekend && state.energy >= 40) {
    weights.go_to_park += 40;
    weights.go_to_church += state.is_health_conscious ? 30 : 10;
    weights.go_to_gym += 20;
    weights.socialize += 40;
  }

  // Money constraint (avoid expensive unless money is high)
  if (state.money < 500) {
    weights.go_to_gym -= 10;
    weights.entertainment -= 30;
  }

  // Time of day
  if (state.time_of_day < 6 || state.time_of_day > 21) {
    weights.rest_at_home += 100;
    weights.socialize -= 50;
  } else if (state.time_of_day >= 6 && state.time_of_day < 12) {
    weights.go_to_gym += 20;
    weights.go_to_church += 30;
  }

  // Emotional state filters
  if (state.emotional_state === 'anxious' || state.emotional_state === 'sad') {
    weights.rest_at_home += 30;
    weights.socialize -= 20;
  }
  if (state.emotional_state === 'joyful' || state.emotional_state === 'excited') {
    weights.socialize += 50;
    weights.entertainment += 30;
  }

  return weights;
}

/**
 * Check if an action is blocked by current state
 */
function checkActionBlockers(action, state) {
  const { health, energy, hunger, money, emotional_state, personalityFilters } = state;

  // Club/bar/party blocked if
  if (['socialize', 'entertainment'].includes(action)) {
    if (health < 20) return true; // critical health
    if (energy < 20) return true; // extremely tired
    if (hunger < 15) return true; // starving
    if (emotional_state === 'overwhelmed' && !personalityFilters.is_extrovert) return true; // stressed introvert
  }

  // Gym blocked if
  if (action === 'go_to_gym') {
    if (health < 20) return true;
    if (energy < 25) return true;
    if (hunger < 20) return true;
  }

  // Expensive outing blocked if
  if (['socialize', 'entertainment'].includes(action)) {
    if (money < 100) return true;
  }

  // Romance/intimacy blocked if
  if (action === 'socialize' && state.personalityFilters) {
    if (state.hygiene < 20 && !personalityFilters.is_self_neglectful) return true;
  }

  return false;
}

/**
 * Generate fallback actions if primary is blocked
 */
function generateFallbacks(primaryAction, state) {
  const fallbacks = [];

  // Always have rest as fallback
  if (primaryAction !== 'rest_at_home') {
    fallbacks.push('rest_at_home');
  }

  // Add personality-appropriate fallbacks
  if (state.is_introvert) {
    fallbacks.push('home_entertainment', 'read_or_music', 'creative_hobby');
  } else {
    fallbacks.push('text_someone', 'go_to_park', 'social_video_call');
  }

  // Add need-based fallbacks
  if (state.hunger < 40) {
    fallbacks.push('seek_food');
  }
  if (state.social < 35) {
    fallbacks.push('text_close_person');
  }

  return fallbacks.slice(0, 3);
}

/**
 * Infer conversational tone from state
 */
function inferTone(emotional_state, energy, hunger, health, social, mental) {
  if (energy < 30) return 'tired';
  if (hunger < 30) return 'irritable';
  if (health < 40) return 'uncomfortable';
  if (mental < 30) return 'withdrawn';
  if (social < 25) return 'lonely';
  if (emotional_state === 'joyful' || emotional_state === 'excited') return 'warm';
  if (emotional_state === 'anxious' || emotional_state === 'overwhelmed') return 'stressed';
  if (emotional_state === 'calm') return 'neutral';
  return 'default';
}

/**
 * Infer response timing delay
 */
function inferResponseDelay(action, energy, emotional_state, hour) {
  // Late night always slow
  if (hour < 6 || hour > 22) return 'very_slow';
  
  // Working/scheduled = distracted
  if (action === 'attend_schedule') return 'slow';
  
  // Resting/sick = slow
  if (action === 'rest_at_home' && energy < 40) return 'slow';
  
  // Socially engaged = very fast
  if (action === 'socialize' && energy >= 60) return 'fast';
  
  // Withdrawn = slow
  if (['isolate_safely', 'go_to_hospital'].includes(action)) return 'very_slow';
  
  return 'normal';
}

/**
 * Infer most likely current locations
 */
function inferLocations(action, state) {
  const locations = [];

  switch (action) {
    case 'rest_at_home':
      locations.push('home');
      break;
    case 'seek_food':
      if (state.money > 500) {
        locations.push('restaurant', 'café', 'brunch');
      } else {
        locations.push('grocery', 'home', 'cheap_diner');
      }
      break;
    case 'go_to_gym':
      locations.push('gym', 'park');
      break;
    case 'socialize':
      if (state.is_introvert) {
        locations.push('friend_home', 'quiet_café', 'park');
      } else {
        locations.push('restaurant', 'bar', 'club', 'group_hangout');
      }
      break;
    case 'go_to_park':
      locations.push('park', 'outdoor');
      break;
    case 'go_to_church':
      locations.push('church', 'place_of_worship');
      break;
    case 'doctor_visit':
      locations.push('clinic', 'hospital', 'urgent_care');
      break;
    case 'go_to_hospital':
      locations.push('hospital', 'ER');
      break;
    case 'attend_schedule':
      locations.push('work', 'school');
      break;
    case 'clean_up':
      locations.push('home', 'gym_shower', 'bathroom');
      break;
    default:
      locations.push('home', 'park', 'café');
  }

  return locations;
}

export default calculateCharacterBehaviour;