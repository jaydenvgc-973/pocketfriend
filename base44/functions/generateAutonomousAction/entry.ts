import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId, conversationId } = await req.json();
    
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch character and conversation
    const characters = await base44.entities.Character.filter({ id: characterId });
    const character = characters[0];
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const convos = conversationId 
      ? await base44.entities.Conversation.filter({ id: conversationId })
      : [];
    const convo = convos[0];
    if (!convo) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch recent messages and memories to determine natural next action
    const recentMsgs = await base44.entities.Message.filter(
      { conversation_id: convo.id },
      '-created_date',
      10
    );

    const memories = await base44.entities.Memory.filter(
      { character_id: characterId },
      '-timestamp',
      8
    );

    // Build context for autonomous action
    const charDesc = [character.appearance_notes, character.personality_summary, character.archetype].filter(Boolean).join(', ');
    const currentActivity = character.current_activity || 'existing';
    const emotionalState = character.emotional_state || 'calm';
    
    const memoryContext = memories.length > 0
      ? `Recent memories: ${memories.map(m => m.title).join('; ')}`
      : '';

    const recentContext = recentMsgs.length > 0
      ? `Last message: "${recentMsgs[0].content?.substring(0, 100)}..."`
      : '';

    // Generate autonomous action via LLM
    const prompt = `You are ${character.name} (${charDesc}).

Current emotional state: ${emotionalState}
Currently: ${currentActivity}
${memoryContext ? `\n${memoryContext}` : ''}
${recentContext ? `\n${recentContext}` : ''}

Generate a SINGLE autonomous narrative action — something you naturally do without being prompted.

This is NOT dialogue. This is ONLY an action/movement/activity.

Examples:
- Ethan grabs his keys and heads out the door.
- Ethan sits down with his phone, scrolling through messages.
- Ethan stretches and looks out the window.
- Ethan walks down the street, hands in his pockets.

Rules:
- ONLY describe action — no dialogue
- Be specific and vivid
- Include location if moving
- Keep it 1-2 sentences max
- Make it naturally flow from their current state

Return ONLY the narrative action text, nothing else.`;

    const actionText = await base44.integrations.Core.InvokeLLM({ prompt });

    if (!actionText?.trim()) {
      return Response.json({ success: false, message: 'No action generated' }, { status: 200 });
    }

    // Save as narrative message (separate from dialogue — is_narrative = true)
    const narrativeMsg = await base44.entities.Message.create({
      conversation_id: convo.id,
      sender_type: 'character',
      character_id: characterId,
      character_name: character.name,
      content: actionText.trim(),
      is_narrative: true,  // CRITICAL: Must be true for autonomous narrative entries
      emotional_state: emotionalState,
      timestamp: new Date().toISOString(),
    });

    // Save memory of this action
    await base44.entities.Memory.create({
      character_id: characterId,
      title: `Autonomous action: ${actionText.substring(0, 60)}`,
      description: actionText.trim(),
      emotional_impact: emotionalState,
      timestamp: new Date().toISOString(),
      source_context: `autonomous_${narrativeMsg.id}`,
    }).catch(() => {});

    // Update conversation
    await base44.entities.Conversation.update(convo.id, {
      last_message_preview: actionText.substring(0, 100),
      last_message_date: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({ 
      success: true, 
      messageId: narrativeMsg.id,
      action: actionText.trim()
    });

  } catch (error) {
    console.error('generateAutonomousAction error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});