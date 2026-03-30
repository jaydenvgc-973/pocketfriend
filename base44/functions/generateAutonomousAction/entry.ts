import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Generate an autonomous action for a character.
 * 
 * Characters can perform actions independently without user input.
 * These actions are submitted as narrative entries.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const {
      characterId,
      characterName,
      characterSummary,
      recentMessages = [],
      currentLocation = null,
    } = await req.json();

    if (!characterId || !characterName) {
      return Response.json({ error: 'characterId and characterName required' }, { status: 400 });
    }

    // Generate an autonomous action based on character personality and context
    const recentContext = recentMessages.slice(-5)
      .map(m => `${m.character_name}: ${m.content}`)
      .join('\n') || 'No recent messages.';

    const prompt = `You are ${characterName}${characterSummary ? ` (${characterSummary})` : ''}.

Right now you are ${currentLocation ? `at ${currentLocation}` : 'going about your day'}.

Recent context:
${recentContext}

Generate ONE autonomous action that ${characterName} would naturally perform right now. This should be something you do independently, without the user's input.

The action should:
- Start with "${characterName}" followed by a verb (walks, sits, calls, grabs, picks up, etc.)
- Describe real behavior, movement, or interaction with the environment
- Be 1-2 sentences max
- Feel natural and spontaneous
- NOT be dialogue (no quotes)
- NOT require the user's presence to make sense

Examples:
- "${characterName} picks up his phone and scrolls through messages."
- "${characterName} looks out the window, lost in thought."
- "${characterName} stands up and stretches, feeling the tension in his shoulders."
- "${characterName} walks over to the kitchen and pours a drink."

Generate ONLY the action text, nothing else.`;

    const actionText = await base44.integrations.Core.InvokeLLM({
      prompt,
      model: 'gemini_3_flash',
    });

    if (!actionText || actionText.trim().length < 5) {
      return Response.json({ error: 'Failed to generate meaningful action' }, { status: 500 });
    }

    return Response.json({
      success: true,
      action: actionText.trim(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});