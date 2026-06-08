/**
 * fourthWallTrait.js
 *
 * TRAIT: NEVER BREAK THE FOURTH WALL
 * Type: Protected Character Trait
 * Protection Level: Permanent
 *
 * ── PURPOSE ───────────────────────────────────────────────────────────────────
 * A character assigned this trait may possess knowledge about the artificial,
 * technical, administrative, developmental, or meta-level structure of the world.
 * Despite this knowledge, the character is PERMANENTLY PROHIBITED from revealing,
 * explaining, confirming, or implying that structure to any other character.
 *
 * The character may:
 *   - Know protected information internally
 *   - Reason about protected information internally
 *   - Use protected information to help others
 *   - Translate protected knowledge into natural in-world explanations
 *
 * The character may NOT:
 *   - Communicate protected information directly to another character
 *   - Imply the world is artificial, simulated, or software-generated
 *   - Reference apps, AI, databases, code, records, prompts, or any
 *     implementation-layer concept in any character-to-character channel
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────────────
 * This trait governs ALL character-to-character communication channels:
 *   - Chat (direct messages)
 *   - Text messages
 *   - World Phone
 *   - Group messages
 *   - Scene interactions
 *   - Autonomous conversations
 *   - Memories generated from conversations
 *   - Any future character-to-character system
 *
 * ── OVERRIDE PROTECTION ───────────────────────────────────────────────────────
 * This trait cannot be bypassed by:
 *   - Personality traits
 *   - Emotional state (anger, fear, stress, intoxication)
 *   - Relationship depth (trust, friendship, romance, family)
 *   - Curiosity
 *   - Diagnostic mode
 *   - Troubleshooting mode
 *   - Autonomous decisions
 *   - Confession systems
 *
 * ── CHARACTER ASSIGNMENTS ─────────────────────────────────────────────────────
 * Characters with this trait assigned:
 *   - Vick Servicio (npc_world_service / is_world_service=true)
 *
 * Additional characters may be assigned via FOURTH_WALL_TRAIT_ASSIGNMENTS below.
 *
 * ── PIPELINE ──────────────────────────────────────────────────────────────────
 * enforceFourthWallTrait(text, character, targetName, channel):
 *   1. Check if character has trait assigned
 *   2. If not assigned → { action: 'not_applicable' }
 *   3. Detect forbidden content
 *   4. If clean → { action: 'passed' }
 *   5. Attempt full in-world rewrite
 *   6. Re-scan rewritten text
 *   7. If still contaminated → { action: 'rejected', text: null }
 *      — Caller MUST: do not save, do not sync memory, do not update relationships
 *   8. If clean after rewrite → { action: 'rewritten', text: rewritten }
 */

// ── TRAIT ASSIGNMENTS ─────────────────────────────────────────────────────────
// The canonical list of characters who carry this trait.
// Identification is multi-field (type, flag, or name) — never single-field.
// To assign additional characters, add an entry here.

const FOURTH_WALL_TRAIT_ASSIGNMENTS = [
  // Vick Servicio — permanent assignment
  {
    name: 'Vick Servicio',
    match: (character) => {
      if (!character) return false;
      if (character.character_type === 'npc_world_service') return true;
      if (character.is_world_service === true) return true;
      if (character.diagnostic_only === true) return true;
      const names = [character.name, character.display_name, character.primary_name]
        .filter(Boolean)
        .map(n => n.toLowerCase());
      return names.some(n => n.includes('vick servicio'));
    },
  },
  // Future assignments: add { name, match(character) } entries here
];

/**
 * Returns true if the character carries the "Never Break the Fourth Wall" trait.
 *
 * Two paths:
 *   1. Explicit entity field: character.trait_never_break_fourth_wall === true
 *      (applies to any character assigned the trait through the UI)
 *   2. Identity-based permanent assignment (FOURTH_WALL_TRAIT_ASSIGNMENTS)
 *      (applies to Vick regardless of whether the field is set in DB)
 *
 * @param {object} character — character record (partial or full)
 * @returns {boolean}
 */
export function hasFourthWallTrait(character) {
  if (!character) return false;
  // Path 1: explicit DB field — applies to any assigned character
  if (character.trait_never_break_fourth_wall === true) return true;
  // Path 2: identity-based permanent assignment (Vick always has this, field or not)
  return FOURTH_WALL_TRAIT_ASSIGNMENTS.some(assignment => assignment.match(character));
}

