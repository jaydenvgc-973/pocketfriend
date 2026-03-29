import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
    
    // Just get the unread messages directly
    const allMessages = await base44.entities.Message.filter(
      { is_read: false, sender_type: 'character' },
      "-created_date",
      200
    );
    
    // Filter for Ethan's conversations
    const ethanConvos = await base44.entities.Conversation.filter(
      { character_ids: [ETHAN_ID] },
      "-updated_date",
      200
    );
    
    const ethanConvoIds = ethanConvos.map(c => c.id);
    const ethanUnread = allMessages.filter(m => ethanConvoIds.includes(m.conversation_id));
    
    console.log(`Total unread for Ethan: ${ethanUnread.length}`);
    console.log(`Ethan's conversations: ${ethanConvos.length}`);
    
    // Group by conversation
    const byConvo = {};
    for (const msg of ethanUnread) {
      if (!byConvo[msg.conversation_id]) {
        byConvo[msg.conversation_id] = [];
      }
      byConvo[msg.conversation_id].push(msg);
    }
    
    const summary = Object.entries(byConvo).map(([convoId, msgs]) => {
      const convo = ethanConvos.find(c => c.id === convoId);
      return `${convo?.type || 'unknown'} "${convo?.title || convoId.substring(0, 8)}": ${msgs.length} unread`;
    });
    
    return Response.json({
      total_unread: ethanUnread.length,
      conversations_count: ethanConvos.length,
      summary: summary,
      message_ids: ethanUnread.map(m => m.id.substring(0, 8)),
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});