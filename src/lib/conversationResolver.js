import { base44 } from "@/api/base44Client";

/**
 * Resolves or creates the canonical direct conversation for a character.
 * DUPLICATE PREVENTION: always queries for an existing conversation before creating.
 * Without this, a race condition (user sends before useChatLoadConvo finishes)
 * creates a duplicate conversation, fragmenting message history.
 *
 * @returns {Promise<string>} conversationId
 */
export async function resolveOrCreateConversation({ characterId, characterName, chatType, ownerEmail }) {
  const existing = await base44.entities.Conversation.filter(
    { owner_email: ownerEmail, character_ids: characterId, type: chatType },
    "-last_message_date",
    50
  );
  const direct = (existing || []).filter(c => {
    const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
    return ids.length === 1 && !c.shared_conversation_key && c.channel !== 'world_phone';
  });
  if (direct.length > 0) {
    return direct[0].id;
  }
  const convo = await base44.entities.Conversation.create({
    title: `${chatType} with ${characterName}`,
    type: chatType,
    character_ids: [characterId],
    owner_email: ownerEmail,
  });
  return convo.id;
}