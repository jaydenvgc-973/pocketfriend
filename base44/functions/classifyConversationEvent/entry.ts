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

    // Build a brief relationship context from the character's known people
    const knownPeople = (characterState.fictional_relationships || [])
      .map(r => r.person_name)
      .filter(Boolean)
      .slice(0, 20);
    const knownPeopleStr = knownPeople.length > 0 ? knownPeople.join(', ') : 'none listed';

    const prompt = `You are analyzing a conversation turn between a user and a fictional character named ${characterName}. Detect if any meaningful life events occurred — positive OR negative.

CLASSIFICATION LEXICAL DISCIPLINE — MANDATORY:
Your output (event_type, valence, title, description, emotional_impact) will be stored permanently as memory and journal entries. Apply these rules without exception.

1. BANNED TERMS — never use "chaos" or "chaotic" in titles, descriptions, emotional_impact, or context_tags.
   Do not classify busy, crowded, celebratory, emotional, energetic, or multi-person scenes as chaotic.
   Describe the actual mechanics instead: lively, bustling, fast-moving, layered, emotional, high-energy, noisy, warm, complex.

2. RESTRICTED TERM — do not use "heavy" as vague emotional shorthand for important, emotional, stressful, meaningful, or sad.
   Describe the specific reality: what made it difficult, meaningful, painful, or significant.

3. VALENCE ACCURACY — classify from event facts, character context, and outcome. Not from dramatic wording.
   If the event is joyful, proud, celebratory, intimate, healing, or successful → valence MUST be positive or mixed, never negative.
   If the event is painful, harmful, frightening, or genuinely unresolved → valence MUST be negative or mixed.
   Do not force positivity. Do not force negativity. Do not balance a positive event with negative language.

4. IDENTITY PROTECTION — do not promote situational descriptions into identity labels.
   A busy scene does not mean the character creates disorder.
   A stressful moment does not mean the character is toxic.
   A mistake does not become a permanent personality label.

5. REINFORCEMENT FAIRNESS — the classification will reinforce memory and emotional state downstream.
   Accurate positive reinforcement for genuinely positive events.
   Accurate negative reinforcement for genuinely negative events.
   Accurate complexity for genuinely mixed events.
   Mislabeling a positive event as negative causes lasting false identity reinforcement.

CHARACTER STATE:
- Emotional state: ${characterState.emotional_state || 'calm'}
- Health status: ${characterState.health_status || 'healthy'}
- Current activity: ${characterState.current_activity || 'none'}
- Personality: ${characterState.personality_summary || 'not specified'}
- People ${characterName} personally knows: ${knownPeopleStr}

RECENT HISTORY:
${historyContext || '(start of conversation)'}

CURRENT TURN:
User: ${userMessage}
${characterName}: ${characterReply}

POSITIVE event types: supportive_event, bonding_event, healthy_choice_event, growth_event, emotional_exchange, reconciliation_event, celebration_event, life_milestone_event, recovery_event, routine_positive_event, eating_event, sleep_event
NEGATIVE event types: conflict_event, fight_event, risky_decision_event, impulsive_decision_event, substance_use_event, grief_event, medical_event, accident_event, betrayal_event, legal_or_social_consequence_event, setback_event, emotional_outburst_event, routine_negative_event

RULES:
1. Only flag events with severity "moderate" or higher — skip things casually mentioned in passing
2. A single turn can have multiple events
3. Most turns are normal chat — return empty array if nothing meaningful happened
4. Negative events need clear evidence, not just vague mentions
5. eating_event is a STATE-TRACKING event, not a narrative event. It must be flagged whenever ${characterName} actually consumes food or drink in this turn, even if the moment is otherwise ordinary. Always set eating_event severity to "moderate".

EATING EVENT RULES — READ CAREFULLY:
eating_event must ONLY be assigned if ${characterName} ACTUALLY CONSUMED food or drink in THIS turn.
Do NOT flag as eating_event if:
  - ${characterName} merely mentions a past meal ("I ate earlier", "I had breakfast this morning")
  - ${characterName} talks about future eating ("I should eat", "I'll eat later", "I need to eat")
  - ${characterName} refuses or is unable to eat ("I'm not hungry", "I can't eat", "too tired to eat")
  - Food was ordered, arrived, or is present but NOT consumed ("I ordered food", "the tacos arrived")
  - ${characterName} is saving food for later or giving it to someone else
  - The eating is hypothetical ("I would eat that", "if I ate that")
ONLY flag eating_event when ${characterName} clearly took a bite, ate, finished, was fed, or is actively eating in this turn.
When flagging eating_event, set meal_size to "snack" for small items/drinks, "meal" for regular meals, or "large_meal" for feasts/large quantities.

SLEEP EVENT RULE — READ CAREFULLY:
sleep_event is a STATE-TRACKING event. Assign sleep_event ONLY when ${characterName} actually begins sleeping in THIS turn — they have gotten into bed and are now asleep or falling asleep. Do NOT assign sleep_event for: merely intending or planning to sleep, agreeing to lie down without doing it, preparing for bed, expressing tiredness, resting while awake, relaxing, taking a break, self-care, continued/descriptive sleep narratives where ${characterName} was already asleep, or napping. When you assign sleep_event, set severity to "moderate".

STRICT GRIEF RULE — READ CAREFULLY:
grief_event must ONLY be assigned if ALL of the following are true:
  a) The deceased person is listed in ${characterName}'s known people above, OR there is clear prior story context establishing a meaningful personal relationship
  b) ${characterName} directly expressed sadness, shock, mourning, or loss in their reply
  c) The death has direct personal significance to ${characterName} — not just awareness of it
If a death is mentioned but ${characterName} did not personally know the deceased, do NOT assign grief_event.
Instead use: emotional_exchange (if ${characterName} offered support), supportive_event (if they comforted the user), or no event at all.
Hearing about a stranger's death, death discussed in passing, or another person grieving nearby does NOT qualify as ${characterName}'s grief_event.

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
      "context_tags": string[],
      "meal_size": "snack" | "meal" | "large_meal"
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
                meal_size: { type: 'string' },
              },
              required: ['event_type', 'valence', 'severity', 'title', 'description'],
            },
          },
        },
        required: ['events'],
      },
    });

    let events = result?.events || [];

    // Post-filter: enforce grief gate — remove grief_event if the character has no known
    // relationship to the deceased mentioned in the conversation
    events = events.filter(event => {
      if (event.event_type !== 'grief_event') return true;
      // Allow grief only if characterState has fictional_relationships that could link to the deceased
      // We check: does the character have any known people that might be deceased based on description keywords?
      const desc = (event.description + ' ' + event.title + ' ' + (event.emotional_impact || '')).toLowerCase();
      const known = (characterState.fictional_relationships || []).map(r => (r.person_name || '').toLowerCase());
      const deathKeywords = ['died', 'death', 'passed away', 'passed on', 'funeral', 'deceased', 'lost their', 'lost his', 'lost her'];
      // Extract what name might be referenced
      const hasPersonalConnection = known.some(name => name.length > 2 && desc.includes(name));
      if (!hasPersonalConnection) {
        console.log(`[classifyConversationEvent] GRIEF BLOCKED for ${characterName}: no known relationship to deceased. Event: "${event.title}"`);
        return false;
      }
      return true;
    });

    const audit_log = [];
    // Tracks the accepted sleep-start occurrence (if any) so its missing
    // authoritative state consequence can be attached AFTER all accepted
    // LifeEvents are written. One occurrence → one consequence.
    let _sleepStartOccurrence = null;

    // Pre-fetch data needed for all events
    const [existingAchievements, character] = await Promise.all([
      base44.entities.UserAchievement.filter({ owner_email: user.email }),
      base44.asServiceRole.entities.Character.filter({ id: characterId }).then(r => r[0]),
    ]);
    const existingAchievementIds = new Set(existingAchievements.map(a => a.achievement_id));

    for (const event of events) {
      if (!event.event_type || !event.title || !event.description) continue;
      // Eating events are state-change events (hunger update) — allow through even at minor severity.
      // All other minor events are just narrative noise.
      if (['minor'].includes(event.severity) && event.event_type !== 'eating_event') continue;

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

        // Also write to CharacterMemory (Life Journal entity) so the canonical prompt
        // Life Journal block is populated. buildCanonicalCharacterContext reads CharacterMemory,
        // not Memory — without this write, the Life Journal block is always empty in chat.
        const importanceScore = event.severity === 'major' ? 9 : event.severity === 'significant' ? 7 : 5;
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: characterId,
          owner_email: user.email,
          memory_type: 'event',
          memory_text: `${event.title}: ${event.description}`,
          memory_summary: event.title,
          importance_score: importanceScore,
          confidence_score: 0.85,
          permanence: event.severity === 'major' ? 'protected' : 'long_term',
          validation_status: 'confirmed',
        }).catch(() => {}); // non-fatal
        audit.systems.push('life_journal');
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

      // ── 7. Eating Event → Hunger Update (INLINED) ─────────────────────
      // When the LLM classifies an eating_event, the character actually consumed
      // food in this turn. We inline the recordEatingEvent logic here because
      // function-to-function invocation via asServiceRole fails with 403.
      // recordEatingEvent remains the canonical writer for direct calls (Scene).
      if (event.event_type === 'eating_event') {
        try {
          const _clamp = (v) => Math.max(0, Math.min(100, v));
          const _RECOVERY = {
            snack:      { hunger: 20, energy: 3,  comfort: 2 },
            meal:       { hunger: 40, energy: 5,  comfort: 4 },
            large_meal: { hunger: 60, energy: 7,  comfort: 6 },
          };
          const _mealSize = event.meal_size || 'meal';
          const _recovery = _RECOVERY[_mealSize] || _RECOVERY.meal;

          // Vick / world-service exclusion — same logic as recordEatingEvent
          const _isWorldService = (c) => {
            if (!c) return false;
            if (c.character_type === 'npc_world_service') return true;
            if (c.is_world_service === true) return true;
            if (c.diagnostic_only === true) return true;
            const _names = [c.name, c.display_name, c.primary_name].filter(Boolean).map(n => n.toLowerCase());
            return _names.some(n => n.includes('vick servicio'));
          };

          if (character && !_isWorldService(character) && character.hunger_lock !== true && character.needs_locks?.hunger !== true) {
            const _curHunger = character.hunger_value ?? 70;
            const _curEnergy = character.energy_value ?? 75;
            const _curComfort = character.comfort_value ?? 70;
            const _effGain = _curHunger >= 85 ? Math.min(_recovery.hunger, 5) : _recovery.hunger;
            const _newHunger = _clamp(_curHunger + _effGain);
            const _newEnergy = _clamp(_curEnergy + _recovery.energy);
            const _newComfort = _clamp(_curComfort + _recovery.comfort);

            await base44.asServiceRole.entities.Character.update(characterId, {
              hunger_value: _newHunger,
              energy_value: _newEnergy,
              comfort_value: _newComfort,
              last_need_simulated_at: new Date().toISOString(),
            });

            console.log(`[EATING_EVENT] ${characterName} | size=${_mealSize} | hunger: ${Math.round(_curHunger)} → ${_newHunger}`);
          } else if (character && _isWorldService(character)) {
            console.log(`[EATING_EVENT] ${characterName} | SKIPPED — world_service_character_excluded`);
          }
        } catch (err) {
          console.error(`[classifyConversationEvent] hunger update FAILED — char="${characterName}" (id=${characterId}) error="${err?.message || err}"`);
        }
        audit.systems.push('hunger');
      }

      // ── 8. Update LifeEvent systems_updated ──────────────────────────
      await base44.asServiceRole.entities.LifeEvent.update(lifeEvent.id, {
        systems_updated: audit.systems,
      });

      // Track the accepted sleep_event occurrence (first one only) so its
      // missing authoritative state consequence attaches after the loop.
      // This is the SAME existing event_type classification decision — not a
      // second interpretive field. The LifeEvent is already written and remains
      // intact regardless of the consequence outcome below.
      if (event.event_type === 'sleep_event' && !_sleepStartOccurrence) {
        _sleepStartOccurrence = { lifeEventId: lifeEvent.id };
      }

      console.log(`[classifyConversationEvent] char=${characterName} event=${event.event_type} valence=${event.valence} severity=${event.severity} systems=[${audit.systems.join(',')}] achievements=[${(audit.achievements_granted||[]).join(',')}]`);
      audit_log.push(audit);
    }

    // ── AUTHORITATIVE SLEEP-START CONSEQUENCE (One Truth) ────────────────
    // The accepted sleep_event occurrence now enters the EXISTING sleep-start
    // consequence contract (the same one scheduleNap / simulateActiveCharacterNeeds
    // use): invoke enforceCharacterLocationPresence to commit canonical
    // 'sleeping', then write exactly one SleepTransition sleep_start proof.
    // This attaches the missing consequence to the already-accepted occurrence
    // — it does NOT reclassify the exchange, inspect dialogue, match title or
    // description, choose a new location, or suppress the LifeEvent.
    if (_sleepStartOccurrence) {
      // Fresh authoritative state for the duplicate guard (avoids the stale
      // pre-loop snapshot). Guard is against 'sleeping' ONLY — napping is a
      // distinct state and a nap→sleep transition is a legitimate state
      // change, not a duplicate start.
      let _freshChar = null;
      try {
        _freshChar = (await base44.asServiceRole.entities.Character.filter({ id: characterId }))[0] || null;
      } catch (e) {
        console.error(`[classifyConversationEvent] sleep-start fresh state read failed for ${characterName}: ${e.message} — LifeEvent ${_sleepStartOccurrence.lifeEventId} remains recorded.`);
      }
      const _isAcc = _freshChar
        && (_freshChar.character_type === 'active_created_character'
          || (!_freshChar.character_type && _freshChar.status === 'active'));
      if (_isAcc && _freshChar.resolved_presence_status !== 'sleeping') {
        const _nowIso = new Date().toISOString();
        // Use the ALREADY-COMMITTED canonical location — do not substitute
        // current_home_location_id and do not relocate the character as a side
        // effect of classifying a conversation event.
        const _committedLocId = _freshChar.resolved_current_location_id || null;
        let _sleepAuth = null;
        try {
          const _ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
            character_id: characterId,
            owner_email: _freshChar.owner_email,
            requested_presence_status: 'sleeping',
            requested_location_id: _committedLocId,
            requested_source_reason: 'conversation_sleep_start',
            requested_authority: 'classifyConversationEvent',
            requested_timestamp: _nowIso,
          });
          _sleepAuth = _ir?.data || _ir;
        } catch (invokeErr) {
          console.error(`[classifyConversationEvent] sleep-start authority invoke FAILED for ${characterName}: ${invokeErr.message} — LifeEvent ${_sleepStartOccurrence.lifeEventId} remains recorded.`);
        }
        // Handle must_resubmit_sleep (e.g., sleep requested while at work →
        // authority moves home awake first), mirroring scheduleNap's contract.
        if (_sleepAuth?.must_resubmit_sleep === true) {
          const _resubmitLocId = _sleepAuth?.committed_result?.resolved_current_location_id || _committedLocId;
          try {
            const _rir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
              character_id: characterId,
              owner_email: _freshChar.owner_email,
              requested_presence_status: 'sleeping',
              requested_location_id: _resubmitLocId,
              requested_source_reason: 'conversation_sleep_start',
              requested_authority: 'classifyConversationEvent',
              requested_timestamp: _nowIso,
            });
            _sleepAuth = _rir?.data || _rir;
          } catch (resubmitErr) {
            console.error(`[classifyConversationEvent] sleep-start authority resubmit FAILED for ${characterName}: ${resubmitErr.message} — LifeEvent ${_sleepStartOccurrence.lifeEventId} remains recorded.`);
          }
        }
        // Success = the authority committed canonical 'sleeping'.
        if (_sleepAuth?.disposition === 'accepted' && _sleepAuth?.committed_result?.resolved_presence_status === 'sleeping') {
          // Exactly ONE existing-format SleepTransition sleep_start proof, from
          // the committed result (same contract as scheduleNap /
          // processScheduledCharacterAlarms). Canonical state is already
          // committed by the authority — proof failure is reported, not
          // reverted (consistent with scheduleNap).
          try {
            await base44.asServiceRole.entities.SleepTransition.create({
              character_id: characterId,
              character_name: characterName || _freshChar.name || '',
              owner_email: _freshChar.owner_email,
              transition_type: 'sleep_start',
              from_status: _freshChar.resolved_presence_status || 'unknown',
              to_status: 'sleeping',
              authority: 'conversation_sleep_start',
              reason: 'Accepted Chat sleep_event occurrence — authoritative sleeping state committed by enforceCharacterLocationPresence.',
              timestamp: _nowIso,
            });
            console.log(`[classifyConversationEvent] sleep-start committed for ${characterName} via authority + one SleepTransition proof written. LifeEvent ${_sleepStartOccurrence.lifeEventId} recorded.`);
          } catch (proofErr) {
            console.error(`[classifyConversationEvent] sleep-start committed for ${characterName} but SleepTransition proof write FAILED: ${proofErr.message} — canonical sleeping state committed; LifeEvent ${_sleepStartOccurrence.lifeEventId} remains recorded.`);
          }
        } else {
          // Authority did not commit 'sleeping' (redirected/deferred/rejected/
          // no_longer_applicable). Surface the real outcome — do NOT suppress
          // the LifeEvent.
          console.error(`[classifyConversationEvent] sleep-start NOT committed for ${characterName} (disposition=${_sleepAuth?.disposition || 'none'}, reason=${_sleepAuth?.reason || 'none'}) — LifeEvent ${_sleepStartOccurrence.lifeEventId} remains recorded (failed state handoff surfaced).`);
        }
      } else if (_freshChar && _freshChar.resolved_presence_status === 'sleeping') {
        // Duplicate guard: already authoritatively sleeping — do not request
        // another sleep_start and do not write a second proof.
        console.log(`[classifyConversationEvent] sleep-start not re-requested for ${characterName} (already sleeping). LifeEvent ${_sleepStartOccurrence.lifeEventId} recorded.`);
      } else if (!_isAcc) {
        console.log(`[classifyConversationEvent] sleep-start consequence skipped for ${characterName} (not active_created_character). LifeEvent ${_sleepStartOccurrence.lifeEventId} recorded.`);
      }
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