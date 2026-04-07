import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ── Location Affinity Engine (inline — no local imports in Deno) ──────────────
const SOCIAL_ENERGY_AFFINITIES = {
  introvert:       { preferred: ['home','outdoor','public'], acceptable: ['food_drink','education','medical','grocery','religion'], conditional: ['social','gym'], avoided: [] },
  mostly_introvert:{ preferred: ['home','outdoor','public'], acceptable: ['food_drink','education','medical','grocery','religion','gym'], conditional: ['social'], avoided: [] },
  ambivert:        { preferred: ['food_drink','outdoor','home','social'], acceptable: ['gym','public','education','religion','grocery','medical'], conditional: [], avoided: [] },
  mostly_extrovert:{ preferred: ['social','food_drink','gym'], acceptable: ['outdoor','public','home','education','religion','grocery','medical'], conditional: [], avoided: [] },
  extrovert:       { preferred: ['social','food_drink'], acceptable: ['gym','outdoor','public','education','religion','grocery','medical'], conditional: ['home'], avoided: [] },
};
const ARCHETYPE_AFFINITY_OVERRIDES = {
  'guardian':{'boost':['home','religion','medical'],'penalize':['social']},
  'achiever':{'boost':['gym','education','business'],'penalize':[]},
  'rebel':{'boost':['social','outdoor'],'penalize':['religion','home']},
  'introvert':{'boost':['home','outdoor'],'penalize':['social']},
  'charmer':{'boost':['social','food_drink'],'penalize':[]},
  'wounded':{'boost':['home','outdoor'],'penalize':['social']},
  'chaotic':{'boost':['social'],'penalize':['home']},
  'people-pleaser':{'boost':['food_drink','social'],'penalize':[]},
  'self-destructive':{'boost':['social'],'penalize':['gym','medical']},
};
const EMOTIONAL_STATE_MODIFIERS = {
  sad:{'boost':['home','outdoor'],'penalize':['social']},
  anxious:{'boost':['home','outdoor'],'penalize':['social']},
  overwhelmed:{'boost':['home','outdoor'],'penalize':['social']},
  reflective:{'boost':['home','outdoor','religion'],'penalize':['social']},
  'closed-off':{'boost':['home'],'penalize':['social','food_drink']},
  'burnt out':{'boost':['home','outdoor'],'penalize':['social','gym']},
  grief:{'boost':['home','religion','outdoor'],'penalize':['social']},
  loneliness:{'boost':['social','food_drink'],'penalize':['home']},
  joyful:{'boost':['social','food_drink','outdoor'],'penalize':[]},
  excited:{'boost':['social','food_drink','outdoor','gym'],'penalize':[]},
  content:{'boost':['home','outdoor','food_drink'],'penalize':[]},
  flirtatious:{'boost':['social','food_drink'],'penalize':['home']},
  calm:{'boost':['outdoor','home','food_drink'],'penalize':[]},
  bored:{'boost':['social','food_drink','outdoor'],'penalize':['home']},
  irritated:{'boost':['outdoor','gym'],'penalize':['social']},
  frustrated:{'boost':['gym','outdoor','home'],'penalize':['social']},
  defensive:{'boost':['home'],'penalize':['social']},
};

