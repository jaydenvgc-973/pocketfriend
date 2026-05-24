/**
 * PRECISE DIAGNOSIS: Why Ethan's chat page shows only 2 messages
 * 
 * We know:
 * - 500 messages exist in DB
 * - 26 conversations exist with correct owner_email
 * - Chat page uses: Conversation.filter({ owner_email, type: 'direct', character_ids: charId })
 * - Then filters out char-to-char and world-phone convos
 * - Then picks the most recent one by last_message_date
 * 
 * We need to find:
 * - Which conversation is selected by the chat page algorithm
 * - How many messages are in that conversation
 * - Whether that's a NEW (almost empty) conversation vs the OLD one with history
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const character_id = body.character_id || '69c0d59d7e382cc866ded9c9'; // Ethan's ID
    const chat_type = body.chat_type || 'direct';
    const dry_run = body.dry_run !== false;

    // STEP 1: Replicate exact chat page query
    const convos = await base44.entities.Conversation.filter(
      { owner_email: user.email, type: chat_type, character_ids: character_id },
      '-last_message_date',
      20
    );

    console.log(`[diagnoseEthanChatLoad] Found ${convos.length} conversations`);

    // STEP 2: Apply same filter logic as useChatLoadConvo
    const directUserConvos = convos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      const isCharToChar = ids.length > 1;
      const isBilateral = !!c.shared_conversation_key;
      const isWorldPhone = c.channel === 'world_phone';
      return !isCharToChar && !isBilateral && !isWorldPhone;
    });

    console.log(`[diagnoseEthanChatLoad] After filter: ${directUserConvos.length} direct user convos`);

    // STEP 3: Sort same way as chat page
    const withMsgs = directUserConvos.filter(c => c.last_message_date);
    const withoutMsgs = directUserConvos.filter(c => !c.last_message_date);
    withMsgs.sort((a, b) => new Date(b.last_message_date) - new Date(a.last_message_date));
    const selectedConvo = [...withMsgs, ...withoutMsgs][0];

    // STEP 4: Load messages for the selected conversation (same as chat page)
    let selectedConvoMsgCount = 0;
    let selectedConvoMsgs = [];
    if (selectedConvo) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: selectedConvo.id },
        '-created_date',
        200
      );
      selectedConvoMsgCount = msgs.length;
      selectedConvoMsgs = msgs.slice(0, 5).map(m => ({
        id: m.id,
        timestamp: m.timestamp,
        created_date: m.created_date,
        sender_type: m.sender_type,
        content_preview: m.content?.substring(0, 50),
      }));
    }

    // STEP 5: Check ALL direct convos and their message counts
    const allConvoDetails = [];
    for (const convo of directUserConvos.slice(0, 10)) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        '-created_date',
        5
      ).catch(() => []);
      allConvoDetails.push({
        id: convo.id,
        type: convo.type,
        last_message_date: convo.last_message_date,
        created_date: convo.created_date,
        message_count_sample: msgs.length,
        sample_timestamps: msgs.slice(0, 3).map(m => m.created_date || m.timestamp),
        would_be_selected: selectedConvo?.id === convo.id,
      });
    }

    // STEP 6: Find the conversation with the MOST messages
    const totalsByConvo = [];
    for (const convo of directUserConvos.slice(0, 5)) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        '-created_date',
        500
      ).catch(() => []);
      totalsByConvo.push({
        id: convo.id,
        last_message_date: convo.last_message_date,
        total_messages: msgs.length,
        oldest_msg: msgs.length > 0 ? (msgs[msgs.length-1]?.created_date || msgs[msgs.length-1]?.timestamp) : null,
        newest_msg: msgs.length > 0 ? (msgs[0]?.created_date || msgs[0]?.timestamp) : null,
        is_selected: selectedConvo?.id === convo.id,
      });
    }

    const verdict = {
      selected_convo_id: selectedConvo?.id,
      selected_convo_msg_count: selectedConvoMsgCount,
      selected_convo_last_msg: selectedConvo?.last_message_date,
      selected_convo_created: selectedConvo?.created_date,
      is_new_empty_convo: selectedConvoMsgCount <= 5,
      history_may_be_in_older_convo: totalsByConvo.some(c => !c.is_selected && c.total_messages > 10),
    };

    // REPAIR: If the selected conversation has few messages but an older one has more,
    // the fix is to update the older conversation to have the most recent last_message_date
    // so the chat page selects it instead.
    let repair_recommendation = null;
    const bestConvo = [...totalsByConvo].sort((a, b) => b.total_messages - a.total_messages)[0];
    if (bestConvo && !bestConvo.is_selected && bestConvo.total_messages > selectedConvoMsgCount) {
      repair_recommendation = {
        action: 'update_conversation_last_message_date',
        target_conversation_id: bestConvo.id,
        current_last_message_date: bestConvo.last_message_date,
        set_last_message_date: new Date().toISOString(),
        reason: `This conversation has ${bestConvo.total_messages} messages vs selected convo ${selectedConvoMsgCount}. Updating timestamp will make chat page select this one.`,
        execute_repair: !dry_run,
      };

      if (!dry_run) {
        // Actually apply the repair
        await base44.entities.Conversation.update(bestConvo.id, {
          last_message_date: new Date().toISOString(),
        });
        repair_recommendation.repair_applied = true;
        console.log(`[diagnoseEthanChatLoad] REPAIRED: Updated conversation ${bestConvo.id} last_message_date`);
      }
    }

    return Response.json({
      success: true,
      dry_run,
      character_id,
      total_convos_found: convos.length,
      direct_user_convos: directUserConvos.length,
      selected_convo: selectedConvo ? {
        id: selectedConvo.id,
        last_message_date: selectedConvo.last_message_date,
        created_date: selectedConvo.created_date,
        message_count: selectedConvoMsgCount,
        recent_msgs: selectedConvoMsgs,
      } : null,
      all_direct_convo_details: allConvoDetails,
      message_counts_by_convo: totalsByConvo,
      verdict,
      repair_recommendation,
      diagnosis: selectedConvoMsgCount <= 5
        ? 'PROBLEM: Chat page is selecting a new/empty conversation instead of the one with chat history'
        : 'OK: Chat page is selecting the conversation with messages',
    });
  } catch (error) {
    console.error('[diagnoseEthanChatLoad]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});