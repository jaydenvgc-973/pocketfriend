import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    // Get character
    const char = await base44.entities.Character.filter({ id: characterId }, "-updated_date", 1);
    if (!char || char.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Get all unread messages
    const allUnread = await base44.entities.Message.filter({
      sender_type: "character",
      character_id: characterId,
      is_read: false,
    }, "-created_date", 1000);

    // Categorize them
    const valid = [];
    const broken = [];

    for (const msg of allUnread) {
      const hasFailedImage = msg.image_url && (msg.image_url.includes('undefined') || msg.image_url === '' || msg.image_url === 'null');
      const isEmpty = !msg.content || msg.content.trim() === '';
      const isPending = msg.delivered === false;
      const isNarrative = msg.is_narrative === true;

      if ((isEmpty && !msg.image_url) || hasFailedImage || isPending || isNarrative) {
        broken.push({
          id: msg.id.substring(0, 8),
          reason: isEmpty && !msg.image_url ? 'empty' : hasFailedImage ? 'failed-image' : isPending ? 'pending' : 'narrative',
          content: msg.content?.substring(0, 30) || '(no content)',
          image: msg.image_url ? msg.image_url.substring(0, 30) : '(no image)',
        });
      } else {
        valid.push({
          id: msg.id.substring(0, 8),
          content: msg.content?.substring(0, 40) || '(no content)',
        });
      }
    }

    // Get conversations
    const convos = await base44.entities.Conversation.filter({ character_ids: [characterId] });
    const directConvos = convos.filter(c => c.type === "direct").map(c => c.id);
    const phoneConvos = convos.filter(c => c.type === "phone").map(c => c.id);

    const validChat = valid.filter(m => {
      const msg = allUnread.find(x => x.id.startsWith(m.id));
      return msg && directConvos.includes(msg.conversation_id);
    }).length;

    const validPhone = valid.filter(m => {
      const msg = allUnread.find(x => x.id.startsWith(m.id));
      return msg && phoneConvos.includes(msg.conversation_id);
    }).length;

    return Response.json({
      character: char[0].name,
      total_unread_messages: allUnread.length,
      valid_messages: {
        total: valid.length,
        chat: validChat,
        phone: validPhone,
      },
      broken_messages: {
        total: broken.length,
        list: broken,
      },
      status: broken.length === 0 ? 'CLEAN' : `${broken.length} BROKEN MESSAGES FOUND`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});