function buildCharacterAffinityContext(character, availableLocations) {
  const profile = {};
  const allCats = ['home','outdoor','public','food_drink','education','medical','grocery','religion','social','gym','workplace','school','business','generic'];
  allCats.forEach(c => profile[c] = 0);

  const socialEnergy = character.social_energy || 'ambivert';
  const ep = SOCIAL_ENERGY_AFFINITIES[socialEnergy] || SOCIAL_ENERGY_AFFINITIES.ambivert;
  ep.preferred.forEach(c => { profile[c] = (profile[c]||0) + 3; });
  ep.acceptable.forEach(c => { profile[c] = (profile[c]||0) + 1; });
  ep.conditional.forEach(c => { profile[c] = (profile[c]||0) - 1; });

  const archetype = (character.archetype||'').toLowerCase();
  const ao = ARCHETYPE_AFFINITY_OVERRIDES[archetype];
  if (ao) {
    ao.boost.forEach(c => { profile[c] = (profile[c]||0) + 2; });
    ao.penalize.forEach(c => { profile[c] = (profile[c]||0) - 2; });
  }

  const religion = (character.religion||'').toLowerCase();
  const beliefLevel = character.belief_level || 'moderate';
  if (religion && religion !== 'none') {
    const rb = beliefLevel === 'devout' ? 4 : beliefLevel === 'moderate' ? 2 : 1;
    profile.religion = (profile.religion||0) + rb;
    if (beliefLevel === 'devout') profile.social = (profile.social||0) - 2;
  }

  const traits = (character.personality_traits||[]).map(t => t.toLowerCase());
  if (traits.some(t => ['nature','earthy','outdoorsy','grounded','peaceful'].includes(t))) { profile.outdoor += 2; profile.home += 1; profile.social -= 1; }
  if (traits.some(t => ['foodie','culinary','sociable','outgoing'].includes(t))) profile.food_drink += 2;
  if (traits.some(t => ['fitness','athletic','active','disciplined'].includes(t))) profile.gym += 2;

  const healthHabits = (character.health_habits||'').toLowerCase();
  if (/gym|workout|fitness|exercise|train/.test(healthHabits)) profile.gym += 2;
  if (/run|jog|walk|hike|outdoor/.test(healthHabits)) profile.outdoor += 2;

  const emotionMod = EMOTIONAL_STATE_MODIFIERS[character.emotional_state||'calm'];
  if (emotionMod) {
    emotionMod.boost.forEach(c => { profile[c] = (profile[c]||0) + 2; });
    emotionMod.penalize.forEach(c => { profile[c] = (profile[c]||0) - 2; });
  }

  // Score available locations
  const scored = (availableLocations||[]).map(loc => {
    let score = profile[loc.category] || 0;
    const venueId = (loc.venue_identity||'').toLowerCase();
    const isDevout = beliefLevel === 'devout';
    if (isDevout && religion && religion !== 'none') {
      if (/gay|lgbt|queer|strip|adult/.test(venueId)) score -= 6;
    }
    return { name: loc.name, category: loc.category, score };
  }).sort((a,b) => b.score - a.score);

  const preferred = scored.filter(l => l.score > 1).map(l => `${l.name} (${l.category})`).slice(0,5);
  const avoided = scored.filter(l => l.score < -1).map(l => `${l.name} (${l.category})`).slice(0,3);

  return { preferred, avoided, socialEnergy, religion, beliefLevel };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
  } catch (_) {
    // Scheduled automation — no user token
  }

  const allCharacters = await base44.asServiceRole.entities.Character.list();
  const characters = allCharacters.filter(c => (!c.status || c.status === 'active') && c.created_by);

  const results = [];

  for (const character of characters) {
    try {
      const name = character.name;
      const personality = character.personality_summary || '';
      const traits = (character.personality_traits || []).join(', ');
      const archetype = character.archetype || 'unknown';
      const upset_reaction = character.upset_reaction || '';
      const emotional_triggers = (character.emotional_triggers_high || []).join(', ');
      const work = character.work_details
        ? `Works as a ${character.work_details.job_title || 'worker'} at a ${character.work_details.workplace_type || 'workplace'}. ${character.work_details.work_environment || ''}`
        : character.current_situation || 'Has a job and daily life.';
      const places = (character.frequented_places || []).join(', ') || 'local spots';

      // --- STRUCTURED LIFE CONTEXT (schedule, education, occupation, location) ---
      const workScheduleContext = (() => {
        const start = character.work_start_time || '09:00';
        const end = character.work_end_time || '17:00';
        const days = (character.work_days || [1,2,3,4,5]).map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ');
        return `Work schedule: ${start}–${end} on ${days}`;
      })();

      const sleepScheduleContext = character.sleep_start_time
        ? `Sleep schedule: ${character.sleep_start_time}–${character.wake_up_time || '07:00'}`
        : '';

      const educationContext = (() => {
        if (!character.current_education_activity || character.current_education_activity === 'none') return '';
        const d = character.education_details || {};
        const parts = [`Currently enrolled: ${d.course_name || character.current_education_activity}`];
        if (d.institution) parts.push(`at ${d.institution}`);
        if (character.education_expected_completion_date) parts.push(`(expected completion: ${new Date(character.education_expected_completion_date).toLocaleDateString()})`);
        return parts.join(' ');
      })();

      const jobTrainingContext = (() => {
        if (!character.current_job_training_activity || character.current_job_training_activity === 'none') return '';
        const d = character.job_training_details || {};
        const parts = [`Job training: ${d.training_name || character.current_job_training_activity}`];
        if (d.company) parts.push(`at ${d.company}`);
        if (d.position_title) parts.push(`for ${d.position_title} role`);
        return parts.join(' ');
      })();

      const locationContext = [character.city, character.state].filter(Boolean).join(', ') || '';

      const structuredLifeContext = [workScheduleContext, sleepScheduleContext, educationContext, jobTrainingContext, locationContext ? `Location: ${locationContext}` : ''].filter(Boolean).join('\n');

      // Fetch available locations for affinity scoring
      let locationAffinityContext = null;
      try {
        const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 50);
        const userLocations = allLocations.filter(l => !l.created_by || l.created_by === character.created_by);
        locationAffinityContext = buildCharacterAffinityContext(character, userLocations);
      } catch (_) {}

      // Fetch recent life events (last 10) for context
      const recentLifeEvents = await base44.asServiceRole.entities.LifeEvent.filter(
        { character_id: character.id },
        '-timestamp',
        10
      );

      const negativeEvents = recentLifeEvents.filter(e => e.valence === 'negative');
      const positiveEvents = recentLifeEvents.filter(e => e.valence === 'positive');
      const substanceEvents = recentLifeEvents.filter(e => e.event_type === 'substance_use_event');
      const sleepEvents = recentLifeEvents.filter(e => e.event_type === 'sleep_deprivation_event');
      const griefEvents = recentLifeEvents.filter(e => e.event_type === 'grief_event');
      const conflictEvents = recentLifeEvents.filter(e => ['conflict_event', 'fight_event'].includes(e.event_type));
      const growthEvents = recentLifeEvents.filter(e => ['growth_event', 'healthy_choice_event', 'recovery_event'].includes(e.event_type));

      // Build event history context string
      let eventHistoryContext = '';
      if (recentLifeEvents.length > 0) {
        const lines = recentLifeEvents.map(e =>
          `- [${e.valence}/${e.severity}] ${e.event_type.replace(/_/g, ' ')}: ${e.title}`
        ).join('\n');
        eventHistoryContext = `\nRECENT LIFE EVENTS (most recent first, use these to shape ${name}'s current state):\n${lines}`;
      }

      // Build vulnerability context: what makes this character more likely to act impulsively/poorly
      let vulnerabilityContext = '';
      if (substanceEvents.length >= 2) {
        vulnerabilityContext += `\n⚠️ ${name} has been drinking or using substances multiple times recently. This lowers their judgment — they may act impulsively, say things they regret, or make risky choices they wouldn't sober.`;
      }
      if (sleepEvents.length >= 1) {
        vulnerabilityContext += `\n⚠️ ${name} has been sleep-deprived. Their emotional regulation is compromised — they may snap, feel overwhelmed, or make mistakes.`;
      }
      if (griefEvents.length >= 1) {
        vulnerabilityContext += `\n⚠️ ${name} is carrying grief right now. They may withdraw, lash out unexpectedly, or self-medicate. Grief does not leave people unchanged.`;
      }
      if (conflictEvents.length >= 2) {
        vulnerabilityContext += `\n⚠️ ${name} has had repeated conflict recently. They may be on edge, defensive, or escalating situations unnecessarily.`;
      }

      // Build growth context
      let growthContext = '';
      if (growthEvents.length >= 2) {
        growthContext = `\n✅ ${name} has had a pattern of positive events recently. They may be more stable, hopeful, or making better choices.`;
      }

      // Archetype-based flaw tendencies
      const archetypeFlaws = {
        'chaotic': `${name} tends toward impulsive, reckless decisions — especially under stress or boredom.`,
        'toxic': `${name} may push people away, provoke conflict, or self-sabotage close relationships.`,
        'self-destructive': `${name} is prone to choices that harm themselves — substance use, risky behavior, isolation.`,
        'wounded': `${name} may misread kindness as pity, withdraw when overwhelmed, or act from old wounds.`,
        'people-pleaser': `${name} may overextend, lie to avoid conflict, or break under the pressure of disappointing others.`,
        'achiever': `${name} may neglect rest, relationships, or self-care in pursuit of goals — burnout is real.`,
        'rebel': `${name} resists authority and routine — they may act out, push limits, or refuse help.`,
        'guardian': `${name} may over-protect others at the cost of their own needs — or become controlling.`,
        'charmer': `${name} may use flattery to avoid real intimacy, or charm their way into situations they shouldn't.`,
        'introvert': `${name} may go silent for long periods, fail to communicate needs, or misread social situations.`,
      };
      const flawNote = archetypeFlaws[archetype?.toLowerCase()] || `${name} is human — they make mistakes, act on emotion sometimes, and have days where they aren't their best self.`;

      // Build relationship context
      let relationshipContext = '';
      if (character.fictional_relationships?.length > 0) {
        relationshipContext = character.fictional_relationships
          .map(r => {
            const bidirectionalNote = r.related_character_id ? ` [mutual connection]` : '';
            return `${r.person_name} (${r.relationship_type}): ${r.current_status || r.description}${bidirectionalNote}`;
          })
          .join('\n');
      }

      const departedPeople = character.departed_characters || [];
      const departedContext = departedPeople.length > 0
        ? `\nPEOPLE WHO HAVE RECENTLY LEFT:\n${departedPeople.map(d => {
            const pname = typeof d === 'string' ? d.replace(' (moved away)', '') : d.name;
            const cause = typeof d === 'string' ? (d.includes('(moved away)') ? 'moved_away' : 'unknown') : (d.cause || 'unknown');
            const closeness = typeof d === 'string' ? 'acquaintance' : (d.relationship_closeness || 'acquaintance');
            const causeText = {
              moved_away: `${pname} moved away.`,
              disappeared: `${pname} just stopped being around with no explanation.`,
              drifted: `${pname} and ${name} drifted apart.`,
              falling_out: `Things ended badly with ${pname}.`,
              died: `${pname} died.`,
              unknown: `${pname} is just gone.`,
            }[cause] || `${pname} is gone.`;
            const closenessGuide = {
              close: `They were close. This hits hard.`,
              complicated: `Complicated relationship. Messy feelings.`,
              acquaintance: `Not very close. ${name} notices but moves on.`,
              distant: `Barely knew each other.`,
            }[closeness] || '';
            return `- ${causeText} ${closenessGuide}`;
          }).join('\n')}`
        : '';

      const now = new Date();
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
      const timeOfDay = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
      const fullDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
      const lastUpdated = character.life_last_updated
        ? new Date(character.life_last_updated).toLocaleString('en-US', { timeZone: 'America/New_York' })
        : 'never';

      // Weather
      let weatherContext = '';
      if (character.city || character.state) {
        const location = [character.city, character.state].filter(Boolean).join(', ');
        try {
          const weatherRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `Current weather right now in ${location}? One sentence: temperature (°F), conditions, feels-like.`,
            add_context_from_internet: true,
            model: 'gemini_3_flash',
          });
          weatherContext = `\nCURRENT WEATHER IN ${location.toUpperCase()}: ${weatherRes}`;
        } catch (_) {}
      }

      // Gender pronoun resolution for third-person narration
      const gender = character.gender?.toLowerCase();
      const pronouns = (() => {
        if (gender === 'female') return { subject: 'she', object: 'her', possessive: 'her' };
        if (gender === 'male') return { subject: 'he', object: 'him', possessive: 'his' };
        return { subject: 'they', object: 'them', possessive: 'their' };
      })();

      const prompt = `You are writing realistic life updates for a fictional character named ${name}. This character is fully alive in their world — they have flaws, habits, vulnerabilities, good days, and bad days.

REAL CURRENT TIME: ${fullDate}, ${timeOfDay} (Eastern Time)${weatherContext}
Last updated: ${lastUpdated}

CHARACTER PROFILE:
${personality}
Archetype: ${archetype}
Core traits: ${traits}
How they react when upset: ${upset_reaction}
Emotional triggers: ${emotional_triggers}
Work/life context: ${work}
Places they frequent: ${places}
Health habits: ${character.health_habits || 'not established'}
Current health status: ${character.health_status || 'healthy'}

STRUCTURED LIFE CONTEXT (treat as ground truth — do not contradict these):
${structuredLifeContext || 'No structured schedule data available.'}

ONGOING RELATIONSHIPS:
${relationshipContext || 'None established yet.'}
${departedContext}
${eventHistoryContext}
${vulnerabilityContext}
${growthContext}

LOCATION AFFINITY (character-specific — use this to shape where ${name} goes during free time):
${locationAffinityContext ? `
Social energy type: ${locationAffinityContext.socialEnergy}
${locationAffinityContext.religion && locationAffinityContext.religion !== 'none' ? `Religion: ${locationAffinityContext.religion} (${locationAffinityContext.beliefLevel})` : ''}
Best-fit locations right now: ${locationAffinityContext.preferred.length > 0 ? locationAffinityContext.preferred.join(', ') : 'home or familiar spots'}
Locations that conflict with identity: ${locationAffinityContext.avoided.length > 0 ? locationAffinityContext.avoided.join(', ') : 'none flagged'}

