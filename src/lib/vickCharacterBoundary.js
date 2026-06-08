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

// ── SAFE REWRITE PHILOSOPHY ────────────────────────────────────────────────────
// Every replacement here must describe only what a real person could physically
// see, hear, or touch — or learn from a spoken account. Nothing implies Vick
// has access to hidden files, internal records, databases, or app mechanics.
// After rewrite, the full text is re-scanned. Any surviving forbidden term
// causes the message to be REJECTED — never saved, never delivered.

const SAFE_REWRITES = [
  // Deleted files → something missing that should be there
  [/\bdeleted\s+files?\b/gi, 'something that should have been there but wasn\'t'],
  [/\bfile\s+headers?\b/gi, 'old papers I came across'],

  // Database / stored records → what I found when looking into it
  [/\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/gi, 'what I found when I looked into it'],
  [/\bstored\s+(?:data|records?|files?)\b/gi, 'what\'s been documented'],

  // Character profile / data → what people say or what I\'ve gathered
  [/\bcharacter\s+profile\b/gi, 'what people say about them'],
  [/\bcharacter\s+record\b/gi, 'what I know about them'],
  [/\bcharacter\s+data\b/gi, 'what I\'ve gathered'],
  [/\bcharacter\s+files?\b/gi, 'what I found on them'],

  // Memory records → what someone claims to remember
  [/\bmemory\s+records?\b/gi, 'what they say they remember'],
  [/\bmemory\s+files?\b/gi, 'what they\'ve told people'],
  [/\bmemory\s+wipe\b/gi, 'someone deliberately made them forget'],
  [/\bmemory\s+(?:system|architecture|bank|entries?|store)\b/gi, 'how they carry things with them'],

  // Diagnostic / audit language → personal investigation
  [/\bran\s+a\s+diagnostic\b/gi, 'looked into it myself'],
  [/\brunning\s+(?:a\s+)?diagnostic/gi, 'looking into it'],
  [/\bdiagnostic\s+results?\b/gi, 'what I found'],
  [/\bdiagnostic\s+tools?\b/gi, 'my own judgment'],
  [/\baudit(?:ed|ing)?\s+(?:your|the|their)/gi, 'went through'],
  [/\brepair\s+function\b/gi, 'what I did to sort it out'],
  [/\bAccount\s+Help\s+(?:&|and)\s+Repair\b/gi, 'the work I do'],

  // Logs → a trail of what happened
  [/\bthe\s+logs?\b/gi, 'a trail of what happened'],
  [/\berror\s+log\b/gi, 'a list of things that went wrong'],
  [/\bthe\s+(?:error|exception)\s+(?:shows?|says?|indicates?)\b/gi, 'from what I could piece together'],

  // Metadata → incidental details that don\'t add up
  [/\bmetadata\b/gi, 'small details that don\'t add up'],

  // Internal ID / records → a name or reference I found
  [/\binternal\s+(?:ID|identifier)\b/gi, 'a name I found in the paperwork'],
  [/\binternal\s+(?:record|data|system|files?)\b/gi, 'something that wasn\'t meant to be seen'],

  // Hidden data → information kept from people
  [/\bhidden\s+(?:data|records?|files?|information)\b/gi, 'information people were kept from'],

  // Scrubbed / purged / erased → made to disappear
  [/\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/gi, 'made to disappear entirely'],
  [/\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'removed from the picture'],
  [/\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'wiped from the story'],

  // Relationship / journal systems → how things between people work
  [/\brelationship\s+system\b/gi, 'how two people relate to each other'],
  [/\bjournal\s+system\b/gi, 'the running history between people'],

  // App / platform / software — all become neutral in-world references
  // NOTE: replacements are intentionally non-specific. After rewrite the full output
  // is re-scanned — any surviving forbidden term causes rejection, not delivery.
  [/\bthe\s+app\b/gi, 'around here'],
  [/\bBase44\b/gi, 'this place'],
  [/\bthe\s+platform\b/gi, 'how things operate here'],
  [/\bbackend\b/gi, 'what goes on behind the scenes'],
  [/\bfrontend\b/gi, 'what\'s visible to everyone'],
  [/\bsource\s+code\b/gi, 'how things were originally set up'],
  [/\bAI\s+(?:memory|system|instruction|data)\b/gi, 'how I think through things'],
  [/\bsystem\s+prompt\b/gi, 'how I was shaped to think'],
  [/\buser\s+settings?\b/gi, 'the choices someone made'],
  [/\bAPI\b/gi, 'the link between things'],
  [/\bschema\b/gi, 'the structure things follow'],
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