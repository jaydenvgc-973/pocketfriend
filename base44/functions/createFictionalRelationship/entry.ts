import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createFictionalRelationship
 *
 * Adds a new entry to a character's fictional_relationships array.
 * For non-family relationships, also creates a standalone NPC Character entity.
 * Called ONLY after explicit user confirmation in the UI.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, person_name, relationship_type, context, description, _feedback_only } = await req.json();

    if (!characterId || !person_name || !relationship_type) {
      return Response.json({ error: 'characterId, person_name, and relationship_type are required' }, { status: 400 });
    }

    // ── NONSENSE FEEDBACK: store as memory, do NOT create a relationship ──
    if (_feedback_only && relationship_type === '__nonsense_feedback__') {
      await base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: `[NONSENSE FEEDBACK] Bad person detection: "${person_name}"`,
        description: context || `User marked "${person_name}" as a nonsense detection — the AI was pattern-matching dialogue structure instead of logic.`,
        emotional_impact: 'neutral',
        source_context: 'new_person_nonsense_feedback',
        timestamp: new Date().toISOString(),
      }).catch(() => {});
      return Response.json({ success: true, feedback_stored: true });
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

    // ── FAMILY CHECK: family members stay nested, non-family get a standalone Character entity ──
    const familyTypes = ['family', 'Family'];
    const isFamily = familyTypes.some(f => relationship_type.toLowerCase().includes(f.toLowerCase()));

    let related_character_id = null;

    if (!isFamily) {
      // Check if a standalone NPC Character already exists for this person under this user
      const existingNPC = await base44.asServiceRole.entities.Character.filter({
        name: person_name,
        created_by: user.email,
        character_type: 'npc',
      }, null, 1).then(c => c?.[0]).catch(() => null);

      if (existingNPC) {
        related_character_id = existingNPC.id;
      } else {
        // Create a new standalone NPC Character entity
        const newNPC = await base44.asServiceRole.entities.Character.create({
          name: person_name,
          character_type: 'npc',
          owner_email: user.email,
          created_by: user.email,
          status: 'active',
          profile_summary: description || context || '',
          background_story: context || '',
          visibility_scope: 'account_private',
          is_default: false,
          is_active_character: false,
          protected_active: false,
        });
        related_character_id = newNPC?.id || null;
      }
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
      related_character_id,
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

    return Response.json({ success: true, relationship: newRelationship, npc_character_id: related_character_id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});