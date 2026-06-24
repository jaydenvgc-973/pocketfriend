/**
 * chatImageSubjectResolver.js
 *
 * Subject-aware character name resolution for chat-triggered image prompts.
 *
 * PURPOSE:
 * When a character generates an image prompt from chat, this module determines
 * which characters (if any) are VISUAL SUBJECTS of the image — not just mentioned.
 *
 * INTENT CLASSIFICATION:
 * - "Send me a picture of Character B"       → B is sole subject, A is NOT in image
 * - "Send me a picture of A and B together"  → A and B are co-subjects
 * - "Send me a picture of the room"          → No character subjects
 * - "Can you send me a pic?" (selfie)        → Sender A is subject
 * - Context mention: "I told B about this"  → B is NOT a subject
 *
 * RULES:
 * - Full name match is preferred over first-name match
 * - First-name match only allowed if unique across active roster
 * - Deleted/soft-deleted characters are excluded
 * - The sender (Character A) is only included when the prompt explicitly indicates they appear
 * - Ambiguous first-name matches produce a warning and are excluded (no silent generic fallback)
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
 */
const INANIMATE_SUBJECT_PATTERNS = [
  /\b(picture|photo|image|pic)\s+of\s+(the|your|his|her|my)\s+(room|bedroom|kitchen|living room|bathroom|office|house|apartment|place|car|desk|view|window|closet|setup|setup)\b/i,
  /\bpicture?\s+of\s+(a|an|the)\s+(object|item|thing|place|location|view|scene|room|space|area)\b/i,
  /\b(show me|send me|give me)\s+(a|an|the)\s+(room|kitchen|bedroom|view|scene|place|location)\b/i,
  /\b(the room|the space|your place|your apartment|your house|your room|your view)\b/i,
];

/**
 * Determine whether the image prompt is requesting a room/object/inanimate scene
 * with no characters as subjects.
 */
function isInanimateSubjectPrompt(prompt) {
  const lower = prompt.toLowerCase();
  return INANIMATE_SUBJECT_PATTERNS.some(p => p.test(lower));
}

/**
 * Determine whether the sender character should be present in the image.
 * Returns true only if the prompt explicitly signals sender presence.
 */
function doesPromptIncludeSender(prompt) {
  const lower = prompt.toLowerCase();
  // If a third-party pattern is matched, sender is definitely NOT included
  if (THIRD_PARTY_SUBJECT_PATTERNS.some(p => p.test(lower))) return false;
  // If sender-present pattern matched, sender IS included
  return SENDER_PRESENT_PATTERNS.some(p => p.test(lower));
}

/**
 * Extract character names that appear in a visual-subject position in the prompt.
 * Returns an array of matched roster characters (full record).
 *
 * Strategy:
 * 1. Full-name match (sorted longest-first to prefer specific matches)
 * 2. First-name match (only if unique across active roster)
 * 3. Ambiguous first-name matches → logged warning, excluded
 *
 * @param {string} prompt - The image generation prompt
 * @param {Array} allChars - Full roster of Character objects
 * @param {string} senderCharacterId - ID of the character sending the message (excluded from secondary scan)
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
      // Ambiguous — multiple characters share this first name
      if (!ambiguous.includes(firstName)) {
        ambiguous.push(firstName);
        log.push(`[SubjectResolver] ⚠️ Ambiguous first-name "${firstName}" (${count} matches) — excluded from subjects`);
      }
    } else {
      // Unique first-name match
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
 * - primarySubjectId: The character ID to use as the main subject (may differ from sender)
 * - additionalCharacterIds: Array of additional character IDs (co-subjects)
 * - includeSender: Whether the sending character should be included in the image
 * - isInanimateScene: Whether no characters should appear (room/object prompt)
 * - log: Diagnostic log entries
 *
 * @param {string} imagePrompt - The image generation prompt produced by LLM
 * @param {Array} allChars - Full roster of Character objects for the current user
 * @param {string} senderCharacterId - The ID of the character generating the image
 */
export function resolveImageSubjects(imagePrompt, allChars, senderCharacterId) {
  const log = [];

  if (!imagePrompt) {
    return { primarySubjectId: senderCharacterId, additionalCharacterIds: [], includeSender: true, isInanimateScene: false, log };
  }

  // Step 1: Is this an inanimate scene (room, object)?
  const isInanimateScene = isInanimateSubjectPrompt(imagePrompt);
  if (isInanimateScene) {
    log.push(`[SubjectResolver] Inanimate scene detected — no character subjects injected`);
    return { primarySubjectId: null, additionalCharacterIds: [], includeSender: false, isInanimateScene: true, log };
  }

  // Step 2: Resolve named characters that appear as visual subjects in the prompt
  const { subjects, ambiguous, log: resolutionLog } = resolveSubjectCharactersFromPrompt(
    imagePrompt,
    allChars,
    senderCharacterId
  );
  log.push(...resolutionLog);

  if (ambiguous.length > 0) {
    log.push(`[SubjectResolver] ⚠️ Ambiguous names excluded: [${ambiguous.join(', ')}] — will not silently generate generic people`);
  }

  // Step 3: Determine if the sender is also a visual subject
  const senderIsSubject = doesPromptIncludeSender(imagePrompt);
  log.push(`[SubjectResolver] Sender present in image: ${senderIsSubject}`);

  // Step 4: Classify results
  if (subjects.length === 0 && !senderIsSubject) {
    // No named characters resolved and no sender-presence signal — sender is default subject (selfie/solo)
    log.push(`[SubjectResolver] No named subjects found, no sender-present signal — defaulting to sender as subject`);
    return {
      primarySubjectId: senderCharacterId,
      additionalCharacterIds: [],
      includeSender: true,
      isInanimateScene: false,
      log,
    };
  }

  if (subjects.length === 0 && senderIsSubject) {
    // Sender-only image
    log.push(`[SubjectResolver] Sender-only image`);
    return {
      primarySubjectId: senderCharacterId,
      additionalCharacterIds: [],
      includeSender: true,
      isInanimateScene: false,
      log,
    };
  }

  // Named subjects found
  const [primaryNamedSubject, ...otherSubjects] = subjects;

  if (senderIsSubject) {
    // Sender + named subjects (e.g. "send me a pic of me and Character B")
    // Primary = sender, additional = named subjects
    log.push(`[SubjectResolver] Sender + ${subjects.length} named subject(s) — joint image`);
    return {
      primarySubjectId: senderCharacterId,
      additionalCharacterIds: subjects.map(c => c.id),
      includeSender: true,
      isInanimateScene: false,
      log,
    };
  }

  // Named subject(s) only — sender is NOT in the image
  // Primary = first named subject, additional = remaining named subjects
  log.push(`[SubjectResolver] Named-only subjects: primary="${primaryNamedSubject.name}" additional=[${otherSubjects.map(c => c.name).join(', ')}]`);
  return {
    primarySubjectId: primaryNamedSubject.id,
    additionalCharacterIds: otherSubjects.map(c => c.id),
    includeSender: false,
    isInanimateScene: false,
    log,
  };
}