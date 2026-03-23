import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, conversationId, userMessage, characterReply } = await req.json();

    if (!characterId || !conversationId || !userMessage || !characterReply) {
      return Response.json({ 
        error: 'characterId, conversationId, userMessage, and characterReply are required' 
      }, { status: 400 });
    }

    // Get character details
    const character = await base44.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]);
    
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const extractionPrompt = `You are analyzing a conversation turn for ${character.name}, a character with:
- Personality: ${character.personality_summary}
- Traits: ${character.personality_traits?.join(', ') || 'N/A'}
- Current mood: ${character.emotional_state}

CONVERSATION TURN:
User: ${userMessage}
${character.name}: ${characterReply}

Does this exchange contain any significant memory that ${character.name} should remember? This could be:
- Important information about the user
- Decisions or commitments made
- Emotional moments
- Details about the user's life, preferences, or relationships

Return a JSON object with:
- should_remember: boolean (true if there's something worth remembering)
- title: string (brief memory title, empty if should_remember is false)
- description: string (detailed description of the memory)
- emotional_impact: string (how it emotionally affects the character)
- lesson_learned: string (optional lesson or takeaway)`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          should_remember: { type: "boolean" },
          title: { type: "string" },
          description: { type: "string" },
          emotional_impact: { type: "string" },
          lesson_learned: { type: "string" }
        }
      }
    });

    let createdMemory = null;
    if (response.should_remember && response.title && response.description) {
      createdMemory = await base44.entities.Memory.create({
        character_id: characterId,
        title: response.title,
        description: response.description,
        emotional_impact: response.emotional_impact || 'neutral',
        lesson_learned: response.lesson_learned || '',
        source_context: conversationId,
        timestamp: new Date().toISOString()
      });
    }

    return Response.json({ 
      success: true, 
      memoryCreated: !!createdMemory,
      memory: createdMemory 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});