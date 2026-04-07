/**
 * CHARACTER LOCATION AFFINITY ENGINE
 *
 * Scores available locations for a character based on:
 * - Personality & social energy
 * - Religious beliefs & moral values
 * - Health habits & lifestyle
 * - Emotional state
 * - Relationship context
 *
 * Returns locations sorted by affinity score (highest = best fit).
 * Does NOT override schedule obligations — call this only during free time.
 */

// Category affinity profiles per personality/social archetype
const SOCIAL_ENERGY_AFFINITIES = {
  introvert: {
    preferred: ['home', 'outdoor', 'public'],
    acceptable: ['food_drink', 'education', 'medical', 'grocery', 'religion'],
    conditional: ['social', 'gym'],
    avoided: [],  // bars/clubs fall under 'social' — marked conditional not avoided, but scored low
  },
  mostly_introvert: {
    preferred: ['home', 'outdoor', 'public'],
    acceptable: ['food_drink', 'education', 'medical', 'grocery', 'religion', 'gym'],
    conditional: ['social'],
    avoided: [],
  },
  ambivert: {
    preferred: ['food_drink', 'outdoor', 'home', 'social'],
    acceptable: ['gym', 'public', 'education', 'religion', 'grocery', 'medical'],
    conditional: [],
    avoided: [],
  },
  mostly_extrovert: {
    preferred: ['social', 'food_drink', 'gym'],
    acceptable: ['outdoor', 'public', 'home', 'education', 'religion', 'grocery', 'medical'],
    conditional: [],
    avoided: [],
  },
  extrovert: {
    preferred: ['social', 'food_drink'],
    acceptable: ['gym', 'outdoor', 'public', 'education', 'religion', 'grocery', 'medical'],
    conditional: ['home'],  // extroverts home too, but less often
    avoided: [],
  },
};

// Archetype-based adjustments on top of social energy
const ARCHETYPE_AFFINITY_OVERRIDES = {
  'guardian':    { boost: ['home', 'religion', 'medical'], penalize: ['social'] },
  'achiever':    { boost: ['gym', 'education', 'business'], penalize: [] },
  'rebel':       { boost: ['social', 'outdoor'], penalize: ['religion', 'home'] },
  'introvert':   { boost: ['home', 'outdoor'], penalize: ['social'] },
  'charmer':     { boost: ['social', 'food_drink'], penalize: [] },
  'wounded':     { boost: ['home', 'outdoor'], penalize: ['social'] },
  'chaotic':     { boost: ['social'], penalize: ['home'] },
  'people-pleaser': { boost: ['food_drink', 'social'], penalize: [] },
  'self-destructive': { boost: ['social'], penalize: ['gym', 'medical'] },
};

// Health habits keywords → location boosts
const HEALTH_HABIT_BOOSTS = [
  { keywords: ['gym', 'workout', 'fitness', 'exercise', 'train'], boost: 'gym' },
  { keywords: ['run', 'jog', 'walk', 'hike', 'outdoor'], boost: 'outdoor' },
  { keywords: ['meal prep', 'healthy eating', 'nutrition', 'diet'], boost: 'grocery' },
  { keywords: ['yoga', 'meditat', 'wellness', 'mindful'], boost: 'outdoor' },
  { keywords: ['drink', 'bar', 'nightclub', 'party'], boost: 'social' },
];

// Emotional state → location modifiers
const EMOTIONAL_STATE_MODIFIERS = {
  // States that push toward quieter/isolated locations
  sad:          { boost: ['home', 'outdoor'], penalize: ['social'] },
  anxious:      { boost: ['home', 'outdoor'], penalize: ['social'] },
  overwhelmed:  { boost: ['home', 'outdoor'], penalize: ['social'] },
  reflective:   { boost: ['home', 'outdoor', 'religion'], penalize: ['social'] },
  'closed-off': { boost: ['home'], penalize: ['social', 'food_drink'] },
  'burnt out':  { boost: ['home', 'outdoor'], penalize: ['social', 'gym'] },
  grief:        { boost: ['home', 'religion', 'outdoor'], penalize: ['social'] },
  loneliness:   { boost: ['social', 'food_drink'], penalize: ['home'] },
  detachment:   { boost: ['home', 'outdoor'], penalize: ['social'] },
  apathy:       { boost: ['home'], penalize: [] },
  hopelessness: { boost: ['home', 'religion'], penalize: ['social'] },

  // States that push toward social/active locations
  joyful:       { boost: ['social', 'food_drink', 'outdoor'], penalize: [] },
  excited:      { boost: ['social', 'food_drink', 'outdoor', 'gym'], penalize: [] },
  content:      { boost: ['home', 'outdoor', 'food_drink'], penalize: [] },
  flirtatious:  { boost: ['social', 'food_drink'], penalize: ['home'] },
  calm:         { boost: ['outdoor', 'home', 'food_drink'], penalize: [] },
  bored:        { boost: ['social', 'food_drink', 'outdoor'], penalize: ['home'] },
  irritated:    { boost: ['outdoor', 'gym'], penalize: ['social'] },
  frustrated:   { boost: ['gym', 'outdoor', 'home'], penalize: ['social'] },
  defensive:    { boost: ['home'], penalize: ['social'] },
  competitive:  { boost: ['gym', 'social'], penalize: [] },
};

