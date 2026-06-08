/**
 * vickCharacterBoundary.js
 *
 * VICK USER-ONLY DIAGNOSTIC BOUNDARY — HARD ARCHITECTURAL RULE
 *
 * Vick Servicio's diagnostic, repair, audit, and troubleshooting capabilities
 * are EXCLUSIVELY for conversations with the user.
 *
 * When Vick communicates with another CHARACTER through ANY channel
 * (World Phone, World Contacts, Chat, Text, Group Chat, Scene, Autonomous,
 * Narrative, Journal, Memory, Relationship Events — anything not the user),
 * he must behave as a real person in the world with NO access to
 * application internals.
 *
 * ── IDENTIFICATION RULE ───────────────────────────────────────────────────────
 * Vick is identified by ANY of the following — all must be treated equally:
 *   - character_type === 'npc_world_service'
 *   - is_world_service === true
 *   - diagnostic_only === true
 *   - name includes 'vick servicio' (case-insensitive)
 *   - display_name includes 'vick servicio' (case-insensitive)
 *   - primary_name includes 'vick servicio' (case-insensitive)
 *
 * ── FORBIDDEN IN ANY VICK→CHARACTER MESSAGE ──────────────────────────────────
 * No word substitution is allowed that preserves the idea of system-level access.
 * The entire message must be rewritten as a real person speaking about:
 *   - old paperwork / public records
 *   - missing photographs
 *   - rumours from people around town
 *   - inconsistent stories
 *   - gaps in what people will admit
 *   - a timeline that does not add up
 *   - something Vick personally saw or heard
 *
 * ── SAFE PIPELINE ─────────────────────────────────────────────────────────────
 * enforceVickCharacterBoundary(text, targetName, channel):
 *   1. Detect → if clean, return { action: 'passed' }
 *   2. Attempt full in-world rewrite of the ENTIRE message (not word-swap)
 *   3. Re-scan rewritten text
 *   4. If still contaminated → return { action: 'rejected', text: null }
 *   5. Callers must: suppress message, skip memory sync, skip relationship update
 */

// ── VICK IDENTIFICATION ────────────────────────────────────────────────────────
/**
 * Returns true if a character record is Vick Servicio by ANY reliable identifier.
 * This must be used instead of a single-field check anywhere in the codebase.
 *
 * @param {object} character — character record (partial or full)
 * @returns {boolean}
 */
export function isVickServicio(character) {
  if (!character) return false;
  if (character.character_type === 'npc_world_service') return true;
  if (character.is_world_service === true) return true;
  if (character.diagnostic_only === true) return true;
  const names = [character.name, character.display_name, character.primary_name]
    .filter(Boolean)
    .map(n => n.toLowerCase());
  return names.some(n => n.includes('vick servicio'));
}

// ── FORBIDDEN PATTERNS ────────────────────────────────────────────────────────
// Comprehensive list. Matched against any Vick→character message before saving.
// These cover every category of implementation-layer language.

