import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const characterId = body?.characterId;

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Get all messages where character is sender
    const sentMsgs = await base44.asServiceRole.entities.Message.filter({ character_id: characterId }, '-created_date', 500);
    
    // Get all conversations this character is in
    const convos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [characterId] }, '-updated_date', 100);
    
    // Get all messages from those conversations
    let allMsgs = [...sentMsgs];
    for (const convo of convos) {
      const convoMsgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: convo.id }, 'created_date', 1000);
      for (const msg of convoMsgs) {
        if (!allMsgs.find(m => m.id === msg.id)) {
          allMsgs.push(msg);
        }
      }
    }

    const charMsgs = allMsgs.filter(m => m.sender_type === 'character').length;
    const userMsgs = allMsgs.filter(m => m.sender_type === 'user').length;
    const withImages = allMsgs.filter(m => m.image_url).length;

    return Response.json({
      success: true,
      totalMessages: allMsgs.length,
      characterMessages: charMsgs,
      userMessages: userMsgs,
      messagesWithImages: withImages,
      conversations: convos.length
    });
  } catch (error) {
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
});