/**
 * Compute a location category compatibility profile for a character.
 * Returns { category: score } where score > 0 = preferred, 0 = neutral, < 0 = avoided.
 */
export function buildCharacterLocationProfile(character) {
  const profile = {
    home: 0, workplace: 0, school: 0, gym: 0, social: 0,
    outdoor: 0, food_drink: 0, medical: 0, education: 0,
    grocery: 0, religion: 0, government: 0, public: 0,
    business: 0, generic: 0,
  };

  // ── STEP 1: Social energy base ────────────────────────────────────────
  const socialEnergy = character.social_energy || 'ambivert';
  const energyProfile = SOCIAL_ENERGY_AFFINITIES[socialEnergy] || SOCIAL_ENERGY_AFFINITIES.ambivert;

  energyProfile.preferred.forEach(cat => { profile[cat] = (profile[cat] || 0) + 3; });
  energyProfile.acceptable.forEach(cat => { profile[cat] = (profile[cat] || 0) + 1; });
  energyProfile.conditional.forEach(cat => { profile[cat] = (profile[cat] || 0) - 1; });
  energyProfile.avoided.forEach(cat => { profile[cat] = (profile[cat] || 0) - 3; });

  // ── STEP 2: Archetype overrides ───────────────────────────────────────
  const archetype = (character.archetype || '').toLowerCase();
  const archetypeOverride = ARCHETYPE_AFFINITY_OVERRIDES[archetype];
  if (archetypeOverride) {
    archetypeOverride.boost.forEach(cat => { profile[cat] = (profile[cat] || 0) + 2; });
    archetypeOverride.penalize.forEach(cat => { profile[cat] = (profile[cat] || 0) - 2; });
  }

  // ── STEP 3: Health habits ─────────────────────────────────────────────
  const healthHabits = (character.health_habits || '').toLowerCase();
  HEALTH_HABIT_BOOSTS.forEach(({ keywords, boost }) => {
    if (keywords.some(k => healthHabits.includes(k))) {
      profile[boost] = (profile[boost] || 0) + 2;
    }
  });

  // ── STEP 4: Religion & values filtering ──────────────────────────────
  const religion = (character.religion || '').toLowerCase();
  const beliefLevel = character.belief_level || 'moderate';

  const devout = beliefLevel === 'devout';
  const moderate = beliefLevel === 'moderate';
  const inNameOnly = beliefLevel === 'in_name_only';

  if (religion && religion !== 'none' && religion !== '') {
    // Religious characters prefer places of worship
    const religionBoost = devout ? 4 : moderate ? 2 : 1;
    profile.religion = (profile.religion || 0) + religionBoost;

    // Devout believers penalize certain nightlife/social venues
    if (devout) {
      // Flag for venue_identity checks (e.g. gay clubs, strip clubs)
      // We mark 'social' as lower by default; venue_identity filtering
      // happens at the individual location level in scoreLocation()
      profile.social = (profile.social || 0) - 2;
    }
  }

  // ── STEP 5: Personality traits boost ─────────────────────────────────
  const traits = (character.personality_traits || []).map(t => t.toLowerCase());
  if (traits.some(t => ['nature', 'earthy', 'outdoorsy', 'grounded', 'peaceful'].includes(t))) {
    profile.outdoor = (profile.outdoor || 0) + 2;
    profile.home = (profile.home || 0) + 1;
    profile.social = (profile.social || 0) - 1;
  }
  if (traits.some(t => ['foodie', 'culinary', 'social', 'sociable', 'outgoing'].includes(t))) {
    profile.food_drink = (profile.food_drink || 0) + 2;
  }
  if (traits.some(t => ['fitness', 'athletic', 'active', 'disciplined', 'health'].includes(t))) {
    profile.gym = (profile.gym || 0) + 2;
  }
  if (traits.some(t => ['bookish', 'intellectual', 'studious', 'curious'].includes(t))) {
    profile.education = (profile.education || 0) + 1;
    profile.public = (profile.public || 0) + 1;
  }

  return profile;
}

/**
 * Score a single location for a character.
 * Higher score = better fit.
 * Returns { score, reasons[] }
 */
