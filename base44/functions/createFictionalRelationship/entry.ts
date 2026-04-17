import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createFictionalRelationship
 *
 * Adds a new entry to a character's fictional_relationships array.
 * Called ONLY after explicit user confirmation in the UI.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, person_name, relationship_type, context, description } = await req.json();

    if (!characterId || !person_name || !relationship_type) {
      return Response.json({ error: 'characterId, person_name, and relationship_type are required' }, { status: 400 });
    }

    const character = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]);

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Check if this person is already in fictional_relationships
    const existing = (character.fictional_relationships || []).find(
      r => r.person_name?.toLowerCase() === person_name.toLowerCase()
    );

    if (existing) {
      return Response.json({ success: true, already_exists: true });
    }

    const newRelationship = {
      person_name,
      relationship_type,
      description: description || context || '',
      history_summary: context || '',
      current_status: 'active',
      emotional_impact: 'neutral',
      last_interaction_summary: '',
      avatar_url: null,
      current_location_id: null,
      related_character_id: null,
      user_respect_level: 50,
      friendship_level: 50,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 0,
    };

    const updatedRelationships = [...(character.fictional_relationships || []), newRelationship];

    await base44.asServiceRole.entities.Character.update(characterId, {
      fictional_relationships: updatedRelationships
    });

    return Response.json({ success: true, relationship: newRelationship });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});