import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditExactUnreadMessages
 *
 * Hard DB diagnostic: fetches ALL unread character messages across all conversations
 * owned by this user. Reports exact message IDs, created_date, is_read,
 * sender_character_id, receiver_character_id, conversation type/channel, and
 * whether the canonical resolver would count or skip each one.
 *
 * Uses TWO flat queries (not per-char/per-convo loops) to stay under rate limits:
 *   Query A: Message filter by sender_type=character, is_read=false — across all convos.
 *            This is the path CharacterCard uses (character_id filter).
 *   Query B: All Conversations for this owner — used to cross-reference channel/type.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // Step 1: All active_created_characters for this user
    const allChars = await base44.entities.Character.filter({ owner_email: ownerEmail });
    const active = allChars.filter(c =>
      (!c.character_type || c.character_type === 'active_created_character') &&
      !['moved_away','deleted','soft_deleted','merged'].includes(c.status)
    );
    const activeIds = new Set(active.map(c => c.id));
    const charById = {};
    for (const c of active) charById[c.id] = c;

    // Step 2: All conversations owned by this user (ownership gate + channel/type lookup)
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail }, '-updated_date', 500
    );
    const convoMap = {};
    for (const c of allConvos) convoMap[c.id] = c;

    // Build map: convoId → which active_created_character(s) it belongs to
    const convoToChars = {};
    for (const convo of allConvos) {
      const ids = convo.character_ids || [];
      for (const cid of ids) {
        if (!activeIds.has(cid)) continue;
        if (!convoToChars[convo.id]) convoToChars[convo.id] = [];
        convoToChars[convo.id].push(cid);
      }
    }
    // Also include participant_character_ids
    for (const convo of allConvos) {
      const ids = convo.participant_character_ids || [];
      for (const cid of ids) {
        if (!activeIds.has(cid)) continue;
        if (!convoToChars[convo.id]) convoToChars[convo.id] = [];
        if (!convoToChars[convo.id].includes(cid)) convoToChars[convo.id].push(cid);
      }
    }

    // Step 3: For each active character, fetch their unread messages via character_id query.
    // This mirrors CharacterCard's exact query path.
    const charUnreadMap = {}; // charId → Message[]
    for (const char of active) {
      const msgs = await base44.entities.Message.filter({
        character_id: char.id,
        sender_type: 'character',
        is_read: false,
      }, 'created_date', 100);
      charUnreadMap[char.id] = msgs;
    }

    // Step 4: Also query by receiver_character_id for each active character
    // (world_phone messages FROM contacts TO this character use receiver_character_id)
    const charReceivedMap = {}; // charId → Message[]
    for (const char of active) {
      const msgs = await base44.entities.Message.filter({
        receiver_character_id: char.id,
        sender_type: 'character',
        is_read: false,
      }, 'created_date', 100);
      charReceivedMap[char.id] = msgs;
    }

    const EXCLUDED_TYPES = new Set(['date','divider','system','timestamp','separator']);
    const now = new Date();

    const report = [];

    for (const char of active) {
      // Union messages from both query paths, deduped
      const seenIds = new Set();
      const allMsgs = [];
      for (const m of [...(charUnreadMap[char.id] || []), ...(charReceivedMap[char.id] || [])]) {
        if (!seenIds.has(m.id)) { seenIds.add(m.id); allMsgs.push(m); }
      }

      if (allMsgs.length === 0) continue;

      const charReport = {
        character_name: char.name,
        character_id: char.id,
        total_unread_found: allMsgs.length,
        countable_count: 0,
        excluded_count: 0,
        badge_breakdown: {},
        messages: [],
      };

      for (const msg of allMsgs) {
        const convo = convoMap[msg.conversation_id];
        const createdAt = msg.created_date ? new Date(msg.created_date) : null;
        const ageMinutes = createdAt ? Math.round((now - createdAt) / 60000) : null;

        const senderId = msg.sender_character_id || msg.character_id;
        const isOutgoing = senderId === char.id;
        const isWrongReceiver = msg.receiver_character_id && msg.receiver_character_id !== char.id;
        const isRecovery = msg.recovery_signal === true;
        const isExcludedType = EXCLUDED_TYPES.has((msg.type || '').toLowerCase());
        const isEmpty = !msg.content || msg.content.trim() === '';
        const isOrphaned = !convo;
        const isMergedDead = convo?.sync_status === 'merged';

        const countable = msg.sender_type === 'character'
          && msg.is_read === false
          && !isRecovery
          && !isExcludedType
          && !isEmpty
          && !isOrphaned
          && !isMergedDead
          && !isOutgoing
          && !isWrongReceiver;

        let exclusionReason = null;
        if (!countable) {
          if (msg.sender_type !== 'character') exclusionReason = `sender_type=${msg.sender_type}`;
          else if (msg.is_read !== false) exclusionReason = 'already_read';
          else if (isRecovery) exclusionReason = 'recovery_signal';
          else if (isExcludedType) exclusionReason = `type_excluded:${msg.type}`;
          else if (isEmpty) exclusionReason = 'empty_content';
          else if (isOrphaned) exclusionReason = 'orphaned_no_convo_in_owner_scope';
          else if (isMergedDead) exclusionReason = 'merged_dead_thread';
          else if (isOutgoing) exclusionReason = `outgoing:sender=${senderId?.substring(0,8)}=viewedChar`;
          else if (isWrongReceiver) exclusionReason = `wrong_receiver:got=${msg.receiver_character_id?.substring(0,8)},expected=${char.id?.substring(0,8)}`;
        }

        const channel = isOrphaned ? 'orphaned'
          : isMergedDead ? 'merged_dead'
          : convo.channel === 'world_phone' ? 'green_world_phone'
          : convo.type === 'npc' ? 'green_npc'
          : convo.type === 'direct' ? 'red_chat'
          : convo.type === 'phone' ? 'red_text'
          : 'unknown_type';

        if (countable) {
          charReport.countable_count++;
          charReport.badge_breakdown[channel] = (charReport.badge_breakdown[channel] || 0) + 1;
        } else {
          charReport.excluded_count++;
        }

        charReport.messages.push({
          message_id: msg.id,
          created_date: msg.created_date,
          age_minutes: ageMinutes,
          is_read: msg.is_read,
          sender_type: msg.sender_type,
          sender_character_id: msg.sender_character_id || null,
          character_id_field: msg.character_id || null,
          receiver_character_id: msg.receiver_character_id || null,
          recovery_signal: msg.recovery_signal || false,
          msg_type: msg.type || null,
          content_preview: (msg.content || '').substring(0, 100),
          conversation_id: msg.conversation_id,
          conversation_type: convo?.type || null,
          conversation_channel: convo?.channel || null,
          conversation_sync_status: convo?.sync_status || null,
          badge_channel: channel,
          countable,
          exclusion_reason: exclusionReason,
          found_by: [
            charUnreadMap[char.id]?.some(m => m.id === msg.id) && 'char_id_query',
            charReceivedMap[char.id]?.some(m => m.id === msg.id) && 'receiver_char_id_query',
          ].filter(Boolean),
        });
      }

      // Sort: countable first, then by age desc
      charReport.messages.sort((a, b) => {
        if (a.countable !== b.countable) return a.countable ? -1 : 1;
        return (b.age_minutes || 0) - (a.age_minutes || 0);
      });

      report.push(charReport);
    }

    const totalCountable = report.reduce((a, c) => a + c.countable_count, 0);
    const totalExcluded = report.reduce((a, c) => a + c.excluded_count, 0);

    // Parse request body for output mode
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const summaryOnly = body.summary_only === true;
    const charFilter = body.character_name; // optional: filter to one character by name

    let outputReport = report;
    if (charFilter) {
      outputReport = report.filter(r => r.character_name.toLowerCase().includes(charFilter.toLowerCase()));
    }

    // summary_only: strip individual messages, show only counts + exclusion reason tallies
    const finalReport = summaryOnly
      ? outputReport.map(r => ({
          character_name: r.character_name,
          character_id: r.character_id,
          total_unread_found: r.total_unread_found,
          countable_count: r.countable_count,
          excluded_count: r.excluded_count,
          badge_breakdown: r.badge_breakdown,
          exclusion_reasons: r.messages.filter(m => !m.countable).reduce((acc, m) => {
            const reason = m.exclusion_reason || 'unknown';
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
          }, {}),
          countable_messages: r.messages.filter(m => m.countable).map(m => ({
            message_id: m.message_id,
            created_date: m.created_date,
            age_minutes: m.age_minutes,
            badge_channel: m.badge_channel,
            sender_character_id: m.sender_character_id,
            receiver_character_id: m.receiver_character_id,
            content_preview: m.content_preview,
            conversation_id: m.conversation_id,
            conversation_type: m.conversation_type,
            conversation_channel: m.conversation_channel,
          })),
        }))
      : outputReport;

    return Response.json({
      owner_email: ownerEmail,
      timestamp: now.toISOString(),
      total_active_characters: active.length,
      total_characters_with_unread: report.length,
      total_countable_messages: totalCountable,
      total_excluded_messages: totalExcluded,
      by_character: finalReport,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});