/**
 * canonicalUnreadResolver.js
 *
 * THE SINGLE SOURCE OF TRUTH for all unread message classification across the app.
 *
 * Used by:
 *   - CharacterCard (homepage red + green badges)
 *   - useWorldContactsUnread (green badge hook)
 *   - WorldContactsPopup (mark-read on thread open)
 *   - useChatPostLoadEffects (mark-read on chat open)
 *
 * Rules enforced globally:
 *   1. sender_type must be 'character' — user messages and null sender_type never count.
 *   2. is_read must be false — already-read messages never count.
 *   3. recovery_signal must not be true — fallback/placeholder signals never count.
 *   4. type (msg.type) must not be date/divider/system/timestamp/separator.
 *   5. content must be non-empty — blank messages never count.
 *   6. Sender must NOT be the "viewed" character (direction guard).
 *   7. If receiver_character_id is explicitly set, it must be the viewed character.
 *
 * Badge channel classification:
 *   GREEN badge (world_phone / world_contact):
 *     - conversation.channel === 'world_phone'
 *     - OR conversation.type === 'npc'
 *   RED badge (direct chat):
 *     - conversation.type === 'direct'
 *   RED badge (phone/text):
 *     - conversation.type === 'phone'
 *
 * NEVER count: date separators, system rows, recovery signals, outgoing messages.
 */

/**
 * isCountableUnread(msg, viewedCharacterId)
 *
 * Returns true if `msg` should count toward any unread badge.
 * This is the canonical shared filter — import this everywhere.
 *
 * @param {object} msg - Message entity record
 * @param {string|null} viewedCharacterId - The character whose card/badge we are counting for
 * @returns {boolean}
 */
export function isCountableUnread(msg, viewedCharacterId = null) {
  if (!msg) return false;

  // 1. Must be character sender
  if (msg.sender_type !== 'character') return false;

  // 2. Must be unread
  if (msg.is_read !== false) return false;

  // 3. Exclude recovery/fallback signals
  if (msg.recovery_signal === true) return false;

  // 4. Exclude system/date/divider/timestamp rows
  const t = (msg.type || '').toLowerCase();
  if (t === 'date' || t === 'divider' || t === 'system' || t === 'timestamp' || t === 'separator') return false;

  // 5. Must have real content
  if (!msg.content || msg.content.trim() === '') return false;

  // 6. Direction guard: exclude outgoing messages sent BY the viewed character.
  //    sender_character_id is authoritative; character_id is the legacy fallback.
  if (viewedCharacterId) {
    const senderId = msg.sender_character_id || msg.character_id;
    if (senderId === viewedCharacterId) return false;

    // 7. Receiver guard: if explicitly set, must be the viewed character.
    if (msg.receiver_character_id && msg.receiver_character_id !== viewedCharacterId) return false;
  }

  return true;
}

/**
 * classifyConversationChannel(convo)
 *
 * Returns the badge channel for a conversation:
 *   'green'       — World Phone or NPC/World Contact thread
 *   'red_chat'    — Direct chat
 *   'red_text'    — Phone/text channel
 *   null          — Merged/dead or unknown type (never count)
 *
 * @param {object} convo - Conversation entity record
 * @returns {'green'|'red_chat'|'red_text'|null}
 */
export function classifyConversationChannel(convo) {
  if (!convo) return null;

  // Merged threads are dead — never contribute to badge counts
  if (convo.sync_status === 'merged') return null;

  // channel field is authoritative and always takes priority over type
  if (convo.channel === 'world_phone') return 'green';

  // NPC-type conversations (World Contacts without explicit world_phone channel)
  if (convo.type === 'npc') return 'green';

  if (convo.type === 'direct') return 'red_chat';
  if (convo.type === 'phone') return 'red_text';

  return null;
}

/**
 * resolveUnreadBadgeCounts(conversations, perConvoMessages, viewedCharacterId)
 *
 * Given a list of conversations and their unread messages (pre-fetched),
 * returns badge counts classified by channel.
 *
 * This is the canonical aggregation function — call it from any component
 * instead of writing inline counting logic.
 *
 * @param {Array} conversations - Array of Conversation entity records
 * @param {Map<string, Array>} perConvoMessages - Map of convoId → array of unread Message records
 * @param {string} viewedCharacterId - The character whose card we are rendering
 * @returns {{ red_chat: number, red_text: number, green: number, diagnostics: Array }}
 */
