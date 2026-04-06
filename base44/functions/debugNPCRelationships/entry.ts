import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    const avaChar = characters.find(c => c.name === 'Ava Dei Park');
    if (!avaChar) {
      return Response.json({ error: 'Ava not found' }, { status: 404 });
    }

    // Show ALL relationships for Ava
    const allRels = avaChar.fictional_relationships || [];
    const npcOnlyRels = allRels.filter(r => !r.related_character_id);
    const linkedRels = allRels.filter(r => r.related_character_id);

    return Response.json({
      avaId: avaChar.id,
      totalRelationships: allRels.length,
      linkedCharacterRels: linkedRels.map(r => ({ person: r.person_name, charId: r.related_character_id })),
      npcRels: npcOnlyRels.map(r => r.person_name),
      allRelDetails: allRels.map(r => ({ 
        person_name: r.person_name, 
        has_related_character_id: !!r.related_character_id,
        relationship_type: r.relationship_type
      }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});