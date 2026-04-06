import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const activeChars = {
      'Ava Dei Park': ['Mia Chen', 'Leah Park', 'Jordan Li'],
      'Matt Lopez': ['Carlos Mendez'],
      'Ethan Nathan Thompson': ['Mace'],
      'Jonathan Anthony  Smith': ['Demi Rivers']
    };

    const report = {};

    for (const [charName, expectedNPCs] of Object.entries(activeChars)) {
      const character = characters.find(c => c.name === charName);
      if (!character) {
        report[charName] = { status: 'character_not_found' };
        continue;
      }

      const rels = character.fictional_relationships || [];
      const npcRelsInList = rels.filter(r => 
        !r.related_character_id && 
        expectedNPCs.includes(r.person_name)
      );

      report[charName] = {
        characterId: character.id,
        totalRelationships: rels.length,
        npcRelationships: npcRelsInList.length,
        foundNPCs: npcRelsInList.map(r => r.person_name),
        missingNPCs: expectedNPCs.filter(npc => 
          !rels.some(r => r.person_name === npc)
        ),
        allNPCsPresent: expectedNPCs.every(npc => 
          rels.some(r => r.person_name === npc)
        )
      };
    }

    return Response.json({ success: true, report });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});