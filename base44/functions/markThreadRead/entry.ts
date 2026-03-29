import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * markThreadRead — Backend function for instant unread badge clearing.
 *
 * AUTHORITATIVE: Immediately marks ALL delivered (visible) character messages in a thread as read.
 * Called the moment a user opens a Chat or Text page. Backend makes the actual database changes,
 * then returns updated unread count so frontend can clear badge synchronously.
 *
 * Rules enforced:
 * - Only marks messages that are fully delivered (exist in DB with conversation_id)
 * - Never touches pending messages (they live in PendingMessage entity, not Message)
 * - Marks ALL unread character messages in this specific thread as read
 * - Returns exact count marked so frontend knows unread is now 0 for that thread
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

    console.log(`[markThreadRead] STARTING for conversationId=${conversationId} | user=${user.email}`);

    // Fetch all unread character messages in this thread BEFORE marking
    // These are DELIVERED messages only — PendingMessage entity is separate and never included here
    const unreadMessages = await base44.entities.Message.filter({
      conversation_id: conversationId,
      sender_type: 'character',
      is_read: false,
    });

    const beforeCount = unreadMessages.length;
    console.log(`[markThreadRead] Found ${beforeCount} unread messages to mark as read`);

    if (beforeCount === 0) {
      console.log(`[markThreadRead] No unread messages found in this thread — already clean`);
      return Response.json({
        success: true,
        marked_read: 0,
        conversation_id: conversationId,
        unread_count: 0,
      });
    }

    // Mark ALL unread messages as read in parallel
    const markPromises = unreadMessages.map(async (msg) => {
      console.log(`[markThreadRead] Marking message ${msg.id.substring(0, 8)}... as read`);
      try {
        await base44.entities.Message.update(msg.id, { is_read: true });
        console.log(`[markThreadRead] ✓ Message ${msg.id.substring(0, 8)}... marked as read`);
        return true;
      } catch (err) {
        console.error(`[markThreadRead] ✗ Failed to mark ${msg.id.substring(0, 8)}... as read:`, err.message);
        return false;
      }
    });

    const results = await Promise.all(markPromises);
    const successCount = results.filter(Boolean).length;

    // Verify by fetching again — ensure database actually changed
    const verifyUnread = await base44.entities.Message.filter({
      conversation_id: conversationId,
      sender_type: 'character',
      is_read: false,
    });

    const finalUnreadCount = verifyUnread.length;

    console.log(`[markThreadRead] COMPLETE: marked_read=${successCount} | beforeCount=${beforeCount} | finalUnreadCount=${finalUnreadCount} | conversationId=${conversationId} | characterId=${characterId} | user=${user.email}`);

    if (finalUnreadCount > 0) {
      console.warn(`[markThreadRead] WARNING: Database shows ${finalUnreadCount} unread messages remain after marking — state mismatch detected`);
    }

    return Response.json({
      success: true,
      marked_read: successCount,
      final_unread_count: finalUnreadCount,
      conversation_id: conversationId,
      before_count: beforeCount,
      messages_processed: unreadMessages.length,
    });
  } catch (error) {
    console.error('[markThreadRead] FATAL ERROR:', error.message);
    return Response.json({ error: error.message, fatal: true }, { status: 500 });
  }
});