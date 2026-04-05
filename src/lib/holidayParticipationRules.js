/**
 * Holiday Participation Rules
 * Determines if a character should participate in a holiday based on their traits
 */

/**
 * Determine if character should participate in a holiday
 * @param {Object} character
 * @param {Object} holiday
 * @param {Array} relationships - character relationships context
 * @returns {Object} { participate: boolean, reason: string, intensity: number (0-1) }
 */
export function shouldCharacterParticipate(character, holiday, relationships = []) {
  if (!character || !holiday) return { participate: false, reason: 'missing data', intensity: 0 };

  const reasons = [];
  let score = 0.5; // baseline

  // Religion-based participation
  const characterReligion = character.religion?.toLowerCase() || 'none';
  if (holiday.type === 'religious') {
    if (holiday.id === 'christmas' || holiday.id === 'christmas_eve' || holiday.id === 'easter') {
      if (['christian', 'catholic', 'protestant', 'orthodox'].includes(characterReligion)) {
        score += 0.3;
        reasons.push('matches_religion');
      } else if (characterReligion === 'none') {
        score += 0.1; // secular celebration
        reasons.push('secular_celebration');
      } else {
        score -= 0.2;
      }
    } else if (holiday.id.includes('jewish')) {
      if (characterReligion === 'jewish') {
        score += 0.3;
        reasons.push('matches_religion');
      } else {
        score -= 0.1;
      }
    } else if (holiday.id.includes('ramadan') || holiday.id.includes('eid')) {
      if (characterReligion === 'muslim') {
        score += 0.3;
        reasons.push('matches_religion');
      } else {
        score -= 0.1;
      }
    }
  }

  // Cultural participation
  if (holiday.type === 'cultural') {
    if (holiday.id === 'pride_month') {
      const orientation = character.sexual_orientation?.toLowerCase() || '';
      if (['gay', 'lesbian', 'bisexual', 'queer', 'pansexual', 'asexual', 'aromantic', 'genderqueer', 'non-binary', 'transgender'].some(o => orientation.includes(o))) {
        score += 0.3;
        reasons.push('lgbtq_identity');
      } else if (['ally', 'ally (lgbtq)', 'support'].some(o => orientation.includes(o))) {
        score += 0.2;
        reasons.push('ally');
      }
    } else if (holiday.id === 'juneteenth') {
      const ethnicity = (character.ethnicities || []).join(' ').toLowerCase();
      if (ethnicity.includes('black') || ethnicity.includes('african')) {
        score += 0.2;
        reasons.push('cultural_significance');
      }
      score += 0.1; // general cultural celebration
    }
  }

  // Emotional state effects
  const mood = character.emotional_state?.toLowerCase() || 'calm';
  if (['sad', 'grief', 'loneliness', 'despair', 'depression'].includes(mood)) {
    score -= 0.2;
    reasons.push('emotional_sadness');
  }
  if (['joyful', 'excited', 'happy', 'elation'].includes(mood)) {
    score += 0.2;
    reasons.push('positive_mood');
  }
  if (['anxious', 'overwhelmed', 'burnt out', 'stress'].includes(mood)) {
    score -= 0.15;
    reasons.push('emotional_stress');
  }

  // Energy level (if available)
  if (character.current_activity?.includes('tired') || character.current_activity?.includes('exhausted')) {
    score -= 0.15;
    reasons.push('low_energy');
  }

  // Family relationship influence
  const familyScores = [];
  for (const rel of relationships) {
    if (rel.relationship_type === 'family' || rel.relationship_type === 'chosen_family') {
      const friendship = rel.friendship_level || 50;
      const trust = rel.trust_level || 50;
      const avgScore = (friendship + trust) / 100;
      familyScores.push(avgScore);
    }
  }
  
  if (familyScores.length > 0) {
    const avgFamily = familyScores.reduce((a, b) => a + b, 0) / familyScores.length;
    if (avgFamily > 0.7 && ['thanksgiving', 'christmas', 'christmas_eve'].includes(holiday.id)) {
      score += (avgFamily - 0.5) * 0.3;
      reasons.push('strong_family_ties');
    } else if (avgFamily < 0.3) {
      score -= 0.2;
      reasons.push('strained_family');
    }
  }

  // Trauma/avoidance
  if (character.emotional_baggage?.toLowerCase().includes('family')) {
    if (['thanksgiving', 'christmas'].includes(holiday.id)) {
      score -= 0.3;
      reasons.push('family_trauma');
    }
  }

  // Work schedule consideration
  if (character.occupation && character.work_days) {
    // If they work essential services on this holiday, they may be working
    if (['hospital', 'police', 'fire', 'emergency'].some(w => character.occupation.toLowerCase().includes(w))) {
      score = 0.3; // likely working
      reasons.push('essential_worker');
    }
  }

  // Clamp score between 0 and 1
  score = Math.max(0, Math.min(1, score));

  return {
    participate: score > 0.4,
    score,
    reasons,
    intensity: Math.max(0, score),
  };
}

/**
 * Determine activity type for character on holiday
 * @param {Object} character
 * @param {Object} holiday
 * @param {Boolean} willParticipate
 * @returns {String} - activity type: 'celebration', 'work', 'rest', 'isolation', 'volunteer', 'worship', 'gathering'
 */
export function determineHolidayActivity(character, holiday, willParticipate) {
  if (!willParticipate) {
    const mood = character.emotional_state?.toLowerCase() || 'calm';
    if (['sad', 'grief', 'loneliness', 'despair'].includes(mood)) {
      return 'isolation';
    }
    return 'rest';
  }

  // Determine primary activity
  const activities = holiday.eventTypes || [];
  const mood = character.emotional_state?.toLowerCase() || 'calm';
  const religion = character.religion?.toLowerCase() || 'none';

  if (activities.includes('worship') && religion !== 'none') {
    return 'worship';
  }
  if (activities.includes('family_gathering')) {
    return 'gathering';
  }
  if (activities.includes('volunteer')) {
    return 'volunteer';
  }
  if (activities.includes('celebration')) {
    return 'celebration';
  }

  return 'gathering';
}

/**
 * Get location preference for holiday activity
 * @param {String} activityType
 * @param {Object} character
 * @returns {Array} - preferred location categories
 */
export function getHolidayLocationPreference(activityType, character) {
  const prefs = {
    celebration: ['social', 'food_drink', 'park', 'outdoor', 'club'],
    worship: ['religion'],
    gathering: ['home', 'character_specific', 'outdoor', 'food_drink'],
    volunteer: ['government', 'medical', 'education', 'public'],
    isolation: ['home'],
    work: ['workplace'],
    rest: ['home', 'outdoor', 'park'],
  };

  return prefs[activityType] || ['home'];
}