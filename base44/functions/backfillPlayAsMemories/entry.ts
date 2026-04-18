import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { playingAsCharacterId, conversationId, targetCharacterId, targetCharacterName } = await req.json();

    if (!playingAsCharacterId || !conversationId || !targetCharacterId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Fetch all messages in the conversation
    const messages = await base44.entities.Message.filter(
      { conversation_id: conversationId },
      "created_date",
      1000
    );

    const playingAsChar = await base44.entities.Character.filter({ id: playingAsCharacterId }).then(r => r[0]);
    if (!playingAsChar) return Response.json({ error: 'Playing-as character not found' }, { status: 404 });

    // Build conversation summary
    const conversationSummary = messages
      .map(m => `${m.sender_type === 'character' ? targetCharacterName : playingAsChar.name}: ${m.content}`)
      .join('\n');

    // Extract what the playing-as character should remember
    const memoryText = await base44.integrations.Core.InvokeLLM({
      prompt: `You are ${playingAsChar.name}. You just had a full conversation with ${targetCharacterName}. Here's what happened:

${conversationSummary}

Write a personal memory (2-3 sentences) of this conversation from your perspective. What did you learn about them? How did the interaction make you feel? Be authentic and natural.`,
    });

    // Create memory for the playing-as character
    const memory = await base44.entities.Memory.create({
      character_id: playingAsCharacterId,
      title: `Conversation with ${targetCharacterName}`,
      description: memoryText,
      emotional_impact: 'neutral',
      timestamp: new Date().toISOString(),
      source_context: `conversation_${conversationId}`,
    });

    // Create or update fictional relationship
    const existingRelationships = await base44.entities.CharacterRelationship.filter({
      character_id: playingAsCharacterId,
      related_character_id: targetCharacterId,
    });

    let relationship;
    if (existingRelationships.length > 0) {
      relationship = existingRelationships[0];
    } else {
      relationship = await base44.entities.CharacterRelationship.create({
        character_id: playingAsCharacterId,
        related_character_id: targetCharacterId,
        person_name: targetCharacterName,
        relationship_type: 'acquaintance',
        description: `Someone I know. We've talked.`,
        current_status: 'ongoing',
        last_interaction_summary: memoryText,
        friendship_level: 50,
        user_respect_level: 50,
        romantic_level: 0,
        attraction_level: 0,
        chosen_family_level: 0,
      });
    }

    return Response.json({
      success: true,
      memory: memory.id,
      relationship: relationship.id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});