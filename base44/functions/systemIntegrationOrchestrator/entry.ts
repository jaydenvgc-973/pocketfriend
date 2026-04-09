import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * System Integration Orchestrator (CRITICAL)
 * Central hub for event propagation, memory sharing, conflict resolution
 * Enforces: cross-system awareness, event propagation, state sync, priority
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json();
  const { eventType, characterId, eventData } = body;

  try {
    const character = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    if (!character[0]) return Response.json({ error: 'Character not found' }, { status: 404 });

    const char = character[0];
    const updates = {};
    const propagation = {
      eventType,
      characterId,
      systems_affected: [],
      state_changes: [],
      timestamp: new Date().toISOString(),
    };

    // ─── GATHER CROSS-SYSTEM STATE ───
    const memoryLog = await base44.asServiceRole.entities.Memory.filter(
      { character_id: characterId },
      '-timestamp',
      20
    );
    const recentLifeEvents = await base44.asServiceRole.entities.LifeEvent.filter(
      { character_id: characterId },
      '-timestamp',
      10
    );
    const relationshipState = await base44.asServiceRole.entities.RelationshipState.filter({
      character_id: characterId,
    });

    // ─── EVENT PROPAGATION LOGIC ───
    switch (eventType) {
      case 'WORK_SHIFT_ENDED':
        // Event ripples to: needs, location, dialogue, card
        if (eventData.exitScore > 50) {
          // Move to home
          updates.resolved_current_location_id = char.current_home_location_id;
          updates.resolved_presence_status = 'home';
          updates.resolved_last_updated_at = new Date().toISOString();
          propagation.systems_affected.push('location', 'character_card', 'dialogue');
          propagation.state_changes.push({
            system: 'location',
            from: char.resolved_current_location_id,
            to: char.current_home_location_id,
            reason: eventData.reason,
          });
        }
        // Update needs
        updates.energy_value = Math.max(20, (char.energy_value || 75) - 25);
        updates.mental_value = Math.max(20, (char.mental_value || 75) - 20);
        propagation.systems_affected.push('needs');
        break;

      case 'RELATIONSHIP_MILESTONE':
        // Event ripples to: dialogue, invitations, effort memory
        const relationshipLevel = eventData.relationshipLevel || 50;
        updates.friendship_level = relationshipLevel;
        propagation.systems_affected.push('relationships', 'dialogue', 'effort_memory');
        // Create effort memory
        await base44.asServiceRole.entities.Memory.create({
          character_id: characterId,
          title: `Relationship deepened with ${eventData.characterName}`,
          description: eventData.eventDescription || '',
          emotional_impact: `Felt closer to ${eventData.characterName}`,
          timestamp: new Date().toISOString(),
          source_context: 'relationship_milestone',
        });
        break;

      case 'STORY_ARC_PROGRESSED':
        // Event ripples to: behaviour, dialogue tone, location choices
        const arcName = eventData.arcType;
        const arcStage = eventData.arcStage;
        propagation.systems_affected.push('behaviour', 'dialogue', 'location_choices', 'character_card');

        // Apply arc-based behavior changes
        if (arcName === 'WORK_BURNOUT' && arcStage === 'burned_out') {
          updates.mental_value = Math.max(20, (char.mental_value || 75) - 30);
          updates.social_value = Math.max(30, (char.social_value || 65) - 20);
          propagation.state_changes.push({
            system: 'needs',
            change: 'mental and social needs declined',
          });
        }
        if (arcName === 'RELATIONSHIP_GROWTH' && arcStage === 'bonded') {
          updates.social_value = Math.min(100, (char.social_value || 65) + 20);
          propagation.state_changes.push({
            system: 'needs',
            change: 'social needs increased',
          });
        }
        break;

      case 'CRITICAL_NEED_DETECTED':
        // Event ripples to: location (home if critical), behaviour, dialogue
        const needType = eventData.needType;
        const needLevel = eventData.needLevel; // 0-100
        propagation.systems_affected.push('location', 'behaviour', 'dialogue');

        // PRIORITY: if health/mental is critical, override other desires
        if (needLevel < 30 && ['health', 'mental', 'energy'].includes(needType)) {
          updates.resolved_current_location_id = char.current_home_location_id;
          updates.resolved_presence_status = 'home';
          propagation.state_changes.push({
            system: 'location',
            reason: `Critical ${needType} — going home`,
          });
        }
        break;

      case 'MEMORY_ACCESSED':
        // Event ripples to: dialogue tone, decision making, relationship context
        const memory = eventData.memory;
        const isPositiveMemory = memory.emotional_impact?.includes('positive');
        propagation.systems_affected.push('dialogue', 'decision_making', 'relationship_context');

        // Track memory usage for consistency
        propagation.state_changes.push({
          system: 'dialogue',
          change: `Memory "${memory.title}" influences tone`,
        });
        break;

      case 'EFFORT_LOGGED':
        // Event ripples to: relationships, achievements, story arcs
        const effortType = eventData.effortType;
        const effortCharacterId = eventData.relatedCharacterId;
        propagation.systems_affected.push('relationships', 'achievements', 'story_arcs');

        // Update relationship if applicable
        if (effortCharacterId && effortType === 'support') {
          const relState = relationshipState.find(r => r.character_id === effortCharacterId);
          if (relState) {
            updates.friendship_level = Math.min(100, (relState.friendship_score || 50) + 10);
            propagation.state_changes.push({
              system: 'relationships',
              change: `Friendship with ${effortCharacterId} increased via effort`,
            });
          }
        }
        break;
    }

    // ─── CONFLICT RESOLUTION ───
    // Check if any needs are critical and override lower priorities
    const priorityOrder = ['health', 'mental', 'energy', 'hunger', 'social', 'comfort'];
    const criticalNeed = priorityOrder.find(needType => {
      const value = updates[`${needType}_value`] || char[`${needType}_value`];
      return value < 30;
    });

    if (criticalNeed && eventData.wouldGoOut) {
      propagation.state_changes.push({
        system: 'conflict_resolution',
        resolution: `Critical ${criticalNeed} takes priority over going out`,
      });
    }

    // ─── PERSIST ALL UPDATES ───
    if (Object.keys(updates).length > 0) {
      await base44.asServiceRole.entities.Character.update(characterId, updates);
      propagation.updates_applied = Object.keys(updates);
    }

    // ─── LOG PROPAGATION FOR DEBUGGING ───
    await base44.asServiceRole.entities.CharacterAutonomyEvent.create({
      character_id: characterId,
      event_type: `INTEGRATION_${eventType}`,
      trigger_source: 'integration_orchestrator',
      event_payload: propagation,
      scheduled_for: new Date().toISOString(),
      status: 'completed',
    }).catch(() => {}); // silent fail if event logging fails

    return Response.json({
      success: true,
      eventType,
      characterId,
      systems_affected: propagation.systems_affected,
      state_changes: propagation.state_changes,
      updates_applied: propagation.updates_applied || [],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});