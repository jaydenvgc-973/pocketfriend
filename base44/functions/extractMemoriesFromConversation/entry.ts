import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId } = await req.json();
    if (!conversationId) {
      return Response.json({ error: 'conversationId is required' }, { status: 400 });
    }

    // Fetch the conversation
    const conversation = await base44.entities.Conversation.get ? 
      null : await base44.entities.Conversation.filter({ id: conversationId }, '-created_date', 1);
    const convo = Array.isArray(conversation) ? conversation[0] : conversation;
    
    if (!convo) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch all messages in this conversation
    const messages = await base44.entities.Message.filter({ conversation_id: conversationId }, 'created_date');
    if (messages.length === 0) {
      return Response.json({ memories: [] });
    }

    // Get character details
    const characterId = convo.character_ids?.[0];
    const character = characterId ? 
      await base44.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]) : null;

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Build conversation summary for LLM
    const messageSummary = messages.map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content}`).join('\n');

    const extractionPrompt = `You are analyzing a conversation for ${character.name}, a character with the following traits:
- Personality: ${character.personality_summary}
- Traits: ${character.personality_traits?.join(', ') || 'N/A'}
- Emotional state: ${character.emotional_state}

CONVERSATION:
${messageSummary}

Identify 3-5 significant memories or important details ${character.name} would remember from this conversation. For each memory, provide:
1. A brief title
2. A detailed description of what happened
3. The emotional impact on ${character.name}
4. Any lesson learned (optional)

Return ONLY a valid JSON array with objects containing: title, description, emotional_impact, lesson_learned.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          memories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                emotional_impact: { type: "string" },
                lesson_learned: { type: "string" }
              }
            }
          }
        }
      }
    });

    // Create Memory records
    const createdMemories = [];
    if (response.memories && Array.isArray(response.memories)) {
      for (const memData of response.memories) {
        const memory = await base44.entities.Memory.create({
          character_id: characterId,
          title: memData.title,
          description: memData.description,
          emotional_impact: memData.emotional_impact || 'neutral',
          lesson_learned: memData.lesson_learned || '',
          source_context: conversationId,
          timestamp: new Date().toISOString()
        });
        createdMemories.push(memory);
      }
    }

    return Response.json({ 
      success: true, 
      memoriesCreated: createdMemories.length,
      memories: createdMemories 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});