/**
 * chatImageSubjectResolver.js
 *
 * Subject-aware character name resolution for chat-triggered image prompts.
 *
 * PURPOSE:
 * When a character generates an image prompt from chat, this module determines
 * which characters (if any) are VISUAL SUBJECTS of the image — not just mentioned.
 *
 * RESOLUTION STATES (returned as `resolutionState`):
 *   'resolved'          — Named characters were found and identity-resolved
 *   'sender_self'       — Sender is the subject (selfie / no named request)
 *   'inanimate'         — Room/object/place — no character injection
 *   'unresolved_named'  — Prompt requested a named person but no roster match found
 *   'ambiguous_named'   — Prompt requested a name that matched multiple roster characters
 *
 * RULES:
 * - Full name match is preferred over first-name match
 * - First-name match only allowed if unique across active roster
 * - Deleted/soft-deleted characters are excluded
 * - The sender (Character A) is only included when the prompt explicitly signals their presence
 * - Ambiguous or unresolved named subjects BLOCK image generation — no silent fallback to sender
 */

/**
 * Patterns that indicate the sender character IS visually present in the image.
 * "selfie", "me", "us together", etc.
 */
const SENDER_PRESENT_PATTERNS = [
  /\bselfie\b/i,
  /\bself.?portrait\b/i,
  /\bpic(ture)? of (me|us|myself)\b/i,
  /\bphoto of (me|us|myself)\b/i,
  /\b(me and|myself and|us together|together with me)\b/i,
  /\b(i|me)\b.{0,30}\b(in|inside|at|with|standing|sitting|lying|holding|eating|wearing)\b/i,
];

/**
 * Patterns that indicate the image contains ONLY the named character(s), not the sender.
 * "send me a picture of X", "show me X", "pic of X", etc.
 */
const THIRD_PARTY_SUBJECT_PATTERNS = [
  /\b(send|show|give|share|post).{0,20}(pic|photo|picture|image|selfie|shot)\s+(of|showing)\s+/i,
  /\b(pic|photo|picture|image)\s+of\s+/i,
  /\bwhat (does|did)\s+.{0,40}\s+(look|looked) like\b/i,
  /\b(show me|send me|give me|share)\s+.{0,20}\b(pic|photo|picture)\b/i,
];

/**
 * Patterns indicating a room, object, place, or inanimate subject — no characters.
 *
 * CRITICAL: These must be INTENT-specific — requiring explicit "photo/picture OF [place]" phrasing.
 * DO NOT use bare noun phrases like "the room" or "the space" — these appear in normal character
 * scene prompts ("looking out into the room", "sitting in the space") and would wrongly classify
 * character scenes as inanimate, causing characterId to be set to null and identity to be lost.
 */
const INANIMATE_SUBJECT_PATTERNS = [
  // "picture/photo/image of the bedroom" — explicit photo-of-room request
  /\b(picture|photo|image|pic)\s+of\s+(the|your|his|her|my)\s+(room|bedroom|kitchen|living room|bathroom|office|house|apartment|place|car|desk|view|window|closet|setup)\b/i,
  // "picture of an object/scene/area" — explicit inanimate subject request
  /\bpicture?\s+of\s+(a|an|the)\s+(object|item|thing|place|location|view|scene|room|space|area)\b/i,
  // "show me the room / send me the kitchen" — direct room request without character
  /\b(show me|send me|give me)\s+(a|an|the)\s+(room|kitchen|bedroom|view|scene|place|location)\b/i,
  // "your place / your apartment / your house / your room / your view" ONLY as a standalone photo request
  // Requires explicit photo/show/send signal before it — not just the phrase in passing
  /\b(send|show|give|share|post)\s+.{0,30}\b(your place|your apartment|your house|your room|your view)\b/i,
];

/**
 * Patterns that signal the prompt is requesting a NAMED person.
 * Used to distinguish "no roster match for named request" from "no named request at all".
 */
const NAMED_PERSON_REQUEST_PATTERNS = [
  /\b(send|show|give|share|post).{0,20}(pic|photo|picture|image|selfie|shot)\s+(of|showing)\s+[A-Z][a-z]/i,
  /\b(pic|photo|picture|image)\s+of\s+[A-Z][a-z]/i,
  /\bwhat (does|did)\s+[A-Z][a-z].{0,30}\s+(look|looked) like\b/i,
  /\b(show|send|give)\s+.{0,10}(pic|photo|picture)\s+(of|showing)\s+[A-Z][a-z]/i,
  // "send me a picture of them/her/him" — references a named person indirectly
  /\b(pic|photo|picture|image)\s+of\s+(him|her|them|this person|that person)\b/i,
];

