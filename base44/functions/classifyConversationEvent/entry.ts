import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * classifyConversationEvent
 *
 * Called after each chat turn (fire-and-forget from Chat.jsx).
 * Detects life events and fans out to all systems inline.
 *
 * All integration is inlined here to avoid cross-function invocation issues.
 */

// Mood transitions based on event type + valence
const MOOD_MAP = {
  supportive_event: { positive: 'content' },
  bonding_event: { positive: 'joyful' },
  healthy_choice_event: { positive: 'content' },
  growth_event: { positive: 'excitement' },
  emotional_exchange: { positive: 'gratitude', negative: 'sad' },
  relationship_shift: { positive: 'hope', negative: 'longing' },
  conflict_event: { negative: 'irritated' },
  risky_decision_event: { positive: 'excited', negative: 'anxious' },
  impulsive_decision_event: { negative: 'frustrated' },
  substance_use_event: { negative: 'numbness' },
  sleep_deprivation_event: { negative: 'burnt out' },
  grief_event: { negative: 'grief' },
  medical_event: { positive: 'relief', negative: 'anxious' },
  accident_event: { negative: 'fear' },
  fight_event: { negative: 'anger' },
  legal_or_social_consequence_event: { negative: 'shame' },
  recovery_event: { positive: 'hope' },
  setback_event: { negative: 'disappointment' },
  life_milestone_event: { positive: 'elation', negative: 'overwhelmed' },
  npc_incident_event: { positive: 'amusement', negative: 'stress' },
  emotional_outburst_event: { negative: 'frustrated' },
  betrayal_event: { negative: 'resentment' },
  reconciliation_event: { positive: 'relief' },
  celebration_event: { positive: 'elation' },
  routine_positive_event: { positive: 'content' },
  routine_negative_event: { negative: 'stress' },
};

// Relationship deltas per event type + valence
const RELATIONSHIP_DELTAS = {
  supportive_event: { positive: { friendship_level: 3, user_respect_level: 2, chosen_family_level: 2 } },
  bonding_event: { positive: { friendship_level: 4, chosen_family_level: 3 } },
  emotional_exchange: { positive: { friendship_level: 3, chosen_family_level: 2 }, negative: { friendship_level: -2 } },
  conflict_event: { negative: { friendship_level: -4, user_respect_level: -3 } },
  betrayal_event: { negative: { friendship_level: -8, user_respect_level: -6, chosen_family_level: -5 } },
  reconciliation_event: { positive: { friendship_level: 5, user_respect_level: 3 } },
  celebration_event: { positive: { friendship_level: 3 } },
  life_milestone_event: { positive: { chosen_family_level: 4 } },
  grief_event: { positive: { friendship_level: 4 }, negative: { chosen_family_level: -2 } },
  fight_event: { negative: { friendship_level: -5, user_respect_level: -4 } },
  medical_event: { positive: { chosen_family_level: 4, friendship_level: 3 } },
};

// Achievement candidates per event type
const EVENT_ACHIEVEMENT_MAP = {
  supportive_event: ['bedside_manner', 'that_meant_something'],
  bonding_event: ['inner_circle', 'they_opened_up'],
  healthy_choice_event: ['the_push'],
  growth_event: ['the_push'],
  emotional_exchange: ['that_meant_something', 'hit_deep', 'they_opened_up'],
  conflict_event: ['tension'],
  grief_event: ['bedside_manner', 'you_were_there'],
  medical_event: ['first_responder', 'bedside_manner'],
  fight_event: ['tension', 'messy'],
  betrayal_event: ['messy'],
  reconciliation_event: ['ride_along'],
  celebration_event: ['big_moment', 'you_were_there'],
  life_milestone_event: ['big_moment', 'you_were_there'],
  recovery_event: ['bedside_manner', 'ride_along'],
  impulsive_decision_event: ['bad_influence'],
  risky_decision_event: ['bad_influence'],
};

