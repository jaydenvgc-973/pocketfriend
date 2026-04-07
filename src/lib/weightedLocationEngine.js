/**
 * WEIGHTED LOCATION DECISION ENGINE
 *
 * Calculates the best destination for a character based on:
 * 1. Needs (highest weight)
 * 2. Emotional state
 * 3. Personality/archetype
 * 4. Wants/desires
 * 5. Quirks/restrictions
 * 6. Schedule
 * 7. Location availability
 * 8. Recent visit frequency
 */

const LOCATION_CATEGORY_TO_ARCHETYPE = {
  'introvert': ['home', 'park', 'food_drink'],
  'mostly_introvert': ['home', 'park', 'food_drink', 'gym'],
  'ambivert': ['home', 'social', 'gym', 'workplace', 'outdoor'],
  'mostly_extrovert': ['social', 'gym', 'food_drink', 'workplace', 'education'],
  'extrovert': ['social', 'gym', 'food_drink', 'workplace', 'public']
};

const EMOTIONAL_STATE_TO_LOCATION = {
  'stressed': ['park', 'gym', 'home'],
  'lonely': ['social', 'food_drink', 'gym'],
  'happy': ['social', 'outdoor', 'food_drink'],
  'angry': ['gym', 'outdoor', 'home'],
  'bored': ['social', 'gym', 'food_drink', 'outdoor'],
  'overwhelmed': ['home', 'park', 'quiet cafe'],
  'anxious': ['home', 'park'],
  'sad': ['home', 'park', 'trusted_place'],
  'excited': ['social', 'food_drink', 'event_venue'],
  'calm': ['anywhere'] // no strong preference
};

const NEED_TO_LOCATION = {
  'hunger': ['food_drink', 'grocery', 'restaurant'],
  'health': ['medical', 'pharmacy', 'gym'],
  'financial': ['workplace'],
  'housing': ['home', 'shelter'],
  'social': ['social', 'gym', 'food_drink', 'public'],
  'relief': ['park', 'gym', 'quiet_place']
};

/**
 * Score locations based on character needs, emotion, personality, etc.
 */
export function scoreLocations(character, locationMap, currentTime = new Date()) {
  const scores = {};

  // Get list of available locations
  const availableLocations = Object.values(locationMap).filter(
    loc => loc.location_type === 'global' || loc.character_id === character.id
  );

  availableLocations.forEach(location => {
    let score = 0;

    // 1. NEEDS (Weight: 40)
    const needs = identifyCharacterNeeds(character);
    const needScore = calculateNeedScore(location, needs);
    score += needScore * 0.4;

    // 2. EMOTIONAL STATE (Weight: 25)
    const emotionalScore = calculateEmotionalScore(location, character.emotional_state);
    score += emotionalScore * 0.25;

    // 3. PERSONALITY/ARCHETYPE (Weight: 15)
    const personalityScore = calculatePersonalityScore(location, character.social_energy, character.personality_traits);
    score += personalityScore * 0.15;

    // 4. WANTS/DESIRES (Weight: 10)
    const wantScore = calculateWantScore(location, character);
    score += wantScore * 0.1;

    // 5. QUIRKS/RESTRICTIONS (Weight: 5)
    const quirkScore = calculateQuirkScore(location, character);
    score += quirkScore * 0.05;

    // 6. SCHEDULE IMPACT (Weight: 3)
    const scheduleScore = calculateScheduleScore(location, character, currentTime);
    score += scheduleScore * 0.03;

    // 7. LOCATION AVAILABILITY (Weight: 2)
    const availabilityScore = calculateAvailabilityScore(location, currentTime);
    score += availabilityScore * 0.02;

    // 8. RECENT VISIT FREQUENCY (Weight: -negative if too recent)
    const frequencyScore = calculateFrequencyScore(location, character.recent_location_history);
    score += frequencyScore;

    scores[location.id] = {
      location,
      totalScore: score,
      breakdown: {
        needs: needScore * 0.4,
        emotion: emotionalScore * 0.25,
        personality: personalityScore * 0.15,
        wants: wantScore * 0.1,
        quirks: quirkScore * 0.05,
        schedule: scheduleScore * 0.03,
        availability: availabilityScore * 0.02,
        frequency: frequencyScore
      }
    };
  });

  // Sort by total score descending
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b.totalScore - a.totalScore)
    .map(([id, data]) => ({ id, ...data }));

  return sorted;
}

/**
 * Identify current character needs
 */
