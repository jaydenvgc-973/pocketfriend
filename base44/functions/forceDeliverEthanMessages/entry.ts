import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find Ethan character
    const ethanChars = await base44.entities.Character.filter(
      { name: 'Ethan', created_by: user.email },
      "-created_date",
      1
    );

    if (!ethanChars || ethanChars.length === 0) {
      return Response.json({ error: 'Ethan character not found' }, { status: 404 });
    }

    const ethanId = ethanChars[0].id;

    // Find pending messages for Ethan
    const pending = await base44.entities.PendingMessage.filter(
      { character_id: ethanId, delivered: false }
    );

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
        character_name: 'Ethan',
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