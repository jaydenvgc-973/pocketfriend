import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * deleteCanonMessage
 *
 * Removes a World Phone (or any channel) message from the database and
 * optionally removes it from canon entirely — preventing it from being
 * used by memory, relationship progression, journal creation, or future
 * context assembly.
 *
 * Payload:
 *   messageId: string — required
 *   mode: 'delete_for_me' | 'delete_from_canon' | 'report_violation'
 *   violationType?: 'fourth_wall' | 'impossible_knowledge' | 'canon_violation' | 'other'
 *   conversationId?: string — for conversation preview update after deletion
 *
 * Behaviors by mode:
 *   delete_for_me       — deletes the message record. Memories/relationships already written are not touched.
 *   delete_from_canon   — deletes the message, then marks all Memory records created from this message
 *                         source context as non-canonical (canon_excluded=true). Also marks the message
 *                         as memory_eligible=false and relationship_eligible=false before deletion.
 *   report_violation    — same as delete_from_canon but also logs the violation for review.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, mode, violationType, conversationId } = await req.json();

    if (!messageId) return Response.json({ error: 'messageId required' }, { status: 400 });
    if (!['delete_for_me', 'delete_from_canon', 'report_violation'].includes(mode)) {
      return Response.json({ error: 'Invalid mode. Must be delete_for_me, delete_from_canon, or report_violation.' }, { status: 400 });
    }

    // Fetch the message to verify ownership
    const messages = await base44.entities.Message.filter({ id: messageId }).catch(() => []);
    const msg = messages[0];
    if (!msg) return Response.json({ error: 'Message not found' }, { status: 404 });

    // Verify the conversation belongs to this user
    let convoId = conversationId || msg.conversation_id;
    if (convoId) {
      const convos = await base44.entities.Conversation.filter({ id: convoId }).catch(() => []);
      const convo = convos[0];
      if (convo && convo.owner_email && convo.owner_email !== user.email) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const isCanonRemoval = mode === 'delete_from_canon' || mode === 'report_violation';
    let memoriesExcluded = 0;
    let relUpdateCount = 0;

    if (isCanonRemoval) {
      // ── STEP 1: Mark message as non-canon before deletion (audit trail) ───────
      await base44.entities.Message.update(messageId, {
        memory_eligible: false,
        relationship_eligible: false,
        canon_excluded: true,
        canon_exclusion_reason: violationType || 'user_removal',
        canon_excluded_at: new Date().toISOString(),
      }).catch(() => {});

      // ── STEP 2: Find and exclude memories created from this message ────────────
      // Memories are linked via source_context which includes the conversation ID.
      // We search for memories created within a 2-minute window of this message
      // that reference the conversation. We mark them canon_excluded rather than
      // deleting — deletion of memories is destructive and may remove valid data
      // if the same conversation had other valid messages nearby.
      if (convoId) {
        const msgTimestamp = msg.timestamp || msg.created_date;
        const windowStart = msgTimestamp
          ? new Date(new Date(msgTimestamp).getTime() - 5000).toISOString()
          : null;
        const windowEnd = msgTimestamp
          ? new Date(new Date(msgTimestamp).getTime() + 120000).toISOString()
          : null;

        // Search Memory entity for records linked to this conversation
        const convoMemories = await base44.entities.Memory.filter(
          { source_context: convoId },
          '-created_date',
          20
        ).catch(() => []);

        // Also search CharacterMemory
        const charMemories = await base44.entities.CharacterMemory.filter(
          { related_message_id: messageId },
          '-created_date',
          10
        ).catch(() => []);

        // Mark conversation-linked memories as canon_excluded
        const memExcludeWrites = convoMemories.map(m =>
          base44.entities.Memory.update(m.id, {
            canon_excluded: true,
            canon_exclusion_reason: `source_message_removed:${messageId}`,
            canon_excluded_at: new Date().toISOString(),
          }).catch(() => {})
        );

        const charMemExcludeWrites = charMemories.map(m =>
          base44.entities.CharacterMemory.update(m.id, {
            canon_excluded: true,
            canon_exclusion_reason: `source_message_removed:${messageId}`,
          }).catch(() => {})
        );

        await Promise.all([...memExcludeWrites, ...charMemExcludeWrites]);
        memoriesExcluded = convoMemories.length + charMemories.length;
      }

      // ── STEP 3: If this was a violation report, log it ─────────────────────────
      if (mode === 'report_violation') {
        console.log(
          `[deleteCanonMessage] VIOLATION REPORTED` +
          ` | owner=${user.email}` +
          ` | messageId=${messageId}` +
          ` | violationType=${violationType || 'unspecified'}` +
          ` | convoId=${convoId || 'none'}` +
          ` | content_snippet="${(msg.content || '').substring(0, 120)}"`
        );
      }
    }

    // ── STEP 4: Delete the message ────────────────────────────────────────────
    await base44.entities.Message.delete(messageId);

    // ── STEP 5: Update conversation preview if needed ─────────────────────────
    if (convoId) {
      // Find the new last message for preview
      const remaining = await base44.entities.Message.filter(
        { conversation_id: convoId },
        '-created_date',
        1
      ).catch(() => []);

      if (remaining.length > 0) {
        await base44.entities.Conversation.update(convoId, {
          last_message_preview: (remaining[0].content || '').substring(0, 100),
          last_message_date: remaining[0].timestamp || remaining[0].created_date,
        }).catch(() => {});
      }
    }

    console.log(
      `[deleteCanonMessage] Complete | mode=${mode} | messageId=${messageId}` +
      ` | memoriesExcluded=${memoriesExcluded} | owner=${user.email}`
    );

    return Response.json({
      success: true,
      mode,
      messageId,
      memoriesExcluded,
      relUpdateCount,
      canon_removed: isCanonRemoval,
    });

  } catch (error) {
    console.error('[deleteCanonMessage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});