import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DIAGNOSTIC: Chat Message Persistence Audit
 *
 * Queries the canonical Message entity for a given character/owner and reports:
 * 1. All conversations found for this character
 * 2. Total message counts per conversation (including archived)
 * 3. Image messages (messages with image_url set)
 * 4. Whether messages exist after the earliest 2 messages
 * 5. Any messages saved under wrong conversation_id
 *
 * Usage: invoke('diagnoseChatMessagePersistence', { characterId: 'xxx' })
 * Or without characterId to find all recent conversations for this user.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const { characterId } = body;

    // Step 1: Find ALL conversations for this user (service role for full visibility)
    let convoFilter = { owner_email: user.email };
    if (characterId) {
      convoFilter.character_ids = [characterId];
    }

    const convos = await base44.asServiceRole.entities.Conversation.filter(
      convoFilter,
      '-last_message_date',
      50
    );

    const convoReports = [];

    for (const convo of convos) {
      // Fetch ALL messages with NO filter — absolute canonical truth
      const allMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id },
        'created_date',
        500
      ).catch(() => []);

      const archivedMsgs = allMsgs.filter(m => !!m.archived_date);
      const liveMsgs = allMsgs.filter(m => !m.archived_date);
      const imageMsgs = allMsgs.filter(m => !!m.image_url);
      const imageMsgsDurable = imageMsgs.filter(m => m.image_url && !m.image_url.startsWith('blob:'));

      const last10 = allMsgs.slice(-10).map(m => ({
        id: m.id,
        sender_type: m.sender_type,
        content: m.content ? m.content.substring(0, 80) : '(empty)',
        has_image: !!m.image_url,
        image_url_prefix: m.image_url ? m.image_url.substring(0, 60) : null,
        archived: !!m.archived_date,
        created_date: m.created_date,
        timestamp: m.timestamp,
      }));

      convoReports.push({
        conversation_id: convo.id,
        type: convo.type,
        channel: convo.channel || null,
        owner_email: convo.owner_email,
        character_ids: convo.character_ids,
        last_message_date: convo.last_message_date,
        total_messages_in_db: allMsgs.length,
        live_unarchived: liveMsgs.length,
        archived: archivedMsgs.length,
        image_messages_total: imageMsgs.length,
        image_messages_durable_url: imageMsgsDurable.length,
        messages_beyond_first_2: Math.max(0, allMsgs.length - 2),
        last_10_messages: last10,
      });

      await new Promise(r => setTimeout(r, 100));
    }

    // Step 2: Check for messages saved under this character_id but potentially wrong convo
    let orphanCheck = { scanned: 0, unknown_convo_ids: [] };
    if (characterId) {
      const orphanMsgs = await base44.asServiceRole.entities.Message.filter(
        { character_id: characterId },
        '-created_date',
        200
      ).catch(() => []);
      const knownIds = new Set(convos.map(c => c.id));
      const orphanConvoIds = [...new Set(orphanMsgs.map(m => m.conversation_id))];
      orphanCheck = {
        scanned: orphanMsgs.length,
        all_convo_ids_seen: orphanConvoIds,
        unknown_convo_ids: orphanConvoIds.filter(id => !knownIds.has(id)),
      };
    }

    const totalLive = convoReports.reduce((s, r) => s + r.live_unarchived, 0);
    const totalArchived = convoReports.reduce((s, r) => s + r.archived, 0);
    const totalImages = convoReports.reduce((s, r) => s + r.image_messages_durable_url, 0);
    const anyBeyond2 = convoReports.some(r => r.messages_beyond_first_2 > 0);

    return Response.json({
      success: true,
      user_email: user.email,
      character_id: characterId || 'all',
      conversations_found: convos.length,
      totals: {
        live_messages: totalLive,
        archived_messages: totalArchived,
        durable_image_messages: totalImages,
        any_conversation_has_msgs_beyond_first_2: anyBeyond2,
      },
      diagnosis: {
        messages_exist_in_db: totalLive > 2,
        data_is_missing_from_db: totalLive <= 2 && convos.length > 0,
        archive_ate_messages: totalArchived > 0 && !anyBeyond2,
        filter_blocking_display: totalLive > 2 && !anyBeyond2,
        no_conversations_found: convos.length === 0,
      },
      conversation_reports: convoReports,
      orphan_check: orphanCheck,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});