function identifyCharacterNeeds(character) {
  const needs = [];

  // Check for hunger (rough heuristic: random or based on last_activity)
  if (Math.random() > 0.7) needs.push('hunger');

  // Check for health needs
  if (character.health_status && character.health_status.toLowerCase().includes('sick')) {
    needs.push('health');
  }

  // Check for financial pressure
  // (would integrate with CharacterFinancial entity in real implementation)
  
  // Social need based on recent interactions
  if (character.emotional_state === 'lonely') {
    needs.push('social');
  }

  // Relief need if stressed/overwhelmed
  if (['stressed', 'overwhelmed', 'angry'].includes(character.emotional_state)) {
    needs.push('relief');
  }

  return needs;
}

/**
 * Score location based on how well it satisfies needs
 */
function calculateNeedScore(location, needs) {
  if (needs.length === 0) return 5; // Neutral if no strong needs

  let score = 0;
  needs.forEach(need => {
    const preferedCategories = NEED_TO_LOCATION[need] || [];
    if (preferedCategories.includes(location.category)) {
      score += 10;
    }
  });

  return Math.min(score, 10); // Cap at 10
}

/**
 * Score location based on emotional state compatibility
 */
function calculateEmotionalScore(location, emotionalState) {
  const preferedCategories = EMOTIONAL_STATE_TO_LOCATION[emotionalState] || ['anywhere'];

  if (preferedCategories.includes('anywhere')) return 5; // Neutral

  return preferedCategories.includes(location.category) ? 10 : 2;
}

/**
 * Score location based on personality/archetype fit
 */
function calculatePersonalityScore(location, socialEnergy, personalityTraits = []) {
  let score = 5; // Baseline

  // Social energy match
  const preferedForEnergy = LOCATION_CATEGORY_TO_ARCHETYPE[socialEnergy] || [];
  if (preferedForEnergy.includes(location.category)) {
    score += 4;
  }

  // Personality trait matches
  if (personalityTraits.includes('health-conscious') && location.category === 'gym') {
    score += 2;
  }
  if (personalityTraits.includes('spiritual') && location.category === 'religion') {
    score += 2;
  }
  if (personalityTraits.includes('social-butterfly') && location.category === 'social') {
    score += 2;
  }

  return Math.min(score, 10);
}

/**
 * Score location based on character wants/desires
 */
function calculateWantScore(location, character) {
  let score = 3; // Baseline

  // If character likes restaurants/food
  if (location.category === 'food_drink') score += 2;

  // If character is outdoorsy
  if (location.category === 'outdoor' && character.personality_traits?.includes('nature-lover')) {
    score += 3;
  }

  return Math.min(score, 10);
}

/**
 * Score location based on quirks/restrictions
 */
function calculateQuirkScore(location, character) {
  let score = 5; // Neutral baseline

  // Religion-based restrictions
  if (character.religion && character.religion !== 'None') {
    // Boost religious locations if character is devout
    if (character.belief_level === 'devout' && location.category === 'religion') {
      score += 3;
    }
    // Might restrict certain venues based on belief
    if (location.category === 'social' && location.subtype?.includes('bar')) {
      if (character.belief_level === 'devout') score -= 2;
    }
  }

  return Math.max(1, Math.min(score, 10));
}

/**
 * Score location based on schedule compliance
 */
function calculateScheduleScore(location, character, currentTime) {
  let score = 5; // Neutral

  // If this is a work/school location and they're scheduled to be there, boost
  if (location.id === character.occupation_location_id && character.work_start_time) {
    const hour = currentTime.getHours();
    const [workStartH] = character.work_start_time.split(':').map(Number);
    const [workEndH] = character.work_end_time.split(':').map(Number);
    if (hour >= workStartH && hour < workEndH) {
      score += 3; // Already scheduled, natural location
    }
  }

  return Math.min(score, 10);
}

/**
 * Score location availability (open/closed)
 */
function calculateAvailabilityScore(location, currentTime) {
  // Ideally would use isLocationOpen() here
  // For now, assume all are open (would integrate real logic)
  return 5; // Neutral
}

/**
 * Score location based on recent visit frequency
 * Discourage repeating the same location too often
 */
function calculateFrequencyScore(location, recentHistory = []) {
  if (!recentHistory || recentHistory.length === 0) {
    return 0; // First location, no penalty
  }

  const visitCount = recentHistory.filter(h => h.location_id === location.id).length;
  const totalVisits = recentHistory.length;

  // If visited >30% of the time, penalize
  if (visitCount / totalVisits > 0.3) {
    return -3; // Discourage overuse
  }

  return 0;
}

/**
 * Get best destination from scored locations
 */
export function getBestDestination(scoredLocations, minScore = 0) {
  if (!scoredLocations || scoredLocations.length === 0) {
    return null;
  }

  // Return highest-scored location that meets minimum threshold
  const best = scoredLocations.find(item => item.totalScore >= minScore);
  return best ? best.location : null;
}

/**
 * Get top N destination options (for UI or future expansion)
 */
export function getTopDestinations(scoredLocations, count = 3) {
  return scoredLocations.slice(0, count).map(item => item.location);
}