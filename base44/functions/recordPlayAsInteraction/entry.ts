import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      playingAsCharacterId,
      playingAsCharacterName,
      targetCharacterId,
      targetCharacterName,
      userAction,
      targetResponse,
      emotionalReaction,
    } = await req.json();

    if (!playingAsCharacterId || !targetCharacterId) {
      return Response.json({ error: 'Missing character IDs' }, { status: 400 });
    }

    // Extract what the playing-as character learned or felt
    const memory = await base44.integrations.Core.InvokeLLM({
      prompt: `As ${playingAsCharacterName}, I just had an interaction with ${targetCharacterName}.
      
What I did/said: "${userAction}"
How they responded: "${targetResponse}"

Write a short, personal memory entry (2-3 sentences) from ${playingAsCharacterName}'s perspective about what this means to them, what they learned, or how it made them feel. Write in first person, natural and authentic.`,
    });

    // Store as a memory for the playing-as character
    await base44.entities.Memory.create({
      character_id: playingAsCharacterId,
      title: `Interaction with ${targetCharacterName}`,
      description: memory,
      emotional_impact: emotionalReaction || 'neutral',
      timestamp: new Date().toISOString(),
      source_context: `play_as_interaction_${targetCharacterId}`,
    });

    return Response.json({ success: true, memory });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});