/**
 * Determine whether the image prompt is requesting a room/object/inanimate scene.
 */
function isInanimateSubjectPrompt(prompt) {
  const lower = prompt.toLowerCase();
  return INANIMATE_SUBJECT_PATTERNS.some(p => p.test(lower));
}

/**
 * Determine whether the sender character should be present in the image.
 */
function doesPromptIncludeSender(prompt) {
  const lower = prompt.toLowerCase();
  if (THIRD_PARTY_SUBJECT_PATTERNS.some(p => p.test(lower))) return false;
  return SENDER_PRESENT_PATTERNS.some(p => p.test(lower));
}

/**
 * Determine whether the prompt appears to be requesting a NAMED person
 * (even if that person wasn't found on the roster).
 */
function doesPromptRequestNamedPerson(prompt) {
  return NAMED_PERSON_REQUEST_PATTERNS.some(p => p.test(prompt));
}

/**
 * RELATIONSHIP TITLES / FORMS OF ADDRESS — FORBIDDEN AS IDENTITY ANCHORS
 *
 * These words describe a relationship role (family, romantic, or form-of-address),
 * NOT an authoritative identity. Every person can be someone's child. Many people
 * can be someone's mother, father, son, or daughter. These words do NOT uniquely
 * identify a character.
 *
 * They may remain valid in dialogue and relationship context, but they must NEVER
 * be used to identify the visual subject of an image. A relationship title may
 * only resolve a person when: (1) speaker/subject context is known, (2) a
 * relationship edge exists in the app, (3) the relationship role points to a
 * specific represented character, and (4) the resolved character does not
 * contradict an explicit name already present in the prompt.
 *
 * Example: "Vick said 'my son'" may resolve to Ethan ONLY because the system
 * knows Vick is Ethan's father. But "son" by itself must not resolve to anyone.
 */
const FORBIDDEN_IDENTITY_TITLES = new Set([
  // Family roles
  'son', 'daughter', 'child', 'children', 'kid', 'kids', 'baby', 'babies',
  'dad', 'daddy', 'father', 'pa', 'papa', 'pop', 'stepdad', 'stepfather',
  'mom', 'mommy', 'mother', 'ma', 'mama', 'mum', 'mummy', 'stepmom', 'stepmother',
  'brother', 'bro', 'sis', 'sister', 'stepbrother', 'stepsister', 'sibling',
  'uncle', 'aunt', 'cousin', 'nephew', 'niece', 'grandpa', 'granddad',
  'grandfather', 'grandma', 'grandmom', 'grandmother', 'grandparent',
  'grandson', 'granddaughter', 'inlaw', 'inlaws', 'stepson', 'stepdaughter',
  // Romantic / partnership roles
  'husband', 'wife', 'spouse', 'partner', 'boyfriend', 'girlfriend',
  'fiance', 'fiancee', 'beloved',
  // Generic forms of address / terms of endearment
  'babe', 'baby', 'honey', 'honeybear', 'hon', 'sweetheart', 'sweetie',
  'sweet', 'darling', 'dear', 'love', 'lover', 'boo', 'bby',
  // Generic references
  'parent', 'parents', 'family', 'relative', 'relative',
]);

/**
 * Returns true if a name form is a forbidden relationship title / form of address.
 * These must never serve as standalone identity anchors for image subject resolution.
 */
function isForbiddenIdentityTitle(form) {
  if (!form) return true;
  const normalized = form.toLowerCase().trim();
  // Exact match against the forbidden set
  if (FORBIDDEN_IDENTITY_TITLES.has(normalized)) return true;
  // Also reject plural / possessive variants ("son's", "babies", "mom's")
  const stripped = normalized.replace(/[''\u2019]s$/i, '').replace(/s$/i, '');
  if (FORBIDDEN_IDENTITY_TITLES.has(stripped)) return true;
  return false;
}

