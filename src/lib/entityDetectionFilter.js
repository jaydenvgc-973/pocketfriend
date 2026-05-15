/**
 * ENTITY DETECTION FILTER — Pre-resolution layer
 *
 * Before showing the NewPersonDetectedModal, all detected mentions are
 * passed through this filter. It checks:
 * 1. Known user aliases, world name, nicknames ("this is me")
 * 2. Existing characters by name and alias
 * 3. Session-stored ignore list (per conversation + globally)
 * 4. Possessive/partial-word patterns (JoJo's, Anderson's, reset→set false positive)
 * 5. Location-suffix patterns (Anderson's Bar → likely location)
 *
 * Only mentions that survive all layers are shown to the user.
 */

// ── SESSION MEMORY ──────────────────────────────────────────────────────────
// Stored per browser session in memory (not localStorage — intentionally transient)
const SESSION_IGNORE_PHRASES = new Set(); // "always ignore this phrase" for this session
const SESSION_RESOLVED_NAMES = new Map(); // name → resolution type ('user', 'character', 'location', 'ignored')

// Permanent ignore list backed by localStorage
const PERMANENT_IGNORE_KEY = 'entity_detection_permanent_ignores';

function getPermanentIgnores() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PERMANENT_IGNORE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function addPermanentIgnore(phrase) {
  const current = getPermanentIgnores();
  current.add(phrase.toLowerCase().trim());
  localStorage.setItem(PERMANENT_IGNORE_KEY, JSON.stringify([...current]));
  SESSION_IGNORE_PHRASES.add(phrase.toLowerCase().trim());
}

export function addSessionIgnore(phrase) {
  SESSION_IGNORE_PHRASES.add(phrase.toLowerCase().trim());
}

export function markResolved(name, resolutionType) {
  SESSION_RESOLVED_NAMES.set(name.toLowerCase().trim(), resolutionType);
}

export function isAlreadyResolved(name) {
  return SESSION_RESOLVED_NAMES.has(name.toLowerCase().trim());
}

// ── LOCATION SUFFIXES ───────────────────────────────────────────────────────
const LOCATION_SUFFIXES = [
  'bar', 'lounge', 'club', 'cafe', 'restaurant', 'hotel', 'shelter',
  'house', 'apartments', 'towers', 'hospital', 'church', 'gym', 'school',
  'mall', 'park', 'center', 'centre', 'plaza', 'market', 'store', 'shop',
  'salon', 'studio', 'office', 'clinic', 'pharmacy', 'station', 'terminal',
];

// Common stop words and partial-word false positives to always ignore
const HARD_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'so', 'yet', 'for', 'nor',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'shall', 'can', 'set', 'get', 'got', 'let', 'put', 'cut',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'she', 'they',
  'it', 'its', 'this', 'that', 'these', 'those', 'what', 'who', 'which',
  'there', 'here', 'when', 'where', 'how', 'why',
  // Common name fragments that are also English words
  'mark', 'grant', 'will', 'bill', 'may', 'grace', 'faith', 'hope',
  'max', 'ray', 'jay', 'kay', 'lee', 'ron', 'don',
]);

// Very short names (1-2 chars) are almost always false positives
const MIN_NAME_LENGTH = 3;

/**
 * Detect if a name is likely a location (has a location suffix nearby in context)
 */
export function looksLikeLocation(name, fullContext = '') {
  const nameLower = name.toLowerCase();
  const contextLower = fullContext.toLowerCase();

  // Possessive name + location suffix in context: "Anderson's Bar", "JoJo's Lounge"
  for (const suffix of LOCATION_SUFFIXES) {
    const pattern = new RegExp(`${nameLower}['']?s?\\s+${suffix}\\b`, 'i');
    if (pattern.test(contextLower)) return true;

    // Also check if the full phrase "Name's" appears directly before a location word
    const possessivePattern = new RegExp(`${nameLower}['']s\\b`, 'i');
    if (possessivePattern.test(contextLower)) {
      // Check if following words include a location suffix
      const idx = contextLower.search(possessivePattern);
      if (idx >= 0) {
        const after = contextLower.slice(idx).split(/\s+/).slice(0, 3).join(' ');
        if (LOCATION_SUFFIXES.some(s => after.includes(s))) return true;
      }
    }
  }

  // "at [Name]'s" pattern usually means a location
  if (new RegExp(`at\\s+${nameLower}['']?s?\\b`, 'i').test(contextLower)) return true;

  return false;
}

/**
 * Check if a detected name is likely a false positive (partial word, stop word, too short)
 */
export function isFalsePositive(name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < MIN_NAME_LENGTH) return true;
  if (HARD_STOP_WORDS.has(trimmed.toLowerCase())) return true;

  // Reject all-lowercase single word that looks like a common English word
  if (/^[a-z]+$/.test(trimmed) && trimmed.length <= 5) return true;

  return false;
}

