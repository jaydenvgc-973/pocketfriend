import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, messageContent } = await req.json();
    if (!characterId || !messageContent) {
      return Response.json({ error: 'Missing characterId or messageContent' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: characterId }).then(r => r[0]);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const text = messageContent.toLowerCase().trim();

    // MASTER REASONING RULE: Read for context, not keywords
    // Determine tense FIRST: Is this present, past, future, or hypothetical?
    
    const isPastTense = /^(i was|i went|i had been|just|earlier|before|yesterday|last|ago)\b/.test(text);
    const isFutureTense = /\b(will|going to|later|tomorrow|next|planning|supposed to|have to)\b/.test(text);
    const isHypothetical = /\b(would|could|might|usually|normally|sometimes|if i)\b/.test(text);

    // RULE: Only extract PRESENT tense statements
    // Past, future, or hypothetical are memories/plans, not current activity
    if (isPastTense || isFutureTense || isHypothetical) {
      return Response.json({
        success: false,
        characterId,
        message: 'This is not a present statement. It should be stored as memory, not activity.',
        tense: isPastTense ? 'past' : isFutureTense ? 'future' : 'hypothetical',
      });
    }

    // Now extract PRESENT context by reading full sentence structure
    let extractedActivity = null;

    // Pattern: "I'm [at/in] [place/doing]" — read the full context
    const presentMatch = text.match(/i[\'m]*\s+(.+?)(?:\.|,|!|\?|$)/i);
    if (presentMatch && presentMatch[1]) {
      const contextPhrase = presentMatch[1].trim();
      
      // Validate this is actually a present activity, not a fragment
      if (contextPhrase.length > 2 && contextPhrase.length < 100) {
        // Check if the context makes sense as a current activity
        // Example: "at work reading" or "at home relaxing" or "in class"
        
        // Rule: Don't filter based on keywords. Read what they're actually saying.
        extractedActivity = contextPhrase;
      }
    }

    // Only update if we extracted something meaningful
    if (extractedActivity) {
      await base44.entities.Character.update(characterId, {
        current_activity: extractedActivity,
      });

      return Response.json({
        success: true,
        characterId,
        characterName: character.name,
        extractedActivity,
        message: `Updated ${character.name}'s activity to: "${extractedActivity}"`,
      });
    }

    return Response.json({
      success: false,
      characterId,
      characterName: character.name,
      message: 'No present-tense activity extracted from message. (Check: is this a past statement, future plan, or hypothetical?)',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});