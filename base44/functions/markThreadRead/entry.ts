import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * markThreadRead — Backend: marks all real, countable unread character messages
 * in a thread as read. Applies the same validity rules as the frontend canonical
 * unread resolver so badge counts and mark-read logic stay in sync.
 *
 * Validity rules (mirrors isCountableUnread in canonicalUnreadResolver.js):
 *   - sender_type === 'character'
 *   - is_read === false
 *   - recovery_signal !== true
 *   - msg.type not in: date, divider, system, timestamp, separator
 *   - content is non-empty
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

    console.log(`[markThreadRead] START conversationId=${conversationId} characterId=${characterId||'none'} user=${user.email}`);

    // Fetch all unread character messages in this thread
    const unreadMessages = await base44.entities.Message.filter({
      conversation_id: conversationId,
      sender_type: 'character',
      is_read: false,
    });

    const beforeCount = unreadMessages.length;
    console.log(`[markThreadRead] Found ${beforeCount} unread candidate messages`);

    if (beforeCount === 0) {
      return Response.json({ success: true, marked_read: 0, conversation_id: conversationId, unread_count: 0 });
    }

    // Apply canonical validity filter — same rules as isCountableUnread on frontend.
    // Only mark messages that are real, non-system, non-recovery unread character messages.
    const EXCLUDED_TYPES = new Set(['date', 'divider', 'system', 'timestamp', 'separator']);
    const toMark = unreadMessages.filter(msg => {
      if (msg.recovery_signal === true) return false;
      if (EXCLUDED_TYPES.has((msg.type || '').toLowerCase())) return false;
      if (!msg.content || msg.content.trim() === '') return false;
      return true;
    });

    const skipped = beforeCount - toMark.length;
    if (skipped > 0) {
      console.log(`[markThreadRead] Skipping ${skipped} non-countable messages (recovery signals, date dividers, empty content)`);
    }

    if (toMark.length === 0) {
      return Response.json({ success: true, marked_read: 0, skipped, conversation_id: conversationId, unread_count: 0 });
    }

    // Mark in parallel
    const markPromises = toMark.map(async (msg) => {
      try {
        await base44.entities.Message.update(msg.id, { is_read: true });
        return true;
      } catch (err) {
        console.error(`[markThreadRead] Failed to mark ${msg.id.substring(0, 8)}: ${err.message}`);
        return false;
      }
    });

    const results = await Promise.all(markPromises);
    const successCount = results.filter(Boolean).length;

    // Verify
    const verifyUnread = await base44.entities.Message.filter({
      conversation_id: conversationId,
      sender_type: 'character',
      is_read: false,
    });
    const finalUnreadCount = verifyUnread.length;

    console.log(`[markThreadRead] COMPLETE: marked=${successCount} skipped=${skipped} before=${beforeCount} finalUnread=${finalUnreadCount} convo=${conversationId} user=${user.email}`);

    if (finalUnreadCount > 0) {
      console.warn(`[markThreadRead] WARNING: ${finalUnreadCount} unread remain after marking`);
    }

    return Response.json({
      success: true,
      marked_read: successCount,
      skipped,
      final_unread_count: finalUnreadCount,
      conversation_id: conversationId,
      before_count: beforeCount,
    });
  } catch (error) {
    console.error('[markThreadRead] FATAL:', error.message);
    return Response.json({ error: error.message, fatal: true }, { status: 500 });
  }
});