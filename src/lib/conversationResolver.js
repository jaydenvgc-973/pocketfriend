import { base44 } from "@/api/base44Client";

/**
 * DUPLICATE PREVENTION GUARD
 *
 * Resolves or creates the canonical direct conversation for a character.
 *
 * HARD RULE: a new direct conversation is NEVER created while an existing
 * valid one exists for the same owner + character + type. This function is
 * the single authority for conversation creation on the Chat/Text page.
 *
 * Selection priority (prevents empty duplicates from shadowing real history):
 *   1. Conversations WITH last_message_date (have real message history), most recent first
 *   2. Conversations WITHOUT last_message_date (empty), most recent first — last resort
 *
 * Duplicate detection criteria (all must match for a conversation to be
 * considered a valid existing direct conversation):
 *   - owner_email matches
 *   - type matches chatType (direct or phone)
 *   - character_ids contains exactly one entry AND it is the target character
 *   - channel is NOT 'world_phone'
 *   - no shared_conversation_key
 *
 * @returns {Promise<string>} conversationId
 */
export async function resolveOrCreateConversation({ characterId, characterName, chatType, ownerEmail }) {
  const existing = await base44.entities.Conversation.filter(
    { owner_email: ownerEmail, character_ids: characterId, type: chatType },
    "-last_message_date",
    50
  );

  // Apply full duplicate-detection criteria
  const direct = (existing || []).filter(c => {
    const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
    const isExactSingleTarget = ids.length === 1 && ids[0] === characterId;
    const isWorldPhone = c.channel === 'world_phone';
    const hasSharedKey = !!c.shared_conversation_key;
    return isExactSingleTarget && !hasSharedKey && !isWorldPhone;
  });

  if (direct.length > 0) {
    // PREFER conversations with real message history over empty duplicates.
    // An empty duplicate (created by a prior race condition) must NEVER shadow
    // an older conversation that has hundreds of messages.
    const withHistory = direct.filter(c => c.last_message_date);
    const withoutHistory = direct.filter(c => !c.last_message_date);
    const sortByRecency = (a, b) => {
      const aTime = new Date(a.last_message_date || a.created_date).getTime();
      const bTime = new Date(b.last_message_date || b.created_date).getTime();
      return bTime - aTime;
    };
    const ranked = [...withHistory.sort(sortByRecency), ...withoutHistory.sort(sortByRecency)];
    const canonical = ranked[0];

    if (direct.length > 1) {
      console.warn(
        `[DUPLICATE_GUARD] BLOCKED duplicate conversation creation for charId=${characterId} type=${chatType}. ` +
        `Found ${direct.length} existing direct conversations. Reusing canonical id=${canonical.id} ` +
        `(has_history=${!!canonical.last_message_date}). Blocked IDs: ${direct.slice(1).map(c => c.id).join(', ')}`
      );
    } else {
      console.log(
        `[DUPLICATE_GUARD] Reused existing direct conversation id=${canonical.id} ` +
        `for charId=${characterId} type=${chatType} (has_history=${!!canonical.last_message_date})`
      );
    }
    return canonical.id;
  }

  // No valid existing direct conversation — safe to create
  console.log(
    `[DUPLICATE_GUARD] No existing direct conversation found for charId=${characterId} type=${chatType}. ` +
    `Creating new one (first-ever direct conversation for this owner+character+type).`
  );
  const convo = await base44.entities.Conversation.create({
    title: `${chatType} with ${characterName}`,
    type: chatType,
    character_ids: [characterId],
    owner_email: ownerEmail,
  });
  console.log(`[DUPLICATE_GUARD] Created new direct conversation id=${convo.id} for charId=${characterId} type=${chatType}`);
  return convo.id;
}

/**
 * SEND GATE — prevents sending before the canonical conversation has resolved.
 *
 * Called at the top of sendMessage. If the conversation load hook is still
 * running and no conversationId has been resolved yet, this waits for the
 * load to complete (up to 15s) so the send reuses the canonical conversation
 * instead of creating a duplicate.
 *
 * @param {object} refs - { conversationIdRef, isLoadingConvoRef }
 * @returns {Promise<void>}
 */
export async function waitForConversationReady({ conversationIdRef, isLoadingConvoRef }) {
  if (conversationIdRef?.current || !isLoadingConvoRef?.current) return;
  console.log('[SEND_GATE] conversation load still in progress — waiting before resolving convoId');
  const gateStart = Date.now();
  while (isLoadingConvoRef.current && Date.now() - gateStart < 15000) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (conversationIdRef.current) {
    console.log('[SEND_GATE] load completed — reusing canonical conversation id=' + conversationIdRef.current);
  } else {
    console.warn('[SEND_GATE] load completed but no conversationId resolved — falling through to resolveOrCreateConversation');
  }
}