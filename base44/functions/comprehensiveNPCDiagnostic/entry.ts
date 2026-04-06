import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const diagnostics = {};

    const expectedNPCs = {
      'Ava Dei Park': ['Mia Chen', 'Leah Park', 'Jordan Li'],
      'Matt Lopez': ['Carlos Mendez'],
      'Ethan Nathan Thompson': ['Mace'],
      'Jonathan Anthony  Smith': ['Demi Rivers']
    };

    for (const [charName, expectedNames] of Object.entries(expectedNPCs)) {
      const character = characters.find(c => c.name === charName);
      if (!character) {
        diagnostics[charName] = { 
          error: 'CHARACTER_NOT_FOUND'
        };
        continue;
      }

      const rels = character.fictional_relationships || [];
      
      // Find which expected NPCs are present
      const found = {};
      const notFound = [];

      for (const npcName of expectedNames) {
        const rel = rels.find(r => r.person_name?.toLowerCase() === npcName.toLowerCase());
        if (rel) {
          found[npcName] = {
            person_name: rel.person_name,
            has_related_character_id: !!rel.related_character_id,
            related_character_id: rel.related_character_id || null,
            relationship_type: rel.relationship_type,
            _raw: JSON.stringify(rel)
          };
        } else {
          notFound.push(npcName);
        }
      }

      // Find extra NPCs that shouldn't be there
      const extraNPCs = rels
        .filter(r => !r.related_character_id && !expectedNames.includes(r.person_name))
        .map(r => r.person_name);

      diagnostics[charName] = {
        totalRelationships: rels.length,
        expectedNPCs: expectedNames.length,
        foundNPCs: Object.keys(found).length,
        found,
        notFound,
        extraNPCs: extraNPCs.length > 0 ? extraNPCs : [],
        allRelationships: rels.map(r => ({
          person_name: r.person_name,
          has_related_character_id: !!r.related_character_id,
          relationship_type: r.relationship_type
        }))
      };
    }

    return Response.json({ success: true, diagnostics });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});