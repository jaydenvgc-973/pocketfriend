/**
 * diagnoseAdobevgcMessages
 * Checks sections 4-8 only — broken char id resolution, orphan messages,
 * no-owner chars, legacy convos, empty-today convos.
 * Scoped to the specific broken IDs found in section 3.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';
const TODAY = new Date().toISOString().split('T')[0];

// These are the broken char_ids found in the owned conversations
// (those NOT present in the 4 owned characters)
const BROKEN_CHAR_IDS = [
  '69e1cbaf2dae540ad7f9042a', // referenced by "direct with Alden Spencer" (empty, today)
  '69dc124ddcbb6c398e71c40b', // referenced by "direct with Ken" (empty, today)
  '69f44d54f62186ec630ab19f', // referenced by "direct with Phoenix Payton" (empty, today)
  // There may be more — scan all owned convos dynamically too
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Re-fetch owned convos to get all broken ids dynamically
    const ownedChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );
    const ownedCharIds = new Set(ownedChars.map(c => c.id));

    const ownedConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );

    const allBrokenIds = [...new Set(
      ownedConvos.flatMap(c => (c.character_ids || []).filter(id => !ownedCharIds.has(id)))
    )];

    // S4: For each broken char_id — does it exist in DB? What owner? Any messages?
    const s4 = [];
    for (const id of allBrokenIds) {
      const found = await base44.asServiceRole.entities.Character.filter({ id }, '-created_date', 1);
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { character_id: id }, '-created_date', 300
      );
      const convoIds = [...new Set(msgs.map(m => m.conversation_id))];
      s4.push({
        char_id: id,
        exists_in_db: found.length > 0,
        db_owner_email: found[0]?.owner_email || null,
        db_name: found[0]?.name || null,
        db_status: found[0]?.status || null,
        message_count: msgs.length,
        in_conversation_ids: convoIds,
      });
    }

    // S5: All chars globally with NO owner_email
    const allChars = await base44.asServiceRole.entities.Character.filter(
      {}, '-created_date', 500
    );
    const s5 = allChars
      .filter(c => !c.owner_email || c.owner_email.trim() === '')
      .map(c => ({ id: c.id, name: c.name, status: c.status, type: c.character_type }));

    // S7: Which owned convos have legacy-pattern titles
    const s7 = ownedConvos
      .filter(c => /^(npc_chat__|Chat with |Text with |direct with |phone with )/i.test(c.title || ''))
      .map(c => ({
        id: c.id,
        title: c.title,
        type: c.type,
        char_ids: c.character_ids,
        char_ids_valid: (c.character_ids || []).every(id => ownedCharIds.has(id)),
      }));

    // S8: Empty convos created today
    const s8 = [];
    for (const convo of ownedConvos) {
      if (!convo.created_date?.startsWith(TODAY)) continue;
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 5
      );
      if (msgs.length === 0) {
        s8.push({
          id: convo.id,
          title: convo.title,
          char_ids: convo.character_ids,
          char_ids_valid: (convo.character_ids || []).every(id => ownedCharIds.has(id)),
          created_date: convo.created_date,
        });
      }
    }

    return Response.json({
      success: true,
      target: TARGET_EMAIL,
      date: TODAY,

      s4_broken_char_id_resolution: s4,
      s4_total_broken_ids: allBrokenIds.length,

      s5_no_owner_email_chars_total: s5.length,
      s5_no_owner_email_chars: s5,

      s7_legacy_titled_convos_total: s7.length,
      s7_legacy_titled_convos: s7,

      s8_empty_convos_created_today_total: s8.length,
      s8_empty_convos_created_today: s8,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});