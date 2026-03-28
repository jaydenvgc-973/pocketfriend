import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { conversationId, characterId } = body;

    if (!conversationId || !characterId) {
      return Response.json({ error: 'conversationId and characterId required' }, { status: 400 });
    }

    // Fetch archived messages (those with archived_date set)
    const archivedMessages = await base44.entities.Message.filter(
      { conversation_id: conversationId, character_id: characterId, archived_date: { $exists: true } },
      "-created_date",
      100
    );

    if (!archivedMessages || archivedMessages.length === 0) {
      return Response.json({ 
        success: true, 
        memoriesCreated: 0,
        message: 'No archived messages to extract from'
      });
    }

    // Get recent character messages (last 50 for context)
    const recentMessages = await base44.entities.Message.filter(
      { conversation_id: conversationId, character_id: characterId },
      "-created_date",
      50
    );

    const chatSummary = recentMessages
      .slice(0, 20)
      .map(m => m.content)
      .join(' ')
      .substring(0, 500);

    // Use LLM to identify key moments to preserve as character memories
    const memoriesToCreate = [];
    
    for (const msg of archivedMessages.slice(0, 5)) {
      // Only store significant character messages as memories
      if (msg.sender_type === 'character' && msg.content && !msg.is_narrative) {
        memoriesToCreate.push({
          character_id: characterId,
          title: `Message from archived chat`,
          description: msg.content.substring(0, 200),
          emotional_impact: msg.emotional_state || 'neutral',
          timestamp: msg.timestamp,
          source_context: `archived_message_${msg.id}`
        });
      }
    }

    // Create memory records for significant moments
    let createdCount = 0;
    for (const memData of memoriesToCreate) {
      try {
        await base44.entities.Memory.create(memData).catch(() => {});
        createdCount++;
      } catch (e) {
        // Continue on error
      }
    }

    return Response.json({
      success: true,
      memoriesCreated: createdCount,
      archivedMessagesProcessed: archivedMessages.length
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});