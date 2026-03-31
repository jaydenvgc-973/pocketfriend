import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// This function is called by a scheduled automation every 3 hours.
// It archives old messages for ALL conversations across ALL users — no frontend involvement.

const PROTECTED_CHARACTER_IDS = ['69c0d59d7e382cc866ded9c9'];
const KEEP_RECENT = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all conversations (service role — no user auth needed for scheduled task)
    const allConversations = await base44.asServiceRole.entities.Conversation.list('-updated_date', 500);

    let totalArchived = 0;
    let conversationsProcessed = 0;

    for (const convo of allConversations) {
      // Skip protected characters
      const isProtected = (convo.character_ids || []).some(id => PROTECTED_CHARACTER_IDS.includes(id));
      if (isProtected) continue;

      // Fetch messages for this conversation
      const messages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id },
        '-created_date',
        1000
      );

      if (!messages || messages.length <= KEEP_RECENT) continue;

      const toArchive = messages.slice(KEEP_RECENT).filter(m => !m.archived_date);
      if (toArchive.length === 0) continue;

      for (const msg of toArchive) {
        await base44.asServiceRole.entities.Message.update(msg.id, {
          archived_date: new Date().toISOString()
        }).catch(() => {});
        totalArchived++;
      }

      // Extract memories from archived messages (fire-and-forget per conversation)
      const characterId = convo.character_ids?.[0];
      if (characterId) {
        base44.asServiceRole.functions.invoke('extractMemoriesFromArchive', {
          conversationId: convo.id,
          characterId
        }).catch(() => {});
      }

      conversationsProcessed++;
    }

    console.log(`[archiveOldMessages] Done — ${conversationsProcessed} conversations, ${totalArchived} messages archived`);
    return Response.json({ success: true, conversationsProcessed, totalArchived });

  } catch (error) {
    console.error('[archiveOldMessages] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});