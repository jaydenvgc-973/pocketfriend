/**
 * diagnoseAdobevgcOrphans — compact summary version
 * Returns only the summary fields needed, no verbose detail arrays.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';
const TODAY = new Date().toISOString().split('T')[0];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Characters owned by adobevgc
    const ownedChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );
    const ownedCharIds = new Set(ownedChars.map(c => c.id));

    // 2. Conversations owned by adobevgc
    const ownedConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );

    // 3. Messages inside owned conversations
    let totalMessages = 0;
    const convoSummary = [];
    for (const convo of ownedConvos) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 500
      );
      totalMessages += msgs.length;
      convoSummary.push({
        convo_id: convo.id,
        title: convo.title,
        type: convo.type,
        character_ids: convo.character_ids,
        message_count: msgs.length,
        created_date: convo.created_date,
        owner_email: convo.owner_email,
        char_ids_all_valid: (convo.character_ids || []).every(id => ownedCharIds.has(id)),
        broken_char_ids: (convo.character_ids || []).filter(id => !ownedCharIds.has(id)),
      });
    }

    // 4. Char ID resolution — for each broken char_id, look it up globally
    const allBrokenIds = [...new Set(
      convoSummary.flatMap(c => c.broken_char_ids)
    )];
    const brokenIdResolution = [];
    for (const id of allBrokenIds) {
      const results = await base44.asServiceRole.entities.Character.filter(
        { id }, '-created_date', 1
      );
      const found = results[0] || null;
      // Also count any messages tied to this character_id
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { character_id: id }, '-created_date', 200
      );
      brokenIdResolution.push({
        char_id: id,
        exists_in_db: !!found,
        owner_email: found?.owner_email || null,
        name: found?.name || null,
        messages_with_this_char_id: msgs.length,
        sample_convo_ids: [...new Set(msgs.map(m => m.conversation_id))].slice(0, 5),
      });
    }

    // 5. Characters with NO owner_email (read-only report)
    const allChars = await base44.asServiceRole.entities.Character.filter(
      {}, '-created_date', 500
    );
    const noOwnerChars = allChars.filter(c => !c.owner_email || c.owner_email.trim() === '');

    // 6+7. Empty convos created today (loader artifacts)
    const emptyToday = convoSummary.filter(c =>
      c.message_count === 0 && c.created_date && c.created_date.startsWith(TODAY)
    );

    // 8. Convos with legacy name-based titles
    const legacyTitled = convoSummary.filter(c =>
      /^(npc_chat__|Chat with |Text with |direct with |phone with )/i.test(c.title || '')
    );

    return Response.json({
      success: true,
      target: TARGET_EMAIL,
      date: TODAY,

      // ── SECTION 1 ──
      owned_characters_total: ownedChars.length,
      owned_characters: ownedChars.map(c => ({
        id: c.id, name: c.name, status: c.status, character_type: c.character_type,
      })),

      // ── SECTION 2 ──
      owned_conversations_total: ownedConvos.length,

      // ── SECTION 3 ──
      total_messages_in_owned_convos: totalMessages,
      convo_summary: convoSummary,

      // ── SECTION 4 ──
      broken_char_id_resolution: brokenIdResolution,
      convos_with_broken_char_ids: convoSummary.filter(c => !c.char_ids_all_valid).length,

      // ── SECTION 5 ──
      no_owner_email_chars_total: noOwnerChars.length,
      no_owner_email_chars: noOwnerChars.map(c => ({
        id: c.id, name: c.name, status: c.status, character_type: c.character_type,
      })),

      // ── SECTION 6+7 ──
      empty_convos_created_today_total: emptyToday.length,
      empty_convos_created_today: emptyToday.map(c => ({
        convo_id: c.convo_id, title: c.title, character_ids: c.character_ids,
        created_date: c.created_date,
      })),

      // ── SECTION 8 ──
      legacy_titled_convos_total: legacyTitled.length,
      legacy_titled_convos: legacyTitled.map(c => ({
        convo_id: c.convo_id, title: c.title, type: c.type,
        message_count: c.message_count, char_ids_valid: c.char_ids_all_valid,
      })),
    });

  } catch (error) {
    console.error('[diagnoseAdobevgcOrphans] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});