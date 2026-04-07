/**
 * CHARACTER LOCATION AFFINITY ENGINE — FULL IDENTITY-DRIVEN SYSTEM
 *
 * Scores available locations for a character during free time using:
 * - Social energy / personality type
 * - Religious beliefs & moral values (venue-level filtering)
 * - Health habits & lifestyle
 * - Personality traits & archetype
 * - Emotional state (current mood)
 * - Relationship context (passed in optionally)
 * - Health status (medical need)
 * - Time of day (night owl, morning person, etc.)
 *
 * Returns locations sorted by affinity score (highest = best fit).
 * Does NOT override schedule obligations — call this only during free time.
 *
 * CORE PRINCIPLE:
 * Character location choice is an extension of who they are.
 * Personality, beliefs, habits, and mood work together.
 * No random venue assignment when meaningful identity data exists.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL ENERGY BASE PROFILES
// Controls which venue categories are preferred vs acceptable vs avoided
// ─────────────────────────────────────────────────────────────────────────────
const SOCIAL_ENERGY_AFFINITIES = {
  introvert: {
    preferred: ['home', 'outdoor', 'public'],
    acceptable: ['food_drink', 'education', 'medical', 'grocery', 'religion'],
    conditional: ['gym'],
    avoided: ['social'],  // bars, clubs, parties — overwhelming
  },
  mostly_introvert: {
    preferred: ['home', 'outdoor', 'public'],
    acceptable: ['food_drink', 'education', 'medical', 'grocery', 'religion', 'gym'],
    conditional: ['social'],  // only in the right mood
    avoided: [],
  },
  ambivert: {
    preferred: ['food_drink', 'outdoor', 'home', 'social'],
    acceptable: ['gym', 'public', 'education', 'religion', 'grocery', 'medical'],
    conditional: [],
    avoided: [],
  },
  mostly_extrovert: {
    preferred: ['social', 'food_drink', 'gym', 'outdoor'],
    acceptable: ['public', 'home', 'education', 'religion', 'grocery', 'medical'],
    conditional: [],
    avoided: [],
  },
  extrovert: {
    preferred: ['social', 'food_drink', 'outdoor'],
    acceptable: ['gym', 'public', 'education', 'religion', 'grocery', 'medical'],
    conditional: ['home'],  // extroverts rest at home but don't seek it out
    avoided: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ARCHETYPE OVERRIDES
// Personality archetype shapes venue preference on top of social energy
// ─────────────────────────────────────────────────────────────────────────────
const ARCHETYPE_AFFINITY_OVERRIDES = {
  'guardian':          { boost: ['home', 'religion', 'medical', 'grocery'], penalize: ['social'] },
  'achiever':          { boost: ['gym', 'education', 'business', 'workplace'], penalize: [] },
  'rebel':             { boost: ['social', 'outdoor'], penalize: ['religion', 'home'] },
  'introvert':         { boost: ['home', 'outdoor'], penalize: ['social'] },
  'charmer':           { boost: ['social', 'food_drink'], penalize: [] },
  'wounded':           { boost: ['home', 'outdoor', 'religion'], penalize: ['social'] },
  'chaotic':           { boost: ['social'], penalize: ['home', 'religion'] },
  'people-pleaser':    { boost: ['food_drink', 'social'], penalize: [] },
  'self-destructive':  { boost: ['social'], penalize: ['gym', 'medical'] },
  'nurturer':          { boost: ['home', 'medical', 'grocery', 'religion'], penalize: [] },
  'intellectual':      { boost: ['education', 'public', 'home'], penalize: ['social'] },
  'free spirit':       { boost: ['outdoor', 'social', 'food_drink'], penalize: ['home', 'workplace'] },
  'homebody':          { boost: ['home', 'grocery', 'outdoor'], penalize: ['social'] },
  'social butterfly':  { boost: ['social', 'food_drink', 'gym'], penalize: ['home'] },
  'empath':            { boost: ['home', 'outdoor', 'religion'], penalize: ['social'] },
  'protector':         { boost: ['home', 'gym', 'medical'], penalize: [] },
  'romantic':          { boost: ['food_drink', 'outdoor', 'social'], penalize: [] },
  'loner':             { boost: ['home', 'outdoor', 'public'], penalize: ['social', 'food_drink'] },
  'adventurer':        { boost: ['outdoor', 'social', 'food_drink'], penalize: ['home'] },
};

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH HABIT BOOSTS
// Keyword → category boost for lifestyle-driven preferences
// ─────────────────────────────────────────────────────────────────────────────
const HEALTH_HABIT_BOOSTS = [
  { keywords: ['gym', 'workout', 'weight', 'lift', 'bodybuilding', 'crossfit', 'fitness', 'exercise', 'train'], boost: 'gym', points: 3 },
  { keywords: ['run', 'jog', 'walk', 'hike', 'trail', 'outdoor', 'nature', 'cycle', 'bike'], boost: 'outdoor', points: 2 },
  { keywords: ['meal prep', 'healthy eating', 'nutrition', 'diet', 'vegetarian', 'vegan', 'groceries'], boost: 'grocery', points: 2 },
  { keywords: ['yoga', 'meditat', 'wellness', 'mindful', 'breath', 'pilates', 'stretch'], boost: 'outdoor', points: 2 },
  { keywords: ['drink', 'bar', 'nightclub', 'party', 'going out', 'clubbing', 'alcohol'], boost: 'social', points: 2 },
  { keywords: ['study', 'read', 'library', 'learn', 'research', 'academic'], boost: 'education', points: 2 },
  { keywords: ['smoke', 'hookah', 'lounge'], boost: 'social', points: 1 },
];

// ─────────────────────────────────────────────────────────────────────────────
// PERSONALITY TRAIT KEYWORD MAPS
// Raw personality trait strings → venue boosts
// ─────────────────────────────────────────────────────────────────────────────
const PERSONALITY_TRAIT_VENUE_MAP = [
  // Nature / outdoorsy
  { keywords: ['nature', 'earthy', 'outdoorsy', 'grounded', 'peaceful', 'rugged', 'adventurous', 'hiking', 'wanderer'], boost: ['outdoor'], penalize: ['social'] },
  // Foodie / social eater
  { keywords: ['foodie', 'culinary', 'brunch', 'coffee', 'social eater', 'food lover'], boost: ['food_drink'], penalize: [] },
  // Fitness / health
  { keywords: ['fitness', 'athletic', 'active', 'disciplined', 'health', 'sporty', 'gym', 'runner', 'wellness'], boost: ['gym', 'outdoor'], penalize: [] },
  // Intellectual / bookish
  { keywords: ['bookish', 'intellectual', 'studious', 'curious', 'academic', 'scholar', 'nerd', 'reader'], boost: ['education', 'public', 'home'], penalize: [] },
  // Social / extroverted traits
  { keywords: ['outgoing', 'sociable', 'party', 'social', 'extroverted', 'people person', 'talkative', 'gregarious'], boost: ['social', 'food_drink'], penalize: [] },
  // Homebody
  { keywords: ['homebody', 'cozy', 'domestic', 'nesting', 'stay at home', 'introverted', 'private'], boost: ['home'], penalize: ['social'] },
  // Spiritual / religious
  { keywords: ['spiritual', 'religious', 'faithful', 'devout', 'prayer', 'worship', 'church', 'mosque', 'temple'], boost: ['religion', 'home'], penalize: ['social'] },
  // Creative
  { keywords: ['creative', 'artist', 'musician', 'writer', 'painter'], boost: ['outdoor', 'public', 'home'], penalize: [] },
  // Night life oriented
  { keywords: ['night owl', 'party lover', 'nightlife', 'club goer', 'bar hopper'], boost: ['social'], penalize: ['home'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// EMOTIONAL STATE MODIFIERS
// Current mood adjusts venue scoring on top of base preferences
// ─────────────────────────────────────────────────────────────────────────────
const EMOTIONAL_STATE_MODIFIERS = {
  // Withdrawing states → quiet, private
  sad:           { boost: ['home', 'outdoor', 'religion'], penalize: ['social'], isolating: true },
  anxious:       { boost: ['home', 'outdoor'], penalize: ['social'], isolating: true },
  overwhelmed:   { boost: ['home', 'outdoor'], penalize: ['social', 'gym'], isolating: true },
  reflective:    { boost: ['home', 'outdoor', 'religion', 'public'], penalize: ['social'], isolating: false },
  'closed-off':  { boost: ['home'], penalize: ['social', 'food_drink'], isolating: true },
  'burnt out':   { boost: ['home', 'outdoor'], penalize: ['social', 'gym'], isolating: true },
  grief:         { boost: ['home', 'religion', 'outdoor'], penalize: ['social'], isolating: true },
  loneliness:    { boost: ['social', 'food_drink', 'outdoor'], penalize: ['home'], isolating: false },
  detachment:    { boost: ['home', 'outdoor'], penalize: ['social'], isolating: true },
  apathy:        { boost: ['home'], penalize: [], isolating: true },
  hopelessness:  { boost: ['home', 'religion'], penalize: ['social', 'gym'], isolating: true },
  despair:       { boost: ['home', 'religion'], penalize: ['social', 'gym'], isolating: true },
  numbness:      { boost: ['home', 'outdoor'], penalize: ['social'], isolating: true },
  stress:        { boost: ['outdoor', 'home', 'gym'], penalize: ['social'], isolating: false },
  fear:          { boost: ['home'], penalize: ['social', 'outdoor'], isolating: true },
  guilt:         { boost: ['home', 'religion'], penalize: ['social'], isolating: true },
  shame:         { boost: ['home'], penalize: ['social', 'food_drink'], isolating: true },
  longing:       { boost: ['outdoor', 'religion', 'home'], penalize: [], isolating: false },

  // Active / social states → outward
  joyful:        { boost: ['social', 'food_drink', 'outdoor', 'gym'], penalize: [], isolating: false },
  joy:           { boost: ['social', 'food_drink', 'outdoor'], penalize: [], isolating: false },
  happiness:     { boost: ['social', 'food_drink', 'outdoor'], penalize: [], isolating: false },
  excited:       { boost: ['social', 'food_drink', 'outdoor', 'gym'], penalize: [], isolating: false },
  elation:       { boost: ['social', 'outdoor'], penalize: [], isolating: false },
  hope:          { boost: ['social', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  contentment:   { boost: ['home', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  content:       { boost: ['home', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  flirtatious:   { boost: ['social', 'food_drink'], penalize: ['home'], isolating: false },
  calm:          { boost: ['outdoor', 'home', 'food_drink', 'religion'], penalize: [], isolating: false },
  bored:         { boost: ['social', 'food_drink', 'outdoor'], penalize: ['home'], isolating: false },
  irritated:     { boost: ['outdoor', 'gym'], penalize: ['social'], isolating: false },
  frustrated:    { boost: ['gym', 'outdoor', 'home'], penalize: ['social'], isolating: false },
  defensive:     { boost: ['home', 'outdoor'], penalize: ['social'], isolating: true },
  gratitude:     { boost: ['religion', 'home', 'food_drink'], penalize: [], isolating: false },
  love:          { boost: ['food_drink', 'outdoor', 'home'], penalize: [], isolating: false },
  affection:     { boost: ['food_drink', 'social', 'home'], penalize: [], isolating: false },
  pride:         { boost: ['social', 'gym', 'food_drink'], penalize: [], isolating: false },
  confidence:    { boost: ['social', 'gym', 'outdoor'], penalize: [], isolating: false },
  peacefulness:  { boost: ['outdoor', 'home', 'religion'], penalize: ['social'], isolating: false },
  satisfaction:  { boost: ['home', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  curiosity:     { boost: ['outdoor', 'education', 'public', 'food_drink'], penalize: [], isolating: false },
  amusement:     { boost: ['social', 'food_drink', 'outdoor'], penalize: [], isolating: false },
  anticipation:  { boost: ['social', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  nostalgia:     { boost: ['home', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  desire:        { boost: ['social', 'food_drink'], penalize: [], isolating: false },
  passion:       { boost: ['social', 'outdoor', 'gym'], penalize: [], isolating: false },
  vulnerability: { boost: ['home', 'religion', 'outdoor'], penalize: ['social'], isolating: false },
  trust:         { boost: ['home', 'food_drink', 'social'], penalize: [], isolating: false },
  security:      { boost: ['home', 'outdoor'], penalize: [], isolating: false },
  patience:      { boost: ['home', 'outdoor', 'religion'], penalize: [], isolating: false },
  annoyance:     { boost: ['outdoor', 'gym'], penalize: ['social'], isolating: false },
  anger:         { boost: ['gym', 'outdoor'], penalize: ['social', 'food_drink'], isolating: false },
  rage:          { boost: ['outdoor', 'gym'], penalize: ['social', 'food_drink'], isolating: true },
  resentment:    { boost: ['home', 'outdoor'], penalize: ['social'], isolating: true },
  jealousy:      { boost: ['home', 'outdoor'], penalize: ['social'], isolating: false },
  envy:          { boost: ['home', 'gym'], penalize: ['social'], isolating: false },
  insecurity:    { boost: ['home', 'outdoor'], penalize: ['social', 'gym'], isolating: true },
  doubt:         { boost: ['home', 'outdoor', 'religion'], penalize: [], isolating: false },
  confusion:     { boost: ['outdoor', 'home', 'religion'], penalize: ['social'], isolating: false },
  panic:         { boost: ['home', 'medical'], penalize: ['social', 'outdoor'], isolating: true },
  worry:         { boost: ['home', 'outdoor'], penalize: ['social'], isolating: false },
  embarrassment: { boost: ['home'], penalize: ['social', 'food_drink'], isolating: true },
  regret:        { boost: ['home', 'religion', 'outdoor'], penalize: ['social'], isolating: false },
  disappointment:{ boost: ['home', 'outdoor'], penalize: ['social'], isolating: false },
  infatuation:   { boost: ['food_drink', 'social', 'outdoor'], penalize: [], isolating: false },
  tenderness:    { boost: ['home', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  belonging:     { boost: ['social', 'food_drink', 'home'], penalize: [], isolating: false },
  acceptance:    { boost: ['home', 'outdoor', 'social'], penalize: [], isolating: false },
  surprise:      { boost: ['social', 'outdoor'], penalize: [], isolating: false },
  awe:           { boost: ['outdoor', 'religion', 'public'], penalize: [], isolating: false },
  relief:        { boost: ['home', 'outdoor', 'food_drink'], penalize: [], isolating: false },
  compassion:    { boost: ['home', 'medical', 'religion'], penalize: [], isolating: false },
  empathy:       { boost: ['home', 'social', 'religion'], penalize: [], isolating: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// VENUE IDENTITY / SUBTYPE FLAGS
// Used to detect specific venue types that conflict with identity
// ─────────────────────────────────────────────────────────────────────────────
const CONSERVATIVE_CONFLICT_PATTERNS = [
  'gay', 'lgbt', 'queer', 'lgbtq', 'trans bar', 'drag',
  'strip club', 'strip bar', 'adult club', 'adult entertainment',
  'erotic', 'sex club', 'swinger', 'fetish',
];
const ALCOHOL_HEAVY_PATTERNS = ['brewery', 'distillery', 'wine bar', 'cocktail bar', 'pub', 'bar'];
const NIGHTCLUB_PATTERNS = ['nightclub', 'night club', 'club', 'rave', 'dance club', 'lounge club'];

function hasPattern(text, patterns) {
  const t = (text || '').toLowerCase();
  return patterns.some(p => t.includes(p));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PROFILE BUILDER
// Computes a base { category: score } map for a character
// ─────────────────────────────────────────────────────────────────────────────
export function buildCharacterLocationProfile(character) {
  const profile = {
    home: 0, workplace: 0, school: 0, gym: 0, social: 0,
    outdoor: 0, food_drink: 0, medical: 0, education: 0,
    grocery: 0, religion: 0, government: 0, public: 0,
    business: 0, generic: 0,
  };

  // ── STEP 1: Social energy base ────────────────────────────────────────────
  const socialEnergy = character.social_energy || 'ambivert';
  const energyProfile = SOCIAL_ENERGY_AFFINITIES[socialEnergy] || SOCIAL_ENERGY_AFFINITIES.ambivert;

  (energyProfile.preferred  || []).forEach(cat => { profile[cat] = (profile[cat] || 0) + 3; });
  (energyProfile.acceptable || []).forEach(cat => { profile[cat] = (profile[cat] || 0) + 1; });
  (energyProfile.conditional|| []).forEach(cat => { profile[cat] = (profile[cat] || 0) - 1; });
  (energyProfile.avoided    || []).forEach(cat => { profile[cat] = (profile[cat] || 0) - 3; });

  // ── STEP 2: Archetype overrides ───────────────────────────────────────────
  const archetype = (character.archetype || '').toLowerCase().trim();
  // Try exact match first, then partial
  let archetypeOverride = ARCHETYPE_AFFINITY_OVERRIDES[archetype];
  if (!archetypeOverride) {
    const key = Object.keys(ARCHETYPE_AFFINITY_OVERRIDES).find(k => archetype.includes(k) || k.includes(archetype));
    archetypeOverride = ARCHETYPE_AFFINITY_OVERRIDES[key];
  }
  if (archetypeOverride) {
    (archetypeOverride.boost   || []).forEach(cat => { profile[cat] = (profile[cat] || 0) + 2; });
    (archetypeOverride.penalize|| []).forEach(cat => { profile[cat] = (profile[cat] || 0) - 2; });
  }

  // ── STEP 3: Health habits ─────────────────────────────────────────────────
  const healthHabits = (character.health_habits || '').toLowerCase();
  HEALTH_HABIT_BOOSTS.forEach(({ keywords, boost, points }) => {
    if (keywords.some(k => healthHabits.includes(k))) {
      profile[boost] = (profile[boost] || 0) + (points || 2);
    }
  });

  // ── STEP 4: Religion & values ─────────────────────────────────────────────
  const religion = (character.religion || '').toLowerCase().trim();
  const beliefLevel = character.belief_level || 'moderate';
  const devout = beliefLevel === 'devout';
  const moderate = beliefLevel === 'moderate';

  if (religion && religion !== 'none' && religion !== '') {
    // Boost worship spaces based on devoutness
    const religionBoost = devout ? 5 : moderate ? 2 : 1;
    profile.religion = (profile.religion || 0) + religionBoost;
    profile.home = (profile.home || 0) + (devout ? 1 : 0);

    // Devout believers generally prefer quieter, values-aligned spaces
    if (devout) {
      profile.social = (profile.social || 0) - 2;
    }

    // Muslim characters: alcohol-heavy venues are uncomfortable
    const isMuslim = religion.includes('islam') || religion.includes('muslim');
    if (isMuslim && (devout || moderate)) {
      // Flag applied at venue level in scoreLocation()
      profile.social = (profile.social || 0) - 1;
    }
  }

  // ── STEP 5: Personality trait keyword matching ────────────────────────────
  const traitsRaw = (character.personality_traits || []).concat(
    (character.personality_summary || '').split(' ')
  ).map(t => t.toLowerCase());

  PERSONALITY_TRAIT_VENUE_MAP.forEach(({ keywords, boost, penalize }) => {
    const matched = keywords.some(k => traitsRaw.some(t => t.includes(k)));
    if (matched) {
      (boost   || []).forEach(cat => { profile[cat] = (profile[cat] || 0) + 2; });
      (penalize|| []).forEach(cat => { profile[cat] = (profile[cat] || 0) - 1; });
    }
  });

  return profile;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCATION SCORER
// Applies per-location adjustments on top of the character base profile
// ─────────────────────────────────────────────────────────────────────────────
export function scoreLocation(location, character, baseProfile, emotionalState) {
  let score = baseProfile[location.category] ?? 0;
  const reasons = [];

  // ── Emotional state modifier ──────────────────────────────────────────────
  const emotionKey = (emotionalState || character.emotional_state || 'calm');
  const emotionMod = EMOTIONAL_STATE_MODIFIERS[emotionKey];
  if (emotionMod) {
    if (emotionMod.boost.includes(location.category)) {
      score += 2;
      reasons.push(`mood (${emotionKey}) draws toward ${location.category}`);
    }
    if (emotionMod.penalize.includes(location.category)) {
      score -= 2;
      reasons.push(`mood (${emotionKey}) pushes away from ${location.category}`);
    }
    // Extra home pull when truly isolating
    if (emotionMod.isolating && location.category === 'home') {
      score += 1;
    }
  }

  // ── Venue identity & religion conflict filtering ──────────────────────────
  const religion = (character.religion || '').toLowerCase().trim();
  const beliefLevel = character.belief_level || 'moderate';
  const isDevout = beliefLevel === 'devout';
  const isModerate = beliefLevel === 'moderate';

  const venueIdentity  = (location.venue_identity || '').toLowerCase();
  const clubTheme      = (location.club_theme     || '').toLowerCase();
  const locationName   = (location.name           || '').toLowerCase();
  const subtypes       = (location.subtype        || []).map(s => s.toLowerCase());

  const venueText = `${venueIdentity} ${clubTheme} ${locationName} ${subtypes.join(' ')}`;

  // Conservative/devout believers: flag LGBTQ+ or adult venues
  if (isDevout && religion && religion !== 'none') {
    if (hasPattern(venueText, CONSERVATIVE_CONFLICT_PATTERNS)) {
      score -= 8;
      reasons.push(`devout ${religion} — venue conflicts with values`);
    }
  }
  // Moderate believers: mild discomfort at explicit adult venues
  if (isModerate && religion && religion !== 'none') {
    if (hasPattern(venueText, ['strip club', 'adult club', 'sex club'])) {
      score -= 4;
      reasons.push(`religious identity — mild conflict with adult venue`);
    }
  }

  // Muslim (devout or moderate): alcohol-heavy venues are uncomfortable
  const isMuslim = religion.includes('islam') || religion.includes('muslim');
  if (isMuslim && (isDevout || isModerate)) {
    if (hasPattern(venueText, ALCOHOL_HEAVY_PATTERNS)) {
      const penalty = isDevout ? -6 : -3;
      score += penalty;
      reasons.push(`Muslim identity — alcohol-heavy venue`);
    }
  }

  // ── Nightclub penalty for introverts ──────────────────────────────────────
  const isNightclub = hasPattern(venueText, NIGHTCLUB_PATTERNS);
  const socialEnergy = character.social_energy || 'ambivert';
  if (isNightclub) {
    if (['introvert', 'mostly_introvert'].includes(socialEnergy)) {
      score -= 3;
      reasons.push('introvert avoids nightclubs by default');
    }
    // Night owls get a partial bonus for nightclubs
    if (character.trait_night_owl) {
      score += 2;
      reasons.push('night owl trait — nightclub acceptable');
    }
  }

  // ── Health status: medical need ───────────────────────────────────────────
  const healthStatus = (character.health_status || '').toLowerCase();
  if (location.category === 'medical') {
    if (/sick|pain|recover|ill|injury|checkup|hospital/.test(healthStatus)) {
      score += 4;
      reasons.push('health condition makes medical location appropriate');
    }
  }

  // ── Frequented places boost ───────────────────────────────────────────────
  const frequented = (character.frequented_places || []).map(p => p.toLowerCase());
  const locNameLower = (location.name || '').toLowerCase();
  if (frequented.some(p => locNameLower.includes(p) || p.includes(locNameLower))) {
    score += 2;
    reasons.push('frequented place — character is comfortable here');
  }

  // ── Home as refuge when worn out ──────────────────────────────────────────
  if (location.category === 'home') {
    const state = (character.emotional_state || '').toLowerCase();
    if (/burnt out|overwhelmed|sad|tired|exhausted|sick|grief|anxious/.test(state)) {
      score += 2;
      reasons.push('worn out — home is refuge');
    }
    // Night owls slightly prefer staying out vs home early
    if (character.trait_night_owl) {
      score -= 1;
    }
  }

  // ── Gym: health-focused characters get a nudge ────────────────────────────
  if (location.category === 'gym') {
    const hh = (character.health_habits || '').toLowerCase();
    if (/gym|workout|fitness|exercise|train|lift|crossfit/.test(hh)) {
      score += 2;
      reasons.push('health-focused lifestyle — gym is natural choice');
    }
    // Skip gym when burnt out or overwhelmed
    const state = (character.emotional_state || '').toLowerCase();
    if (/burnt out|overwhelmed|exhausted/.test(state)) {
      score -= 2;
      reasons.push('too worn out to gym');
    }
  }

  // ── Religion location: boost when devout & it's a match ──────────────────
  if (location.category === 'religion') {
    const denomText = (location.religion_denomination || '').toLowerCase();
    if (religion && religion !== 'none') {
      // Same-denomination match
      const sameReligion = denomText && (
        denomText.includes(religion.split(' ')[0]) ||
        religion.includes(denomText.split(' ')[0])
      );
      if (sameReligion) {
        score += 2;
        reasons.push('same-faith worship space');
      }
    } else if (!religion || religion === 'none') {
      // Non-religious characters don't seek worship spaces
      score -= 2;
    }
  }

  // ── Outdoor: earthy/nature-loving characters ──────────────────────────────
  if (location.category === 'outdoor') {
    const traitsRaw = (character.personality_traits || []).map(t => t.toLowerCase());
    const summary = (character.personality_summary || '').toLowerCase();
    if (/nature|earthy|outdoors|grounded|peaceful|green|organic|hiking|trail/
      .test(traitsRaw.join(' ') + ' ' + summary)) {
      score += 2;
      reasons.push('nature-leaning personality — outdoor is comfortable');
    }
  }

  return { score, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// RANK ALL LOCATIONS
// Returns locations sorted from best to worst fit for this character right now
// ─────────────────────────────────────────────────────────────────────────────
export function rankLocationsForCharacter(locations, character, overrideEmotionalState = null) {
  const emotionalState = overrideEmotionalState || character.emotional_state || 'calm';
  const baseProfile = buildCharacterLocationProfile(character);

  return locations
    .map(loc => {
      const { score, reasons } = scoreLocation(loc, character, baseProfile, emotionalState);
      return { location: loc, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECT BEST LOCATION
// Picks the highest-fit location with slight top-3 randomness to avoid
// robotic repetition. Identity still drives the choice — randomness only
// shuffles within the valid affinity tier.
// ─────────────────────────────────────────────────────────────────────────────
export function selectBestLocation(locations, character, overrideEmotionalState = null) {
  if (!locations || locations.length === 0) return null;

  const ranked = rankLocationsForCharacter(locations, character, overrideEmotionalState);

  // Only consider positive-scoring locations (truly fitting ones)
  const positives = ranked.filter(r => r.score > 0);

  if (positives.length === 0) {
    // All neutral or negative — fall back to home or first available
    const home = ranked.find(r => r.location.category === 'home');
    return home?.location || ranked[0]?.location || null;
  }

  // Weight top candidates — not purely random, identity wins
  // 1st=50%, 2nd=30%, 3rd=20% when there are 3+
  const top = positives.slice(0, Math.min(3, positives.length));
  const weights = top.length === 1 ? [1]
    : top.length === 2 ? [0.65, 0.35]
    : [0.50, 0.30, 0.20];

  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < top.length; i++) {
    cumulative += weights[i] || 0;
    if (roll <= cumulative) return top[i].location;
  }

  return top[0].location;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUMAN-READABLE AFFINITY SUMMARY (for LLM prompt injection)
// Returns a concise text block describing the character's venue preferences
// ─────────────────────────────────────────────────────────────────────────────
export function buildAffinityPromptBlock(character, availableLocations = []) {
  const baseProfile = buildCharacterLocationProfile(character);
  const ranked = rankLocationsForCharacter(availableLocations, character);

  const preferred  = ranked.filter(r => r.score >= 3).map(r => r.location.name);
  const acceptable = ranked.filter(r => r.score > 0 && r.score < 3).map(r => r.location.name);
  const avoided    = ranked.filter(r => r.score <= -3).map(r => r.location.name);

  const socialEnergy = character.social_energy || 'ambivert';
  const religion = character.religion && character.religion !== 'None' ? character.religion : null;
  const beliefLevel = character.belief_level || 'moderate';
  const emotionalState = character.emotional_state || 'calm';

  const lines = [];
  lines.push(`SOCIAL ENERGY: ${socialEnergy} — ${getSocialEnergyDescription(socialEnergy)}`);
  if (religion) lines.push(`BELIEFS: ${religion} (${beliefLevel}) — affects comfortable venues`);
  lines.push(`CURRENT MOOD: ${emotionalState} — ${getMoodDescription(emotionalState)}`);
  if (preferred.length)  lines.push(`PREFERRED VENUES: ${preferred.slice(0, 5).join(', ')}`);
  if (acceptable.length) lines.push(`ACCEPTABLE VENUES: ${acceptable.slice(0, 5).join(', ')}`);
  if (avoided.length)    lines.push(`VENUES TO AVOID: ${avoided.slice(0, 5).join(', ')}`);
  lines.push(`RULE: Choose venues consistent with the above identity. Do not pick avoided venues without a strong character-driven reason.`);

  return lines.join('\n');
}

function getSocialEnergyDescription(se) {
  const map = {
    introvert:        'prefers home, parks, quiet places. Avoids crowds and loud venues.',
    mostly_introvert: 'leans quiet. Small gatherings and calm spots preferred.',
    ambivert:         'balanced. Mood determines whether social or quiet is preferred.',
    mostly_extrovert: 'enjoys lively bars, restaurants, social events.',
    extrovert:        'thrives at clubs, parties, and crowded social spaces.',
  };
  return map[se] || 'balanced preferences.';
}

function getMoodDescription(mood) {
  const em = EMOTIONAL_STATE_MODIFIERS[mood];
  if (!em) return 'neutral mood, normal preferences.';
  if (em.isolating) return `withdrawing — prefers ${em.boost.join('/')} and avoids ${em.penalize.join('/')}.`;
  return `active — drawn to ${em.boost.join('/')}${em.penalize.length ? `, less interested in ${em.penalize.join('/')}` : ''}.`;
}