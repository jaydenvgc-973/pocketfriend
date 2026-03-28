import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters and find one with pending messages
    const allChars = await base44.entities.Character.filter(
      { created_by: user.email },
      "-created_date"
    );

    if (!allChars || allChars.length === 0) {
      return Response.json({ error: 'No characters found' }, { status: 404 });
    }

    // Find character with pending undelivered messages
    let ethanId = null;
    for (const char of allChars) {
      const pending = await base44.entities.PendingMessage.filter(
        { character_id: char.id, delivered: false }
      );
      if (pending.length > 0) {
        ethanId = char.id;
        break;
      }
    }

    if (!ethanId) {
      return Response.json({ error: 'No character with pending messages found' }, { status: 404 });
    }

    // Find pending messages for this character
    const pending = await base44.entities.PendingMessage.filter(
      { character_id: ethanId, delivered: false }
    );

    const charName = allChars.find(c => c.id === ethanId)?.name || 'Character';

    if (pending.length === 0) {
      return Response.json({ message: 'No pending messages for Ethan', delivered: 0 });
    }

    // Find active conversation with Ethan
    const conversations = await base44.entities.Conversation.filter(
      { character_ids: [ethanId], created_by: user.email },
      "-updated_date",
      1
    );

    if (!conversations || conversations.length === 0) {
      return Response.json({ error: 'No conversation with Ethan found' }, { status: 404 });
    }

    const convoId = conversations[0].id;
    const deliveredCount = Math.min(2, pending.length);
    const toDeliver = pending.slice(0, deliveredCount);

    // Deliver the messages
    for (const pm of toDeliver) {
      const charMsg = await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: 'character',
        character_id: ethanId,
        character_name: charName,
        content: pm.content,
        image_url: pm.image_url || undefined,
        emotional_state: pm.emotional_state || 'calm',
        timestamp: new Date().toISOString(),
      });

      // Mark pending as delivered
      await base44.entities.PendingMessage.update(pm.id, { delivered: true });

      // Update conversation
      await base44.entities.Conversation.update(convoId, {
        last_message_preview: pm.content.substring(0, 100),
        last_message_date: new Date().toISOString(),
      });
    }

    return Response.json({
      success: true,
      delivered: deliveredCount,
      conversationId: convoId,
      ethanId
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});