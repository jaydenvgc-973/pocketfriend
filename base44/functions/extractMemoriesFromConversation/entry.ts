import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

    // Fetch the conversation — filter by id only (RLS enforces ownership)
    const convos = await base44.entities.Conversation.filter({ id: conversationId }, '-created_date', 1);
    const convo = Array.isArray(convos) ? convos[0] : null;
    
    if (!convo) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch all messages in this conversation
    const messages = await base44.entities.Message.filter({ conversation_id: conversationId }, 'created_date');
    if (messages.length === 0) {
      return Response.json({ memories: [] });
    }

    // ── CHARACTER RECOVERY ─────────────────────────────────────────────────────
    // First, try character_ids from conversation
    let characterId = convo.character_ids?.[0];
    let character = characterId ? 
      await base44.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]) : null;

    // If no character_ids in convo, recover from messages
    if (!characterId && messages.length > 0) {
      console.log(`[extractMemoriesFromConversation] character_ids missing from convo, recovering from message history`);
      // Get all unique character_ids from messages
      const charIdsFromMsgs = new Set(
        messages
          .filter(m => m.character_id && m.sender_type === 'character')
          .map(m => m.character_id)
      );
      if (charIdsFromMsgs.size > 0) {
        characterId = Array.from(charIdsFromMsgs)[0];
        character = await base44.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]);
      }
    }

    if (!character) {
      return Response.json({ 
        error: 'Character not found in conversation or message history', 
        details: 'Conversation has no character_ids and no character messages found' 
      }, { status: 404 });
    }

    // Build conversation summary for LLM
    const messageSummary = messages.map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content}`).join('\n');

    const extractionPrompt = `You are analyzing a conversation for ${character.name}, a character with the following traits.

MEMORY EXTRACTION LEXICAL DISCIPLINE — MANDATORY:
The title, description, emotional_impact, and lesson_learned fields you produce will be stored permanently as Memory records. Characters will read and learn from this text in future interactions.

1. BANNED TERMS — Never use "chaos" or "chaotic" in any output field.
   Do not describe busy, complex, emotional, or multi-person exchanges as chaotic.
   Describe the actual mechanics instead: lively, layered, emotional, fast-moving, warm, complex, intense.

2. RESTRICTED TERM — Do not use "heavy" as vague emotional shorthand for important, emotional, stressful, or meaningful.
   Literal physical weight only. For emotional significance, describe the specific reality.

3. VALENCE ACCURACY — Derive meaning from what actually happened, not from dramatic language.
   Joyful, affectionate, supportive, celebratory exchanges must produce positive or neutral emotional_impact.
   Genuinely painful, conflicted, or unresolved exchanges may produce negative emotional_impact when the facts support it.
   Do not inject negativity into positive interactions.

4. IDENTITY PROTECTION — A single difficult conversation does not make a character toxic.
   A busy or emotionally layered exchange does not mean the relationship is troubled.
   Do not promote situational descriptors into identity labels.

5. REINFORCEMENT FAIRNESS — Memories are learned from. Positive experiences should preserve positive reinforcement.
   Negative experiences should preserve accurate negative reinforcement. Complex experiences preserve their complexity.

You are analyzing a conversation for ${character.name}, a character with the following traits:
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
        // DUPLICATE PREVENTION: check for existing memory with same source_context + title
        const existingCheck = await base44.entities.Memory.filter(
          { character_id: characterId, source_context: conversationId },
          '-created_date',
          50
        );
        const alreadyExists = existingCheck.some(m =>
          m.title?.toLowerCase().trim() === memData.title?.toLowerCase().trim()
        );
        if (alreadyExists) {
          console.log(`[extractMemoriesFromConversation] SKIP duplicate memory: "${memData.title}" for char=${characterId}`);
          continue;
        }
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