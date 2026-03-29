import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * logLifeEvent — the central integration hub for the life event system.
 *
 * Every meaningful event (positive or negative) flows through here.
 * This function:
 *   1. Persists the event to LifeEvent entity (shared source of truth)
 *   2. Updates character emotional state (mood system)
 *   3. Creates a memory entry (memory system)
 *   4. Updates relationship levels if applicable (relationship system)
 *   5. Evaluates achievement triggers (achievement system)
 *   6. Returns a full audit trail for debugging
 *
 * Called from: Chat.jsx (per turn), processScheduledEvents, evolveCharacterLife, extractMemoriesFromTurn
 */

// Mood transitions based on event type + valence
const MOOD_MAP = {
  supportive_event: { positive: 'content', negative: null },
  bonding_event: { positive: 'joyful', negative: null },
  healthy_choice_event: { positive: 'content', negative: null },
  growth_event: { positive: 'excitement', negative: null },
  achievement_qualifying_action: { positive: 'pride', negative: null },
  emotional_exchange: { positive: 'gratitude', negative: 'sad' },
  relationship_shift: { positive: 'hope', negative: 'longing' },
  conflict_event: { positive: null, negative: 'irritated' },
  risky_decision_event: { positive: 'excited', negative: 'anxious' },
  impulsive_decision_event: { positive: null, negative: 'frustrated' },
  substance_use_event: { positive: null, negative: 'numbness' },
  sleep_deprivation_event: { positive: null, negative: 'burnt out' },
  grief_event: { positive: null, negative: 'grief' },
  medical_event: { positive: 'relief', negative: 'anxious' },
  accident_event: { positive: null, negative: 'fear' },
  fight_event: { positive: null, negative: 'anger' },
  legal_or_social_consequence_event: { positive: null, negative: 'shame' },
  recovery_event: { positive: 'hope', negative: null },
  setback_event: { positive: null, negative: 'disappointment' },
  life_milestone_event: { positive: 'elation', negative: 'overwhelmed' },
  npc_incident_event: { positive: 'amusement', negative: 'stress' },
  location_change_event: { positive: 'anticipation', negative: 'nostalgia' },
  emotional_outburst_event: { positive: null, negative: 'frustrated' },
  betrayal_event: { positive: null, negative: 'resentment' },
  reconciliation_event: { positive: 'relief', negative: null },
  celebration_event: { positive: 'elation', negative: null },
  routine_positive_event: { positive: 'content', negative: null },
  routine_negative_event: { positive: null, negative: 'stressed' },
};

// Map event types to achievement IDs they could trigger
const EVENT_ACHIEVEMENT_MAP = {
  supportive_event: ['bedside_manner', 'that_meant_something', 'first_responder'],
  bonding_event: ['inner_circle', 'they_opened_up', 'bonding_event'],
  healthy_choice_event: ['the_push'],
  growth_event: ['the_push', 'progress_witness'],
  achievement_qualifying_action: ['first_responder', 'the_push', 'voice_of_reason'],
  emotional_exchange: ['that_meant_something', 'hit_deep', 'they_opened_up'],
  relationship_shift: ['ride_along', 'inner_circle'],
  conflict_event: ['tension', 'in_the_middle', 'stirred_the_pot'],
  impulsive_decision_event: ['bad_influence'],
  grief_event: ['bedside_manner', 'you_were_there'],
  medical_event: ['first_responder', 'bedside_manner'],
  fight_event: ['tension', 'messy'],
  betrayal_event: ['messy', 'he_said_she_said'],
  reconciliation_event: ['ride_along'],
  celebration_event: ['big_moment', 'you_were_there'],
  life_milestone_event: ['big_moment', 'you_were_there'],
  recovery_event: ['bedside_manner', 'ride_along'],
  risky_decision_event: ['clutch_timing', 'bad_influence'],
};

