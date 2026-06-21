/**
 * worldPhoneBoundaryGuard.js
 *
 * PERMANENT SYSTEM-LEVEL BOUNDARY GUARD for World Phone / World Contacts.
 *
 * World Phone is a communication-only channel.
 * It must ONLY contain intentional character-to-character messages.
 *
 * World Phone MUST NOT contain:
 * - Narrative records (is_narrative === true)
 * - Third-person prose / scene narration
 * - Sleep narration / activity narration
 * - Private character monologue
 * - Any message without both sender_character_id AND receiver_character_id
 *
 * This module is the single source of truth for what constitutes a valid
 * World Phone message. All World Phone write paths and all narrative generation
 * paths MUST check against these rules.
 *
 * USAGE:
 *
 *   import { assertNotNarrative, isEligibleForWorldPhone, filterWorldPhoneHistory } from '@/lib/worldPhoneBoundaryGuard';
 *
 *   // Before saving any message to a WP conversation:
 *   assertNotNarrative(payload, 'sendWorldPhoneMessage');
 *
 *   // Before selecting a conversation for narrative write:
 *   if (!isEligibleForWorldPhone(conversation)) { skip it; }
 *
 *   // Before rendering WP message history:
 *   const safeMessages = filterWorldPhoneHistory(rawMessages);
 */

/**
 * Returns true if a Message payload is narrative content and must NEVER
 * be written to a World Phone conversation.
 *
 * Criteria (any one is sufficient):
 * - is_narrative === true (or any truthy representation: 1, "true", "1")
 * - has content consistent with third-person narration AND lacks sender_character_id
 * - lacks both sender_character_id AND receiver_character_id (not a valid bilateral message)
 */
export function isNarrativeContent(msg) {
  if (!msg) return false;
  // Primary check: is_narrative flag in any truthy form
  if (
    msg.is_narrative === true ||
    msg.is_narrative === 1 ||
    msg.is_narrative === '1' ||
    msg.is_narrative === 'true'
  ) return true;
  return false;
}

/**
 * Asserts that a message payload is NOT narrative content.
 * Throws a descriptive error if the assertion fails.
 * Call this before any World Phone Message.create() write.
 *
 * @param {object} payload - The message payload about to be written
 * @param {string} callerLabel - Identifies which function is calling (for error context)
 */
export function assertNotNarrative(payload, callerLabel = 'unknown') {
  if (isNarrativeContent(payload)) {
    const err = new Error(
      `[WORLD_PHONE_BOUNDARY_VIOLATION] ${callerLabel} attempted to write a narrative record ` +
      `(is_narrative=${JSON.stringify(payload.is_narrative)}) to a World Phone conversation ` +
      `(conversation_id=${payload.conversation_id || 'unknown'} channel=${payload.channel || 'unknown'}). ` +
      `World Phone is communication-only. Narrative content must be written to direct user↔character conversations, ` +
      `not World Phone threads.`
    );
    console.error(err.message);
    throw err;
  }
}

/**
 * Soft check: logs a warning but does NOT throw.
 * Use in places where a hard throw would break the UI.
 * Returns true if the message is SAFE (not narrative), false if it is narrative contamination.
 *
 * @param {object} payload - The message payload
 * @param {string} callerLabel - Identifies which function is calling
 * @returns {boolean} true = safe to write, false = must not write
 */
export function assertNotNarrativeSoft(payload, callerLabel = 'unknown') {
  if (isNarrativeContent(payload)) {
    console.error(
      `[WORLD_PHONE_BOUNDARY_VIOLATION_SOFT] ${callerLabel} attempted to write narrative content ` +
      `to World Phone (conversation_id=${payload.conversation_id || 'unknown'}). Write blocked.`
    );
    return false;
  }
  return true;
}

/**
 * Returns true if a Conversation record is a valid World Phone conversation
 * that should receive character-to-character messages.
 *
 * A valid WP conversation MUST have channel='world_phone'.
 * type='direct' alone is NOT sufficient — this was the root cause of the
 * June 2026 contamination event. Direct user↔character conversations also
 * use type='direct' but have channel='direct' or null.
 *
 * @param {object} convo - A Conversation entity record
 * @returns {boolean}
 */