/**
 * Resolve the authenticated user as a visual subject from a prompt.
 *
 * Checks whether any of the user's known name forms (world_name, full_name, aliases)
 * appear in the prompt text. This covers [JOINT], secondary subjects, and non-leading
 * mentions — not just [CHARACTER] tokens.
 *
 * CRITICAL: Relationship titles / forms of address (son, daughter, dad, mom, baby,
 * babe, honey, etc.) are NEVER used as identity anchors here, even if they appear in
 * the user's aliases. These words describe a relationship role, not a unique identity.
 * A named subject in the prompt always wins over any relationship/title term.
 *
 * Returns the user's world_name if matched, null otherwise.
 *
 * @param {string} prompt
 * @param {object|null} resolvedUser  - Output of resolveAuthenticatedUser(), or raw user+settings bundle
 * @returns {{ matched: boolean, worldName: string|null, matchedForm: string|null }}
 */
export function resolveUserParticipantInPrompt(prompt, resolvedUser) {
  if (!prompt || !resolvedUser) return { matched: false, worldName: null, matchedForm: null };

  const promptLower = prompt.toLowerCase();

  // Build the full set of name forms to check — order: world_name > full_name > aliases
  const worldName = resolvedUser.world_name || resolvedUser.fictional_world_name || resolvedUser.full_name || null;
  const fullName = resolvedUser.full_name || null;
  // aliases from UserSettings (user_aliases array) or _source_settings
  const aliases = resolvedUser.aliases
    || resolvedUser._source_settings?.user_aliases
    || [];

  // Assemble all candidate identity forms, then FILTER OUT forbidden relationship
  // titles / forms of address. "son" is not a name — it's a relationship role.
  const rawForms = [worldName, fullName, ...aliases].filter(Boolean);
  const nameForms = rawForms.filter(form => !isForbiddenIdentityTitle(form));

  // Deduplicate, case-insensitive
  const seen = new Set();
  const uniqueForms = nameForms.filter(n => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const form of uniqueForms) {
    const formLower = form.toLowerCase();
    // Require at least 3 chars to avoid spurious single-letter matches
    if (formLower.length < 3) continue;
    // WORD-BOUNDARY MATCHING — prevents short aliases from matching as substrings
    // of longer words. Example: alias "son" must NOT match inside "Thompson".
    // Uses \b word boundary so "son" only matches standalone "son", not "Thompson".
    // Escapes regex special characters in the name form.
    const escaped = formLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (wordBoundaryRegex.test(prompt)) {
      return { matched: true, worldName, matchedForm: form };
    }
  }

  return { matched: false, worldName, matchedForm: null };
}

/**
 * VISUAL-PRESENCE GATING — Conversation Topic Must Not Override Prompt Subject
 *
 * A character name appearing in the prompt is NOT automatically a visual subject.
 * The name may be a CONVERSATION TOPIC ("Ethan thinking about Victor", "Ethan
 * remembers what his father said") — mentioning a person is not the same as
 * placing them in the scene.
 *
 * Only resolve a named character as an additional visual subject when the prompt
 * EXPLICITLY places them in the scene via a visual-presence signal:
 *   - "and Name" / "Name and" (co-presence)
 *   - "with Name" / "Name with" (co-presence)
 *   - "together with Name"
 *   - "me and Name" / "Name and me"
 *   - "Name is sitting/standing/here/in the" (explicit position)
 *   - "Name sits/stands/sitting/standing" (explicit position)
 *
 * This prevents conversation-topic characters (father, father figure, dad, Victor)
 * from being resolved as additional visual subjects and having their reference
 * images injected — which causes the image model to render them instead of the
 * prompt subject.
 */
