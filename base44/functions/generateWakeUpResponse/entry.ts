import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Generates a personality-based wake-up response when a sleeping character is woken up.
 * Considers personality traits, relationship levels, and sleep interruption tolerance.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterData } = await req.json();
    if (!characterId || !characterData) {
      return Response.json({ error: 'characterId and characterData required' }, { status: 400 });
    }

    const char = characterData;
    
    // Build personality context
    const personalityFactors = {
      traits: char.personality_traits || [],
      summary: char.personality_summary || '',
      communication_style: char.communication_style || '',
      emotional_state: char.emotional_state || 'calm',
      emotional_triggers: {
        high: char.emotional_triggers_high || [],
        medium: char.emotional_triggers_medium || [],
        deep: char.emotional_triggers_deep || [],
      },
    };

    // Relationship context
    const relationshipFactors = {
      friendship_level: char.friendship_level ?? 75,
      romantic_level: char.romantic_level ?? 0,
      user_respect_level: char.user_respect_level ?? 50,
      chosen_family_level: char.chosen_family_level ?? 0,
    };

    // Determine wake tolerance based on personality
    let wakeTolerance = 'medium'; // default
    const traits = personalityFactors.traits.map(t => t.toLowerCase());
    if (traits.some(t => t.includes('patient') || t.includes('easygoing') || t.includes('calm'))) {
      wakeTolerance = 'high';
    } else if (traits.some(t => t.includes('irritable') || t.includes('grumpy') || t.includes('angry'))) {
      wakeTolerance = 'low';
    }

    // Generate wake response via LLM
    const prompt = `You are ${char.name}. Someone just woke you up because they want you to come with them somewhere.

PERSONALITY & TRAITS:
- Summary: ${personalityFactors.summary}
- Communication style: ${personalityFactors.communication_style}
- Current mood: ${personalityFactors.emotional_state}
- Key traits: ${traits.join(', ') || 'balanced'}

RELATIONSHIP WITH THE USER:
- Friendship: ${relationshipFactors.friendship_level}/100
- Romantic: ${relationshipFactors.romantic_level}/100
- Respect: ${relationshipFactors.user_respect_level}/100
- Family closeness: ${relationshipFactors.chosen_family_level}/100

YOUR WAKE TOLERANCE: ${wakeTolerance}
- high = don't mind being woken, can be cooperative or affectionate
- medium = groggy but manageable, may negotiate or be neutral
- low = irritated or defensive when woken suddenly

TASK: You just woke up. Someone is asking you to come somewhere with them.

Generate a BRIEF, AUTHENTIC response (1-2 sentences max) that reflects:
1. How you react to being woken up (groggy? annoyed? fine with it?)
2. Your personality (irritable? calm? playful?)
3. Your relationship (closer = more willing; distant = more resistant)
4. Whether you'll come or refuse

Examples of different reactions:
- "I'm up. Give me 10 minutes..." (cooperative, some irritation)
- "You woke me up for this?" (defensive, may still come)
- "If it's you, I don't mind." (affectionate response to close person)
- "Absolutely not, let me sleep." (hard refusal)
- "Fine, fine. I'm getting dressed." (annoyed but agreeing)

Respond ONLY with the character's dialogue. No narration, no explanations.`;

    const wakeResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
    });

    // Determine outcome: agreed, refused, or negotiating
    const responseText = (wakeResponse || '').toLowerCase();
    let outcome = 'agreed'; // default
    if (responseText.includes('no') || responseText.includes('not') || responseText.includes('sleep')) {
      outcome = 'refused';
    } else if (
      responseText.includes('give me') ||
      responseText.includes('wait') ||
      responseText.includes('minute') ||
      responseText.includes('get dressed')
    ) {
      outcome = 'negotiating';
    }

    // Determine mood modifier for venue interaction
    let moodModifier = 'neutral';
    if (wakeTolerance === 'low') {
      moodModifier = relationshipFactors.friendship_level > 70 ? 'slightly_annoyed' : 'irritated';
    } else if (wakeTolerance === 'high' && relationshipFactors.friendship_level > 70) {
      moodModifier = 'cooperative';
    } else if (relationshipFactors.romantic_level > 50) {
      moodModifier = 'affectionate';
    }

    // Calculate realistic prep time if they agreed
    let prepTimeMs = 0;
    if (outcome !== 'refused') {
      prepTimeMs = 30000 + Math.random() * 30000; // 30-60 seconds to get ready
    }

    return Response.json({
      success: true,
      wakeResponse: wakeResponse || "I'm awake. What?",
      outcome, // agreed | refused | negotiating
      moodModifier, // affects venue interaction
      prepTimeMs, // time to get ready if agreed
      wakeTolerance,
    });
  } catch (error) {
    console.error('[generateWakeUpResponse]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});