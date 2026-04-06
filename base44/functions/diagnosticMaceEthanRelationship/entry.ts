import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const mace = characters.find(c => c.name === 'Mace');
    const ethan = characters.find(c => c.name === 'Ethan');

    if (!mace) {
      return Response.json({
        mace_found: false,
        ethan_found: !!ethan,
        error: 'Mace character not found'
      });
    }

    if (!ethan) {
      return Response.json({
        mace_found: true,
        ethan_found: false,
        error: 'Ethan character not found'
      });
    }

    const maceRelationships = mace.fictional_relationships || [];
    const ethanRelation = maceRelationships.find(r => r.person_name === 'Ethan');

    return Response.json({
      mace_found: true,
      ethan_found: true,
      mace_id: mace.id,
      ethan_id: ethan.id,
      mace_relationships_count: maceRelationships.length,
      mace_all_relationships: maceRelationships.map(r => ({
        person_name: r.person_name,
        relationship_type: r.relationship_type,
        related_character_id: r.related_character_id
      })),
      ethan_relation_exists: !!ethanRelation,
      ethan_relation: ethanRelation ? {
        person_name: ethanRelation.person_name,
        relationship_type: ethanRelation.relationship_type,
        related_character_id: ethanRelation.related_character_id
      } : null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});