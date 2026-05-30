import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characterId = '69c0d59d7e382cc866ded9c9';
    const chatType = 'direct';
    const ownerEmail = user.email;

    console.log(`[TEST] Querying conversations for:`);
    console.log(`  - owner_email: ${ownerEmail}`);
    console.log(`  - type: ${chatType}`);
    console.log(`  - character_ids: ${characterId}`);
    console.log(`  - limit: 100 (new limit)`);

    const convos = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail, type: chatType, character_ids: characterId },
      "-last_message_date",
      100
    );

    console.log(`[TEST] Raw query returned ${convos.length} conversations`);

    if (convos.length === 0) {
      return Response.json({ 
        success: false,
        error: 'No conversations found',
        query_params: { ownerEmail, type: chatType, character_ids: characterId }
      });
    }

    // Mimic the chat identity guard filter from useChatLoadConvo line 239
    const directUserConvos = convos.filter(c => 
      c.character_ids?.length === 1 && 
      !c.shared_conversation_key &&
      c.channel !== 'world_phone'
    );

    console.log(`[TEST] After identity filter: ${directUserConvos.length} conversations`);

    const mostRecent = convos[0];
    const mostRecentAfterFilter = directUserConvos[0];

    return Response.json({
      success: true,
      raw_query_count: convos.length,
      after_identity_filter_count: directUserConvos.length,
      most_recent_all: {
        id: mostRecent.id,
        type: mostRecent.type,
        character_ids: mostRecent.character_ids,
        channel: mostRecent.channel,
        shared_conversation_key: mostRecent.shared_conversation_key,
        last_message_date: mostRecent.last_message_date,
      },
      most_recent_after_filter: mostRecentAfterFilter ? {
        id: mostRecentAfterFilter.id,
        type: mostRecentAfterFilter.type,
        character_ids: mostRecentAfterFilter.character_ids,
        channel: mostRecentAfterFilter.channel,
        shared_conversation_key: mostRecentAfterFilter.shared_conversation_key,
        last_message_date: mostRecentAfterFilter.last_message_date,
      } : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});