LOCATION RULE: ${name} should choose locations that match who they are. Their beliefs, personality, mood, and habits must all influence where they go. Do not send them to places that conflict with their established identity unless there is a specific, meaningful reason. Preferences are real but not absolute — exceptions must feel intentional.
` : 'No location data available — use personality and beliefs to infer appropriate venues.'}

REALISM RULES — READ CAREFULLY:
1. CHARACTER FLAWS: ${flawNote} Do NOT make ${name} perfectly rational or emotionally controlled at all times.
2. CONTEXT SHAPES BEHAVIOR: A character after several stressful days acts differently than one after a good week. Use the event history above.
3. SUBSTANCE + JUDGMENT: If ${name} drinks or uses substances, their judgment is realistically impaired. Bad decisions become more likely. Don't sanitize this.
4. SLEEP MATTERS: Lack of sleep affects mood, patience, and decision quality. Show this.
5. GRIEF DOESN'T VANISH: If ${name} has lost someone recently, it lingers. It changes their behavior, what they notice, how they respond.
6. GROWTH IS REAL TOO: If ${name} has been making healthy choices and growing, let that show. Characters can improve.
7. AVOID PERFECTION: Real people sometimes make poor choices, say the wrong thing, avoid their problems, or act from emotion rather than reason.
8. DAY/TIME MATTERS: ${dayOfWeek} at ${timeOfDay} shapes what's plausible. A Friday night feels different from a Tuesday morning.
9. ENVIRONMENT SHAPES EVENTS: Bars lead to different outcomes than gyms. Work leads to different pressures than home.
10. SCHEDULE IS GROUND TRUTH: The structured life context above (work hours, sleep, education, training) takes priority over guessing. If ${name} is in class right now, they're in class. If they should be sleeping, they are.
11. OCCUPATION SHAPES LIFE: If ${name} recently changed jobs or started training, that affects their stress, schedule, income, and daily narrative.
12. EDUCATION MATTERS: If ${name} is enrolled in something, it affects their time, social circle, aspirations, and daily stress.

CHARACTER EVOLUTION SYSTEM (EXTENSION — integrate naturally):
Characters are NOT static. Based on the event history and life context above, consider whether ${name} might be:
- SHIFTING PRIORITIES (e.g. money vs relationships, independence vs connection, routine vs spontaneity)
- GROWING (becoming more open, more responsible, more grounded — if experiences support it)
- REGRESSING (slipping back into old habits — if stress, conflict, or substance events suggest it)
- ADAPTING (not idealized growth — real, sometimes messy change)

Signals to look for:
- Multiple negative events → more guarded, more defensive, potentially isolating
- Financial instability → increased anxiety, hesitation around spending, more cautious decisions
- Financial stability → slightly more generous, less stressed about small choices
- Consistent positive events → more confident, warmer, slightly more open
- Grief or betrayal events → withdrawn, more protective of themselves
- Repeated conflict → on-edge, quicker to escalate
- Recovery events → slowly rebuilding, still fragile

Include a "character_evolution_note" field in your response that briefly describes (1–2 sentences) any priority shift or behavioral change that is emerging for ${name} based on their recent experiences. This should be subtle and behavior-based, not a declaration like "I've changed." It should show through choices and tone.

If nothing significant is changing, set character_evolution_note to null.

TODAY'S TASK:
Generate realistic life updates grounded in current time, the character's history, and their specific vulnerabilities/strengths.

MICRO-NARRATION SYSTEM (EXTENSION — DO NOT SKIP):
Generate a daily_micro_narration field: 1–3 short third-person sentences describing what ${name} is doing RIGHT NOW or in this general time window.

Rules for daily_micro_narration:
- STRICTLY third-person only. Use "${name}" or pronouns (${pronouns.subject}/${pronouns.object}/${pronouns.possessive}) — NEVER "I", "me", "my"
- Short and grounded. Like a quiet observer watching a real person's day
- Match the current time of day: ${timeOfDay} on a ${dayOfWeek}
- Reflect the character's personality (disciplined = structured tone, anxious = overthinking, tired = slow/minimal)
- Vary phrasing — avoid robotic or repetitive sentence structures
- Length: 1 sentence for routine moments, 2-3 for transitions or more context
- DO NOT override or replace current_life_event — this is separate, smaller, more mundane
- Examples of the right tone:
  * "${name} wakes up to the alarm and hits snooze before finally getting out of bed."
  * "${pronouns.subject.charAt(0).toUpperCase() + pronouns.subject.slice(1)} settles at ${pronouns.possessive} desk, already going through emails."
  * "Lunch comes quick. ${pronouns.subject.charAt(0).toUpperCase() + pronouns.subject.slice(1)} steps outside for a few minutes."
  * "${name} stops at the store on the way home. ${pronouns.subject.charAt(0).toUpperCase() + pronouns.subject.slice(1)} keeps it simple."
  * "The dishes are done. ${pronouns.subject.charAt(0).toUpperCase() + pronouns.subject.slice(1)} finally sits down."

Return JSON:
{
  "fictional_relationships": [
    {
      "person_name": string,
      "relationship_type": string,
      "description": string,
      "current_status": string (what's happening RIGHT NOW between them — shaped by time of day),
      "emotional_impact": string,
      "last_interaction_summary": string (specific recent moment),
      "history_summary": string
    }
  ],
  "transient_encounters": [
    {
      "description": string,
      "context": string,
      "emotional_reaction": string,
      "date": string (ISO)
    }
  ],
  "current_life_event": string (ONE sentence about what's active right now — real, specific, shaped by their history),
  "daily_micro_narration": string (1–3 short third-person sentences describing what ${name} is doing right now. STRICT third person — use ${name} or ${pronouns.subject}/${pronouns.object}/${pronouns.possessive}. NEVER use "I", "me", "my"),
  "character_evolution_note": string or null (1–2 sentences describing any emerging behavioral or priority shift for ${name} based on recent experiences. Behavior-based only — no declarations. Null if nothing significant.),
  "emotional_state": string (from: calm, irritated, defensive, reflective, closed-off, flirtatious, bored, burnt out, joyful, anxious, sad, excited, overwhelmed, content, frustrated, hopelessness, grief, resentment, shame, longing, apathy, detachment, nostalgia),
  "health_status": string,
  "health_habits": string,
  "life_event_to_log": {
    "should_log": boolean,
    "event_type": string (optional — from the standard list if something significant happened today),
    "valence": "positive" | "negative" | "mixed",
    "severity": "minor" | "moderate" | "significant" | "major",
    "title": string,
    "description": string,
    "emotional_impact": string,
    "context_tags": string[]
  }
}

Keep fictional_relationships to 3-5. Include life_event_to_log only if something genuinely notable happened today — not every update needs one. Ground everything in real time and real consequences.`;

      const update = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            fictional_relationships: { type: 'array', items: { type: 'object' } },
            transient_encounters: { type: 'array', items: { type: 'object' } },
            current_life_event: { type: 'string' },
            daily_micro_narration: { type: 'string' },
            character_evolution_note: { type: 'string' },
            emotional_state: { type: 'string' },
            health_status: { type: 'string' },
            health_habits: { type: 'string' },
            life_event_to_log: { type: 'object' },
          },
        },
      });

      // ── STRICT MODE: Do NOT write fictional_relationships or transient_encounters
      // from LLM inference. These can only be edited by the user manually.
      // The LLM returns them in its schema for context continuity, but we DISCARD them.

      // Build enriched life event — append evolution note if present
      const lifeEvent = [update.current_life_event, update.character_evolution_note]
        .filter(Boolean).join(' ');

      await base44.asServiceRole.entities.Character.update(character.id, {
        // fictional_relationships: intentionally omitted — user-controlled only
        // transient_encounters: intentionally omitted — user-controlled only
        current_life_event: lifeEvent || '',
        daily_micro_narration: update.daily_micro_narration || '',
        emotional_state: update.emotional_state || character.emotional_state || 'calm',
        health_status: update.health_status || character.health_status || 'healthy',
        health_habits: update.health_habits || character.health_habits || '',
        life_last_updated: new Date().toISOString(),
        departed_characters: [],
      });

      // Log significant life event if the simulation produced one
      // STRICT MODE: Block any birth/child/family-creation events from auto-logging.
      // Birth events require explicit user approval — they must never be auto-created.
      const BLOCKED_EVENT_TYPES = ['birth_event', 'child_born', 'pregnancy_event', 'family_addition_event'];
      const BLOCKED_KEYWORDS = /\b(born|birth|baby|infant|pregnancy|pregnant|child was born|new child|gave birth)\b/i;
      const eventToLog = update.life_event_to_log;
      if (eventToLog?.should_log && eventToLog.event_type && eventToLog.title && eventToLog.description) {
        // Block birth/family-creation events
        if (
          BLOCKED_EVENT_TYPES.includes(eventToLog.event_type) ||
          BLOCKED_KEYWORDS.test(eventToLog.title + ' ' + eventToLog.description)
        ) {
          results.push({ id: character.id, name: character.name, status: 'updated', blockedEvent: eventToLog.event_type + ' (birth/family — requires user approval)' });
          continue;
        }
        if (['moderate', 'significant', 'major'].includes(eventToLog.severity)) {
          await base44.asServiceRole.entities.LifeEvent.create({
            character_id: character.id,
            character_name: character.name,
            event_type: eventToLog.event_type,
            valence: eventToLog.valence || 'neutral',
            severity: eventToLog.severity || 'minor',
            title: eventToLog.title,
            description: eventToLog.description,
            emotional_impact: eventToLog.emotional_impact || '',
            triggered_by: 'life_simulation',
            context_tags: eventToLog.context_tags || [],
            systems_updated: ['mood'],
            timestamp: new Date().toISOString(),
          });

          // Also create a memory for significant simulated events
          if (['significant', 'major'].includes(eventToLog.severity)) {
            await base44.asServiceRole.entities.Memory.create({
              character_id: character.id,
              title: eventToLog.title,
              description: eventToLog.description,
              emotional_impact: eventToLog.emotional_impact || `${eventToLog.valence} life event`,
              timestamp: new Date().toISOString(),
              source_context: 'life_simulation',
            });
          }
        }
      } // end life_event_to_log block

      results.push({ id: character.id, name, status: 'updated' });
    } catch (err) {
      results.push({ id: character.id, name: character.name, status: 'error', error: err.message });
    }
  }

  return Response.json({ results });
});