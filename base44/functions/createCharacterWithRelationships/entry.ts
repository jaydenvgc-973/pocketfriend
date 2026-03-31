import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterData, characterRelationships } = await req.json();

    if (!characterData || !characterData.name) {
      return Response.json({ error: 'Character name required' }, { status: 400 });
    }

    // CRITICAL: Always enforce created_by to be the authenticated user — never allow overrides
    const safeCharacterData = {
      ...characterData,
      created_by: user.email
    };

    // Create the new character
    const newCharacter = await base44.asServiceRole.entities.Character.create(safeCharacterData);

    if (!newCharacter || !newCharacter.id) {
      return Response.json({ error: 'Failed to create character' }, { status: 500 });
    }

    // Handle bidirectional relationships
    if (characterRelationships && Array.isArray(characterRelationships) && characterRelationships.length > 0) {
      for (const rel of characterRelationships) {
        if (!rel.related_character_id) continue;

        // Update new character with relationship
        const newCharRels = [...(newCharacter.fictional_relationships || [])];
        newCharRels.push({
          person_name: rel.person_name,
          related_character_id: rel.related_character_id,
          relationship_type: rel.relationship_type,
          description: rel.description,
          current_status: "active",
          emotional_impact: "neutral"
        });

        await base44.asServiceRole.entities.Character.update(newCharacter.id, {
          fictional_relationships: newCharRels
        });

        // Update existing character with reciprocal relationship
        const existingChar = await base44.asServiceRole.entities.Character.get(rel.related_character_id);
        if (existingChar) {
          const existingRels = [...(existingChar.fictional_relationships || [])];
          
          // Check if relationship already exists
          const hasRelationship = existingRels.some(r => r.related_character_id === newCharacter.id);
          
          if (!hasRelationship) {
            existingRels.push({
              person_name: newCharacter.name,
              related_character_id: newCharacter.id,
              relationship_type: rel.relationship_type,
              description: `${existingChar.name} is a ${rel.relationship_type} of ${newCharacter.name}.`,
              current_status: "active",
              emotional_impact: "neutral"
            });

            await base44.asServiceRole.entities.Character.update(rel.related_character_id, {
              fictional_relationships: existingRels
            });
          }
        }
      }
    }

    // Pre-create direct and phone conversations so the character is immediately fully accessible
    await Promise.all([
      base44.asServiceRole.entities.Conversation.create({
        title: `Chat with ${newCharacter.name}`,
        type: "direct",
        character_ids: [newCharacter.id],
        created_by: user.email,
      }),
      base44.asServiceRole.entities.Conversation.create({
        title: `Text with ${newCharacter.name}`,
        type: "phone",
        character_ids: [newCharacter.id],
        created_by: user.email,
      }),
    ]);

    return Response.json({
      success: true,
      character: newCharacter,
      message: `Character "${newCharacter.name}" created with ${characterRelationships?.length || 0} relationships`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});