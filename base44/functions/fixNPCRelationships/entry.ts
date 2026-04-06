import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const relationshipUpdates = {
      'Demi Rivers': { name: 'Jonathan', type: 'best_friend' },
      'Mia Chen': { name: 'Ava', type: 'friend' },
      'Leah Park': { name: 'Ava', type: 'friend' },
      'Jordan Li': { name: 'Ava', type: 'friend' },
      'Mace': { name: 'Ethan', type: 'best_friend' },
      'Carlos Mendez': { name: 'Matt', type: 'best_friend' },
    };

    const updates = [];

    for (const [charName, relData] of Object.entries(relationshipUpdates)) {
      const character = characters.find(c => c.name === charName);
      if (!character) continue;

      const newRel = {
        person_name: relData.name,
        relationship_type: relData.type,
        description: relData.type === 'best_friend' ? `Best friend` : `Friend`,
        current_status: 'close',
        avatar_url: character.avatar_url,
      };

      const existing = character.fictional_relationships || [];
      const filtered = existing.filter(r => r.person_name !== relData.name);
      filtered.push(newRel);

      updates.push(
        base44.entities.Character.update(character.id, {
          fictional_relationships: filtered
        })
      );
    }

    await Promise.all(updates);

    return Response.json({
      success: true,
      message: 'Relationships updated',
      updated: Object.keys(relationshipUpdates).length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});