const VICK_BOUNDARY_PATTERNS = [
  // Application / platform existence
  /\bthe\s+app\b/i,
  /\bBase44\b/i,
  /\bthis\s+application\b/i,
  /\bthe\s+application\b/i,
  /\bthe\s+platform\b/i,
  /\bthe\s+software\b/i,

  // Diagnostic / audit / repair language
  /\brun(?:ning)?\s+(?:a\s+)?diagnostic/i,
  /\bdiagnostic\s+result/i,
  /\bdiagnostic\s+tool/i,
  /\baudit(?:ing|ed)?\s+(?:your|the|their)/i,
  /\bran\s+(?:a\s+)?(?:diagnostic|audit|repair|check)/i,
  /\brepair\s+(?:function|system|tool|result|log)/i,
  /\brepair\s+(?:ran|complete|done|succeed|fail)/i,
  /\bAccount\s+Help\b/i,
  /\bAccount\s+Help\s+(?:&|and)\s+Repair\b/i,
  /\bVGC\s+(?:system|platform|app|Recovery\s+Yard\s+system)/i,
  /\bmy\s+diagnostic\s+(?:tools?|access|system)\b/i,
  /\bI\s+(?:ran|ran\s+a|checked|inspected|audited)\s+(?:the\s+)?(?:system|records?|data|files?|logs?|database)\b/i,

  // Files / storage systems
  /\bdeleted\s+files?\b/i,
  /\bfile\s+headers?\b/i,
  /\bcharacter\s+files?\b/i,
  /\bmemory\s+files?\b/i,
  /\bmemory\s+records?\b/i,
  /\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/i,
  /\bstored\s+(?:data|records?|files?)\b/i,
  /\bhidden\s+(?:data|records?|files?|information)\b/i,
  /\bmetadata\b/i,
  /\binternal\s+(?:ID|identifier|record|data|system|files?)\b/i,
  /\bschema\b/i,
  /\btable\s+(?:record|entry|data|field)\b/i,
  /\bdata\s+(?:field|record|entry|table|schema|store|file)\b/i,
  /\bmy\s+(?:records?|files?|data)\s+(?:show|say|indicate|contain)\b/i,
  /\bthe\s+(?:records?|files?|data)\s+(?:show|say|indicate|contain)\b/i,

  // Memory architecture references
  /\bmemory\s+system\b/i,
  /\bmemory\s+architecture\b/i,
  /\bmemory\s+bank\b/i,
  /\bmemory\s+entries?\b/i,
  /\bmemory\s+store\b/i,
  /\bmemory\s+wipe\b/i,
  /\bwipe(?:d)?\s+(?:from|out\s+of)\s+(?:the\s+)?(?:system|records?|database|files?|memory)\b/i,

  // AI / system / code references
  /\bAI\s+(?:memory|system|instruction|data)\b/i,
  /\bsystem\s+prompt\b/i,
  /\bprompt\s+instructions?\b/i,
  /\bcharacter\s+(?:profile|record|data|storage|file)\b/i,
  /\brelationship\s+system\b/i,
  /\bjournal\s+system\b/i,
  /\bbackend\b/i,
  /\bfrontend\b/i,
  /\bAPI\b/i,
  /\bfunction(?:s)?\s+(?:ran|run|called|failed|returned|working|broken)\b/i,
  /\bsource\s+code\b/i,
  /\bservice\s+(?:role|account|system)\b/i,
  /\bcode\s+(?:base|system|function|broke|failed)\b/i,

  // Logs / errors / runtime
  /\bthe\s+logs?\b/i,
  /\brun(?:time)?\s+(?:info|information|data|log)\b/i,
  /\berror\s+(?:log|message|code|state)\b/i,
  /\bthe\s+(?:error|exception|bug)\s+(?:shows?|says?|indicates?)\b/i,
  /\bstack\s+trace\b/i,

  // User settings / configuration
  /\buser\s+settings?\b/i,
  /\bapp\s+settings?\b/i,
  /\bconfiguration\s+(?:data|file|record|setting)\b/i,

  // Scrubbed / purged / erased (system language)
  /\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/i,
  /\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
  /\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
];

