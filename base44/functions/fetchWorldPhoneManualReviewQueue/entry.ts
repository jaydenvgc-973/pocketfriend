/**
 * fetchWorldPhoneManualReviewQueue
 *
 * Returns the full list of World Phone conversations that need manual re-anchoring
 * (both participant IDs are dead_no_replacement), enriched with:
 *   - first 3 and last 3 message samples (content, sender hints, timestamps in Eastern)
 *   - last_message_preview from the conversation record
 *   - all live characters on this account (for the replacement picker)
 *
 * No writes. Read-only diagnostic enrichment.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function toEastern(isoStr) {
  if (!isoStr) return null;
  try {
    return new Date(isoStr).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return isoStr; }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;
    const body = await req.json().catch(() => ({}));
    // Optional: limit how many conversations to enrich per call (default 50 to avoid timeout)
    const limit = Math.min(body.limit || 50, 100);
    const offset = body.offset || 0;

    // ── Load all World Phone conversations ────────────────────────────────────
    const [byChannel, byKey] = await Promise.all([
      base44.asServiceRole.entities.Conversation.filter(
        { channel: 'world_phone', owner_email: ownerEmail }, '-updated_date', 500
      ).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter(
        { owner_email: ownerEmail }, '-updated_date', 500
      ).catch(() => []),
    ]);

    const seenIds = new Set();
    const allConvos = [...byChannel, ...byKey].filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return (
        c.channel === 'world_phone' ||
        c.shared_conversation_key?.startsWith('world_phone::') ||
        c.title?.startsWith('world_phone::')
      ) && c.sync_status !== 'merged';
    });

    // ── Load live characters ──────────────────────────────────────────────────
    const liveChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail }, 'name', 300
    ).catch(() => []);

    const liveCharacters = liveChars
      .filter(c => c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged')
      .map(c => ({
        id: c.id,
        name: c.name,
        avatar_url: c.avatar_url || c.image_avatar_url || null,
        character_type: c.character_type,
      }));

    const liveById = new Map(liveChars.map(c => [c.id, c]));

    // ── Batch-prefetch dead IDs ───────────────────────────────────────────────
    const allDeadIds = new Set();
    for (const c of allConvos) {
      for (const id of [...(c.participant_character_ids || []), ...(c.character_ids || [])]) {
        if (id && !liveById.has(id)) allDeadIds.add(id);
      }
    }

    const deadCache = new Map();
    const deadIdList = [...allDeadIds];
    const BATCH = 10;
    for (let i = 0; i < deadIdList.length; i += BATCH) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      const batch = deadIdList.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(id =>
          base44.asServiceRole.entities.Character.filter({ id }, null, 1)
            .then(arr => arr?.[0] || null).catch(() => null)
        )
      );
      batch.forEach((id, idx) => deadCache.set(id, results[idx]));
    }

    // ── Identify conversations needing manual review ──────────────────────────
    const needsReview = [];
    const liveByNameLower = new Map(liveChars.map(c => [c.name?.toLowerCase()?.trim(), c]));

    for (const convo of allConvos) {
      const rawIds = [...new Set([
        ...(convo.participant_character_ids || []),
        ...(convo.character_ids || []),
      ].filter(Boolean))];

      const liveIds = rawIds.filter(id => liveById.has(id));
      const deadIds = rawIds.filter(id => !liveById.has(id));

      // Check if any dead ID can be auto-resolved (merged chain or name match)
      const autoResolvable = deadIds.filter(id => {
        const rec = deadCache.get(id);
        if (!rec) return false;
        if (rec.status === 'merged' && rec.merged_into_character_id && liveById.has(rec.merged_into_character_id)) return true;
        const nameLower = rec.name?.toLowerCase()?.trim();
        if (nameLower && liveByNameLower.has(nameLower)) return true;
        return false;
      });

      // Only needs manual review if there are unresolvable dead IDs
      const trulyDead = deadIds.filter(id => !autoResolvable.includes(id));
      if (trulyDead.length === 0) continue; // auto-repair can handle this one

      needsReview.push({ convo, deadIds: trulyDead, liveIds, allRawIds: rawIds });
    }

    const total = needsReview.length;
    const page = needsReview.slice(offset, offset + limit);

    // ── Enrich each conversation with message samples ─────────────────────────
    const enriched = [];
    for (const { convo, deadIds, liveIds, allRawIds } of page) {
      // Fetch up to 6 messages for clues — first 3 and last 3
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, 'created_date', 6
      ).catch(() => []);

      const msgSamples = msgs.map(m => ({
        id: m.id,
        content: (m.content || '').substring(0, 120),
        sender_type: m.sender_type,
        character_name: m.character_name || null,
        character_id: m.character_id || null,
        sender_character_id: m.sender_character_id || null,
        receiver_character_id: m.receiver_character_id || null,
        timestamp_eastern: toEastern(m.timestamp || m.created_date),
        is_narrative: m.is_narrative || false,
      }));

      // Extract name clues from the conversation key/title
      // key format: world_phone::ID1::ID2 — IDs not names, but messages may have character_name
      const nameClues = [...new Set(
        msgs.map(m => m.character_name).filter(Boolean)
      )];

      // Dead ID metadata from cache
      const deadIdDetails = deadIds.map(id => {
        const rec = deadCache.get(id);
        return {
          id,
          known_name: rec?.name || null,
          known_status: rec?.status || 'not_found',
          character_type: rec?.character_type || null,
        };
      });

      enriched.push({
        conversation_id: convo.id,
        key: convo.shared_conversation_key,
        title: convo.title,
        last_message_preview: convo.last_message_preview,
        last_message_date_eastern: toEastern(convo.last_message_date),
        channel: convo.channel,
        all_raw_ids: allRawIds,
        dead_ids: deadIdDetails,
        already_live_ids: liveIds.map(id => ({
          id,
          name: liveById.get(id)?.name || null,
        })),
        name_clues_from_messages: nameClues,
        message_samples: msgSamples,
        message_count_sampled: msgs.length,
      });
    }

    return Response.json({
      owner_email: ownerEmail,
      total_needing_manual_review: total,
      offset,
      limit,
      has_more: offset + limit < total,
      conversations: enriched,
      live_characters: liveCharacters,
    });

  } catch (error) {
    console.error('[fetchWorldPhoneManualReviewQueue]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});