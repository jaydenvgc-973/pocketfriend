import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
    
    // Wait to avoid rate limit
    await new Promise(r => setTimeout(r, 500));
    
    // Get all unread character messages across entire app
    const allUnread = await base44.entities.Message.filter({
      is_read: false,
      sender_type: 'character'
    });
    
    // Get Ethan conversations to check which unread belong to him
    await new Promise(r => setTimeout(r, 500));
    
    const ethanConvos = await base44.entities.Conversation.filter({
      character_ids: [ETHAN_ID]
    });
    
    const ethanConvoIds = new Set(ethanConvos.map(c => c.id));
    const ethanUnreadIds = allUnread
      .filter(m => ethanConvoIds.has(m.conversation_id))
      .map(m => m.id);
    
    console.log(`Found ${ethanUnreadIds.length} unread Ethan messages`);
    
    // Mark each as read with delay
    let marked = 0;
    for (const id of ethanUnreadIds) {
      try {
        await base44.entities.Message.update(id, { is_read: true });
        marked++;
      } catch (e) {
        console.error(`Failed to mark ${id.substring(0, 8)}`);
      }
      
      // Delay between updates
      if (marked % 5 === 0) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    return Response.json({
      marked: marked,
      total_found: ethanUnreadIds.length,
      success: marked === ethanUnreadIds.length,
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});