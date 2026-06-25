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
 * Extract character names that appear in a visual-subject position in the prompt.
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

  // Phase 1: Full name match
  for (const c of sortedRoster) {
    if (matchedIds.has(c.id)) continue;
    const fullNameLower = c.name.toLowerCase();
    if (promptLower.includes(fullNameLower)) {
      matchedIds.add(c.id);
      subjects.push(c);
      log.push(`[SubjectResolver] Full-name match: "${c.name}" (id=${c.id})`);
    }
  }

  // Phase 2: First-name match (only if unique, only if ≥4 chars, not already matched)
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
      matchedIds.add(c.id);
      subjects.push(c);
      log.push(`[SubjectResolver] First-name match (unique): "${c.name}" via "${firstName}" (id=${c.id})`);
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
 */
export function resolveImageSubjects(imagePrompt, allChars, senderCharacterId) {
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
  if (ambiguous.length > 0 && subjects.length === 0 && !senderIsSubject) {
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
      log,
    };
  }

  // Step 5: Detect "named person requested but not found on roster"
  // Only fires when: third-party subject pattern matched AND no subjects resolved AND no sender signal.
  const isNamedPersonRequest = doesPromptRequestNamedPerson(imagePrompt);
  if (subjects.length === 0 && !senderIsSubject && isNamedPersonRequest) {
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
      log,
    };
  }

  // Step 6: Sender-only image (selfie, no named request)
  if (subjects.length === 0) {
    log.push(`[SubjectResolver] Sender-only image (no named subjects, no named request signal)`);
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
    log,
  };
}