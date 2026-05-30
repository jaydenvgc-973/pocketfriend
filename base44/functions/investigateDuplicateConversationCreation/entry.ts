import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characterId = '69c0d59d7e382cc866ded9c9';

    // Get ALL conversations for this character (not just direct)
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId },
      "-created_date",
      100
    );

    console.log(`[DUP_CONVO] Total conversations: ${allConvos.length}`);

    // Categorize by type and channel
    const byType = {};
    const byChannel = {};
    
    for (const convo of allConvos) {
      if (!byType[convo.type]) byType[convo.type] = [];
      byType[convo.type].push(convo);
      
      const key = convo.channel || 'direct';
      if (!byChannel[key]) byChannel[key] = [];
      byChannel[key].push(convo);
    }

    // Focus on direct conversations
    const directConvos = allConvos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      return ids.length === 1 && !c.shared_conversation_key && c.channel !== 'world_phone';
    });

    console.log(`[DUP_CONVO] Direct conversations: ${directConvos.length}`);

    // For each direct conversation, get message count and creation timeline
    const convoDetails = [];
    for (const convo of directConvos) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        "-created_date",
        500
      );

      convoDetails.push({
        convo_id: convo.id,
        convo_title: convo.title,
        type: convo.type,
        created_date: convo.created_date,
        last_message_date: convo.last_message_date,
        message_count: msgs.length,
        oldest_msg: msgs[msgs.length - 1]?.created_date,
        newest_msg: msgs[0]?.created_date,
        has_images: msgs.some(m => m.image_url),
        image_count: msgs.filter(m => m.image_url).length,
      });
    }

    // Sort by creation date to see the chronological order
    convoDetails.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

    // Identify gaps and overlaps
    const timeline = convoDetails.map((c, idx) => ({
      order: idx + 1,
      created: c.created_date,
      last_msg: c.last_message_date,
      msg_count: c.message_count,
      convo_id: c.convo_id,
      time_between_creation: idx > 0 
        ? Math.floor((new Date(c.created_date) - new Date(convoDetails[idx-1].created_date)) / 1000 / 60) + ' min'
        : 'first',
      date_range: `${c.oldest_msg?.split('T')[0]} to ${c.newest_msg?.split('T')[0]}`,
    }));

    return Response.json({
      success: true,
      character_id: characterId,
      owner_email: user.email,
      total_all_convos: allConvos.length,
      by_type: Object.keys(byType).map(t => ({ type: t, count: byType[t].length })),
      by_channel: Object.keys(byChannel).map(c => ({ channel: c, count: byChannel[c].length })),
      direct_count: directConvos.length,
      issue: directConvos.length > 1 ? `CRITICAL: ${directConvos.length} direct conversations exist when only 1 should` : 'normal',
      timeline_chronological: timeline,
      conversation_details: convoDetails.slice(0, 5),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});