// Relationship-impacting event types
const RELATIONSHIP_EVENT_TYPES = new Set([
  'supportive_event', 'bonding_event', 'conflict_event', 'betrayal_event',
  'reconciliation_event', 'fight_event', 'grief_event', 'medical_event',
  'celebration_event', 'life_milestone_event', 'emotional_exchange',
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      characterId,
      characterName,
      conversationId,
      userMessage,
      characterReply,
      recentMessages = [],
      characterState = {},
    } = await req.json();

    if (!characterId || !userMessage || !characterReply) {
      return Response.json({ events_detected: 0, events: [] });
    }

    const historyContext = recentMessages
      .slice(-8)
      .map(m => `${m.sender_type === 'user' ? 'User' : characterName}: ${m.content || '(image)'}`)
      .join('\n');

    const prompt = `You are analyzing a conversation turn between a user and a fictional character named ${characterName}. Detect if any meaningful life events occurred — positive OR negative.

CHARACTER STATE:
- Emotional state: ${characterState.emotional_state || 'calm'}
- Health status: ${characterState.health_status || 'healthy'}
- Current activity: ${characterState.current_activity || 'none'}
- Personality: ${characterState.personality_summary || 'not specified'}

RECENT HISTORY:
${historyContext || '(start of conversation)'}

CURRENT TURN:
User: ${userMessage}
${characterName}: ${characterReply}

POSITIVE event types: supportive_event, bonding_event, healthy_choice_event, growth_event, emotional_exchange, reconciliation_event, celebration_event, life_milestone_event, recovery_event, routine_positive_event
NEGATIVE event types: conflict_event, fight_event, risky_decision_event, impulsive_decision_event, substance_use_event, grief_event, medical_event, accident_event, betrayal_event, legal_or_social_consequence_event, setback_event, emotional_outburst_event, routine_negative_event

RULES:
1. Only flag events with severity "moderate" or higher — skip things casually mentioned in passing
2. A single turn can have multiple events
3. Most turns are normal chat — return empty array if nothing meaningful happened
4. Negative events need clear evidence, not just vague mentions

Return JSON:
{
  "events": [
    {
      "event_type": string,
      "valence": "positive" | "negative" | "mixed",
      "severity": "minor" | "moderate" | "significant" | "major",
      "title": string,
      "description": string,
      "emotional_impact": string,
      "context_tags": string[]
    }
  ]
}

If nothing meaningful happened, return: { "events": [] }`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                event_type: { type: 'string' },
                valence: { type: 'string' },
                severity: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                emotional_impact: { type: 'string' },
                context_tags: { type: 'array', items: { type: 'string' } },
              },
              required: ['event_type', 'valence', 'severity', 'title', 'description'],
            },
          },
        },
        required: ['events'],
      },
    });

    const events = result?.events || [];
    const audit_log = [];

    // Pre-fetch data needed for all events
    const [existingAchievements, character] = await Promise.all([
      base44.entities.UserAchievement.filter({ created_by: user.email }),
      base44.asServiceRole.entities.Character.filter({ id: characterId }).then(r => r[0]),
    ]);
    const existingAchievementIds = new Set(existingAchievements.map(a => a.achievement_id));

    for (const event of events) {
      if (!event.event_type || !event.title || !event.description) continue;
      if (['minor'].includes(event.severity)) continue; // skip minor — just noise

      const audit = { event_type: event.event_type, valence: event.valence, severity: event.severity, systems: [] };

      // ── 1. Persist LifeEvent ──────────────────────────────────────────
      const lifeEvent = await base44.asServiceRole.entities.LifeEvent.create({
        character_id: characterId,
        character_name: characterName || '',
        event_type: event.event_type,
        valence: event.valence,
        severity: event.severity,
        title: event.title,
        description: event.description,
        emotional_impact: event.emotional_impact || '',
        triggered_by: 'user_message',
        conversation_id: conversationId,
        context_tags: event.context_tags || [],
        systems_updated: [],
        timestamp: new Date().toISOString(),
      });
      audit.life_event_id = lifeEvent.id;

      // ── 2. Memory ─────────────────────────────────────────────────────
      if (['moderate', 'significant', 'major'].includes(event.severity)) {
        await base44.asServiceRole.entities.Memory.create({
          character_id: characterId,
          title: event.title,
          description: event.description,
          emotional_impact: event.emotional_impact || `${event.valence} event`,
          timestamp: new Date().toISOString(),
          source_context: conversationId ? `conversation:${conversationId}` : `life_event:${lifeEvent.id}`,
        });
        audit.systems.push('memory');
      }

      // ── 3. Mood ───────────────────────────────────────────────────────
      if (['significant', 'major'].includes(event.severity)) {
        const moodEntry = MOOD_MAP[event.event_type];
        const newMood = moodEntry?.[event.valence] || (event.valence === 'positive' ? 'content' : 'anxious');
        if (newMood) {
          await base44.asServiceRole.entities.Character.update(characterId, { emotional_state: newMood });
          audit.systems.push('mood');
          audit.mood = newMood;
        }
      }

      // ── 4. Relationship delta ─────────────────────────────────────────
      if (RELATIONSHIP_EVENT_TYPES.has(event.event_type) && character) {
        const deltas = RELATIONSHIP_DELTAS[event.event_type]?.[event.valence];
        if (deltas) {
          const updated = {};
          for (const [key, delta] of Object.entries(deltas)) {
            const current = character[key] ?? 50;
            updated[key] = Math.min(100, Math.max(0, current + delta));
          }
          await base44.asServiceRole.entities.Character.update(characterId, updated);
          audit.systems.push('relationship');
          audit.relationship_deltas = deltas;
        }
      }

      // ── 5. Achievements ───────────────────────────────────────────────
      const candidates = EVENT_ACHIEVEMENT_MAP[event.event_type] || [];
      const granted = [];
      for (const achievement_id of candidates) {
        if (!existingAchievementIds.has(achievement_id)) {
          await base44.entities.UserAchievement.create({
            achievement_id,
            character_id: characterId,
            character_name: characterName || '',
            unlocked_at: new Date().toISOString(),
            tier: 'bronze',
            is_seen: false,
          });
          existingAchievementIds.add(achievement_id);
          granted.push(achievement_id);
        }
      }
      if (granted.length > 0) {
        audit.systems.push('achievement');
        audit.achievements_granted = granted;
      }

      // ── 6. Life Context Intelligence — update schedule/occupation/location if event implies it ──
      const LIFE_CONTEXT_TRIGGERS = new Set([
        'life_milestone_event', 'medical_event', 'growth_event', 'recovery_event',
        'location_change_event', 'setback_event', 'legal_or_social_consequence_event',
      ]);
      const lifeContextKeywords = ['job', 'work', 'hired', 'fired', 'class', 'school', 'enroll', 'college',
        'doctor', 'surgery', 'hospital', 'appointment', 'clinic', 'moved', 'moving', 'training', 'internship'];
      const descLower = (event.description + ' ' + event.title).toLowerCase();
      const hasLifeContextKeyword = lifeContextKeywords.some(k => descLower.includes(k));

      if (LIFE_CONTEXT_TRIGGERS.has(event.event_type) || hasLifeContextKeyword) {
        base44.asServiceRole.functions.invoke('updateCharacterLifeContext', {
          character_id: characterId,
          event_type: event.event_type,
          event_description: `${event.title}: ${event.description}`,
          conversation_id: conversationId,
        }).catch(() => {}); // fire-and-forget — don't block main response
        audit.systems.push('life_context');
      }

      // ── 7. Update LifeEvent systems_updated ──────────────────────────
      await base44.asServiceRole.entities.LifeEvent.update(lifeEvent.id, {
        systems_updated: audit.systems,
      });

      console.log(`[classifyConversationEvent] char=${characterName} event=${event.event_type} valence=${event.valence} severity=${event.severity} systems=[${audit.systems.join(',')}] achievements=[${(audit.achievements_granted||[]).join(',')}]`);
      audit_log.push(audit);
    }

    return Response.json({
      events_detected: audit_log.length,
      events: audit_log,
    });
  } catch (error) {
    console.error('[classifyConversationEvent] ERROR:', error.message);
    return Response.json({ error: error.message, events_detected: 0, events: [] }, { status: 500 });
  }
});