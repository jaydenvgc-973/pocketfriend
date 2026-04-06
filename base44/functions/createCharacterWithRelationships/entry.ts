import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    // Define the people to create and who they belong to
    const peopleToDeclare = [
      { name: 'Mace', owner: 'Ethan Nathan Thompson', type: 'best_friend' },
      { name: 'Carlos Mendez', owner: 'Matt Lopez', type: 'best_friend' },
      { name: 'Mia Chen', owner: 'Ava Dei Park', type: 'friend' },
      { name: 'Leah Park', owner: 'Ava Dei Park', type: 'friend' },
      { name: 'Jordan Li', owner: 'Ava Dei Park', type: 'friend' },
      { name: 'Demi Rivers', owner: 'Jonathan Anthony  Smith', type: 'best_friend' },
    ];

    const created = [];
    const linked = [];

    // Create character records for each person
    for (const person of peopleToDeclare) {
      const ownerChar = characters.find(c => c.name === person.owner);
      if (!ownerChar) {
        created.push({ name: person.name, status: 'FAILED', reason: `Owner "${person.owner}" not found` });
        continue;
      }

      // Create the NPC character
      const npcChar = await base44.entities.Character.create({
        name: person.name,
        character_type: 'npc',
        status: 'active',
        created_by: user.email,
      });

      created.push({ name: person.name, id: npcChar.id, status: 'CREATED' });

      // Now update the owner's fictional_relationships to link to this new character
      const existingRels = ownerChar.fictional_relationships || [];
      const filtered = existingRels.filter(r => r.person_name !== person.name);
      const newRel = {
        person_name: person.name,
        relationship_type: person.type,
        related_character_id: npcChar.id,
        description: person.type === 'best_friend' ? 'Best friend' : 'Friend',
        current_status: 'close'
      };
      filtered.push(newRel);

      await base44.entities.Character.update(ownerChar.id, {
        fictional_relationships: filtered
      });

      linked.push({
        person: person.name,
        owner: person.owner,
        relationship_type: person.type,
        related_character_id: npcChar.id,
        status: 'LINKED'
      });
    }

    return Response.json({
      characters_created: created,
      relationships_linked: linked,
      summary: `Created ${created.filter(c => c.status === 'CREATED').length} characters and linked ${linked.filter(l => l.status === 'LINKED').length} relationships`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});