function hasVisualPresenceSignal(prompt, name) {
  if (!prompt || !name) return false;
  const firstName = name.split(/\s+/)[0];
  if (!firstName || firstName.length < 2) return false;
  const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\band\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+and\\b`, 'i'),
    new RegExp(`\\bwith\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+with\\b`, 'i'),
    new RegExp(`\\btogether with\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\bme and\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+and me\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+(is|are)\\s+(sitting|standing|here|in|next|beside|lying|leaning|present)\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+(sits|stands|sitting|standing|lying|leaning)\\b`, 'i'),
    // Spatial co-presence prepositions — name is physically present in the scene
    new RegExp(`\\b(next to|beside|behind|in front of|across from|near)\\s+${escaped}\\b`, 'i'),
  ];
  return patterns.some(p => p.test(prompt));
}

/**
 * Extract character names that appear in a visual-subject position in the prompt.
 *
 * VISUAL-PRESENCE GATE: A name is only resolved as an additional visual subject
 * when the prompt EXPLICITLY places that person in the scene (visual-presence
 * signal). Conversation-topic mentions do NOT create visual subjects.
 *
 * @param {string} prompt
 * @param {Array} allChars
 * @param {string} senderCharacterId
 * @returns {{ subjects: Character[], ambiguous: string[], log: string[] }}
 */
function resolveSubjectCharactersFromPrompt(prompt, allChars, senderCharacterId) {
  const log = [];
  const ambiguous = [];
  const matchedIds = new Set();
  const subjects = [];

  if (!prompt || !allChars?.length) return { subjects, ambiguous, log };

  const promptLower = prompt.toLowerCase();

  // Filter to active characters only, excluding sender
  const activeRoster = allChars.filter(c =>
    c.name &&
    c.id !== senderCharacterId &&
    c.status !== 'deleted' &&
    c.status !== 'soft_deleted' &&
    c.status !== 'merged'
  );

  // Sort by name length descending — prefer more specific/longer matches first
  const sortedRoster = [...activeRoster].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

  // Build first-name frequency map to detect ambiguity
  const firstNameCount = {};
  for (const c of activeRoster) {
    const firstName = c.name.split(/\s+/)[0].toLowerCase();
    firstNameCount[firstName] = (firstNameCount[firstName] || 0) + 1;
  }

  // Phase 1: Full name match — gated by visual-presence signal
  for (const c of sortedRoster) {
    if (matchedIds.has(c.id)) continue;
    const fullNameLower = c.name.toLowerCase();
    if (promptLower.includes(fullNameLower)) {
      // VISUAL-PRESENCE GATE: only resolve as a visual subject when the prompt
      // explicitly places this person in the scene. Conversation-topic mentions
      // ("thinking about Name", "remembers Name") do NOT create visual subjects.
      if (!hasVisualPresenceSignal(prompt, c.name)) {
        log.push(`[SubjectResolver] Full-name match "${c.name}" SKIPPED — no visual-presence signal (conversation topic, not in scene)`);
        continue;
      }
      matchedIds.add(c.id);
      subjects.push(c);
      log.push(`[SubjectResolver] Full-name match (visual-presence): "${c.name}" (id=${c.id})`);
    }
  }

  // Phase 2: First-name match (only if unique, only if ≥4 chars, not already matched)
  // Also gated by visual-presence signal.
  for (const c of sortedRoster) {
    if (matchedIds.has(c.id)) continue;
    const firstName = c.name.split(/\s+/)[0].toLowerCase();
    if (firstName.length < 4) continue;
    if (!promptLower.includes(firstName)) continue;

    const count = firstNameCount[firstName] || 0;
    if (count > 1) {
      if (!ambiguous.includes(firstName)) {
        ambiguous.push(firstName);
        log.push(`[SubjectResolver] ⚠️ Ambiguous first-name "${firstName}" (${count} matches) — excluded from subjects`);
      }
    } else {
      if (!hasVisualPresenceSignal(prompt, c.name)) {
        log.push(`[SubjectResolver] First-name match "${firstName}" SKIPPED — no visual-presence signal (conversation topic, not in scene)`);
        continue;
      }
      matchedIds.add(c.id);
      subjects.push(c);
      log.push(`[SubjectResolver] First-name match (unique, visual-presence): "${c.name}" via "${firstName}" (id=${c.id})`);
    }
  }

  return { subjects, ambiguous, log };
}

/**
 * Main export: resolve image subjects from a chat-generated image prompt.
 *
 * Returns:
 * - resolutionState: One of 'resolved' | 'sender_self' | 'inanimate' | 'unresolved_named' | 'ambiguous_named'
 * - primarySubjectId: The character ID to use as the main subject (null for inanimate/unresolved)
 * - additionalCharacterIds: Array of additional character IDs (co-subjects)
 * - includeSender: Whether the sending character should be included in the image
 * - isInanimateScene: Whether no characters should appear (room/object prompt)
 * - blockReason: Human-readable reason when generation should be blocked (unresolved/ambiguous)
 * - ambiguousNames: Names that were ambiguous (for logging)
 * - log: Diagnostic log entries
 *
 * @param {string} imagePrompt - The image generation prompt produced by LLM
 * @param {Array} allChars - Full roster of Character objects for the current user
 * @param {string} senderCharacterId - The ID of the character generating the image
 * @param {object|null} resolvedUser - Optional: output of resolveAuthenticatedUser(). When provided,
 *   the user's world name and aliases are checked against the full prompt (including [JOINT],
 *   secondary subjects, and non-leading mentions) to detect user-as-visual-subject.
 */
export function resolveImageSubjects(imagePrompt, allChars, senderCharacterId, resolvedUser = null) {
  const log = [];

  if (!imagePrompt) {
    return {
      resolutionState: 'sender_self',
      primarySubjectId: senderCharacterId,
      additionalCharacterIds: [],
      includeSender: true,
      isInanimateScene: false,
      blockReason: null,
      ambiguousNames: [],
      log,
    };
  }

  // ── USER-PARTICIPANT SCAN (runs across ALL prompt forms, before any other check) ──
  // The authenticated user can appear in [JOINT], [CHARACTER], secondary subjects, scene
  // descriptions, and non-leading name mentions. We resolve them here — independently of
  // the Character roster — so they are never lost due to null related_character_id.
  let userIsVisualSubject = false;
  let userWorldName = null;
  if (resolvedUser) {
    const userScan = resolveUserParticipantInPrompt(imagePrompt, resolvedUser);
    if (userScan.matched) {
      userIsVisualSubject = true;
      userWorldName = userScan.worldName;
      log.push(`[SubjectResolver] USER participant detected in prompt — matched name form "${userScan.matchedForm}" (world_name="${userWorldName}"). Identity resolved from User Profile + UserSettings, NOT from Character roster.`);
    }
  }

  // Step 0: [JOINT] prefix detection — LLM's explicit signal that sender IS in the image.
  // When the LLM prefixes a prompt with [JOINT], it means the SENDER is one of the visual
  // subjects regardless of whether the sender's name appears in the prompt text.
  // This MUST be checked BEFORE inanimate detection and before sender pattern matching
  // because [JOINT] prompts contain location words ("looking out into the room", "living room zone")
  // that would otherwise incorrectly trigger inanimate classification.
  const hasJointTag = /^\[JOINT\]/i.test(imagePrompt.trim());
  if (hasJointTag) {
    log.push(`[SubjectResolver] [JOINT] tag detected — sender is confirmed visual subject`);
    // Still resolve named co-subjects from the prompt for additionalCharacterIds
    const { subjects: jointSubjects, log: jointLog } = resolveSubjectCharactersFromPrompt(
      imagePrompt, allChars, senderCharacterId
    );
    log.push(...jointLog);
    log.push(`[SubjectResolver] [JOINT] co-subjects found: [${jointSubjects.map(c => c.name).join(', ')}]`);
    return {
      resolutionState: 'resolved',
      primarySubjectId: senderCharacterId,
      additionalCharacterIds: jointSubjects.map(c => c.id),
      includeSender: true,
      isInanimateScene: false,
      blockReason: null,
      ambiguousNames: [],
      // User participant context — propagated even in JOINT so callers can inject user refs
      userIsVisualSubject,
      userWorldName,
      log,
    };
  }

  // Step 1: Is this an inanimate scene (room, object)?
  const isInanimateScene = isInanimateSubjectPrompt(imagePrompt);
  if (isInanimateScene) {
    log.push(`[SubjectResolver] Inanimate scene detected — no character subjects injected`);
    return {
      resolutionState: 'inanimate',
      primarySubjectId: null,
      additionalCharacterIds: [],
      includeSender: false,
      isInanimateScene: true,
      blockReason: null,
      ambiguousNames: [],
      userIsVisualSubject,
      userWorldName,
      log,
    };
  }

  // Step 2: Resolve named characters that appear as visual subjects in the prompt
  const { subjects, ambiguous, log: resolutionLog } = resolveSubjectCharactersFromPrompt(
    imagePrompt,
    allChars,
    senderCharacterId
  );
  log.push(...resolutionLog);

  // Step 3: Determine if the sender is also a visual subject
  const senderIsSubject = doesPromptIncludeSender(imagePrompt);
  log.push(`[SubjectResolver] Sender present in image: ${senderIsSubject}`);

  // Step 4: Handle ambiguous names — BLOCK generation, never silently default
  // EXCEPTION: if user was detected as a visual subject (by world name match), do NOT block —
  // the user participant is a valid, unambiguous subject resolved outside the Character roster.
  if (ambiguous.length > 0 && subjects.length === 0 && !senderIsSubject && !userIsVisualSubject) {
    const blockReason = `Ambiguous character name(s): "${ambiguous.join('", "')}" — multiple characters share this name. Cannot determine the correct subject.`;
    log.push(`[SubjectResolver] ⛔ BLOCKED — ${blockReason}`);
    return {
      resolutionState: 'ambiguous_named',
      primarySubjectId: null,
      additionalCharacterIds: [],
      includeSender: false,
      isInanimateScene: false,
      blockReason,
      ambiguousNames: ambiguous,
      userIsVisualSubject,
      userWorldName,
      log,
    };
  }

  // Step 5: Detect "named person requested but not found on roster"
  // Only fires when: third-party subject pattern matched AND no subjects resolved AND no sender signal
  // AND the user is not the visual subject (user presence resolves from User Profile, not roster).
  const isNamedPersonRequest = doesPromptRequestNamedPerson(imagePrompt);
  if (subjects.length === 0 && !senderIsSubject && isNamedPersonRequest && !userIsVisualSubject) {
    const blockReason = `The prompt requests a specific named person but no matching character was found on your roster.`;
    log.push(`[SubjectResolver] ⛔ BLOCKED — unresolved named subject. Named person requested but not on roster.`);
    return {
      resolutionState: 'unresolved_named',
      primarySubjectId: null,
      additionalCharacterIds: [],
      includeSender: false,
      isInanimateScene: false,
      blockReason,
      ambiguousNames: [],
      userIsVisualSubject,
      userWorldName,
      log,
    };
  }

  // Step 6: Sender-only image (selfie, no named request)
  if (subjects.length === 0 && !userIsVisualSubject) {
    log.push(`[SubjectResolver] Sender-only image (no named subjects, no named request signal)`);
    return {
      resolutionState: 'sender_self',
      primarySubjectId: senderCharacterId,
      additionalCharacterIds: [],
      includeSender: true,
      isInanimateScene: false,
      blockReason: null,
      ambiguousNames: [],
      userIsVisualSubject: false,
      userWorldName: null,
      log,
    };
  }

  // Step 6b: User is the only resolved subject (no Character roster match, no sender match)
  if (subjects.length === 0 && userIsVisualSubject) {
    log.push(`[SubjectResolver] User-participant-only image — user world_name "${userWorldName}" is the visual subject. Identity resolved from User Profile + UserSettings.`);
    return {
      resolutionState: 'user_participant',
      primarySubjectId: null,   // user is NOT a Character — do not pass a character ID
      additionalCharacterIds: [],
      includeSender: false,
      isInanimateScene: false,
      blockReason: null,
      ambiguousNames: [],
      userIsVisualSubject: true,
      userWorldName,
      log,
    };
  }

  // Named subjects found
  const [primaryNamedSubject, ...otherSubjects] = subjects;

  if (senderIsSubject) {
    // Sender + named subjects (e.g. "send me a pic of me and Character B")
    log.push(`[SubjectResolver] Sender + ${subjects.length} named subject(s) — joint image`);
    return {
      resolutionState: 'resolved',
      primarySubjectId: senderCharacterId,
      additionalCharacterIds: subjects.map(c => c.id),
      includeSender: true,
      isInanimateScene: false,
      blockReason: null,
      ambiguousNames: [],
      userIsVisualSubject,
      userWorldName,
      log,
    };
  }

  // Named subject(s) only — sender is NOT in the image
  log.push(`[SubjectResolver] Named-only subjects: primary="${primaryNamedSubject.name}" additional=[${otherSubjects.map(c => c.name).join(', ')}]`);
  return {
    resolutionState: 'resolved',
    primarySubjectId: primaryNamedSubject.id,
    additionalCharacterIds: otherSubjects.map(c => c.id),
    includeSender: false,
    isInanimateScene: false,
    blockReason: null,
    ambiguousNames: [],
    userIsVisualSubject,
    userWorldName,
    log,
  };
}