import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { messageId, characterId, content, conversationId } = body;

    if (!messageId || !characterId || !content) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get the message to verify it exists and extract timestamp
    const msg = await base44.entities.Message.filter({ id: messageId }, "-created_date", 1)
      .then(arr => arr?.[0]);

    if (!msg) {
      return Response.json({ error: 'Message not found', success: true }, { status: 200 });
    }

    // Get recent conversation context (last 5 messages for narrative continuity)
    const context = conversationId 
      ? await base44.entities.Message.filter(
          { conversation_id: conversationId, character_id: characterId },
          "-created_date",
          5
        )
      : [];

    const contextStr = context
      .map(m => `${m.sender_type === 'user' ? 'User' : 'Character'}: ${m.content}`)
      .join(' // ');

    // PHASE 3 RULE: Character messages must enter memory to drive story progression
    // Only store significant character messages (not every message, to avoid memory bloat)
    if (msg.sender_type === 'character' && msg.content && !msg.is_narrative) {
      const memoryDesc = contextStr 
        ? `Context: [${contextStr}]. Character said: "${msg.content}"`
        : `Character said: "${msg.content}"`;

      try {
        await base44.entities.Memory.create({
          character_id: characterId,
          title: 'Recent interaction moment',
          description: memoryDesc.substring(0, 300),
          emotional_impact: msg.emotional_state || 'neutral',
          lesson_learned: 'Interaction with user in ongoing conversation',
          timestamp: msg.timestamp,
          source_context: `message_${msg.id}`
        });
      } catch (memErr) {
        console.error('Memory creation failed (non-blocking):', memErr.message);
        // Continue — memory failure does NOT block message persistence
      }
    }

    return Response.json({
      success: true,
      memoryCreated: msg.sender_type === 'character'
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});