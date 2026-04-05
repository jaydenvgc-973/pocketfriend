import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, oldHomeId, newHomeId } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: characterId });
    if (!character || character.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const char = character[0];
    let updated = false;
    const changes = {};

    // Check if current_situation mentions living with family/mother/parent
    if (char.current_situation) {
      const lowerSitu = char.current_situation.toLowerCase();
      const movingOutPatterns = /living with|staying with|lives with|with (my|his|her|their)? (family|mother|father|parent|mom|dad)/gi;
      
      if (movingOutPatterns.test(lowerSitu)) {
        // User is moving out — remove living-with references
        let updatedSituation = char.current_situation
          .replace(/\s*living with (my|his|her|their)? (family|mother|father|parent|mom|dad)?\.?/gi, '')
          .replace(/\s*staying with (my|his|her|their)? (family|mother|father|parent|mom|dad)?\.?/gi, '')
          .replace(/\s*lives with (my|his|her|their)? (family|mother|father|parent|mom|dad)?\.?/gi, '')
          .trim();

        // Append new situation
        updatedSituation += ` Recently moved to a new place and is adjusting to independent living.`;
        
        changes.current_situation = updatedSituation;
        updated = true;
      }
    }

    // Also check background_story for living situation mentions
    if (char.background_story) {
      const lowerBG = char.background_story.toLowerCase();
      if (/lived with|growing up with|raised by|lived with family/.test(lowerBG)) {
        // Add a note about their move — don't remove origin story, just acknowledge the change
        changes.current_life_event = `Recently moved out of their family home. Adjusting to independent life.`;
        updated = true;
      }
    }

    if (updated && Object.keys(changes).length > 0) {
      await base44.entities.Character.update(characterId, changes);
    }

    return Response.json({
      success: true,
      updated,
      changes: Object.keys(changes),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});