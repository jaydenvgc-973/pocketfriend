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
      'Demi Rivers': { ownerName: 'Jonathan Anthony  Smith', name: 'Demi Rivers', type: 'best_friend' },
      'Mia Chen': { ownerName: 'Ava Dei Park', name: 'Mia Chen', type: 'friend' },
      'Leah Park': { ownerName: 'Ava Dei Park', name: 'Leah Park', type: 'friend' },
      'Jordan Li': { ownerName: 'Ava Dei Park', name: 'Jordan Li', type: 'friend' },
      'Mace': { ownerName: 'Ethan Nathan Thompson', name: 'Mace', type: 'best_friend' },
      'Carlos Mendez': { ownerName: 'Matt Lopez', name: 'Carlos Mendez', type: 'best_friend' },
    };

    const updates = [];
    const results = [];

    for (const [key, relData] of Object.entries(relationshipUpdates)) {
      const ownerChar = characters.find(c => c.name === relData.ownerName);
      const targetChar = characters.find(c => c.name === relData.name);

      if (!ownerChar) {
        results.push({ relationship: key, status: 'FAILED', reason: `Owner "${relData.ownerName}" not found` });
        continue;
      }

      // Build new relationship object
      const newRel = {
        person_name: relData.name,
        relationship_type: relData.type,
        description: relData.type === 'best_friend' ? `Best friend` : `Friend`,
        current_status: 'close',
        avatar_url: targetChar?.avatar_url || undefined,
        related_character_id: targetChar?.id || undefined
      };

      // Remove any existing relationships with this person from the owner
      const existing = ownerChar.fictional_relationships || [];
      const filtered = existing.filter(r => r.person_name !== relData.name);
      filtered.push(newRel);

      updates.push(
        base44.entities.Character.update(ownerChar.id, {
          fictional_relationships: filtered
        }).then(() => {
          results.push({ 
            relationship: `${relData.name} → ${relData.ownerName}`, 
            status: 'SUCCESS',
            character_id: ownerChar.id,
            related_character_id: targetChar?.id || 'NOT_FOUND'
          });
        }).catch(err => {
          results.push({ 
            relationship: key, 
            status: 'FAILED', 
            reason: err.message 
          });
        })
      );
    }

    await Promise.all(updates);

    // Now remove these people from Matt Lopez's fictional_relationships entirely
    const matt = characters.find(c => c.name === 'Matt Lopez');
    if (matt) {
      const mattRels = matt.fictional_relationships || [];
      const peopleToRemove = ['Sofia Garcia', 'Jasmine Rodriguez', 'Kiara', 'Nick Decker'];
      const filteredMattRels = mattRels.filter(r => !peopleToRemove.includes(r.person_name));
      
      // Also remove Carlos Mendez since it's being reassigned
      const finalMattRels = filteredMattRels.filter(r => r.person_name !== 'Carlos Mendez');
      
      await base44.entities.Character.update(matt.id, {
        fictional_relationships: finalMattRels
      });
      
      results.push({
        action: 'Cleaned Matt Lopez relationships',
        removed: peopleToRemove.concat(['Carlos Mendez']),
        status: 'SUCCESS'
      });
    }

    return Response.json({
      fixed_relationships: results,
      summary: `Fixed ${results.filter(r => r.status === 'SUCCESS').length} relationships`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});