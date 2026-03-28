import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { characterId } = body;

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch ALL messages for this character (not just recent 50)
    const convos = await base44.entities.Conversation.filter(
      { character_ids: [characterId], created_by: user.email },
      "-updated_date",
      100
    );

    let totalMessages = 0;
    let actualUnreadCount = 0;
    let pendingMessages = 0;
    let failedMessages = 0;
    const messagesToFix = [];

    for (const convo of convos) {
      // Fetch ALL messages for this conversation (no limit)
      const allMessages = await base44.entities.Message.filter(
        { conversation_id: convo.id, sender_type: "character" },
        "-created_date",
        10000 // High limit to get everything
      );

      for (const msg of allMessages) {
        totalMessages++;

        // Check if message is legitimately unread
        const isUnread = !msg.is_read;

        // RED FLAGS: Message should not be unread if it has these issues
        const hasFailedImage = msg.image_url && msg.image_url.includes('undefined');
        const hasEmptyContent = !msg.content || msg.content.trim() === '';
        const isOlderThan24h = new Date() - new Date(msg.timestamp) > 24 * 60 * 60 * 1000;
        const isPendingDelivery = msg.delivered === false;

        if (isUnread) {
          // If it's a legitimately unread message with valid content, count it
          if (!hasFailedImage && (msg.content?.trim() || msg.image_url) && msg.audio_url !== false) {
            actualUnreadCount++;
          } else {
            // Flag for cleanup
            messagesToFix.push({
              id: msg.id,
              reason: hasFailedImage ? 'failed_image' : hasEmptyContent ? 'empty_content' : isOlderThan24h ? 'old_message' : 'invalid_state',
              content: msg.content?.substring(0, 50),
              timestamp: msg.timestamp
            });
          }
        }

        // Track problematic states
        if (isPendingDelivery) pendingMessages++;
        if (hasFailedImage) failedMessages++;
      }
    }

    // Fix messages: mark invalid unread messages as read (batch update)
    const fixPromises = messagesToFix.map(msgFix =>
      base44.entities.Message.update(msgFix.id, { is_read: true })
        .catch(e => console.error(`Failed to fix message ${msgFix.id}:`, e.message))
    );
    await Promise.all(fixPromises);

    // Also mark ALL unread messages older than 30 days as read (safety net)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldUnreadMessages = await base44.entities.Message.filter({
      character_id: characterId,
      is_read: false,
      timestamp: { $lt: thirtyDaysAgo.toISOString() }
    }, "-created_date", 1000);

    if (oldUnreadMessages.length > 0) {
      const oldFixPromises = oldUnreadMessages.map(msg =>
        base44.entities.Message.update(msg.id, { is_read: true })
          .catch(() => {})
      );
      await Promise.all(oldFixPromises);
      console.log(`[Unread Sync] Marked ${oldUnreadMessages.length} old messages as read`);
    }

    // Invalidate conversation queries to refresh unread counts
    // (This is done on the frontend after this function completes)

    return Response.json({
      success: true,
      character_id: characterId,
      diagnostics: {
        total_messages: totalMessages,
        actual_unread_count: actualUnreadCount,
        pending_delivery: pendingMessages,
        failed_media: failedMessages,
        invalid_unread_fixed: messagesToFix.length
      },
      fixed_messages: messagesToFix,
      message: `Synced unread count. Fixed ${messagesToFix.length} invalid unread states. Actual unread: ${actualUnreadCount}`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});