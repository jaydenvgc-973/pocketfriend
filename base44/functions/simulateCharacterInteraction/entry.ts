import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character_ids, userPrompt } = await req.json();
    
    if (!character_ids || character_ids.length < 2) {
      return Response.json({ error: 'At least 2 character IDs required' }, { status: 400 });
    }

    const characters = await Promise.all(
      character_ids.map(id => base44.entities.Character.list().then(chars => 
        chars.find(c => c.id === id)
      ))
    );

    if (characters.some(c => !c)) {
      return Response.json({ error: 'One or more characters not found' }, { status: 404 });
    }

    // Build relationship context
    const getRelationshipContext = (fromChar, toChar) => {
      const rel = (fromChar.fictional_relationships || []).find(r => r.related_character_id === toChar.id);
      if (rel) {
        return `${fromChar.name} views ${toChar.name} as a ${rel.relationship_type}. ${rel.description || ''} Current status: ${rel.current_status || 'unknown'}.`;
      }
      return `${fromChar.name} and ${toChar.name} haven't established a formal relationship yet.`;
    };

    // Build character profiles for interaction
    const characterProfiles = characters.map(char => ({
      id: char.id,
      name: char.name,
      personality: char.personality_summary || '',
      traits: (char.personality_traits || []).join(', '),
      emotionalState: char.emotional_state || 'calm',
      currentSituation: char.current_life_event || char.current_situation || '',
      archetype: char.archetype || 'unknown'
    }));

    // Generate interaction prompt
    const interactionContext = characters.length === 2 
      ? `${getRelationshipContext(characters[0], characters[1])}\n${getRelationshipContext(characters[1], characters[0])}`
      : characters.map((char, i) => {
          const others = characters.filter((_, j) => j !== i);
          return others.map(other => getRelationshipContext(char, other)).join('\n');
        }).join('\n');

    const userPromptDirective = userPrompt 
      ? `USER DIRECTION (HIGHEST PRIORITY): ${userPrompt}\n\nBase the interaction around this direction. Make it central to what happens.`
      : '';

    const prompt = `${userPromptDirective ? `${userPromptDirective}\n\n---\n\n` : ''}Simulate a realistic interaction between these characters:

${characterProfiles.map(p => `
NAME: ${p.name}
Archetype: ${p.archetype}
Emotional state: ${p.emotionalState}
Personality: ${p.personality}
Core traits: ${p.traits}
Current life: ${p.currentSituation}
`).join('\n')}

RELATIONSHIP CONTEXT (fine-tune details based on this):
${interactionContext}

Generate a natural conversation/interaction scene that:
1. STRICTLY FOLLOW the user direction above if provided — this is your primary constraint
2. Each character acts according to their ARCHETYPE — this is their core lens on the world
3. Their emotional state heavily shapes their tone, patience, and openness
4. Relationships provide context for how they interact, but do not override archetype/mood
5. Includes realistic dialogue with distinct voices for each character
6. Results in some outcome — does the interaction bring them closer, create tension, resolve something, or leave them confused?

Return a JSON object with:
{
  "scene_summary": "brief description of what happened and the setting",
  "dialogue": [
    { "speaker": "character_name", "text": "dialogue" },
    ...
  ],
  "outcome": "what changed or was revealed in this interaction",
  "emotional_shifts": { "character_name": "how their emotional state changed" },
  "relationship_updates": {
    "character_name_1": {
      "other_character_id": "other_character_id",
      "last_interaction_summary": "specific summary of this interaction",
      "updated_status": "current status after this interaction",
      "emotional_impact": "how this interaction affected them"
    },
    ...
  }
}`;

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          scene_summary: { type: 'string' },
          dialogue: { 
            type: 'array',
            items: {
              type: 'object',
              properties: {
                speaker: { type: 'string' },
                text: { type: 'string' }
              }
            }
          },
          outcome: { type: 'string' },
          emotional_shifts: { type: 'object' },
          relationship_updates: { type: 'object' }
        }
      },
      model: 'gemini_3_flash'
    });

    // Update each character with interaction data
    for (const character of characters) {
      const updates = response.relationship_updates[character.name];
      
      if (updates) {
        // Find the corresponding character being interacted with
        const otherCharId = updates.other_character_id;
        const otherChar = characters.find(c => c.id === otherCharId);

        if (otherChar) {
          // Update transient encounters
          const newEncounter = {
            description: `Interaction with ${otherChar.name}: ${response.scene_summary}`,
            context: 'character interaction simulation',
            emotional_reaction: response.emotional_shifts[character.name] || 'neutral',
            date: new Date().toISOString()
          };

          const updatedEncounters = [...(character.transient_encounters || []), newEncounter];

          // Update fictional relationships
          const updatedRelationships = (character.fictional_relationships || []).map(rel => {
            if (rel.related_character_id === otherCharId) {
              return {
                ...rel,
                last_interaction_summary: updates.last_interaction_summary,
                current_status: updates.updated_status,
                emotional_impact: updates.emotional_impact
              };
            }
            return rel;
          });

          // If no existing relationship but should have one after interaction
          if (!updatedRelationships.some(r => r.related_character_id === otherCharId)) {
            updatedRelationships.push({
              person_name: otherChar.name,
              related_character_id: otherCharId,
              relationship_type: 'acquaintance',
              description: response.scene_summary,
              current_status: updates.updated_status,
              emotional_impact: updates.emotional_impact,
              last_interaction_summary: updates.last_interaction_summary,
              history_summary: 'Recently had their first significant interaction'
            });
          }

          // Update character with new data
          await base44.entities.Character.update(character.id, {
            transient_encounters: updatedEncounters,
            fictional_relationships: updatedRelationships,
            emotional_state: response.emotional_shifts[character.name]?.split(' ')[0] || character.emotional_state
          });
        }
      }
    }

    return Response.json({
      success: true,
      interaction: {
        characters: characterProfiles.map(p => p.name),
        scene_summary: response.scene_summary,
        dialogue: response.dialogue,
        outcome: response.outcome,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Interaction simulation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});