/**
 * getWorldPhoneManualReviewQueue
 *
 * Loads all World Phone conversations that could not be auto-resolved because
 * their participant character IDs are completely dead (no record found, no merge chain,
 * no name match). For each conversation, enriches the record with:
 *   - first/last message samples (content + sender_type + character_name)
 *   - total message count
 *   - last activity date
 *   - any character names mentioned in messages (to help identify who was talking)
 *   - the raw dead participant IDs (for display)
 *
 * Returns the list of live characters on the account so the UI can render
 * a character picker for manual re-anchoring.
 *
 * Does NOT write anything. Read-only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;
    const body = await req.json().catch(() => ({}));
    // Optional: pass a specific conversation_id to get details for one convo only
    const singleConvoId = body.conversation_id || null;
    // Pagination: offset + limit
    const offset = parseInt(body.offset) || 0;
    const limit = Math.min(parseInt(body.limit) || 20, 50);

    // ── Load live characters for the picker ──────────────────────────────────
    const liveChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail }, 'name', 500
    ).catch(() => []);

    const activeLiveChars = liveChars
      .filter(c =>
        c.status !== 'deleted' &&
        c.status !== 'soft_deleted' &&
        c.status !== 'merged'
      )
      .map(c => ({
        id: c.id,
        name: c.name,
        character_type: c.character_type,
        avatar_url: c.avatar_url || c.image_avatar_url || null,
        occupation: c.occupation || null,
      }));

    const liveById = new Map(liveChars.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    ).map(c => [c.id, c]));

    // ── Load World Phone conversations ───────────────────────────────────────
    let targetConvos = [];

    if (singleConvoId) {
      const found = await base44.asServiceRole.entities.Conversation.filter(
        { id: singleConvoId, owner_email: ownerEmail }, null, 1
      ).catch(() => []);
      targetConvos = found;
    } else {
      const [byChannel, byKey] = await Promise.all([
        base44.asServiceRole.entities.Conversation.filter(
          { channel: 'world_phone', owner_email: ownerEmail }, '-updated_date', 500
        ).catch(() => []),
        base44.asServiceRole.entities.Conversation.filter(
          { owner_email: ownerEmail }, '-updated_date', 500
        ).catch(() => []),
      ]);

      const seen = new Set();
      const allConvos = [...byChannel, ...byKey].filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return (
          c.channel === 'world_phone' ||
          c.shared_conversation_key?.startsWith('world_phone::') ||
          c.title?.startsWith('world_phone::')
        );
      });

      // Filter to only those where ALL participants are dead (manual review candidates)
      for (const convo of allConvos) {
        if (convo.sync_status === 'merged') continue;
        const rawIds = [
          ...(convo.participant_character_ids || []),
          ...(convo.character_ids || []),
        ];
        const uniqueIds = [...new Set(rawIds.filter(Boolean))];
        // If any live ID exists → already handled by auto-repair, skip
        const hasAnyLive = uniqueIds.some(id => liveById.has(id));
        if (!hasAnyLive && uniqueIds.length >= 1) {
          targetConvos.push(convo);
        }
      }
    }

    const totalCount = targetConvos.length;
    const pageConvos = targetConvos.slice(offset, offset + limit);

    // ── Enrich each conversation with message samples ────────────────────────
    const enriched = [];
    for (const convo of pageConvos) {
      // Fetch up to 10 messages for sampling (first 5 + last 5)
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, 'created_date', 200
      ).catch(() => []);

      const msgCount = msgs.length;
      const firstMsgs = msgs.slice(0, 5);
      const lastMsgs = msgs.slice(-5);

      // Extract unique character names mentioned (from character_name field on messages)
      const mentionedNames = new Set();
      for (const m of msgs) {
        if (m.character_name) mentionedNames.add(m.character_name);
        if (m.played_as_character_name) mentionedNames.add(m.played_as_character_name);
      }

      // Sample messages for display
      const sampleMessages = [...new Set([...firstMsgs, ...lastMsgs].map(m => m.id))]
        .map(id => {
          const m = msgs.find(x => x.id === id);
          if (!m) return null;
          return {
            id: m.id,
            sender_type: m.sender_type,
            character_name: m.character_name || null,
            content: m.content ? m.content.substring(0, 120) : null,
            timestamp: m.timestamp || m.created_date,
          };
        })
        .filter(Boolean);

      const rawIds = [
        ...(convo.participant_character_ids || []),
        ...(convo.character_ids || []),
      ];
      const uniqueDeadIds = [...new Set(rawIds.filter(Boolean))];

      enriched.push({
        conversation_id: convo.id,
        title: convo.title,
        key: convo.shared_conversation_key,
        channel: convo.channel,
        last_message_date: convo.last_message_date || convo.updated_date,
        message_count: msgCount,
        dead_ids: uniqueDeadIds,
        mentioned_names: [...mentionedNames],
        sample_messages: sampleMessages,
        last_message_preview: convo.last_message_preview || null,
        // Suggest possible replacements based on name matches in messages
        name_based_suggestions: [...mentionedNames].map(name => {
          const lower = name.toLowerCase().trim();
          const match = activeLiveChars.find(c => c.name?.toLowerCase()?.trim() === lower);
          return match ? { name, matched_character: match } : { name, matched_character: null };
        }),
      });

      // Throttle between message fetches
      await new Promise(r => setTimeout(r, 100));
    }

    return Response.json({
      total_count: totalCount,
      offset,
      limit,
      has_more: offset + limit < totalCount,
      conversations: enriched,
      live_characters: activeLiveChars,
    });

  } catch (error) {
    console.error('[getWorldPhoneManualReviewQueue]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});