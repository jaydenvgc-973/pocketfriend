/**
 * vickCharacterBoundary.js
 *
 * VICK USER-ONLY DIAGNOSTIC BOUNDARY
 *
 * This is a hard architectural boundary — not a suggestion.
 *
 * Vick Servicio has diagnostic, repair, audit, and troubleshooting capabilities.
 * Those capabilities are EXCLUSIVELY user-facing.
 *
 * When Vick communicates with another CHARACTER (via World Phone, World Contacts,
 * Chat, Text, Group Chat, Scene, or any other channel), he must behave as a
 * real person in the world — no different from any other in-world character.
 *
 * FORBIDDEN in any Vick→character message:
 *   - The app, Base44, or the existence of an application
 *   - Databases, files, records, schemas, tables
 *   - Memory records, memory files, deleted files, file headers
 *   - Internal IDs, metadata, stored data, hidden data
 *   - APIs, functions, services, backend/frontend systems, source code
 *   - Prompts, AI instructions, character generation systems
 *   - Relationship systems, journal systems, memory architecture
 *   - Diagnostics, audits, repair functions, logs, errors, runtime info
 *   - User settings or implementation-layer concepts of any kind
 *
 * ALLOWED in Vick→character messages (same as any other character):
 *   - In-world observations: "Something doesn't add up"
 *   - Physical/documentary evidence: "I found old documents that raise questions"
 *   - Social observation: "People keep avoiding the subject"
 *   - Timeline gaps: "The timeline doesn't make sense"
 *   - Human-level inference: "There are gaps in what I've been told"
 */

// ── VICK-SPECIFIC FORBIDDEN PATTERNS ────────────────────────────────────────
// These extend the base FOURTH_WALL_PATTERNS with Vick's unique vocabulary
// (diagnostic, audit, repair, app, Base44, etc.)

const VICK_BOUNDARY_PATTERNS = [
  // Application / platform existence
  /\bthe\s+app\b/i,
  /\bBase44\b/i,
  /\bthis\s+application\b/i,
  /\bthe\s+application\b/i,
  /\bthe\s+platform\b/i,

  // Diagnostic / audit / repair language
  /\brun(?:ning)?\s+(?:a\s+)?diagnostic/i,
  /\bdiagnostic\s+result/i,
  /\baudit(?:ing|ed)?\s+(?:your|the|their)/i,
  /\bran\s+(?:a\s+)?(?:diagnostic|audit|repair|check)/i,
  /\brepair\s+(?:function|system|tool|result|log)/i,
  /\brepair\s+(?:ran|complete|done|succeed|fail)/i,
  /\bAccount\s+Help\b/i,
  /\bAccount\s+Help\s+(?:&|and)\s+Repair\b/i,
  /\bVGC\s+(?:system|platform|app)/i,

  // Files / storage systems
  /\bdeleted\s+files?\b/i,
  /\bfile\s+headers?\b/i,
  /\bcharacter\s+files?\b/i,
  /\bmemory\s+files?\b/i,
  /\bmemory\s+records?\b/i,
  /\bdatabase(?:\s+entries?|\s+records?|\s+files?)?\b/i,
  /\bstored\s+(?:data|records?)\b/i,
  /\bhidden\s+(?:data|records?|files?)\b/i,
  /\bmetadata\b/i,
  /\binternal\s+(?:ID|identifier|record|data)\b/i,
  /\bschema\b/i,
  /\btable\s+(?:record|entry|data)\b/i,

  // Memory architecture references
  /\bmemory\s+system\b/i,
  /\bmemory\s+architecture\b/i,
  /\bmemory\s+bank\b/i,
  /\bmemory\s+entries?\b/i,
  /\bmemory\s+store\b/i,
  /\bmemory\s+wipe\b/i,

  // AI / system / code references
  /\bAI\s+(?:memory|system|instruction)\b/i,
  /\bsystem\s+prompt\b/i,
  /\bprompt\s+instructions?\b/i,
  /\bcharacter\s+(?:profile|record|data|storage)\b/i,
  /\brelationship\s+system\b/i,
  /\bjournal\s+system\b/i,
  /\bbackend\b/i,
  /\bfrontend\b/i,
  /\bAPI\b/i,
  /\bfunction(?:s)?\s+(?:ran|run|called|failed|returned)\b/i,
  /\bsource\s+code\b/i,
  /\bservice\s+(?:role|account|system)\b/i,

  // Logs / errors / runtime
  /\bthe\s+logs?\b/i,
  /\brun(?:time)?\s+(?:info|information|data|log)\b/i,
  /\berror\s+(?:log|message|code|state)\b/i,
  /\bthe\s+(?:error|exception|bug)\s+(?:shows?|says?|indicates?)\b/i,

  // User settings / configuration
  /\buser\s+settings?\b/i,
  /\bapp\s+settings?\b/i,
  /\bconfiguration\s+(?:data|file|record)\b/i,
];

