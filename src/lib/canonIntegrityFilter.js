/**
 * canonIntegrityFilter.js
 *
 * FOURTH-WALL INTEGRITY GUARD
 *
 * Characters are real people in their world. They must never demonstrate
 * awareness of the application layer, database, memory systems, AI architecture,
 * or any implementation-layer construct.
 *
 * This module detects and rewrites (or flags) implementation-layer language
 * before it reaches the user as delivered character dialogue.
 *
 * DETECTION: Pattern matching against known system-layer vocabulary.
 * ACTION: Attempt in-world rewrite. If rewrite fails or is too similar, reject.
 *
 * Characters CAN describe in-world equivalents:
 *   - "memory records" → "what I remember", "what stays with me", "what I can't forget"
 *   - "deleted files" → "what was kept from me", "what she won't say", "the missing years"
 *   - "database entries" → not needed — has no in-world equivalent
 *   - "file headers" → not needed — has no in-world equivalent
 *   - "system data" → not needed
 *   - "character profile" → "what I know about you", "how I see you"
 *   - "AI memory" → never acceptable
 *   - "prompt" → never acceptable (in a technical sense)
 */

// ── FORBIDDEN PATTERNS ────────────────────────────────────────────────────────
// Each pattern must be clearly implementation-layer, not ordinary language.
// "memory" alone is NOT flagged — it's a common human word.
// "memory records", "memory system", "memory architecture" ARE flagged.

const FOURTH_WALL_PATTERNS = [
  // Memory system references
  /\bmemory\s+records?\b/i,
  /\bmemory\s+system\b/i,
  /\bmemory\s+architecture\b/i,
  /\bmemory\s+bank\b/i,
  /\bmemory\s+entries?\b/i,
  /\bmemory\s+files?\b/i,
  /\bmemory\s+store\b/i,
  /\bmemory\s+wipe\b/i,
  /\bwiped\s+(?:from\s+)?(?:your\s+)?memory\b/i,
  /\bdeleted\s+(?:from\s+)?(?:your\s+)?memory\b/i,

  // File / database references
  /\bdeleted\s+files?\b/i,
  /\bfile\s+headers?\b/i,
  /\bdatabase\s+entries?\b/i,
  /\bdatabase\s+records?\b/i,
  /\bdatabase\s+files?\b/i,
  /\bmy\s+name\s+is\s+all\s+over\s+the\s+headers?\b/i,
  /\bstamped\s+(?:in|on|across)\s+(?:the\s+)?(?:headers?|records?|files?)\b/i,
  /\bmetadata\b/i,

  // Character / profile references
  /\bcharacter\s+profile\b/i,
  /\bcharacter\s+record\b/i,
  /\bcharacter\s+data\b/i,
  /\bcharacter\s+storage\b/i,

  // AI / system references
  /\bAI\s+memory\b/i,
  /\bprompt\s+instructions?\b/i,
  /\bsystem\s+prompt\b/i,
  /\binternal\s+(?:ID|identifier|record|data|service|system)\b/i,
  /\bbackend\s+(?:system|service|data|record)\b/i,
  /\bapplication\s+(?:layer|data|system|logic)\b/i,

  // Hidden / intentional wipe language that implies system access
  /intentional\s+(?:memory\s+)?wipe\b/i,
  /\bwipe\s+(?:of\s+)?(?:your|her|his|their|the)\s+(?:memory|records?|data)\b/i,
  /\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/i,
  /\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
  /\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
];

/**
 * Checks whether a message contains implementation-layer language.
 *
 * @param {string} text — the character's generated response
 * @returns {{ violated: boolean, patterns: string[] }} — whether a violation was detected and which patterns
 */
export function detectFourthWallViolation(text) {
  if (!text || typeof text !== 'string') return { violated: false, patterns: [] };

  const matchedPatterns = [];
  for (const pattern of FOURTH_WALL_PATTERNS) {
    if (pattern.test(text)) {
      matchedPatterns.push(pattern.source);
    }
  }

  return {
    violated: matchedPatterns.length > 0,
    patterns: matchedPatterns,
  };
}

