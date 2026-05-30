import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characterId = '69c0d59d7e382cc866ded9c9';

    // Get all direct conversations for this character
    const convos = await base44.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId, type: 'direct' },
      "-last_message_date",
      100
    );

    console.log(`[AUDIT_CONVO] Found ${convos.length} direct conversations for character`);

    // For each conversation, get message count and last message
    const convoData = [];
    for (const convo of convos) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        "-created_date",
        500
      );

      // Check last message timestamp
      const lastMsg = msgs[msgs.length - 1]; // oldest chronologically
      const newestMsg = msgs[0]; // newest chronologically

      convoData.push({
        convo_id: convo.id,
        convo_title: convo.title,
        created_date: convo.created_date,
        last_message_date: convo.last_message_date,
        message_count: msgs.length,
        oldest_msg_timestamp: lastMsg?.created_date,
        newest_msg_timestamp: newestMsg?.created_date,
        oldest_msg_preview: lastMsg?.content?.substring(0, 30),
        newest_msg_preview: newestMsg?.content?.substring(0, 30),
      });
    }

    // Sort by message count (largest first)
    convoData.sort((a, b) => b.message_count - a.message_count);

    return Response.json({
      success: true,
      character_id: characterId,
      total_direct_conversations: convos.length,
      conversations_by_message_count: convoData,
      notes: 'The conversation with the most messages is likely the active one. Check if chat is using the correct convo_id.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});