import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characterId = '69c0d59d7e382cc866ded9c9';
    const UTC_OFFSET_EDT = -4 * 60 * 60 * 1000; // EDT = UTC-4

    function toEDT(isoString) {
      if (!isoString) return null;
      const utcTime = new Date(isoString);
      const edtTime = new Date(utcTime.getTime() + UTC_OFFSET_EDT);
      return {
        utc: isoString,
        edt: edtTime.toISOString().replace('Z', ' EDT'),
        edtHour: edtTime.getUTCHours(),
        edtDate: edtTime.toISOString().split('T')[0],
      };
    }

    // Get all conversations for this character
    const convos = await base44.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId },
      "-last_message_date",
      100
    );

    console.log(`[TZ_DIAG] Found ${convos.length} conversations`);

    // Filter to direct conversations only
    const directConvos = convos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      const isCharToChar = ids.length > 1;
      const isBilateral = !!c.shared_conversation_key;
      return !isCharToChar && !isBilateral;
    });

    console.log(`[TZ_DIAG] Found ${directConvos.length} direct conversations`);

    const results = [];

    for (const convo of directConvos) {
      // Get all messages in conversation
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        "-created_date",
        500 // Get all
      );

      if (msgs.length > 0) {
        // Convert to EDT
        const msgsWithEDT = msgs.map(m => ({
          id: m.id,
          sender_type: m.sender_type,
          content_preview: (m.content || '').substring(0, 40),
          created_date_utc: m.created_date,
          created_date_edt: toEDT(m.created_date),
        }));

        // Sort chronologically
        msgsWithEDT.sort((a, b) => new Date(a.created_date_utc) - new Date(b.created_date_utc));

        // Find messages from 2026-05-29 around 8:00 AM EDT (12:00 UTC)
        const may29_8am_msgs = msgsWithEDT.filter(m => {
          const edt = m.created_date_edt;
          // 8:00 AM EDT = 12:00 UTC
          // Look for messages on May 29 between 7:00-9:00 AM EDT
          const isOnMay29 = edt.edtDate === '2026-05-29';
          const is8amWindow = edt.edtHour >= 7 && edt.edtHour <= 9;
          return isOnMay29 && is8amWindow;
        });

        results.push({
          convo_id: convo.id,
          type: convo.type,
          last_message_date_utc: convo.last_message_date,
          last_message_date_edt: toEDT(convo.last_message_date),
          total_messages: msgs.length,
          messages_on_may29: msgsWithEDT.filter(m => m.created_date_edt.edtDate === '2026-05-29').length,
          messages_on_may30: msgsWithEDT.filter(m => m.created_date_edt.edtDate === '2026-05-30').length,
          has_8am_messages: may29_8am_msgs.length > 0,
          count_8am_messages: may29_8am_msgs.length,
          oldest_msg_edt: msgsWithEDT[0]?.created_date_edt,
          newest_msg_edt: msgsWithEDT[msgsWithEDT.length - 1]?.created_date_edt,
          first_5_msgs: msgsWithEDT.slice(0, 5),
          last_5_msgs: msgsWithEDT.slice(-5),
          messages_8am_window: may29_8am_msgs,
        });
      }
    }

    // Sort by whether they have 8:00 AM messages (priority first)
    const with8AM = results.filter(r => r.has_8am_messages);
    const without8AM = results.filter(r => !r.has_8am_messages);

    return Response.json({
      success: true,
      user_timezone: 'America/New_York (EDT = UTC-4)',
      timestamp_note: 'All timestamps converted to Eastern Daylight Time for local reading',
      total_conversations: convos.length,
      direct_conversations: directConvos.length,
      conversations_with_8am_messages: with8AM.length,
      all_results: [...with8AM, ...without8AM].slice(0, 5),
      full_results_count: results.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});