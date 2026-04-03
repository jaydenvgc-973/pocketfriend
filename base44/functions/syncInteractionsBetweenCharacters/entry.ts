import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * syncInteractionsBetweenCharacters
 * 
 * Ensures that when one character interacts with another:
 * - BOTH characters record the interaction
 * - Both remember it
 * - Both reflect it in behavior and dialogue
 * 
 * No one-sided events.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { actor_id, actor_name, target_id, target_name, interaction_type, details } = body;

    if (!actor_id || !target_id || !interaction_type) {
      return Response.json({ error: 'actor_id, target_id, interaction_type required' }, { status: 400 });
    }

    // Create shared memory/event that both characters can access
    const sharedEventId = `interaction_${actor_id}_${target_id}_${Date.now()}`;
    
    // Record in actor's memory
    const actorMemory = await base44.asServiceRole.entities.Memory.create({
      character_id: actor_id,
      title: `Interaction with ${target_name}`,
      description: `${interaction_type}: ${details || 'Shared interaction'}`,
      emotional_impact: details?.mood || 'neutral',
      timestamp: new Date().toISOString(),
      source_context: sharedEventId,
    });

    // Record in target's memory
    const targetMemory = await base44.asServiceRole.entities.Memory.create({
      character_id: target_id,
      title: `Interaction with ${actor_name}`,
      description: `${interaction_type}: ${details || 'Shared interaction'}`,
      emotional_impact: details?.mood || 'neutral',
      timestamp: new Date().toISOString(),
      source_context: sharedEventId,
    });

    // Update both characters' relationship states
    const actorRelationships = await base44.asServiceRole.entities.RelationshipState.filter({
      character_id: actor_id,
    });
    const targetRelationships = await base44.asServiceRole.entities.RelationshipState.filter({
      character_id: target_id,
    });

    // Ensure both have relationship records
    let actorRel = actorRelationships[0];
    if (!actorRel) {
      actorRel = await base44.asServiceRole.entities.RelationshipState.create({
        character_id: actor_id,
      });
    }

    let targetRel = targetRelationships[0];
    if (!targetRel) {
      targetRel = await base44.asServiceRole.entities.RelationshipState.create({
        character_id: target_id,
      });
    }

    // Update interaction timestamp
    await base44.asServiceRole.entities.RelationshipState.update(actorRel.id, {
      last_interaction_at: new Date().toISOString(),
    });
    await base44.asServiceRole.entities.RelationshipState.update(targetRel.id, {
      last_interaction_at: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      sharedEventId,
      actorMemoryId: actorMemory.id,
      targetMemoryId: targetMemory.id,
      message: `Interaction recorded for both ${actor_name} and ${target_name}`,
    });
  } catch (error) {
    console.error('[syncInteractionsBetweenCharacters]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});