import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * markThreadRead — Backend function for instant unread badge clearing.
 *
 * Immediately marks ALL delivered (visible) character messages in a thread as read.
 * Called the moment a user opens a Chat or Text page.
 *
 * Rules enforced:
 * - Only marks messages that are fully delivered (exist in DB with conversation_id)
 * - Never touches pending messages (they live in PendingMessage entity, not Message)
 * - Returns the count of messages marked read so the frontend can update instantly
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId, characterId } = await req.json();

    if (!conversationId) {
      return Response.json({ error: 'conversationId required' }, { status: 400 });
    }

    // Fetch all unread character messages in this thread
    // These are DELIVERED messages only — PendingMessage entity is separate and never included here
    const unreadMessages = await base44.entities.Message.filter({
      conversation_id: conversationId,
      sender_type: 'character',
      is_read: false,
    });

    if (unreadMessages.length === 0) {
      return Response.json({ success: true, marked_read: 0 });
    }

    // Mark all as read in parallel
    await Promise.all(
      unreadMessages.map((msg) =>
        base44.entities.Message.update(msg.id, { is_read: true }).catch(() => {})
      )
    );

    console.log(`[markThreadRead] conversationId=${conversationId} | characterId=${characterId} | marked_read=${unreadMessages.length} | user=${user.email}`);

    return Response.json({
      success: true,
      marked_read: unreadMessages.length,
      conversation_id: conversationId,
    });
  } catch (error) {
    console.error('[markThreadRead] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});