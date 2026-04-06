import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Restores fictional_relationships on all active characters
 * by rebuilding from CharacterRelationship table
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters for this user
    const characters = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email,
      status: 'active'
    });

    // Get all relationships
    const allRelationships = await base44.asServiceRole.entities.CharacterRelationship.list();

    const updates = [];

    for (const char of characters) {
      // Find all relationships where this character is the source
      const charRelationships = allRelationships.filter(r => r.source_character_id === char.id);
      
      if (charRelationships.length === 0) continue;

      // Build fictional_relationships array from CharacterRelationship records
      const fictionalRels = charRelationships.map(rel => ({
        person_name: rel.label_from_source_perspective || rel.target_character_id,
        related_character_id: rel.target_character_id,
        relationship_type: rel.relationship_type,
        description: rel.label_from_target_perspective || '',
        friendship_level: rel.friendship_level || 50,
        trust_level: rel.trust_level || 50,
        attraction_level: rel.attraction_level || 0,
        respect_level: rel.respect_level || 50
      }));

      // Update character with restored fictional_relationships
      await base44.asServiceRole.entities.Character.update(char.id, {
        fictional_relationships: fictionalRels
      });

      updates.push({
        character: char.name,
        relationshipsRestored: fictionalRels.length
      });
    }

    return Response.json({
      success: true,
      message: `Restored fictional_relationships for ${updates.length} characters`,
      updates
    });
  } catch (error) {
    console.error('Restore error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});