/**
 * Rewrites implementation-layer phrases into in-world equivalents.
 * This is a best-effort surface-level rewrite — simple substitutions only.
 * If the rewrite cannot produce a clean in-world result, the caller should
 * reject the response and either regenerate or suppress.
 *
 * @param {string} text — original character response
 * @returns {string} — rewritten text with system terms replaced
 */
export function rewriteToInWorld(text) {
  if (!text) return text;

  let rewritten = text;

  // Direct substitution map — most specific first
  const substitutions = [
    [/\bmemory\s+records?\b/gi, 'what I remember'],
    [/\bmemory\s+system\b/gi, 'what stays in my mind'],
    [/\bmemory\s+wipe\b/gi, 'someone made her forget'],
    [/\bwiped\s+(?:from\s+)?(?:your\s+)?memory\b/gi, 'taken from her'],
    [/\bdeleted\s+(?:from\s+)?(?:your\s+)?memory\b/gi, 'hidden from her'],
    [/\bdeleted\s+files?\b/gi, 'missing pieces'],
    [/\bfile\s+headers?\b/gi, 'what was left behind'],
    [/\bdatabase\s+(?:entries?|records?|files?)\b/gi, 'what was recorded'],
    [/\bmetadata\b/gi, 'traces'],
    [/\bmy\s+name\s+is\s+all\s+over\s+the\s+headers?\b/gi, 'signs of my involvement are everywhere'],
    [/\bintentional\s+(?:memory\s+)?wipe\b/gi, 'someone deliberately made her forget'],
    [/\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/gi, 'hidden from everyone'],
    [/\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'removed from the picture'],
    [/\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'wiped from the story'],
    [/\bcharacter\s+profile\b/gi, 'who you are'],
    [/\bcharacter\s+record\b/gi, 'what I know about you'],
    [/\bcharacter\s+data\b/gi, 'what I know about you'],
    [/\bAI\s+memory\b/gi, 'what I carry with me'],
    [/\bbackend\s+(?:system|service|data|record)\b/gi, 'how things work behind the scenes'],
    [/\binternal\s+(?:ID|identifier)\b/gi, 'who they really are'],
    [/\binternal\s+(?:record|data|service|system)\b/gi, 'what\'s kept quiet'],
  ];

  for (const [pattern, replacement] of substitutions) {
    rewritten = rewritten.replace(pattern, replacement);
  }

  return rewritten;
}

/**
 * Full guard pipeline: detect → attempt rewrite → validate → return result.
 *
 * @param {string} text — character response text
 * @param {object} options
 * @param {string} options.characterName — for logging
 * @param {string} options.channel — 'world_phone' | 'direct' etc
 * @returns {{ safe: boolean, text: string, action: 'passed'|'rewritten'|'rejected', violatedPatterns: string[] }}
 */
export function enforceCanonIntegrity(text, { characterName = 'unknown', channel = 'unknown' } = {}) {
  const detection = detectFourthWallViolation(text);

  if (!detection.violated) {
    return { safe: true, text, action: 'passed', violatedPatterns: [] };
  }

  console.warn(
    `[CanonIntegrityFilter] FOURTH-WALL VIOLATION DETECTED` +
    ` | character=${characterName} | channel=${channel}` +
    ` | patterns=[${detection.patterns.join(', ')}]` +
    ` | snippet="${text.substring(0, 120)}..."`
  );

  // Attempt rewrite
  const rewritten = rewriteToInWorld(text);

  // Re-check rewritten text — if it still violates, reject entirely
  const rewriteCheck = detectFourthWallViolation(rewritten);
  if (rewriteCheck.violated) {
    console.error(
      `[CanonIntegrityFilter] REWRITE FAILED — response rejected` +
      ` | character=${characterName} | remaining_patterns=[${rewriteCheck.patterns.join(', ')}]`
    );
    return {
      safe: false,
      text: null,
      action: 'rejected',
      violatedPatterns: detection.patterns,
    };
  }

  console.log(`[CanonIntegrityFilter] Rewrite successful | character=${characterName}`);
  return {
    safe: true,
    text: rewritten,
    action: 'rewritten',
    violatedPatterns: detection.patterns,
  };
}