/**
 * LOCATION ALIAS RESOLVER
 * 
 * Detects spoken place references in character dialogue/messages and resolves them
 * through a strict priority chain:
 *   1. Exact saved location match
 *   2. Existing user-scoped alias mapping
 *   3. Category-based soft match
 *   4. → UNRESOLVED → trigger popup
 *
 * This is the single source of truth for "did this phrase mean a real place?"
 */

// Phrases that are too vague to imply a specific place — skip resolution
const VAGUE_PHRASES = [
  "i'm out", "i'm busy", "i'm gone", "out for a bit", "stepping out",
  "not home", "away", "be back", "somewhere", "around", "later",
  "not around", "i'm good", "i'll be back", "heading somewhere",
  "running errands", "handling something", "busy rn", "dealing with something",
  "on my way", "give me a sec", "one second", "brb", "afk",
];

// Patterns that strongly suggest a specific place reference
const PLACE_REFERENCE_PATTERNS = [
  /\b(?:i'm|i am|currently|just got to|heading to|on my way to|at|going to|just left|leaving for|headed to|arrived at|made it to|just pulled up to|at the|going to the)\s+([\w\s']+?)(?:\s*[,.]|$)/i,
  /\b(?:the\s+)?(?:studio|rehearsal|set|gym|salon|shop|office|clinic|church|court|class|session|appointment|bar|lounge|club|warehouse|interview|venue|stage|backstage|lab|rooftop|gallery|mall|market|campus)\b/i,
  /\bgrandma['']?s\b/i,
  /\buncle['']?s\b/i,
  /\baunt['']?s\b/i,
];

// Category keywords → likely location categories for soft matching
const CATEGORY_HINTS = {
  studio: ['social', 'business', 'workplace', 'generic'],
  rehearsal: ['social', 'business', 'generic'],
  gym: ['gym'],
  church: ['religion'],
  clinic: ['medical'],
  salon: ['business', 'generic'],
  office: ['workplace', 'business'],
  school: ['school', 'education'],
  class: ['school', 'education'],
  campus: ['school', 'education'],
  bar: ['food_drink', 'social'],
  lounge: ['food_drink', 'social'],
  club: ['social', 'community'],
  shop: ['business', 'generic'],
  mall: ['business', 'generic'],
  market: ['grocery', 'generic'],
  court: ['government', 'public'],
  venue: ['social', 'community'],
  stage: ['social', 'community'],
  warehouse: ['business', 'generic'],
};

/**
 * Normalize a phrase for consistent matching
 */