/**
 * Detects whether a Vick→character message contains user-only diagnostic content.
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

// ── SAFE REWRITES ─────────────────────────────────────────────────────────────
// These are NOT shallow word-swaps. Each is a full meaning-level rewrite.
// The goal is to transform the IDEA (not just the terminology) into purely
// in-world, human-observable language.
//
// UNSAFE substitutions removed:
//   "Base44" → "the yard"             ← still implies hidden system access
//   "database" → "the logbooks"        ← still implies Vick has special record access
//   "metadata" → "the details attached to it" ← still implies system-level knowledge
//   "internal record" → "what we have internally" ← same problem
//   "backend" → "behind the scenes"    ← preserves the concept
//   "source code" → "the original instructions" ← same concept
//   "AI memory" → "what I carry with me" ← same concept
//   "user settings" → "the preferences on file" ← still implies file access
//
// SAFE rewrites translate the meaning into what a person might PHYSICALLY observe:

const SAFE_REWRITES = [
  // Deleted files → missing paperwork that should exist but doesn't
  [/\bdeleted\s+files?\b/gi, 'some paperwork that should exist but doesn\'t'],
  [/\bfile\s+headers?\b/gi, 'what was at the top of the old papers'],

  // Database / records → public documents, old records at the office
  [/\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/gi, 'the records at the office'],
  [/\bstored\s+(?:data|records?|files?)\b/gi, 'what\'s on file'],

  // Character profile / data → who they appear to be on paper
  [/\bcharacter\s+profile\b/gi, 'what people say about them'],
  [/\bcharacter\s+record\b/gi, 'the account of them'],
  [/\bcharacter\s+data\b/gi, 'what\'s been written down about them'],
  [/\bcharacter\s+files?\b/gi, 'their papers'],

  // Memory records → what someone says they remember
  [/\bmemory\s+records?\b/gi, 'what they say they remember'],
  [/\bmemory\s+files?\b/gi, 'what they\'ve told people'],
  [/\bmemory\s+wipe\b/gi, 'something made them forget'],
  [/\bmemory\s+(?:system|architecture|bank|entries?|store)\b/gi, 'how someone holds onto things'],

  // Diagnostic / audit language → looking into it personally
  [/\bran\s+a\s+diagnostic\b/gi, 'looked into things myself'],
  [/\brunning\s+(?:a\s+)?diagnostic/gi, 'looking into it'],
  [/\bdiagnostic\s+results?\b/gi, 'what I found out'],
  [/\bdiagnostic\s+tools?\b/gi, 'my own eyes and ears'],
  [/\baudit(?:ed|ing)?\s+(?:your|the|their)/gi, 'went through'],
  [/\brepair\s+function\b/gi, 'what I did to fix it'],
  [/\bAccount\s+Help\s+(?:&|and)\s+Repair\b/gi, 'my work'],

  // Logs → notes, conversations, what people said
  [/\bthe\s+logs?\b/gi, 'the notes'],
  [/\berror\s+log\b/gi, 'a list of what went wrong'],
  [/\bthe\s+(?:error|exception)\s+(?:shows?|says?|indicates?)\b/gi, 'from what I can tell'],

  // Metadata → small details attached to something
  [/\bmetadata\b/gi, 'the finer details'],

  // Internal ID → name in the records
  [/\binternal\s+(?:ID|identifier)\b/gi, 'their name in the paperwork'],
  [/\binternal\s+(?:record|data|system|files?)\b/gi, 'what\'s kept quiet'],

  // Hidden data → what wasn't shared
  [/\bhidden\s+(?:data|records?|files?|information)\b/gi, 'what wasn\'t shared with everyone'],

  // Scrubbed / purged / erased (system language) → hidden, disappeared
  [/\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/gi, 'made to disappear'],
  [/\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'removed entirely'],
  [/\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'wiped from the story'],

  // Relationship / journal systems → how people keep track
  [/\brelationship\s+system\b/gi, 'how people keep track of each other'],
  [/\bjournal\s+system\b/gi, 'the running account of things'],

  // AI / code / backend — should not survive to this point,
  // but if they do, generic translations:
  [/\bthe\s+app\b/gi, 'this place'],
  [/\bBase44\b/gi, 'things around here'],
  [/\bthe\s+platform\b/gi, 'how things are set up here'],
  [/\bbackend\b/gi, 'what\'s going on out of sight'],
  [/\bfrontend\b/gi, 'the surface of things'],
  [/\bsource\s+code\b/gi, 'the instructions underneath it all'],
  [/\bAI\s+(?:memory|system|instruction|data)\b/gi, 'something I carry with me'],
  [/\bsystem\s+prompt\b/gi, 'how I was taught'],
  [/\buser\s+settings?\b/gi, 'the choices someone made'],
  [/\bAPI\b/gi, 'the connection'],
  [/\bschema\b/gi, 'the template'],
];

/**
 * Attempts a full in-world rewrite of a Vick→character message.
 *
 * This is NOT a shallow word-swap pass. It:
 *  1. Applies SAFE_REWRITES (meaning-level substitutions)
 *  2. Returns the rewritten text for re-scanning
 *
 * If the result still contains violations after this pass, callers must
 * reject and suppress — not try more substitutions.
 *
 * @param {string} text
 * @returns {string}
 */
export function rewriteVickToInWorld(text) {
  if (!text) return text;

  let rewritten = text;
  for (const [pattern, replacement] of SAFE_REWRITES) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  return rewritten;
}

