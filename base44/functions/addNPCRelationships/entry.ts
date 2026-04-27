import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * addNPCRelationships
 *
 * Creates real NPC Character records for named people and links them
 * to the specified active characters via fictional_relationships.
 *
 * Each NPC gets a full Character entity (via createNPCCharacter) — never a name-only label.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters created by this user to find speaking characters by name
    const characters = await base44.entities.Character.filter({ created_by: user.email });

    const relationships = {
      'Ava Dei Park': ['Mia Chen', 'Leah Park', 'Jordan Li'],
      'Matt Lopez': ['Carlos Mendez'],
      'Ethan Nathan Thompson': ['Mace'],
      'Jonathan Anthony  Smith': ['Demi Rivers']
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

      const added = [];
      const skipped = [];

      for (const npcName of npcNames) {
        if (existingNames.has(npcName.toLowerCase())) {
          skipped.push(npcName);
          continue;
        }

        // Create or find a real Character record for this NPC via the existing createNPCCharacter function
        try {
          const res = await base44.functions.invoke('createNPCCharacter', {
            name: npcName,
            relationship_type: 'acquaintance',
            speaking_character_id: character.id,
          });

          if (res?.data?.success) {
            added.push(npcName);
          } else {
            console.error(`[addNPCRelationships] createNPCCharacter failed for "${npcName}":`, res?.data);
          }
        } catch (err) {
          console.error(`[addNPCRelationships] Error creating NPC "${npcName}":`, err.message);
        }
      }

      results[charName] = { status: 'processed', added, skipped };
    }

    return Response.json({ success: true, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});