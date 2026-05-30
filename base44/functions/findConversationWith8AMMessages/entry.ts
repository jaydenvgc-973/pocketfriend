import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characterId = '69c0d59d7e382cc866ded9c9';

    // Get all conversations for this character
    const convos = await base44.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId },
      "-last_message_date",
      100
    );

    console.log(`[FIND_8AM] Found ${convos.length} conversations for character`);

    const results = [];

    for (const convo of convos) {
      // Get messages from this conversation
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        "-timestamp",
        5 // Just get the last 5
      );

      if (msgs.length > 0) {
        const oldestMsg = msgs[msgs.length - 1];
        const newestMsg = msgs[0];
        
        // Check if any message is from 8:00 AM on 2026-05-29
        const has8AM = msgs.some(m => {
          const time = new Date(m.timestamp);
          return time.getUTCHours() === 12 && // 8:00 AM EDT = 12:00 UTC
                 time.toISOString().startsWith('2026-05-29');
        });

        results.push({
          convo_id: convo.id,
          type: convo.type,
          channel: convo.channel,
          character_ids: convo.character_ids,
          last_message_date: convo.last_message_date,
          message_count_in_query: msgs.length,
          oldest_msg_time: oldestMsg?.timestamp,
          newest_msg_time: newestMsg?.timestamp,
          has_8am_message: has8AM,
          preview: newestMsg?.content?.substring(0, 50),
        });
      }
    }

    const with8AM = results.filter(r => r.has_8am_message);
    
    return Response.json({
      success: true,
      total_conversations: convos.length,
      convos_with_messages_checked: results.length,
      convos_with_8am_messages: with8AM.length,
      matches_with_8am: with8AM,
      all_results: results.slice(0, 10), // First 10
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});