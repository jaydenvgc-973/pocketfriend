/**
 * worldPhoneCacheInvalidation.js
 *
 * Helper that detects World Phone / bilateral character-to-character messages
 * and invalidates the canonical prompt cache so the next chat response fetches
 * fresh World Phone awareness via buildCanonicalCharacterContext.
 *
 * PROVEN SCHEMA (from live Message records — see proof run 2026-06-23):
 *
 *   World Phone / bilateral messages (char→char):
 *     channel:                'world_phone'   ← authoritative discriminator
 *     sender_character_id:    <char id>       ← always set
 *     receiver_character_id:  <char id>       ← always set
 *     shared_conversation_key: 'world_phone::...' ← always set
 *     autonomy_marker:        set only if proactive/commitment-driven (may be null for user-triggered)
 *
 *   Proactive direct messages (char→user):
 *     channel:                'direct'        ← NOT world_phone
 *     sender_character_id:    <char id>
 *     receiver_character_id:  null            ← user is receiver, no char id
 *     autonomy_marker:        'proactive::...' ← set
 *
 * Cache invalidation must fire when channel === 'world_phone' AND (sender OR receiver
 * is the character currently open in Chat/Text). This covers:
 *   - Proactive World Phone messages (commitment fulfillment, autonomy beats)
 *   - User-initiated World Phone sends
 *   - Bilateral character social interactions
 *
 * Usage (in Message.subscribe handler or equivalent):
 *   import { shouldInvalidateForWorldPhone, invalidateCanonicalCache } from '@/lib/worldPhoneCacheInvalidation';
 *
 *   if (shouldInvalidateForWorldPhone(event.data, characterId)) {
 *     invalidateCanonicalCache(characterId, currentUserEmail, systemPromptCacheRef);
 *   }
 */

/**
 * shouldInvalidateForWorldPhone(messageData, characterId)
 *
 * Returns true when a newly created Message is a World Phone message
 * that involves the currently open character (as sender or receiver).
 *
 * @param {object} messageData - The Message entity data from a subscription event
 * @param {string} characterId - The characterId currently open in Chat/Text
 * @returns {boolean}
 */
export function shouldInvalidateForWorldPhone(messageData, characterId) {
  if (!messageData || !characterId) return false;

  // Proven discriminator: World Phone messages always have channel === 'world_phone'
  if (messageData.channel !== 'world_phone') return false;

  // Only invalidate when this character is a participant
  const isSender = messageData.sender_character_id === characterId;
  const isReceiver = messageData.receiver_character_id === characterId;
  const isParticipant = Array.isArray(messageData.participant_character_ids)
    && messageData.participant_character_ids.includes(characterId);

  return isSender || isReceiver || isParticipant;
}

/**
 * invalidateCanonicalCache(characterId, ownerEmail, systemPromptCacheRef)
 *
 * Evicts the canonical prompt from both the mount-level ref cache (Chat.jsx)
 * and the global characterRuntimeCache so the next send re-fetches WP-aware context.
 *
 * @param {string} characterId
 * @param {string} ownerEmail
 * @param {object} systemPromptCacheRef - React ref object ({ current: {} }) from Chat
 */
export function invalidateCanonicalCache(characterId, ownerEmail, systemPromptCacheRef) {
  // Evict from mount-level session cache
  if (systemPromptCacheRef?.current) {
    delete systemPromptCacheRef.current[`canonical::${characterId}`];
  }

  // Evict from global runtime cache (shared across Chat, Text, prewarm)
  if (ownerEmail) {
    import('@/lib/characterRuntimeCache.js').then(({ invalidateCharacterCache }) => {
      invalidateCharacterCache(ownerEmail, characterId);
    }).catch(() => {});
  }

  console.log(
    `[WPCacheInvalidation] canonical cache evicted for char=${characterId}` +
    ` — next send will re-fetch WP-aware context`
  );
}