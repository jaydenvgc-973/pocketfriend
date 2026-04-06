import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const relationshipMap = {
      'Ava Dei Park': ['Mia Chen', 'Leah Park', 'Jordan Li'],
      'Matt Lopez': ['Carlos Mendez'],
      'Ethan Nathan Thompson': ['Mace'],
      'Jonathan Anthony  Smith': ['Demi Rivers']
    };

    const results = {};

    for (const [charName, npcNames] of Object.entries(relationshipMap)) {
      const character = characters.find(c => c.name === charName);
      if (!character) {
        results[charName] = { status: 'not_found' };
        continue;
      }

      const rels = character.fictional_relationships || [];
      const updated = rels.map(rel => {
        // If this NPC is in our list, remove the related_character_id to make it pure NPC
        if (npcNames.includes(rel.person_name) && rel.related_character_id) {
          return {
            ...rel,
            related_character_id: null
          };
        }
        return rel;
      });

      // Check if any changes were made
      const changed = updated.some((u, i) => u.related_character_id !== rels[i].related_character_id);
      
      if (changed) {
        await base44.entities.Character.update(character.id, {
          fictional_relationships: updated
        });
        results[charName] = { status: 'updated', npcsUnlinked: npcNames };
      } else {
        results[charName] = { status: 'no_changes' };
      }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});