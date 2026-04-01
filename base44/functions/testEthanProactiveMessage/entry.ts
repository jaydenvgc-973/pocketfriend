import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * testEthanProactiveMessage
 * 
 * Test function: Generates a proactive message from Ethan to the user
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get Ethan by ID
    const ethan = await base44.asServiceRole.entities.Character.get('69c0d59d7e382cc866ded9c9');
    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    // Find or create direct conversation with Ethan
    const convos = await base44.entities.Conversation.filter({
      type: 'direct',
      character_ids: ethan.id,
    });
    
    let conversationId;
    if (convos.length > 0) {
      conversationId = convos[0].id;
    } else {
      const newConvo = await base44.entities.Conversation.create({
        title: ethan.name,
        type: 'direct',
        character_ids: [ethan.id],
      });
      conversationId = newConvo.id;
    }

    // Generate proactive message using LLM
    const content = await base44.integrations.Core.InvokeLLM({
      prompt: `You are ${ethan.name}. Generate a short, casual proactive message (1-2 sentences) reaching out to the user right now. Be spontaneous, genuine, and in-character. No greeting phrases like "Hey" or "Hi" — just natural text.`,
    });

    // Create the message
    const msg = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: ethan.id,
      character_name: ethan.name,
      content: content,
      emotional_state: ethan.emotional_state || 'calm',
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      message: msg,
      content: content,
    });
  } catch (error) {
    console.error('[testEthanProactiveMessage]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});