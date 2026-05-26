/**
 * Conversational Entity Resolver
 *
 * Resolves entity references (places, people) from conversation text using:
 * - Saved LocationReference records (owner_email scoped)
 * - Known characters (owner_email scoped)
 * - Conversation anchors (recent explicit mentions)
 * - Shortened names and aliases
 * - Disambiguated possessive phrases
 *
 * Returns structured result with confidence, match IDs, and disambiguation flags.
 */

/**
 * Generate safe normalized aliases from a location name.
 * Handles possessives, common suffixes, and case variations.
 */
function generateLocationAliases(locationName) {
  if (!locationName) return [];
  
  const aliases = [locationName]; // always include exact name
  const lower = locationName.toLowerCase();
  
  // Remove punctuation
  const cleaned = locationName.replace(/['']/g, '').toLowerCase();
  if (cleaned !== lower) aliases.push(cleaned);
  
  // Strip common suffixes
  const suffixPatterns = [
    { suffix: /\s+(bar|pub|cafe|restaurant|diner|bistro|grill)$/i, reason: 'venue' },
    { suffix: /\s+(school|university|college|academy)$/i, reason: 'school' },
    { suffix: /\s+(church|mosque|temple|synagogue|chapel)$/i, reason: 'religious' },
    { suffix: /\s+(house|home|apartment|loft|estate)$/i, reason: 'residence' },
  ];
  
  for (const { suffix } of suffixPatterns) {
    const stripped = locationName.replace(suffix, '').toLowerCase();
    if (stripped && stripped !== lower && stripped.length > 3) {
      aliases.push(stripped);
    }
  }
  
  // Handle possessives (Anderson's Bar → anderson)
  const possessive = locationName.match(/^([A-Za-z]+)'s\s+(.+)$/);
  if (possessive) {
    aliases.push(possessive[1].toLowerCase());
    aliases.push(possessive[2].toLowerCase());
  }
  
  // Generic conversational shortcuts
  if (/university|college/i.test(locationName)) {
    aliases.push('the school', 'campus', 'school');
  }
  if (/bar|pub|restaurant|cafe/i.test(locationName)) {
    aliases.push('the bar', 'the place');
  }
  
  return [...new Set(aliases)]; // dedupe
}

/**
 * Score location match confidence.
 * Exact > alias > substring > nothing
 */
function scoreLocationMatch(refText, locationName, locationAliases) {
  const refLower = (refText || '').toLowerCase().trim();
  const nameLower = locationName.toLowerCase();
  
  if (refLower === nameLower) return { score: 1.0, reason: 'exact_match' };
  if (locationAliases.includes(refLower)) return { score: 0.95, reason: 'alias_match' };
  if (nameLower.includes(refLower)) return { score: 0.7, reason: 'substring_match' };
  
  return { score: 0, reason: 'no_match' };
}

/**
 * Extract vague destination reference (pronouns, generic phrases).
 */
function extractVagueDestination(messageText) {
  const vaguePattern = /\b(there|here|that\s+place|the\s+(?:school|bar|church|place|location)|campus|over\s+there|back\s+there)\b/i;
  const match = messageText.match(vaguePattern);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Resolve conversational entity from text, locations, characters, and anchors.
 *
 * @param {object} params
 * @param {string} params.rawText - the phrase to resolve
 * @param {array} params.savedLocations - all user's saved LocationReference records
 * @param {array} params.characters - all user's characters
 * @param {array} params.recentMessages - last 15-20 conversation messages
 * @param {string} params.currentCharacterId - ID of the character being talked to
 * @param {object} params.currentCharacter - character record
 * @param {object} params.userSettings - user settings (current location, home, etc.)
 *
 * @returns {object} resolution result
 */
export async function resolveConversationalEntity({
  rawText,
  savedLocations = [],
  characters = [],
  recentMessages = [],
  currentCharacterId,
  currentCharacter,
  userSettings,
}) {
  if (!rawText) {
    return {
      raw_text: rawText,
      entity_type: 'empty',
      confidence: 0,
      should_block_action: true,
    };
  }

  const normalized = rawText.trim();
  const result = {
    raw_text: rawText,
    normalized_text: normalized,
    entity_type: null,
    matched_location_id: null,
    matched_location_name: null,
    matched_character_id: null,
    matched_character_name: null,
    confidence: 0,
    confidence_reason: null,
    requires_disambiguation: false,
    candidates: [],
    should_block_action: false,
    resolved_from_anchor: null,
    anchor_type: null,
  };

  // ── STEP 1: EXACT/ALIAS LOCATION MATCH ──
  const locationMatches = [];
  for (const loc of savedLocations) {
    const aliases = generateLocationAliases(loc.name);
    const { score, reason } = scoreLocationMatch(normalized, loc.name, aliases);
    if (score > 0) {
      locationMatches.push({
        type: 'location',
        id: loc.id,
        name: loc.name,
        score,
        reason,
        record: loc,
      });
    }
  }

  if (locationMatches.length === 1) {
    const match = locationMatches[0];
    result.entity_type = 'location';
    result.matched_location_id = match.id;
    result.matched_location_name = match.name;
    result.confidence = match.score;
    result.confidence_reason = `Direct location match (${match.reason})`;
    return result;
  }

  if (locationMatches.length > 1) {
    // Multiple location matches = ambiguous
    result.entity_type = 'ambiguous';
    result.requires_disambiguation = true;
    result.candidates = locationMatches;
    result.confidence = 0.5;
    result.confidence_reason = 'Multiple saved locations match this phrase';
    result.should_block_action = true;
    return result;
  }

  // ── STEP 2: VAGUE PRONOUN → CONVERSATION ANCHOR ──
  const vagueRef = extractVagueDestination(normalized);
  if (vagueRef) {
    // Scan recent messages for the last explicit location mention
    for (const msg of recentMessages) {
      if (!msg.content) continue;
      
      // Find location references in this message
      for (const loc of savedLocations) {
        const aliases = generateLocationAliases(loc.name);
        // Check both exact and alias matches
        const allNames = [loc.name, ...aliases];
        const found = allNames.some(alias => msg.content.toLowerCase().includes(alias));
        
        if (found) {
          result.entity_type = 'location';
          result.matched_location_id = loc.id;
          result.matched_location_name = loc.name;
          result.confidence = 0.85;
          result.confidence_reason = `Vague pronoun "${vagueRef}" resolved via recent conversation anchor`;
          result.resolved_from_anchor = loc.name;
          result.anchor_type = 'explicit_location';
          return result;
        }
      }
    }
  }

  // ── STEP 3: CONTEXTUAL DEFAULTS (current location, work, school, home) ──
  const isGenericWork = /\b(work|office|workplace|job)\b/i.test(normalized);
  const isGenericSchool = /\b(school|campus|university|college|class)\b/i.test(normalized);
  const isGenericHome = /\b(home|house|place|my\s+place|your\s+place)\b/i.test(normalized);

  if (isGenericWork && currentCharacter?.current_work_location_id) {
    const workLoc = savedLocations.find(l => l.id === currentCharacter.current_work_location_id);
    if (workLoc) {
      result.entity_type = 'location';
      result.matched_location_id = workLoc.id;
      result.matched_location_name = workLoc.name;
      result.confidence = 0.8;
      result.confidence_reason = 'Generic "work" reference resolved to character\'s active work location';
      result.resolved_from_anchor = workLoc.name;
      result.anchor_type = 'work_location';
      return result;
    }
  }

  if (isGenericSchool && currentCharacter?.current_school_location_id) {
    const schoolLoc = savedLocations.find(l => l.id === currentCharacter.current_school_location_id);
    if (schoolLoc) {
      result.entity_type = 'location';
      result.matched_location_id = schoolLoc.id;
      result.matched_location_name = schoolLoc.name;
      result.confidence = 0.8;
      result.confidence_reason = 'Generic "school/campus" reference resolved to character\'s active school location';
      result.resolved_from_anchor = schoolLoc.name;
      result.anchor_type = 'school_location';
      return result;
    }
  }

  if (isGenericHome && currentCharacter?.current_home_location_id) {
    const homeLoc = savedLocations.find(l => l.id === currentCharacter.current_home_location_id);
    if (homeLoc) {
      result.entity_type = 'location';
      result.matched_location_id = homeLoc.id;
      result.matched_location_name = homeLoc.name;
      result.confidence = 0.8;
      result.confidence_reason = 'Generic "home" reference resolved to character\'s home location';
      result.resolved_from_anchor = homeLoc.name;
      result.anchor_type = 'home_location';
      return result;
    }
  }

  // ── STEP 4: CHARACTER MATCH (for "Is X a person or place?" disambiguation) ──
  const charMatches = [];
  for (const char of characters) {
    const charNameLower = char.name.toLowerCase();
    if (charNameLower === normalized.toLowerCase()) {
      charMatches.push({
        type: 'character',
        id: char.id,
        name: char.name,
        score: 1.0,
        reason: 'exact_name_match',
      });
    }
  }

  if (charMatches.length === 1) {
    result.entity_type = 'character';
    result.matched_character_id = charMatches[0].id;
    result.matched_character_name = charMatches[0].name;
    result.confidence = 1.0;
    result.confidence_reason = 'Exact character name match';
    return result;
  }

  // ── STEP 5: UNRESOLVABLE (vague generic or no match) ──
  const unresolvableGenericWords = ['there', 'here', 'place', 'destination', 'location'];
  const isUnresolvableGeneric = unresolvableGenericWords.some(word => normalized.toLowerCase() === word);

  if (isUnresolvableGeneric || !result.matched_location_id) {
    result.entity_type = 'unresolvable';
    result.confidence = 0;
    result.confidence_reason = 'Cannot resolve destination — no saved location match and no conversation anchor';
    result.should_block_action = true;
    return result;
  }

  return result;
}

/**
 * For movement commitment detection, resolve a vague destination to a real saved location.
 * Returns {location_id, location_name, confidence, reason} or null if unresolvable.
 */
export async function resolveMovementDestination({
  destinationText,
  savedLocations = [],
  characters = [],
  recentMessages = [],
  currentCharacter,
}) {
  const result = await resolveConversationalEntity({
    rawText: destinationText,
    savedLocations,
    characters,
    recentMessages,
    currentCharacter,
  });

  // Only return location results that are actionable
  if (result.entity_type === 'location' && result.matched_location_id) {
    return {
      location_id: result.matched_location_id,
      location_name: result.matched_location_name,
      confidence: result.confidence,
      reason: result.confidence_reason,
      resolved_from_anchor: result.resolved_from_anchor,
    };
  }

  // Unresolvable or ambiguous = return null (block the action)
  return null;
}

/**
 * Test cases and expected outputs for documentation
 */
export const TEST_CASES = [
  {
    name: 'Aurelian State University → "there"',
    input: {
      rawText: 'there',
      savedLocations: [{ id: 'loc_asu_1', name: 'Aurelian State University' }],
      recentMessages: [
        { content: 'I\'m heading to Aurelian State University' },
      ],
    },
    expectedOutput: {
      entity_type: 'location',
      matched_location_name: 'Aurelian State University',
      confidence: 0.85,
      reason: 'Vague pronoun "there" resolved via recent conversation anchor',
    },
  },
  {
    name: 'JoJo\'s Bar → exact saved location',
    input: {
      rawText: 'JoJo\'s Bar',
      savedLocations: [{ id: 'loc_jojos_1', name: 'JoJo\'s Bar' }],
      recentMessages: [],
    },
    expectedOutput: {
      entity_type: 'location',
      matched_location_name: 'JoJo\'s Bar',
      confidence: 1.0,
      reason: 'Direct location match (exact_match)',
    },
  },
  {
    name: 'Anderson\'s Bar → matches saved location (not person)',
    input: {
      rawText: 'Anderson\'s Bar',
      savedLocations: [{ id: 'loc_andersons_1', name: 'Anderson\'s Bar' }],
      characters: [{ id: 'char_james_1', name: 'James Anderson' }],
      recentMessages: [],
    },
    expectedOutput: {
      entity_type: 'location',
      matched_location_name: 'Anderson\'s Bar',
      confidence: 1.0,
      reason: 'Direct location match (exact_match)',
    },
  },
  {
    name: 'Shortened name: "Aurelian" → "Aurelian State University"',
    input: {
      rawText: 'Aurelian',
      savedLocations: [{ id: 'loc_asu_1', name: 'Aurelian State University' }],
      recentMessages: [],
    },
    expectedOutput: {
      entity_type: 'location',
      matched_location_name: 'Aurelian State University',
      confidence: 0.7,
      reason: 'Direct location match (substring_match)',
    },
  },
  {
    name: 'Generic "the school" with active enrollment',
    input: {
      rawText: 'the school',
      savedLocations: [{ id: 'loc_asu_1', name: 'Aurelian State University' }],
      currentCharacter: { current_school_location_id: 'loc_asu_1' },
      recentMessages: [],
    },
    expectedOutput: {
      entity_type: 'location',
      matched_location_name: 'Aurelian State University',
      confidence: 0.8,
      reason: 'Generic "school/campus" reference resolved to character\'s active school location',
    },
  },
  {
    name: 'Unresolvable: generic "there" with no anchor',
    input: {
      rawText: 'there',
      savedLocations: [],
      recentMessages: [],
    },
    expectedOutput: {
      entity_type: 'unresolvable',
      confidence: 0,
      should_block_action: true,
      reason: 'Cannot resolve destination',
    },
  },
];