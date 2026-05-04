/**
 * diagnoseAdobevgcAccount — minimal summary only
 * Returns the 8 required diagnostic fields with no verbose arrays.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';
const TODAY = new Date().toISOString().split('T')[0];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Characters with owner_email = target
    const ownedChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );
    const ownedCharIds = new Set(ownedChars.map(c => c.id));

    // 2. Conversations with owner_email = target
    const ownedConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );

    // 3. Messages inside those conversations
    let totalMessages = 0;
    const convoData = [];
    for (const convo of ownedConvos) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 500
      );
      totalMessages += msgs.length;
      const brokenIds = (convo.character_ids || []).filter(id => !ownedCharIds.has(id));
      convoData.push({
        id: convo.id,
        title: convo.title,
        type: convo.type,
        char_ids: convo.character_ids,
        msg_count: msgs.length,
        broken_char_ids: brokenIds,
        created_today: convo.created_date?.startsWith(TODAY) || false,
        is_empty_today: msgs.length === 0 && (convo.created_date?.startsWith(TODAY) || false),
      });
    }

    // 4. All broken char_ids — global lookup + message check
    const allBrokenIds = [...new Set(convoData.flatMap(c => c.broken_char_ids))];
    const brokenResolution = [];
    for (const id of allBrokenIds) {
      const found = await base44.asServiceRole.entities.Character.filter({ id }, '-created_date', 1);
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { character_id: id }, '-created_date', 200
      );
      const convoIdsWithMsgs = [...new Set(msgs.map(m => m.conversation_id))];
      brokenResolution.push({
        char_id: id,
        exists_in_db: found.length > 0,
        db_owner_email: found[0]?.owner_email || null,
        db_name: found[0]?.name || null,
        message_count_in_db: msgs.length,
        in_convo_ids: convoIdsWithMsgs,
      });
    }

    // 5. Characters with NO owner_email (global scan, read-only)
    const allChars = await base44.asServiceRole.entities.Character.filter(
      {}, '-created_date', 500
    );
    const noOwnerChars = allChars
      .filter(c => !c.owner_email || c.owner_email.trim() === '')
      .map(c => ({ id: c.id, name: c.name, status: c.status, type: c.character_type }));

    return Response.json({
      success: true,
      target: TARGET_EMAIL,
      date: TODAY,

      // 1
      s1_owned_characters_total: ownedChars.length,
      s1_owned_characters: ownedChars.map(c => ({ id: c.id, name: c.name, type: c.character_type })),

      // 2
      s2_owned_conversations_total: ownedConvos.length,

      // 3
      s3_total_messages: totalMessages,
      s3_convo_breakdown: convoData.map(c => ({
        id: c.id, title: c.title, type: c.type,
        msg_count: c.msg_count, broken_char_ids: c.broken_char_ids,
        created_today: c.created_today, is_empty_today: c.is_empty_today,
      })),

      // 4
      s4_broken_char_id_resolution: brokenResolution,
      s4_convos_with_broken_char_ids: convoData.filter(c => c.broken_char_ids.length > 0).length,

      // 5
      s5_no_owner_email_chars_total: noOwnerChars.length,
      s5_no_owner_email_chars: noOwnerChars,

      // 6 (derived from brokenResolution above)
      s6_orphan_messages_for_missing_chars: brokenResolution.map(r => ({
        char_id: r.char_id,
        name: r.db_name,
        msg_count: r.message_count_in_db,
        in_convo_ids: r.in_convo_ids,
      })),

      // 7
      s7_legacy_titled_convos: convoData
        .filter(c => /^(npc_chat__|Chat with |Text with |direct with |phone with )/i.test(c.title || ''))
        .map(c => ({ id: c.id, title: c.title, msg_count: c.msg_count, broken: c.broken_char_ids })),

      // 8
      s8_empty_convos_created_today_total: convoData.filter(c => c.is_empty_today).length,
      s8_empty_convos_created_today: convoData
        .filter(c => c.is_empty_today)
        .map(c => ({ id: c.id, title: c.title, char_ids: c.char_ids })),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});