/**
 * Check if a name matches the user (world name, aliases, known nicknames)
 */
export function matchesUser(name, userSettings) {
  if (!name || !userSettings) return false;
  const nameLower = name.toLowerCase().trim();

  // World name exact or fuzzy match
  const worldName = (userSettings.fictional_world_name || '').toLowerCase().trim();
  if (worldName && (worldName === nameLower || worldName.includes(nameLower) || nameLower.includes(worldName))) {
    return true;
  }

  // User aliases
  const aliases = Array.isArray(userSettings.user_aliases) ? userSettings.user_aliases : [];
  for (const alias of aliases) {
    if ((alias || '').toLowerCase().trim() === nameLower) return true;
  }

  return false;
}

/**
 * Check if a name matches any existing character (by name, display_name, or aliases)
 */
export function matchesExistingCharacter(name, characters = []) {
  if (!name || !characters.length) return null;
  const nameLower = name.toLowerCase().trim();

  for (const char of characters) {
    const charName = (char.name || '').toLowerCase().trim();
    const displayName = (char.display_name || '').toLowerCase().trim();
    const primaryName = (char.primary_name || '').toLowerCase().trim();

    // Exact match
    if (charName === nameLower || displayName === nameLower || primaryName === nameLower) {
      return char;
    }

    // First name match (for "James" matching "James Anderson")
    const firstName = charName.split(' ')[0];
    if (firstName && firstName === nameLower && firstName.length > 3) {
      return char;
    }

    // Check aliases array
    const charAliases = Array.isArray(char.aliases) ? char.aliases : [];
    for (const alias of charAliases) {
      const aliasText = (typeof alias === 'string' ? alias : alias?.text || alias?.alias || '').toLowerCase().trim();
      if (aliasText && aliasText === nameLower) return char;
    }

    // Check fictional relationships (character may already know this person)
    const fictionalRels = Array.isArray(char.fictional_relationships) ? char.fictional_relationships : [];
    for (const rel of fictionalRels) {
      const relName = (rel.person_name || '').toLowerCase().trim();
      if (relName && relName === nameLower) return char;
    }
  }

  return null;
}

/**
 * Primary filter: given a list of detected mentions, return only those that should be shown.
 * Returns { toShow, autoResolved } where autoResolved is for logging only.
 */
export function filterDetectedMentions(detectedPeople, {
  userSettings = {},
  existingCharacters = [],
  character = null,
} = {}) {
  const permanentIgnores = getPermanentIgnores();
  const toShow = [];
  const autoResolved = [];

  for (const person of detectedPeople) {
    const name = (person.name || '').trim();
    if (!name) continue;
    const nameLower = name.toLowerCase().trim();

    // 1. Hard stop words / false positive check
    if (isFalsePositive(name)) {
      autoResolved.push({ name, reason: 'false_positive' });
      continue;
    }

    // 2. Permanent ignore list
    if (permanentIgnores.has(nameLower)) {
      autoResolved.push({ name, reason: 'permanent_ignore' });
      continue;
    }

    // 3. Session ignore list
    if (SESSION_IGNORE_PHRASES.has(nameLower)) {
      autoResolved.push({ name, reason: 'session_ignore' });
      continue;
    }

    // 4. Already resolved this session
    if (isAlreadyResolved(name)) {
      autoResolved.push({ name, reason: 'already_resolved' });
      continue;
    }

    // 5. User self-reference
    if (matchesUser(name, userSettings)) {
      autoResolved.push({ name, reason: 'user_self_reference' });
      markResolved(name, 'user');
      continue;
    }

    // 6. Existing character match
    const existingChar = matchesExistingCharacter(name, existingCharacters);
    if (existingChar) {
      autoResolved.push({ name, reason: 'existing_character', matchedTo: existingChar.name });
      markResolved(name, 'character');
      continue;
    }

    // 7. Character self (the speaking character)
    if (character) {
      const charNameLower = (character.name || '').toLowerCase().trim();
      const charFirstName = charNameLower.split(' ')[0];
      if (charNameLower === nameLower || (charFirstName && charFirstName === nameLower && charFirstName.length > 3)) {
        autoResolved.push({ name, reason: 'speaking_character_self' });
        continue;
      }
    }

    // 8. Looks like a location (with context)
    const context = person.context || '';
    if (looksLikeLocation(name, context)) {
      // Don't silently ignore — but flag as likely location so the popup shows location option prominently
      toShow.push({ ...person, likely_type: 'location' });
      continue;
    }

    // Passed all filters — show to user
    toShow.push({ ...person, likely_type: person.likely_type || 'person' });
  }

  if (autoResolved.length > 0) {
    console.log(`[EntityDetection] Auto-resolved ${autoResolved.length} mentions:`, autoResolved.map(r => `${r.name}(${r.reason})`).join(', '));
  }

  return { toShow, autoResolved };
}