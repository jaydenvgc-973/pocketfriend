import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const conversationId = '6a197fe8b09007a735df3937';

    // Fetch messages — exactly like useChatLoadConvo lines 251-262
    const messages = await base44.entities.Message.filter(
      { conversation_id: conversationId },
      "-timestamp",
      50
    );

    console.log(`[TEST] Message.filter returned ${messages.length} messages for conversation ${conversationId}`);

    const liveMessages = messages.filter(m => !m.archived_date);
    console.log(`[TEST] After filtering archived: ${liveMessages.length} messages`);

    const firstMsg = messages[messages.length - 1];
    const lastMsg = messages[0];
    const first5 = messages.slice(-5);

    return Response.json({
      success: true,
      total_messages_returned: messages.length,
      live_messages_count: liveMessages.length,
      archived_count: messages.filter(m => m.archived_date).length,
      timestamp_range: {
        oldest: firstMsg?.timestamp,
        newest: lastMsg?.timestamp,
      },
      last_5_messages: first5.map(m => ({
        id: m.id,
        sender_type: m.sender_type,
        content_preview: m.content?.substring(0, 60) || '(no content)',
        timestamp: m.timestamp,
        archived_date: m.archived_date || null,
      })),
      first_5_messages: first5.reverse().map(m => ({
        id: m.id,
        sender_type: m.sender_type,
        content_preview: m.content?.substring(0, 60) || '(no content)',
        timestamp: m.timestamp,
        archived_date: m.archived_date || null,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});