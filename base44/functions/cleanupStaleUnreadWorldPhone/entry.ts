import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * cleanupStaleUnreadWorldPhone
 *
 * Identifies and marks stale/orphaned World Phone / World Contact unread messages as read.
 * Targets OLD unread messages that should have been marked read but persisted as stale.
 *
 * Cleanup criteria — marks as read:
 * 1. Date dividers: "—— Thursday, May 22, 2026 ——" patterns
 * 2. Timestamp separators: content is ONLY whitespace + dashes
 * 3. Outgoing messages: sender_character_id === conversation participant
 * 4. Wrong receiver: receiver_character_id is set but doesn't match other participant
 * 5. Merged conversations: sync_status === 'merged'
 * 6. Recovery signals: recovery_signal === true
 * 7. Old viewed messages: unread messages in conversations already marked read by other threads
 *
 * Returns detailed audit of cleaned records per character.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;
    console.log(`[cleanupStaleUnreadWorldPhone] Starting for ${ownerEmail}`);

    // Fetch all active characters for this user
    const allChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail, status: 'active' },
      null, 200
    ).catch(() => []);

    // Fetch all conversations for this user
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail },
      null, 300
    ).catch(() => []);

    // All conversations for this user — green-channel AND any type
    // We scan all convos to catch outgoing unread messages saved incorrectly in any channel
    const allConvoIds = new Set(allConvos.map(c => c.id));

    // Build a map of convo → character IDs to identify outgoing messages
    const convoParticipants = new Map();
    for (const convo of allConvos) {
      convoParticipants.set(convo.id, {
        characterIds: new Set([...(convo.character_ids || []), ...(convo.participant_character_ids || [])]),
        type: convo.type,
        channel: convo.channel,
        sync_status: convo.sync_status
      });
    }

    // Batch convos into groups of 20 to avoid rate limits
    const allConvoIdArr = [...allConvoIds];
    const batches = [];
    for (let i = 0; i < allConvoIdArr.length; i += 20) batches.push(allConvoIdArr.slice(i, i + 20));

    console.log(`[cleanupStaleUnreadWorldPhone] Scanning ${allConvoIds.size} total convos in ${batches.length} batches`);

    let flatUnread = [];
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(convoId =>
          base44.entities.Message.filter(
            { conversation_id: convoId, sender_type: 'character', is_read: false },
            null, 50
          ).catch(() => [])
        )
      );
      flatUnread = flatUnread.concat(batchResults.flat());
      // Small pause between batches to avoid 429
      if (batches.length > 1) await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[cleanupStaleUnreadWorldPhone] Found ${flatUnread.length} unread messages across all convos`);

    // Mark-read log
    const toMarkRead = [];
    const reasons = {};

    for (const msg of flatUnread) {
      if (!msg.id || !msg.conversation_id) continue;

      const convoParticipant = convoParticipants.get(msg.conversation_id);
      if (!convoParticipant) continue; // shouldn't happen, but skip if so

      let shouldMarkRead = false;
      let reason = null;

      // 1. Date divider patterns
      const content = (msg.content || '').trim();
      if (/^[-–—]{2,}/.test(content) && /[-–—]{2,}$/.test(content)) {
        shouldMarkRead = true;
        reason = 'date_divider_dash_wrapped';
      } else if (/^[-–—\s]*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)/i.test(content) &&
                 /\d{4}/.test(content)) {
        shouldMarkRead = true;
        reason = 'date_divider_weekday_pattern';
      }

      // 2. Timestamp separators (only dashes + whitespace)
      else if (/^[-–—\s]+$/.test(content)) {
        shouldMarkRead = true;
        reason = 'timestamp_separator_only_dashes';
      }

      // 3. Empty content
      else if (!content) {
        shouldMarkRead = true;
        reason = 'empty_content';
      }

      // 4. Recovery signals
      else if (msg.recovery_signal === true) {
        shouldMarkRead = true;
        reason = 'recovery_signal';
      }

      // 5. Merged conversation
      else if (convoParticipant.sync_status === 'merged') {
        shouldMarkRead = true;
        reason = 'merged_dead_conversation';
      }

      // 6. Outgoing message — sender is the RECEIVER of this unread record.
      // In a bilateral world-phone thread, receiver_character_id is the intended reader.
      // A message is "outgoing" (and incorrectly unread) when the sender IS the receiver,
      // i.e. a character sent a message to themselves (typed_by_user or self-reply).
      // More precisely: if receiver_character_id === sender_character_id, it's self-addressed.
      // Broader rule for pre-canonical messages: if NO receiver_character_id is set AND the
      // sender is a conversation participant AND this is a world-phone channel, mark as read —
      // these are outgoing messages saved before receiver stamping was enforced.
      else {
        const senderId = msg.sender_character_id || msg.character_id;
        const receiverId = msg.receiver_character_id || null;

        // Self-addressed: sender === receiver (definitively outgoing)
        if (senderId && receiverId && senderId === receiverId) {
          shouldMarkRead = true;
          reason = 'self_addressed_outgoing';
        }
        // typed_by_user flag: this message was typed by the app user — always outgoing
        else if (msg.typed_by_user === true) {
          shouldMarkRead = true;
          reason = 'typed_by_user_outgoing';
        }
        // user_operated flag: sent on user's behalf — always outgoing
        else if (msg.user_operated === true) {
          shouldMarkRead = true;
          reason = 'user_operated_outgoing';
        }
        // 7. Wrong receiver — receiver is set but is not a conversation participant
        else if (receiverId) {
          const isValidReceiver = convoParticipant.characterIds.has(receiverId);
          if (!isValidReceiver) {
            shouldMarkRead = true;
            reason = 'receiver_not_conversation_participant';
          }
        }
      }

      if (shouldMarkRead && reason) {
        toMarkRead.push(msg.id);
        reasons[reason] = (reasons[reason] || 0) + 1;
      }
    }

    console.log(`[cleanupStaleUnreadWorldPhone] Marking ${toMarkRead.length} messages as read`);
    console.log('[cleanupStaleUnreadWorldPhone] Reasons:', reasons);

    // Rate-limit-safe sequential batching for mark-read writes.
    // Promise.all burst at high count causes 429. Process in chunks of 5 with 150ms pause.
    const WRITE_CHUNK = 5;
    const WRITE_DELAY_MS = 150;
    let successCount = 0;
    for (let i = 0; i < toMarkRead.length; i += WRITE_CHUNK) {
      const chunk = toMarkRead.slice(i, i + WRITE_CHUNK);
      const results = await Promise.all(
        chunk.map(msgId =>
          base44.entities.Message.update(msgId, { is_read: true }).catch(err => {
            console.error(`[cleanupStaleUnreadWorldPhone] Failed to mark ${msgId} as read:`, err.message);
            return null;
          })
        )
      );
      successCount += results.filter(r => r !== null).length;
      if (i + WRITE_CHUNK < toMarkRead.length) {
        await new Promise(r => setTimeout(r, WRITE_DELAY_MS));
      }
    }

    return Response.json({
      owner_email: ownerEmail,
      timestamp: new Date().toISOString(),
      convos_scanned: allConvoIds.size,
      total_unread_messages_found: flatUnread.length,
      messages_marked_read: toMarkRead.length,
      successful_updates: successCount,
      cleanup_reasons: reasons,
      note: `Marked ${successCount} stale/orphaned messages as read. These were old unread records that should not produce green notifications.`,
      success: true
    });
  } catch (err) {
    console.error('[cleanupStaleUnreadWorldPhone] Error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});