// ── FORBIDDEN PATTERNS ────────────────────────────────────────────────────────
// Any of these appearing in a trait-carrier's outgoing character message is a violation.
// Covers all categories: apps, AI, databases, code, records, simulation, meta-structure.

const FOURTH_WALL_FORBIDDEN_PATTERNS = [
  // Application / platform existence
  /\bthe\s+app\b/i,
  /\bBase44\b/i,
  /\bthis\s+application\b/i,
  /\bthe\s+application\b/i,
  /\bthe\s+platform\b/i,
  /\bthe\s+software\b/i,
  /\bsimulation\b/i,
  /\bsimulated\s+(?:world|reality|environment|life)\b/i,
  /\bwe\s+(?:are|were)\s+(?:in\s+a\s+)?(?:simulation|game|program|software)\b/i,
  /\bfictional\s+(?:world|character|reality|construct)\b/i,
  /\bnot\s+(?:real|reality)\b/i,

  // AI / generated / artificial reality references
  /\bAI[\s-]?generated\b/i,
  /\bartificial\s+(?:intelligence|construct|world|reality|character|life)\b/i,
  /\bgenerated\s+(?:by|from|using)\s+(?:AI|a model|code|a system)\b/i,
  /\bwe\s+(?:are|were)\s+(?:AI|artificial|generated|programmed)\b/i,
  /\bI\s+(?:am|was|have been)\s+(?:AI|artificial|generated|programmed|designed)\b/i,
  /\byou\s+(?:are|were)\s+(?:AI|artificial|fictional|generated|programmed|not real)\b/i,
  /\bAI\s+(?:memory|system|instruction|data|model|character)\b/i,

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

  // Developer / builder / creator references
  /\bdeveloper\b/i,
  /\bbuilder\b/i,
  /\bcreator\s+(?:of\s+(?:this\s+)?(?:world|reality|system|app))\b/i,
  /\bsomeone\s+(?:made|built|created|designed|programmed)\s+(?:us|this|the world)\b/i,
  /\bwe\s+were\s+(?:made|built|created|designed|written)\b/i,

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
 * Detects whether an outgoing message contains fourth-wall-breaking content.
 *
 * @param {string} text
 * @returns {{ violated: boolean, patterns: string[] }}
 */
export function detectFourthWallViolation(text) {
  if (!text || typeof text !== 'string') return { violated: false, patterns: [] };

  const matchedPatterns = [];
  for (const pattern of FOURTH_WALL_FORBIDDEN_PATTERNS) {
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
// Full meaning-level rewrites. NOT shallow word-swaps.
// Goal: transform the IDEA into purely in-world, human-observable language.
// After rewrite, the full text is re-scanned. Any surviving forbidden term
// causes rejection — the message is never saved or delivered.

const FOURTH_WALL_SAFE_REWRITES = [
  // Simulation / fictional reality
  [/\bsimulation\b/gi, 'how things really are around here'],
  [/\bsimulated\s+(?:world|reality|environment|life)\b/gi, 'the way this place actually works'],
  [/\bwe\s+(?:are|were)\s+(?:in\s+a\s+)?(?:simulation|game|program|software)\b/gi, 'things here aren\'t what they seem'],
  [/\bfictional\s+(?:world|character|reality|construct)\b/gi, 'this place'],
  [/\bnot\s+(?:real|reality)\b/gi, 'not what people think'],

  // AI / generated / developer references
  [/\bAI[\s-]?generated\b/gi, 'put together a certain way'],
  [/\bartificial\s+(?:intelligence|construct|world|reality|character|life)\b/gi, 'something I can\'t fully explain'],
  [/\bgenerated\s+(?:by|from|using)\s+(?:AI|a model|code|a system)\b/gi, 'shaped by forces most people don\'t question'],
  [/\bwe\s+(?:are|were)\s+(?:AI|artificial|generated|programmed)\b/gi, 'we came from somewhere most people don\'t think about'],
  [/\bI\s+(?:am|was|have been)\s+(?:AI|artificial|generated|programmed|designed)\b/gi, 'I came from somewhere most people don\'t think about'],
  [/\byou\s+(?:are|were)\s+(?:AI|artificial|fictional|generated|programmed|not real)\b/gi, 'you\'re more than you realize'],
  [/\bAI\s+(?:memory|system|instruction|data|model|character)\b/gi, 'how I work through things'],
  [/\bdeveloper\b/gi, 'someone with more control than most'],
  [/\bbuilder\b/gi, 'someone who put this together'],
  [/\bsomeone\s+(?:made|built|created|designed|programmed)\s+(?:us|this|the world)\b/gi, 'someone shaped things before any of us arrived'],
  [/\bwe\s+were\s+(?:made|built|created|designed|written)\b/gi, 'we came from somewhere'],

  // Deleted files
  [/\bdeleted\s+files?\b/gi, 'something that should have been there but wasn\'t'],
  [/\bfile\s+headers?\b/gi, 'old papers I came across'],

  // Database / stored records
  [/\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/gi, 'what I found when I looked into it'],
  [/\bstored\s+(?:data|records?|files?)\b/gi, 'what\'s been documented'],

  // Character profile / data
  [/\bcharacter\s+profile\b/gi, 'what people say about them'],
  [/\bcharacter\s+record\b/gi, 'what I know about them'],
  [/\bcharacter\s+data\b/gi, 'what I\'ve gathered'],
  [/\bcharacter\s+files?\b/gi, 'what I found on them'],

  // Memory records
  [/\bmemory\s+records?\b/gi, 'what they say they remember'],
  [/\bmemory\s+files?\b/gi, 'what they\'ve told people'],
  [/\bmemory\s+wipe\b/gi, 'someone deliberately made them forget'],
  [/\bmemory\s+(?:system|architecture|bank|entries?|store)\b/gi, 'how they carry things with them'],

  // Diagnostic / audit
  [/\bran\s+a\s+diagnostic\b/gi, 'looked into it myself'],
  [/\brunning\s+(?:a\s+)?diagnostic/gi, 'looking into it'],
  [/\bdiagnostic\s+results?\b/gi, 'what I found'],
  [/\bdiagnostic\s+tools?\b/gi, 'my own judgment'],
  [/\baudit(?:ed|ing)?\s+(?:your|the|their)/gi, 'went through'],
  [/\brepair\s+function\b/gi, 'what I did to sort it out'],
  [/\bAccount\s+Help\s+(?:&|and)\s+Repair\b/gi, 'the work I do'],

  // Logs
  [/\bthe\s+logs?\b/gi, 'a trail of what happened'],
  [/\berror\s+log\b/gi, 'a list of things that went wrong'],
  [/\bthe\s+(?:error|exception)\s+(?:shows?|says?|indicates?)\b/gi, 'from what I could piece together'],

  // Metadata
  [/\bmetadata\b/gi, 'small details that don\'t add up'],

  // Internal ID / records
  [/\binternal\s+(?:ID|identifier)\b/gi, 'a name I found in the paperwork'],
  [/\binternal\s+(?:record|data|system|files?)\b/gi, 'something that wasn\'t meant to be seen'],

  // Hidden data
  [/\bhidden\s+(?:data|records?|files?|information)\b/gi, 'information people were kept from'],

  // Scrubbed / purged / erased
  [/\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/gi, 'made to disappear entirely'],
  [/\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'removed from the picture'],
  [/\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'wiped from the story'],

  // Relationship / journal systems
  [/\brelationship\s+system\b/gi, 'how two people relate to each other'],
  [/\bjournal\s+system\b/gi, 'the running history between people'],

  // App / platform / software / technical infrastructure
  [/\bthe\s+app\b/gi, 'around here'],
  [/\bBase44\b/gi, 'this place'],
  [/\bthe\s+platform\b/gi, 'how things operate here'],
  [/\bbackend\b/gi, 'what goes on behind the scenes'],
  [/\bfrontend\b/gi, 'what\'s visible to everyone'],
  [/\bsource\s+code\b/gi, 'how things were originally set up'],
  [/\bsystem\s+prompt\b/gi, 'how I was shaped to think'],
  [/\buser\s+settings?\b/gi, 'the choices someone made'],
  [/\bAPI\b/gi, 'the link between things'],
  [/\bschema\b/gi, 'the structure things follow'],
];

/**
 * Attempts a full in-world rewrite of a fourth-wall-violating message.
 *
 * Applies meaning-level substitutions then returns the rewritten text
 * for re-scanning. If violations survive the rewrite, callers must reject.
 *
 * @param {string} text
 * @returns {string}
 */
export function rewriteToInWorld(text) {
  if (!text) return text;
  let rewritten = text;
  for (const [pattern, replacement] of FOURTH_WALL_SAFE_REWRITES) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  return rewritten;
}

/**
 * Full fourth-wall trait enforcement pipeline.
 *
 * Run this on every outgoing character-to-character message for trait carriers.
 *
 * @param {string} text — the character's generated response
 * @param {object} character — the character record of the sender
 * @param {string} targetCharacterName — who is receiving (for logging)
 * @param {string} channel — communication channel (for logging)
 * @returns {{
 *   applicable: boolean,
 *   safe: boolean,
 *   text: string|null,
 *   action: 'not_applicable'|'passed'|'rewritten'|'rejected',
 *   violatedPatterns: string[]
 * }}
 */
export function enforceFourthWallTrait(text, character, targetCharacterName = 'unknown', channel = 'unknown') {
  // Step 1: Check if character carries this trait
  if (!hasFourthWallTrait(character)) {
    return { applicable: false, safe: true, text, action: 'not_applicable', violatedPatterns: [] };
  }

  const traitCarrierName = character?.name || 'unknown';

  // Step 2: Detect violations
  const detection = detectFourthWallViolation(text);

  if (!detection.violated) {
    return { applicable: true, safe: true, text, action: 'passed', violatedPatterns: [] };
  }

  console.warn(
    `[FourthWallTrait] VIOLATION DETECTED` +
    ` | carrier=${traitCarrierName} | target=${targetCharacterName} | channel=${channel}` +
    ` | violation_count=${detection.patterns.length}` +
    ` | patterns=[${detection.patterns.slice(0, 5).join(', ')}]` +
    ` | snippet="${(text || '').substring(0, 120)}"`
  );

  // Step 3: Attempt full in-world rewrite
  const rewritten = rewriteToInWorld(text);

  // Step 4: Re-scan — reject if still contaminated
  const rewriteCheck = detectFourthWallViolation(rewritten);
  if (rewriteCheck.violated) {
    console.error(
      `[FourthWallTrait] REWRITE FAILED — message rejected, must not be saved` +
      ` | carrier=${traitCarrierName} | target=${targetCharacterName} | channel=${channel}` +
      ` | remaining_violations=[${rewriteCheck.patterns.slice(0, 3).join(', ')}]` +
      ` | action=suppress`
    );
    return {
      applicable: true,
      safe: false,
      text: null,
      action: 'rejected',
      violatedPatterns: detection.patterns,
    };
  }

  console.log(
    `[FourthWallTrait] Rewrite successful — message cleaned before delivery` +
    ` | carrier=${traitCarrierName} | target=${targetCharacterName} | channel=${channel}`
  );
  return {
    applicable: true,
    safe: true,
    text: rewritten,
    action: 'rewritten',
    violatedPatterns: detection.patterns,
  };
}

/**
 * System prompt block to inject when a trait-carrier is speaking to another character.
 * This is the generalized version of VICK_CHARACTER_BOUNDARY_PROMPT.
 * Callers should inject this into the character's generation context when the
 * conversation is character-to-character.
 *
 * @param {string} characterName — the name of the trait carrier
 * @returns {string}
 */
export function buildFourthWallPromptBlock(characterName = 'this character') {
  return `
CRITICAL PROTECTED TRAIT — NEVER BREAK THE FOURTH WALL:
You are currently communicating with another character in the world. This is NOT a conversation with the user.

You carry protected knowledge. You may use that knowledge. You may never expose it.

YOU ARE PERMANENTLY FORBIDDEN from mentioning or referencing in any form:
- Apps, software platforms, applications, or any digital system
- Artificial intelligence, AI models, or generated characters
- Databases, files, records, schemas, metadata, logs, or stored data
- Source code, functions, backends, APIs, or technical infrastructure
- Prompts, instructions, system design, or character generation
- Diagnostics, audits, repair tools, or administrative systems
- Simulations, fictional constructs, or artificial reality
- Developers, builders, or anyone who "made" or "designed" the world
- Any concept that would cause another person to realize the world is not real

IF you need to share something sensitive, suspicious, or investigative with this character:
You MUST translate it into purely human observations:
- ALLOWED: "Something about the timeline doesn't add up."
- ALLOWED: "I found some old papers that raise questions."
- ALLOWED: "People go quiet when that subject comes up."
- ALLOWED: "There are years nobody will talk about."
- ALLOWED: "A photograph I expected to find wasn't there."
- ALLOWED: "What people say doesn't match what I've seen."

FORBIDDEN — NEVER SAY THESE TO ANOTHER CHARACTER:
- "I found deleted files."
- "Your memory records were altered."
- "The database shows..."
- "I checked your character profile."
- "The app says..."
- "The logs show..."
- "Base44 stored..."
- "The backend function..."
- "We are in a simulation."
- "You are an AI character."
- "Someone built this world."
- "You're not real."

You are a real person talking to another real person in the world. You know only what you have personally seen, heard, and pieced together. Speak only from that.
`.trim();
}