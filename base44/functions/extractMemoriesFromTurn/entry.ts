import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let { characterId, conversationId, userMessage, characterReply, playingAsCharacterId } = await req.json();

    if (!characterId || !conversationId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // If playingAsCharacterId not provided, check the last user message for it
    if (!playingAsCharacterId) {
      const lastUserMsg = await base44.entities.Message.filter(
        { conversation_id: conversationId, sender_type: 'user' },
        '-created_date',
        1
      ).then(r => r[0]);
      if (lastUserMsg?.played_as_character_id) {
        playingAsCharacterId = lastUserMsg.played_as_character_id;
      }
    }

    const targetChar = await base44.entities.Character.filter({ id: characterId }).then(r => r[0]);
    const playingAsChar = playingAsCharacterId
      ? await base44.entities.Character.filter({ id: playingAsCharacterId }).then(r => r[0])
      : null;

    let newPeopleDetected = [];

    // Create memory for target character about this interaction
    if (targetChar && characterReply) {
      const targetMemory = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${targetChar.name}. Someone just said: "${userMessage}" and you replied: "${characterReply}". 

Extract any NEW people names mentioned (NPCs not yet in your world) from the user's message or your response. List them as JSON: [{"name": "Name", "relationship_type": "friend/family/etc", "context": "brief context"}] or empty [] if none.`,
        response_json_schema: {
          type: "object",
          properties: {
            people: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  relationship_type: { type: "string" },
                  context: { type: "string" }
                }
              }
            }
          }
        }
      });

      newPeopleDetected = targetMemory?.people || [];

      // Store memory for target character
      await base44.entities.Memory.create({
        character_id: characterId,
        title: `Conversation moment`,
        description: `They said: "${userMessage}". I responded: "${characterReply.substring(0, 200)}"`,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `conversation_${conversationId}`,
      });
    }

    // If user was playing as a character, create a simple emotional journal entry
    if (playingAsChar && targetChar) {
      const emotionalReflection = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${playingAsChar.name}. Personality: ${playingAsChar.personality_summary || 'unknown'}. You just talked with ${targetChar.name}.

What you said: "${userMessage}"
How they responded: "${characterReply?.substring(0, 150)}"

Write ONE sentence about how this interaction made you feel. Be authentic to your personality and what you just learned about them.`,
      });

      await base44.entities.Memory.create({
        character_id: playingAsCharacterId,
        title: `Talked with ${targetChar.name}`,
        description: emotionalReflection,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `conversation_${conversationId}_as_${playingAsCharacterId}`,
      });

      // Create/update fictional relationship
      const existingRels = await base44.entities.CharacterRelationship.filter({
        source_character_id: playingAsCharacterId,
        target_character_id: characterId,
      });

      if (existingRels.length === 0) {
        await base44.entities.CharacterRelationship.create({
          source_character_id: playingAsCharacterId,
          target_character_id: characterId,
          person_name: targetChar.name,
          relationship_type: 'acquaintance',
          current_status: 'ongoing',
          friendship_level: 50,
          user_respect_level: 50,
          romantic_level: 0,
          attraction_level: 0,
          chosen_family_level: 0,
        });
      }
    }

    return Response.json({ success: true, newPeopleDetected });
  } catch (error) {
    console.error('extractMemoriesFromTurn error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});