export function scoreLocation(location, character, baseProfile, emotionalState) {
  let score = baseProfile[location.category] || 0;
  const reasons = [];

  // Apply emotional state modifier on top of base profile
  const emotionMod = EMOTIONAL_STATE_MODIFIERS[emotionalState];
  if (emotionMod) {
    if (emotionMod.boost.includes(location.category)) {
      score += 2;
      reasons.push(`emotional state (${emotionalState}) pulls toward ${location.category}`);
    }
    if (emotionMod.penalize.includes(location.category)) {
      score -= 2;
      reasons.push(`emotional state (${emotionalState}) pushes away from ${location.category}`);
    }
  }

  // ── Religion/values: venue-level filtering ───────────────────────────
  const religion = (character.religion || '').toLowerCase();
  const beliefLevel = character.belief_level || 'moderate';
  const venueIdentity = (location.venue_identity || '').toLowerCase();
  const clubTheme = (location.club_theme || '').toLowerCase();
  const locationName = (location.name || '').toLowerCase();

  const isDevout = beliefLevel === 'devout';
  const isModerate = beliefLevel === 'moderate';

  // Conservative/religious characters avoid explicit adult venues
  if (isDevout && religion && religion !== 'none') {
    const conflictsWithReligion = (
      venueIdentity.includes('gay') ||
      venueIdentity.includes('lgbt') ||
      venueIdentity.includes('queer') ||
      venueIdentity.includes('strip') ||
      venueIdentity.includes('adult') ||
      clubTheme.includes('gay') ||
      clubTheme.includes('lgbt') ||
      locationName.includes('strip club') ||
      locationName.includes('adult club')
    );
    if (conflictsWithReligion) {
      score -= 6;
      reasons.push(`devout ${religion} identity conflicts with venue`);
    }
  }

  // Nightclub penalty for introverts (even without religion)
  const isNightclub = venueIdentity.includes('nightclub') || clubTheme.includes('nightclub') ||
    location.subtype?.includes('nightclub') || locationName.includes('nightclub');
  const socialEnergy = character.social_energy || 'ambivert';
  if (isNightclub && ['introvert', 'mostly_introvert'].includes(socialEnergy)) {
    score -= 2;
    reasons.push('introvert avoids nightclubs by default');
  }

  // ── Frequented places boost ──────────────────────────────────────────
  const frequented = (character.frequented_places || []).map(p => p.toLowerCase());
  if (frequented.some(p => (location.name || '').toLowerCase().includes(p) || p.includes(location.name?.toLowerCase()))) {
    score += 2;
    reasons.push('frequented place match');
  }

  // ── Health status: medical boost ─────────────────────────────────────
  const healthStatus = (character.health_status || '').toLowerCase();
  if (location.category === 'medical' && (healthStatus.includes('sick') || healthStatus.includes('pain') || healthStatus.includes('recover'))) {
    score += 3;
    reasons.push('health condition makes medical location appropriate');
  }

  // ── Home as refuge when worn out ─────────────────────────────────────
  if (location.category === 'home') {
    const wornOut = ['burnt out', 'overwhelmed', 'sad', 'tired', 'exhausted', 'sick'].some(
      s => (character.emotional_state || '').toLowerCase().includes(s)
    );
    if (wornOut) {
      score += 2;
      reasons.push('character needs rest — home preferred');
    }
  }

  return { score, reasons };
}

/**
 * Rank all available locations for a character during free time.
 * Returns locations sorted from best to worst fit, with scores attached.
 */
export function rankLocationsForCharacter(locations, character) {
  const emotionalState = character.emotional_state || 'calm';
  const baseProfile = buildCharacterLocationProfile(character);

  return locations
    .map(loc => {
      const { score, reasons } = scoreLocation(loc, character, baseProfile, emotionalState);
      return { location: loc, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Select the best location from a list for a character.
 * Adds slight randomness among the top candidates to avoid robotic repetition.
 * Returns the chosen location or null.
 */
export function selectBestLocation(locations, character) {
  if (!locations || locations.length === 0) return null;

  const ranked = rankLocationsForCharacter(locations, character);

  // Pick from top 3 candidates with weighted randomness
  // (top pick gets higher chance, but occasionally varies)
  const topCandidates = ranked.slice(0, Math.min(3, ranked.length));

  // Weight inversely: 1st=50%, 2nd=30%, 3rd=20% (if >=3 candidates with positive score)
  const positives = topCandidates.filter(c => c.score > 0);
  if (positives.length === 0) {
    // All scores neutral or negative — just return home/first available
    const home = ranked.find(r => r.location.category === 'home');
    return home?.location || ranked[0]?.location || null;
  }

  const weights = positives.length === 1 ? [1]
    : positives.length === 2 ? [0.65, 0.35]
    : [0.50, 0.30, 0.20];

  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < positives.length; i++) {
    cumulative += weights[i] || 0.1;
    if (roll <= cumulative) return positives[i].location;
  }

  return positives[0].location;
}