export function normalizePhrase(phrase) {
  return phrase.toLowerCase().trim()
    .replace(/['".,!?]/g, '')
    .replace(/\bthe\b\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect if a message contains a specific place reference.
 * Returns { detected: bool, phrase: string, normalized: string } or null
 */
export function detectPlaceReference(messageContent) {
  if (!messageContent) return null;

  const lower = messageContent.toLowerCase();

  // Skip if entirely vague
  const isVague = VAGUE_PHRASES.some(v => lower.includes(v));
  if (isVague && lower.length < 60) return null;

  // Try each pattern
  for (const pattern of PLACE_REFERENCE_PATTERNS) {
    const match = messageContent.match(pattern);
    if (match) {
      // Extract the place phrase
      let raw = match[1] || match[0];
      raw = raw.replace(/^(i'm at|i am at|heading to|going to|at the|at my|currently at|just got to|at)\s+/i, '').trim();
      const normalized = normalizePhrase(raw);
      if (normalized.length < 2) continue;
      return { detected: true, phrase: raw, normalized };
    }
  }

  return null;
}

/**
 * Try to resolve a normalized phrase against a list of user-visible saved locations.
 * Returns { match: location, confidence, method } or null
 */
export function tryExactLocationMatch(normalizedPhrase, userLocations) {
  if (!userLocations?.length) return null;

  for (const loc of userLocations) {
    const locNorm = normalizePhrase(loc.name);
    if (locNorm === normalizedPhrase) {
      return { match: loc, confidence: 1.0, method: 'exact' };
    }
    // Check keywords
    const kws = (loc.keywords || []).map(k => normalizePhrase(k));
    if (kws.includes(normalizedPhrase)) {
      return { match: loc, confidence: 0.95, method: 'keyword' };
    }
  }
  return null;
}

/**
 * Try a soft category-based match
 * Returns { match: location, confidence, method } or null
 */
export function tryCategoryMatch(normalizedPhrase, userLocations) {
  if (!userLocations?.length) return null;

  // Find which category hint matches this phrase
  let hintCategories = null;
  for (const [key, cats] of Object.entries(CATEGORY_HINTS)) {
    if (normalizedPhrase.includes(key)) {
      hintCategories = cats;
      break;
    }
  }
  if (!hintCategories) return null;

  const candidates = userLocations.filter(loc => hintCategories.includes(loc.category));
  if (candidates.length === 1) {
    // Only one match — reasonably confident
    return { match: candidates[0], confidence: 0.6, method: 'category' };
  }
  // Multiple matches — not confident enough to auto-resolve, return them for popup ranking
  return { candidates, confidence: 0.4, method: 'category_multiple' };
}

/**
 * Full resolution attempt — runs all layers.
 * Returns one of:
 *   { resolved: true, type: 'saved_location', location, method }
 *   { resolved: true, type: 'alias', location, method }  (alias already known)
 *   { resolved: false, needsPopup: true, phrase, normalized, categoryCandidates? }
 *   null  (phrase is vague or no place detected)
 */
export function resolveSpokenPlace(messageContent, userLocations, existingAliases = []) {
  const detected = detectPlaceReference(messageContent);
  if (!detected) return null;

  const { phrase, normalized } = detected;

  // Step 1: Check existing alias memory (user-confirmed)
  const alias = existingAliases.find(a => normalizePhrase(a.phrase) === normalized);
  if (alias) {
    if (alias.resolution_type === 'saved_location') {
      const loc = userLocations.find(l => l.id === alias.resolved_location_id);
      return {
        resolved: true,
        type: 'alias',
        aliasRecord: alias,
        location: loc || { id: alias.resolved_location_id, name: alias.resolved_location_name },
        method: 'alias_memory',
      };
    }
    if (alias.resolution_type === 'rabbit_hole') {
      return {
        resolved: true,
        type: 'rabbit_hole',
        aliasRecord: alias,
        label: alias.rabbit_hole_label || phrase,
        method: 'alias_memory',
      };
    }
    if (alias.resolution_type === 'ignored') {
      return null; // user said this is not a real place
    }
  }

  // Step 2: Exact location match
  const exact = tryExactLocationMatch(normalized, userLocations);
  if (exact && exact.confidence >= 0.9) {
    return { resolved: true, type: 'saved_location', location: exact.match, method: exact.method };
  }

  // Step 3: Category soft match with single result
  const soft = tryCategoryMatch(normalized, userLocations);
  if (soft && soft.confidence >= 0.6 && soft.match) {
    // Single confident category match — still ask user to confirm since we're not certain
    return {
      resolved: false,
      needsPopup: true,
      phrase,
      normalized,
      categoryCandidates: [soft.match],
      suggestedLocation: soft.match,
    };
  }

  // Step 4: Unresolved — needs popup
  return {
    resolved: false,
    needsPopup: true,
    phrase,
    normalized,
    categoryCandidates: soft?.candidates || [],
  };
}

/**
 * Build a rabbit hole presence update payload for a character.
 * This updates the character's live presence to the rabbit hole without creating a saved location.
 */
export function buildRabbitHolePresenceUpdate(label, subtype = null) {
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: label,
    resolved_location_type: 'rabbit_hole',
    resolved_presence_status: 'rabbit_hole',
    resolved_source_reason: 'chat_rabbit_hole',
    is_rabbit_hole: true,
    rabbit_hole_label: label,
    rabbit_hole_subtype: subtype || null,
    rabbit_hole_started_at: new Date().toISOString(),
    last_location_update_time: new Date().toISOString(),
  };
}