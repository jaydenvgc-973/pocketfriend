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
 *
 * STRICT GATE: A phrase must be spatially meaningful — not just grammatically extractable —
 * before it can enter any location logic. Time phrases, idioms, comparison phrases, and
 * abstract expressions are forbidden from location resolution unless the user explicitly named a place.
 */

// ── TEMPORAL PHRASES — must never enter location resolution ────────────────
// These may contain "at", "in", "on", "time", but refer to timing, not places.
const TEMPORAL_PHRASES = new Set([
  "same time", "this time", "next time", "last time", "that time", "any time",
  "all the time", "at the same time", "at that time", "at this time", "at once",
  "on time", "in time", "right on time", "one more time", "every time",
  "for now", "right now", "just now", "by now", "until now", "from now",
  "at this point", "at that point", "at some point", "by this point",
  "in a moment", "in the moment", "at the moment", "for a moment", "just a moment",
  "in a second", "one second", "give me a sec", "in a bit", "in a while",
  "after a while", "for a while", "in a minute", "just a minute",
]);

// ── NON-SPATIAL IDIOMS AND ABSTRACT PHRASES — never locations ──────────────
const NON_SPATIAL_PHRASES = new Set([
  "in my head", "in my mind", "on my mind", "out of my mind", "in my heart",
  "in sync", "in tune", "on beat", "off beat", "in rhythm", "in motion",
  "in line", "out of line", "in order", "out of order", "in place", "out of place",
  "in general", "in theory", "in practice", "in reality", "in fact", "in truth",
  "in the way", "out of the way", "in the mix", "in the zone", "out of pocket",
  "on the same page", "on point", "off track", "on track", "in check",
  "at once", "all at once", "at will", "at best", "at worst", "at least",
  "on my own", "on their own", "by myself", "by themselves",
  "out loud", "out of nowhere", "out of context", "in context",
  "in a row", "in sequence", "in order", "in turn", "in kind",
  "this part", "that part", "the part", "this section", "that section",
  "this move", "that move", "the move", "this step", "that step",
  "for real", "for sure", "for good", "for free", "for once",
  "no way", "in no way", "either way", "any way", "that way", "this way",
]);

// ── TIMING / CHOREOGRAPHY / ACTIVITY CONTEXT WORDS ─────────────────────────
// If the extracted "phrase" is one of these standalone, it's not a place.
const TIMING_CONTEXT_WORDS = new Set([
  "time", "beat", "count", "moment", "second", "minute", "hour",
  "motion", "move", "step", "turn", "part", "section", "sequence",
  "pace", "tempo", "rhythm", "timing", "sync", "cue",
]);

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

/**
 * STRICT PLACE-LIKELIHOOD GATE
 *
 * Returns { isPlace: bool, reason: string, score: number }
 * 
 * A phrase must pass this gate before entering ANY location resolution logic.
 * Score: 0.0 (definitely not a place) → 1.0 (definitely a place).
 * Threshold to proceed: score >= 0.6
 */
