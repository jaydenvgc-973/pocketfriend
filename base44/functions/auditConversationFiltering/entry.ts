import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characterId = '69c0d59d7e382cc866ded9c9';

    // Replicate the exact query from useChatLoadConvo
    const convos = await base44.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId },
      "-last_message_date",
      100
    );

    console.log(`[AUDIT_FILTER] Query returned ${convos.length} conversations`);

    // Now apply the EXACT filtering logic from useChatLoadConvo (lines 219-229)
    const directUserConvos = convos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      const isCharToChar = ids.length > 1;
      const isBilateral = !!c.shared_conversation_key;
      const isWorldPhone = c.channel === 'world_phone';
      
      const excluded = isCharToChar || isBilateral || isWorldPhone;
      
      if (excluded) {
        console.log(`[AUDIT_FILTER] EXCLUDED: id=${c.id} type=${c.type} char_ids=[${ids.join(',')}] channel='${c.channel}' shared_key=${c.shared_conversation_key ? 'yes' : 'no'} → isCharToChar=${isCharToChar} isBilateral=${isBilateral} isWorldPhone=${isWorldPhone}`);
      }
      
      return !excluded;
    });

    console.log(`[AUDIT_FILTER] After filtering: ${directUserConvos.length} conversations remain`);

    // Show what was excluded
    const excluded = convos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      const isCharToChar = ids.length > 1;
      const isBilateral = !!c.shared_conversation_key;
      const isWorldPhone = c.channel === 'world_phone';
      return isCharToChar || isBilateral || isWorldPhone;
    });

    return Response.json({
      success: true,
      query_returned: convos.length,
      passed_filter: directUserConvos.length,
      rejected_by_filter: excluded.length,
      filter_logic_correct: directUserConvos.length > 0,
      issue: directUserConvos.length === 0 
        ? 'CRITICAL: All conversations rejected by filter! This causes new conversation creation.' 
        : 'normal',
      excluded_breakdown: excluded.map(c => ({
        id: c.id,
        type: c.type,
        channel: c.channel,
        char_count: (Array.isArray(c.character_ids) ? c.character_ids : []).length,
        shared_key: !!c.shared_conversation_key,
      })),
      passing_breakdown: directUserConvos.map(c => ({
        id: c.id,
        type: c.type,
        channel: c.channel,
        created: c.created_date,
        last_msg: c.last_message_date,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});