// Relationship delta guidance per event type + valence
const RELATIONSHIP_DELTAS = {
  supportive_event: { positive: { friendship_level: 3, user_respect_level: 2, chosen_family_level: 2 } },
  bonding_event: { positive: { friendship_level: 4, chosen_family_level: 3 } },
  emotional_exchange: {
    positive: { friendship_level: 3, chosen_family_level: 2 },
    negative: { friendship_level: -2, user_respect_level: -1 }
  },
  conflict_event: { negative: { friendship_level: -4, user_respect_level: -3 } },
  betrayal_event: { negative: { friendship_level: -8, user_respect_level: -6, chosen_family_level: -5 } },
  reconciliation_event: { positive: { friendship_level: 5, user_respect_level: 3 } },
  celebration_event: { positive: { friendship_level: 3, romantic_level: 1 } },
  life_milestone_event: { positive: { chosen_family_level: 4 } },
  grief_event: { negative: { chosen_family_level: -2 }, positive: { friendship_level: 4 } },
  fight_event: { negative: { friendship_level: -5, user_respect_level: -4 } },
  medical_event: { positive: { chosen_family_level: 4, friendship_level: 3 } },
  risky_decision_event: { negative: { user_respect_level: -2 } },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow both user and service-role contexts
    let userEmail = null;
    try {
      const user = await base44.auth.me();
      userEmail = user?.email;
    } catch (_) {
      // Service role / scheduled — no user session
    }

    const body = await req.json();
    const {
      characterId,
      characterName,
      eventType,
      valence = 'neutral',
      severity = 'minor',
      title,
      description,
      emotionalImpact = '',
      triggeredBy = 'user_message',
      conversationId = null,
      contextTags = [],
      applyMoodUpdate = true,
      applyMemory = true,
      applyRelationshipDelta = false,
      relationshipDeltaOverride = null, // { friendship_level, user_respect_level, etc. }
      applyAchievementCheck = true,
    } = body;

    if (!characterId || !eventType || !title || !description) {
      return Response.json({ error: 'Missing required: characterId, eventType, title, description' }, { status: 400 });
    }

    const audit = {
      event_detected: true,
      event_type: eventType,
      valence,
      severity,
      systems_updated: [],
      memory_updated: false,
      mood_updated: false,
      relationship_updated: false,
      achievement_evaluated: false,
      achievement_granted: [],
      skipped_reasons: [],
    };

    // ── 1. Persist LifeEvent ──────────────────────────────────────────
    const lifeEvent = await base44.asServiceRole.entities.LifeEvent.create({
      character_id: characterId,
      character_name: characterName || '',
      event_type: eventType,
      valence,
      severity,
      title,
      description,
      emotional_impact: emotionalImpact,
      triggered_by: triggeredBy,
      conversation_id: conversationId,
      context_tags: contextTags,
      systems_updated: [],
      timestamp: new Date().toISOString(),
    });

    // ── 2. Memory update ─────────────────────────────────────────────
    if (applyMemory && ['moderate', 'significant', 'major'].includes(severity)) {
      await base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title,
        description,
        emotional_impact: emotionalImpact || `${valence} ${eventType.replace(/_/g, ' ')}`,
        timestamp: new Date().toISOString(),
        source_context: conversationId ? `conversation:${conversationId}` : `life_event:${lifeEvent.id}`,
      });
      audit.memory_updated = true;
      audit.systems_updated.push('memory');
    } else if (!applyMemory) {
      audit.skipped_reasons.push('memory: applyMemory=false');
    } else {
      audit.skipped_reasons.push('memory: severity too low (minor)');
    }

    // ── 3. Mood update ───────────────────────────────────────────────
    if (applyMoodUpdate && ['moderate', 'significant', 'major'].includes(severity)) {
      const moodEntry = MOOD_MAP[eventType];
      const newMood = moodEntry?.[valence] || moodEntry?.['positive'] || null;
      if (newMood) {
        await base44.asServiceRole.entities.Character.update(characterId, {
          emotional_state: newMood,
        });
        audit.mood_updated = true;
        audit.mood_new_state = newMood;
        audit.systems_updated.push('mood');
      } else {
        audit.skipped_reasons.push(`mood: no mapped mood for ${eventType}/${valence}`);
      }
    } else {
      audit.skipped_reasons.push('mood: severity too low or disabled');
    }

    // ── 4. Relationship delta ─────────────────────────────────────────
    if (applyRelationshipDelta) {
      const deltas = relationshipDeltaOverride || RELATIONSHIP_DELTAS[eventType]?.[valence] || null;
      if (deltas) {
        // Fetch current character state
        const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const char = chars[0];
        if (char) {
          const updated = {};
          for (const [key, delta] of Object.entries(deltas)) {
            const current = char[key] ?? 50;
            updated[key] = Math.min(100, Math.max(0, current + delta));
          }
          await base44.asServiceRole.entities.Character.update(characterId, updated);
          audit.relationship_updated = true;
          audit.relationship_deltas = deltas;
          audit.systems_updated.push('relationship');
        }
      } else {
        audit.skipped_reasons.push(`relationship: no delta defined for ${eventType}/${valence}`);
      }
    }

    // ── 5. Achievement evaluation ─────────────────────────────────────
    if (applyAchievementCheck && userEmail) {
      const candidateAchievements = EVENT_ACHIEVEMENT_MAP[eventType] || [];
      if (candidateAchievements.length > 0) {
        audit.achievement_evaluated = true;
        // Fetch existing achievements
        const existing = await base44.entities.UserAchievement.filter({ created_by: userEmail });
        const existingIds = new Set(existing.map(a => a.achievement_id));

        const toGrant = candidateAchievements.filter(id => !existingIds.has(id));
        for (const achievement_id of toGrant) {
          await base44.entities.UserAchievement.create({
            achievement_id,
            character_id: characterId,
            character_name: characterName || '',
            unlocked_at: new Date().toISOString(),
            tier: 'bronze',
            is_seen: false,
          });
          audit.achievement_granted.push(achievement_id);
        }
        if (toGrant.length > 0) audit.systems_updated.push('achievement');
        if (toGrant.length === 0) audit.skipped_reasons.push('achievement: all candidates already unlocked');
      } else {
        audit.skipped_reasons.push(`achievement: no candidates for ${eventType}`);
      }
    } else if (!userEmail) {
      audit.skipped_reasons.push('achievement: no user session (service role context)');
    }

    // ── 6. Update LifeEvent with systems_updated ─────────────────────
    await base44.asServiceRole.entities.LifeEvent.update(lifeEvent.id, {
      systems_updated: audit.systems_updated,
    });

    console.log(`[logLifeEvent] char=${characterName}(${characterId}) type=${eventType} valence=${valence} severity=${severity} systems=[${audit.systems_updated.join(',')}] achievements=[${audit.achievement_granted.join(',')}]`);

    return Response.json({
      success: true,
      life_event_id: lifeEvent.id,
      audit,
    });
  } catch (error) {
    console.error('[logLifeEvent] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});