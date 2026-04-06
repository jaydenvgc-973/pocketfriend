import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters created by this user
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const relationships = {
      'Ava': ['Mia', 'Leah', 'Jordan'],
      'Matt': ['Carlos'],
      'Ethan': ['Mace'],
      'Jonathan': ['Demi']
    };

    const results = {};

    for (const [charName, npcNames] of Object.entries(relationships)) {
      const character = characters.find(c => c.name === charName);
      if (!character) {
        results[charName] = { status: 'not_found' };
        continue;
      }

      const currentRels = character.fictional_relationships || [];
      const existingNames = new Set(currentRels.map(r => r.person_name?.toLowerCase()));
      
      const newRels = npcNames
        .filter(npcName => !existingNames.has(npcName.toLowerCase()))
        .map(npcName => ({
          person_name: npcName,
          related_character_id: null,
          relationship_type: 'acquaintance',
          description: '',
          current_status: '',
          emotional_impact: '',
          last_interaction_summary: '',
          history_summary: '',
          avatar_url: '',
          user_respect_level: 50,
          friendship_level: 75,
          romantic_level: 0,
          attraction_level: 0,
          chosen_family_level: 0
        }));

      if (newRels.length > 0) {
        await base44.entities.Character.update(character.id, {
          fictional_relationships: [...currentRels, ...newRels]
        });
        results[charName] = { status: 'updated', added: newRels.map(r => r.person_name) };
      } else {
        results[charName] = { status: 'skipped', reason: 'all NPCs already present' };
      }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});