export function assessPlaceLikelihood(phrase, sentenceContext = '') {
  const lower = phrase.toLowerCase().trim();
  const contextLower = (sentenceContext || '').toLowerCase();

  // ── Hard rejections ────────────────────────────────────────────────────────

  // 1. Exact temporal phrase match
  if (TEMPORAL_PHRASES.has(lower)) {
    return { isPlace: false, score: 0.0, reason: `temporal phrase, not a spatial location reference` };
  }

  // 2. Exact non-spatial idiom match
  if (NON_SPATIAL_PHRASES.has(lower)) {
    return { isPlace: false, score: 0.0, reason: `idiomatic/abstract phrase, not a location` };
  }

  // 3. Single word that is a timing/activity word, not a place noun
  const words = lower.split(/\s+/);
  if (words.length === 1 && TIMING_CONTEXT_WORDS.has(words[0])) {
    return { isPlace: false, score: 0.0, reason: `timing or activity word, not a place noun` };
  }

  // 4. Phrase contains "time" and is 2 words or fewer — almost never a place
  if (lower.includes('time') && words.length <= 3) {
    return { isPlace: false, score: 0.05, reason: `short phrase containing "time" — classified as temporal` };
  }

  // 5. Phrase ends in "time", "beat", "move", "step", "sync", "motion", "moment"
  const lastWord = words[words.length - 1];
  if (['time', 'beat', 'move', 'step', 'sync', 'motion', 'moment', 'pace', 'tempo', 'count', 'cue'].includes(lastWord)) {
    return { isPlace: false, score: 0.05, reason: `phrase ends with temporal/activity word "${lastWord}"` };
  }

  // 6. Context suggests choreography, dance, music, or timing language
  const timingContextPattern = /\b(choreograph|timing|rhythm|count|sync|beat|tempo|dance|move|sequence|step|cue|rehearse|practice|run.through|blocking)\b/i;
  if (timingContextPattern.test(contextLower) && lower.split(/\s+/).length <= 3) {
    return { isPlace: false, score: 0.1, reason: `short phrase in timing/choreography context — not spatial` };
  }

  // ── Positive signals ───────────────────────────────────────────────────────

  // 7. Contains a strong place-category keyword
  const placeKeywords = /\b(studio|studio|gym|bar|club|church|office|hospital|clinic|school|campus|court|venue|stage|backstage|mall|salon|shop|warehouse|lab|rooftop|gallery|dressing room|green room|rehearsal space|lounge|store|restaurant|cafe|diner|arena|stadium)\b/i;
  if (placeKeywords.test(lower)) {
    return { isPlace: true, score: 0.9, reason: `contains place-category keyword` };
  }

  // 8. Possessive place references ("grandma's house", "Chris's place", "Anderson's Bar")
  if (/\b\w+'s\s+(house|place|home|apartment|spot|bar|studio|office|gym)\b/i.test(lower)) {
    return { isPlace: true, score: 0.95, reason: `possessive place reference` };
  }

  // 9. "home" as destination (not "at home" in general)
  if (/\b(heading home|going home|on my way home|back home|head home)\b/i.test(contextLower)) {
    return { isPlace: true, score: 0.9, reason: `home destination phrase in context` };
  }

  // 10. Preceded by strong spatial verbs in the full sentence
  const spatialVerbPattern = /\b(i'm at|i am at|i'm in|i am in|i'm heading to|headed to|going to|just arrived at|just got to|pulled up to|leaving for|at the|in the|inside the)\s+/i;
  if (spatialVerbPattern.test(contextLower) && contextLower.includes(lower)) {
    return { isPlace: true, score: 0.85, reason: `preceded by spatial verb in sentence context` };
  }

  // 11. Multi-word phrase with no timing words — moderate confidence
  if (words.length >= 2 && !TIMING_CONTEXT_WORDS.has(lastWord) && !lower.includes('time')) {
    return { isPlace: true, score: 0.55, reason: `multi-word phrase, no temporal signals` };
  }

  // Default — single generic word, low confidence
  return { isPlace: false, score: 0.3, reason: `insufficient spatial signals to classify as a location` };
}

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
 *
 * All candidates are run through assessPlaceLikelihood() before being returned.
 * Only phrases scoring >= 0.6 are treated as locations.
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

      // ── STRICT PLACE-LIKELIHOOD GATE ──────────────────────────────────────
      // Pass the full sentence as context so temporal/choreography signals can be detected.
      const gate = assessPlaceLikelihood(normalized, messageContent);
      console.log(`[LOCATION_GATE] phrase="${normalized}" | score=${gate.score.toFixed(2)} | isPlace=${gate.isPlace} | reason="${gate.reason}"`);
      if (!gate.isPlace || gate.score < 0.6) continue; // rejected — not a location

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