export function resolveUnreadBadgeCounts(conversations, perConvoMessages, viewedCharacterId) {
  let red_chat = 0;
  let red_text = 0;
  let green = 0;
  const diagnostics = [];

  for (const convo of conversations) {
    const channel = classifyConversationChannel(convo);
    if (!channel) {
      diagnostics.push({
        convo_id: convo.id?.substring(0, 8),
        convo_type: convo.type,
        convo_channel: convo.channel,
        sync_status: convo.sync_status,
        excluded: true,
        exclusion_reason: convo.sync_status === 'merged' ? 'merged_dead_thread' : 'unknown_type',
      });
      continue;
    }

    const msgs = perConvoMessages.get(convo.id) || [];
    for (const msg of msgs) {
      const counted = isCountableUnread(msg, viewedCharacterId);
      const diagEntry = {
        message_id: msg.id?.substring(0, 8),
        conversation_id: convo.id?.substring(0, 8),
        conversation_type: convo.type,
        channel: convo.channel || convo.type,
        sender_type: msg.sender_type,
        sender_character_id: msg.sender_character_id?.substring(0, 8) || 'none',
        character_id: msg.character_id?.substring(0, 8) || 'none',
        receiver_character_id: msg.receiver_character_id?.substring(0, 8) || 'none',
        msg_type: msg.type || 'none',
        is_read: msg.is_read,
        recovery_signal: msg.recovery_signal,
        content_preview: msg.content?.substring(0, 30) || '',
        counted,
        excluded: !counted,
        badge_channel: counted ? channel : null,
      };

      if (!counted) {
        // Determine exclusion reason for diagnostics
        if (msg.sender_type !== 'character') diagEntry.exclusion_reason = `sender_type_${msg.sender_type}`;
        else if (msg.is_read !== false) diagEntry.exclusion_reason = 'already_read';
        else if (msg.recovery_signal === true) diagEntry.exclusion_reason = 'recovery_signal';
        else if ((msg.type || '').match(/^(date|divider|system|timestamp|separator)$/i)) diagEntry.exclusion_reason = `type_${msg.type}`;
        else if (!msg.content?.trim()) diagEntry.exclusion_reason = 'empty_content';
        else {
          const senderId = msg.sender_character_id || msg.character_id;
          if (senderId === viewedCharacterId) diagEntry.exclusion_reason = 'outgoing_from_viewed_char';
          else if (msg.receiver_character_id && msg.receiver_character_id !== viewedCharacterId) diagEntry.exclusion_reason = 'receiver_is_other_char';
          else diagEntry.exclusion_reason = 'unknown';
        }
      }

      diagnostics.push(diagEntry);

      if (!counted) continue;

      if (channel === 'green') green++;
      else if (channel === 'red_chat') red_chat++;
      else if (channel === 'red_text') red_text++;
    }
  }

  return { red_chat, red_text, green, diagnostics };
}

/**
 * fetchUnreadMessagesForConversations(conversationIds, base44)
 *
 * Fetches unread character messages for a list of conversation IDs.
 * Returns a Map<convoId, Array<Message>>.
 *
 * Uses per-conversation scoped queries — never a global unread query.
 *
 * @param {string[]} conversationIds
 * @param {object} base44 - base44 SDK client
 * @param {number} [limitPerConvo=50]
 * @returns {Promise<Map<string, Array>>}
 */
export async function fetchUnreadMessagesForConversations(conversationIds, base44, limitPerConvo = 50) {
  if (!conversationIds || conversationIds.length === 0) return new Map();

  const results = await Promise.all(
    conversationIds.map(convoId =>
      base44.entities.Message.filter(
        { conversation_id: convoId, sender_type: 'character', is_read: false },
        null,
        limitPerConvo
      ).catch(() => [])
    )
  );

  const map = new Map();
  conversationIds.forEach((convoId, idx) => {
    map.set(convoId, results[idx] || []);
  });
  return map;
}