export function isWorldPhoneConversation(convo) {
  if (!convo) return false;
  return convo.channel === 'world_phone';
}

/**
 * Returns true if a Conversation is a valid narrative destination
 * (user↔character direct chat, NOT World Phone).
 *
 * Narrative content (is_narrative=true) must ONLY go to:
 * - type='direct' conversations
 * - that include the correct character_id in character_ids
 * - that do NOT have channel='world_phone'
 *
 * @param {object} convo - A Conversation entity record
 * @param {string} characterId - The character whose narrative this is
 * @returns {boolean}
 */
export function isValidNarrativeDestination(convo, characterId) {
  if (!convo) return false;
  // MUST be a direct conversation
  if (convo.type !== 'direct') return false;
  // MUST NOT be a world_phone channel — this is the critical guard
  if (convo.channel === 'world_phone') return false;
  // MUST include the correct character
  if (characterId && Array.isArray(convo.character_ids) && !convo.character_ids.includes(characterId)) {
    return false;
  }
  return true;
}

/**
 * Filters a World Phone message history array to remove excluded contamination.
 *
 * Any message in a World Phone conversation that has:
 * - canon_excluded === true
 * - is_narrative truthy (narrative contamination that reached WP)
 *
 * ...must NOT be rendered in the World Contacts UI.
 *
 * Legitimate bilateral messages (with sender_character_id + receiver_character_id)
 * that have is_narrative=true and are NOT canon_excluded are preserved.
 *
 * @param {Array} messages - Raw Message records from the database
 * @returns {Array} Filtered messages safe for World Contacts rendering
 */
export function filterWorldPhoneHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(m => {
    // Always remove canon_excluded records — they were contamination
    if (m.canon_excluded === true) {
      console.log(
        `[worldPhoneBoundaryGuard] filterWorldPhoneHistory: suppressing canon_excluded message ` +
        `msg_id=${m.id} char=${m.character_name || 'unknown'} reason=${m.canon_exclusion_reason || 'none'}`
      );
      return false;
    }
    // Remove narrative records that have no bilateral IDs — they are contamination
    // that slipped through without being marked canon_excluded (edge case protection)
    if (
      isNarrativeContent(m) &&
      !m.sender_character_id &&
      !m.receiver_character_id
    ) {
      console.warn(
        `[worldPhoneBoundaryGuard] filterWorldPhoneHistory: suppressing non-excluded narrative ` +
        `msg_id=${m.id} char=${m.character_name || 'unknown'} — narrative without bilateral IDs`
      );
      return false;
    }
    return true;
  });
}

/**
 * Validates a full conversation selection for narrative targeting.
 *
 * The bug that caused the June 2026 contamination was:
 *   triggerCharacterNarratives selected conversations by { type: 'direct' }
 *   World Phone convos also have type='direct' → narratives landed in WP threads.
 *
 * This function codifies the correct selection logic.
 * Call this in ANY function that selects a conversation to write narrative content.
 *
 * @param {Array} conversations - Candidate conversation list
 * @param {string} characterId - The character whose narrative this is
 * @returns {object|null} The best valid destination conversation, or null if none
 */
export function selectNarrativeDestination(conversations, characterId) {
  if (!Array.isArray(conversations) || !characterId) return null;
  const valid = conversations.filter(c => isValidNarrativeDestination(c, characterId));
  if (valid.length === 0) return null;
  // Sort by last_message_date descending — most recently active conversation wins
  return valid.sort((a, b) => new Date(b.last_message_date || 0) - new Date(a.last_message_date || 0))[0];
}

/**
 * Builds a complete audit entry for a World Phone boundary check.
 * Use when logging boundary decisions for traceability.
 *
 * @param {string} decision - 'allowed' | 'blocked' | 'filtered'
 * @param {string} reason - Human-readable reason
 * @param {object} context - Additional context (msg_id, convo_id, char_name, etc.)
 * @returns {string} Formatted log string
 */
export function buildBoundaryAuditLog(decision, reason, context = {}) {
  const parts = [`[WP_BOUNDARY:${decision.toUpperCase()}]`, reason];
  for (const [k, v] of Object.entries(context)) {
    if (v !== undefined && v !== null) parts.push(`${k}=${v}`);
  }
  return parts.join(' | ');
}