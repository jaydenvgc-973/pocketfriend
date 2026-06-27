/**
 * participantNameReferenceKey.js
 *
 * Unified Name Reference Key builder for ALL image generation paths.
 *
 * CRITICAL: This is the single source of truth for building the
 * [NAME REFERENCE KEY — SELECTED PARTICIPANTS] block.
 *
 * Both generateImageAsync and regenerateImageWithReason MUST call
 * buildParticipantNameReferenceKey() — no separate builder may exist.
 *
 * RUNTIME USER RULE:
 * The authenticated user may only be included when runtime participant evidence
 * identifies them (subjectType='joint'/'user', userIsVisualSubject flag, or
 * explicit picker selection). Names in prompts are EXAMPLES — the authenticated
 * user is NEVER resolved by name matching alone.
 *
 * @param {Array} participants  — Normalized participant objects (see below)
 * @returns {string}            — The complete [NAME REFERENCE KEY] block
 *
 * Participant object shape:
 * {
 *   participant_type: 'character' | 'user',
 *   character_id: string | null,       // for character participants
 *   user_id: string | null,            // for user participants (runtime authenticated user ID/email)
 *   display_name: string,              // canonical display name
 *   matched_prompt_name: string | null // the name form that appeared in the prompt (may differ)
 * }
 */
export function buildParticipantNameReferenceKey(participants) {
  if (!participants || participants.length === 0) return '';

  const lines = [];
  lines.push(`[NAME REFERENCE KEY — SELECTED PARTICIPANTS]`);
  lines.push(`Every name in the scene prompt maps to exactly one sealed subject bundle below.`);
  lines.push(`Do NOT infer any appearance, gender, outfit, or body from a name alone.`);
  lines.push(`Do NOT assign any subject's attributes to a different subject.`);
  lines.push(``);

  for (const p of participants) {
    const displayName = p.display_name || 'Unknown';
    const firstName = displayName.split(/\s+/)[0];
    // The name as it appears in the prompt (may be first name, alias, world name, etc.)
    const promptName = p.matched_prompt_name || firstName;

    if (p.participant_type === 'user') {
      // Runtime authenticated user — identity must come from User Profile + UserSettings only.
      // user_id is the runtime authenticated user's email/id — never hardcoded.
      const userIdLabel = p.user_id ? `User ID: ${p.user_id}` : 'authenticated user';
      lines.push(`"${promptName}" / "${displayName}" → Current authenticated user / world persona (${userIdLabel}) — visual identity ONLY from user reference images and user appearance lock`);
    } else {
      // Character participant
      const charIdLabel = p.character_id ? `Character ID: ${p.character_id}` : 'character';
      lines.push(`"${promptName}" / "${displayName}" → Saved character (${charIdLabel}) — visual identity ONLY from character reference images and character appearance lock`);
    }
  }

  lines.push(`[END NAME REFERENCE KEY]`);

  return lines.join('\n');
}

/**
 * Build the complete NAME REFERENCE KEY block wrapped with separator lines,
 * ready for injection into a full prompt string.
 *
 * @param {Array} participants
 * @returns {string}
 */
export function buildParticipantNameReferenceKeyBlock(participants) {
  if (!participants || participants.length === 0) return '';
  const key = buildParticipantNameReferenceKey(participants);
  return `\n════════════════════════════════════════════════════════════\n${key}\n════════════════════════════════════════════════════════════\n`;
}

/**
 * Normalize a Character DB record into a participant object.
 *
 * @param {object} charRecord
 * @param {string|null} matchedPromptName
 * @returns {object}
 */
export function normalizeCharacterParticipant(charRecord, matchedPromptName = null) {
  return {
    participant_type: 'character',
    character_id: charRecord?.id || null,
    user_id: null,
    display_name: charRecord?.name || 'Unknown',
    matched_prompt_name: matchedPromptName || charRecord?.name?.split(/\s+/)[0] || null,
  };
}

/**
 * Normalize a runtime authenticated user into a participant object.
 *
 * RUNTIME RULE: user_id comes from the authenticated session (user.email or user.id).
 * world_name comes from User entity or UserSettings.fictional_world_name.
 * NEVER hardcoded.
 *
 * @param {string} runtimeUserId       — authenticated user email or ID from session
 * @param {string} worldName           — user's world/display name from User/UserSettings
 * @param {string|null} matchedPromptName  — the name form that appeared in the prompt
 * @returns {object}
 */
export function normalizeUserParticipant(runtimeUserId, worldName, matchedPromptName = null) {
  return {
    participant_type: 'user',
    character_id: null,
    user_id: runtimeUserId,
    display_name: worldName || 'User / My Persona',
    matched_prompt_name: matchedPromptName || worldName?.split(/\s+/)[0] || null,
  };
}