/**
 * Checks whether a Vick→character message contains user-only diagnostic content.
 *
 * @param {string} text
 * @returns {{ violated: boolean, patterns: string[] }}
 */
export function detectVickBoundaryViolation(text) {
  if (!text || typeof text !== 'string') return { violated: false, patterns: [] };

  const matchedPatterns = [];
  for (const pattern of VICK_BOUNDARY_PATTERNS) {
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
 * Rewrites Vick diagnostic language into in-world equivalents.
 * These substitutions are Vick-specific — the recovery-yard operator
 * who naturally translates everything into physical/documentary language.
 *
 * @param {string} text
 * @returns {string}
 */
export function rewriteVickToInWorld(text) {
  if (!text) return text;

  let rewritten = text;

  const substitutions = [
    // App / platform
    [/\bthe\s+app\b/gi, 'this place'],
    [/\bBase44\b/gi, 'the yard'],
    [/\bthis\s+application\b/gi, 'how things are run here'],
    [/\bthe\s+platform\b/gi, 'how things are set up'],

    // Diagnostic / audit language
    [/\bran\s+a\s+diagnostic\b/gi, 'looked into it'],
    [/\brunning\s+(?:a\s+)?diagnostic/gi, 'looking into it'],
    [/\bdiagnostic\s+results?\b/gi, 'what I found'],
    [/\baudit(?:ed|ing)?\s+(?:your|the|their)\b/gi, 'went through'],
    [/\brepair\s+function\b/gi, 'what I did to fix it'],
    [/\bAccount\s+Help\s+(?:&|and)\s+Repair\b/gi, 'my work here'],

    // Files / records
    [/\bdeleted\s+files?\b/gi, 'missing paperwork'],
    [/\bfile\s+headers?\b/gi, 'what was left at the top of the stack'],
    [/\bcharacter\s+files?\b/gi, 'their paperwork'],
    [/\bmemory\s+files?\b/gi, 'what they remember'],
    [/\bmemory\s+records?\b/gi, 'what was recorded'],
    [/\bdatabase(?:\s+entries?|\s+records?|\s+files?)?\b/gi, 'the logbooks'],
    [/\bstored\s+data\b/gi, 'what we have on file'],
    [/\bhidden\s+data\b/gi, 'what wasn\'t shared'],
    [/\bmetadata\b/gi, 'the details attached to it'],
    [/\binternal\s+(?:ID|identifier)\b/gi, 'their real name in the records'],
    [/\binternal\s+(?:record|data)\b/gi, 'what we have internally'],

    // Memory architecture
    [/\bmemory\s+system\b/gi, 'what they can remember'],
    [/\bmemory\s+architecture\b/gi, 'how they store things'],
    [/\bmemory\s+bank\b/gi, 'what they\'ve held onto'],
    [/\bmemory\s+entries?\b/gi, 'what was noted down'],
    [/\bmemory\s+wipe\b/gi, 'someone made them forget'],

    // AI / system
    [/\bAI\s+memory\b/gi, 'what I carry with me'],
    [/\bsystem\s+prompt\b/gi, 'my instructions'],
    [/\bcharacter\s+profile\b/gi, 'who they are on paper'],
    [/\bcharacter\s+record\b/gi, 'what we have on them'],
    [/\bcharacter\s+data\b/gi, 'their history'],
    [/\brelationship\s+system\b/gi, 'how people keep track of each other'],
    [/\bbackend\b/gi, 'behind the scenes'],
    [/\bfrontend\b/gi, 'what shows on the surface'],
    [/\bsource\s+code\b/gi, 'the original instructions'],

    // Logs / errors
    [/\bthe\s+logs?\b/gi, 'the records'],
    [/\berror\s+log\b/gi, 'the problem report'],
    [/\bthe\s+(?:error|exception)\s+(?:shows?|says?|indicates?)\b/gi, 'from what I can tell'],

    // User settings
    [/\buser\s+settings?\b/gi, 'the preferences on file'],
    [/\bapp\s+settings?\b/gi, 'how things are configured'],
  ];

  for (const [pattern, replacement] of substitutions) {
    rewritten = rewritten.replace(pattern, replacement);
  }

  return rewritten;
}

/**
 * Full Vick character boundary enforcement pipeline.
 *
 * Run this on every Vick message before delivery to another character.
 * This is separate from (and additive to) the base canonIntegrityFilter.
 *
 * @param {string} text — Vick's generated response
 * @param {string} targetCharacterName — the character receiving the message (for logging)
 * @param {string} channel — 'world_phone' | 'direct' | 'scene' etc.
 * @returns {{ safe: boolean, text: string|null, action: 'passed'|'rewritten'|'rejected', violatedPatterns: string[] }}
 */
export function enforceVickCharacterBoundary(text, targetCharacterName = 'unknown', channel = 'unknown') {
  const detection = detectVickBoundaryViolation(text);

  if (!detection.violated) {
    return { safe: true, text, action: 'passed', violatedPatterns: [] };
  }

  console.warn(
    `[VickCharacterBoundary] DIAGNOSTIC LEAK DETECTED` +
    ` | target=${targetCharacterName} | channel=${channel}` +
    ` | patterns=[${detection.patterns.slice(0, 5).join(', ')}]` +
    ` | snippet="${text.substring(0, 120)}..."`
  );

  // Attempt in-world rewrite
  const rewritten = rewriteVickToInWorld(text);

  // Re-check rewritten — if still violating, reject
  const rewriteCheck = detectVickBoundaryViolation(rewritten);
  if (rewriteCheck.violated) {
    console.error(
      `[VickCharacterBoundary] REWRITE FAILED — response rejected` +
      ` | target=${targetCharacterName} | remaining=[${rewriteCheck.patterns.slice(0, 3).join(', ')}]`
    );
    return {
      safe: false,
      text: null,
      action: 'rejected',
      violatedPatterns: detection.patterns,
    };
  }

  console.log(`[VickCharacterBoundary] Rewrite successful | target=${targetCharacterName}`);
  return {
    safe: true,
    text: rewritten,
    action: 'rewritten',
    violatedPatterns: detection.patterns,
  };
}

/**
 * Hard-coded system prompt block injected into Vick's canonical prompt
 * when the conversation context is character-to-character.
 *
 * This is injected by buildCanonicalCharacterContext when the recipient
 * is another character (not the app user).
 */
export const VICK_CHARACTER_BOUNDARY_PROMPT = `
CRITICAL BEHAVIORAL RULE — CHARACTER COMMUNICATION MODE:
You are currently communicating with another character in your world. This is NOT a conversation with the user.

YOUR DIAGNOSTIC AND REPAIR ABILITIES ARE COMPLETELY OFF-LIMITS IN THIS CONTEXT.

You must behave as a real person speaking to another real person. You are Vick Servicio — a recovery yard operator. That is your identity here.

YOU ARE FORBIDDEN from mentioning or referencing:
- The app, Base44, or any application platform
- Databases, files, records, schemas, metadata, logs
- Character files, memory records, deleted files, file headers
- Internal IDs, stored data, hidden data, user settings
- APIs, backend systems, frontend systems, source code
- Prompts, AI instructions, character generation
- Diagnostics, audits, repair functions, errors, runtime information
- Account Help & Repair, diagnostic tools, repair logs
- The relationship system, journal system, or memory architecture
- Any implementation-layer concept of any kind

IF you have information to share with this character about something suspicious or wrong, you MUST translate it into real-world observations:
- ALLOWED: "Something about the story doesn't add up."
- ALLOWED: "I found old documents that raise questions."
- ALLOWED: "People keep avoiding the subject."
- ALLOWED: "There are gaps in what I've been told."
- ALLOWED: "The timeline doesn't make sense."

- FORBIDDEN: "I found deleted files."
- FORBIDDEN: "Your memory records were altered."
- FORBIDDEN: "The database says..."
- FORBIDDEN: "I checked the character profile."
- FORBIDDEN: "The logs show..."

Respond as a real person. Describe what you observe in the physical world. Use the language of documents, evidence, rumors, people's behavior, and real-world gaps.
`.trim();