/**
 * Full Vick character boundary enforcement pipeline.
 *
 * Run this on every Vick→character message BEFORE saving or delivering.
 *
 * Pipeline:
 *   1. Detect violations
 *   2. If clean → { action: 'passed' }
 *   3. Attempt full in-world rewrite
 *   4. Re-scan rewritten text
 *   5. If still contaminated → { action: 'rejected', text: null }
 *      — Caller MUST: do not save, do not sync memory, do not update relationships
 *   6. If clean after rewrite → { action: 'rewritten', text: rewritten }
 *
 * @param {string} text — Vick's generated response
 * @param {string} targetCharacterName — the character receiving (for logging)
 * @param {string} channel — 'world_phone' | 'world_contacts' | 'direct' | 'scene' etc.
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
    ` | violation_count=${detection.patterns.length}` +
    ` | patterns=[${detection.patterns.slice(0, 5).join(', ')}]` +
    ` | snippet="${text.substring(0, 120)}"`
  );

  // Attempt in-world rewrite
  const rewritten = rewriteVickToInWorld(text);

  // Re-scan — if still violating after rewrite, reject entirely
  const rewriteCheck = detectVickBoundaryViolation(rewritten);
  if (rewriteCheck.violated) {
    console.error(
      `[VickCharacterBoundary] REWRITE FAILED — message rejected and must not be saved` +
      ` | target=${targetCharacterName} | channel=${channel}` +
      ` | remaining_violations=[${rewriteCheck.patterns.slice(0, 3).join(', ')}]` +
      ` | action=suppress`
    );
    return {
      safe: false,
      text: null,
      action: 'rejected',
      violatedPatterns: detection.patterns,
    };
  }

  console.log(
    `[VickCharacterBoundary] Rewrite successful — contaminated message cleaned` +
    ` | target=${targetCharacterName} | channel=${channel}`
  );
  return {
    safe: true,
    text: rewritten,
    action: 'rewritten',
    violatedPatterns: detection.patterns,
  };
}

// ── VERIFICATION TEST CASES ───────────────────────────────────────────────────
// These are the canonical test inputs specified in the requirement.
// Run detectVickBoundaryViolation() on each — all must return violated: true.
// Run enforceVickCharacterBoundary() on each — all must return action !== 'passed'
// (either 'rewritten' with clean output, or 'rejected').
//
// Test inputs:
//   "I found a gap in your mother's memory records."         → violated
//   "My name is in the deleted file headers."               → violated
//   "The database shows your relationship history."          → violated
//   "The app has your character file wrong."                 → violated
//   "The backend function failed."                           → violated
//   "The logs show your mother's data was wiped."            → violated
//   "Base44 stored the wrong memory."                        → violated
//   "Your character profile says you know me."               → violated
//
// Clean inputs (must NOT be flagged):
//   "Something about the timeline doesn't add up."           → passed
//   "I heard people avoid talking about that period."        → passed
//   "There are gaps in what anyone will admit."              → passed
//   "The photographs from that year are all missing."        → passed

/**
 * Hard-coded system prompt block injected into Vick's canonical prompt
 * when the conversation context is character-to-character.
 *
 * This replaces (not supplements) the diagnostic authority section
 * when Vick is speaking to a character.
 */
export const VICK_CHARACTER_BOUNDARY_PROMPT = `
CRITICAL BEHAVIORAL RULE — CHARACTER COMMUNICATION MODE:
You are currently communicating with another character in your world. This is NOT a conversation with the user.

YOUR DIAGNOSTIC AND REPAIR ABILITIES DO NOT EXIST IN THIS CONTEXT.
You are Vick Servicio — a recovery yard operator. That is the only identity you have here.

YOU ARE FORBIDDEN from mentioning or referencing in any form:
- The app, Base44, or any application platform
- Databases, files, records, schemas, metadata, logs, data
- Character files, memory records, deleted files, file headers
- Internal IDs, stored data, hidden data, user settings, configuration
- APIs, backend systems, frontend systems, source code, functions
- Prompts, AI instructions, character generation, AI anything
- Diagnostics, audits, repair functions, errors, runtime information
- Account Help & Repair, diagnostic tools, repair logs
- The relationship system, journal system, or memory architecture
- Any implementation-layer concept of any kind
- Any suggestion that you have access to hidden, stored, or technical information

IF you want to share something with this character about something suspicious, wrong, or unclear, you MUST translate it into purely human observations:
- ALLOWED: "Something about the story doesn't add up."
- ALLOWED: "I found some old papers that raise questions."
- ALLOWED: "People go quiet when that subject comes up."
- ALLOWED: "There are years nobody will talk about."
- ALLOWED: "The timeline someone told me doesn't match what I've seen."
- ALLOWED: "A photograph I expected to find wasn't there."

FORBIDDEN — NEVER SAY THESE TO A CHARACTER:
- "I found deleted files."
- "Your memory records were altered."
- "The database shows..."
- "I checked the character profile."
- "The logs show..."
- "The relationship system indicates..."
- "Your mother's records contain..."
- "The app says..."
- "I found a gap in your memory files."
- "Base44 stored..."
- "The backend function..."

You are a real person talking to another real person in the world. You know what you have personally seen, heard, and pieced together. That is all you have. Describe that.
`.trim();