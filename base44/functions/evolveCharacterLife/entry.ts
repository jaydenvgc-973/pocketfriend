import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ── Location Affinity Engine (inline — Deno cannot use local imports) ─────────
const _SE = {
  introvert:        { preferred:['home','outdoor','public'], acceptable:['food_drink','education','medical','grocery','religion'], conditional:['gym'], avoided:['social'] },
  mostly_introvert: { preferred:['home','outdoor','public'], acceptable:['food_drink','education','medical','grocery','religion','gym'], conditional:['social'], avoided:[] },
  ambivert:         { preferred:['food_drink','outdoor','home','social'], acceptable:['gym','public','education','religion','grocery','medical'], conditional:[], avoided:[] },
  mostly_extrovert: { preferred:['social','food_drink','gym','outdoor'], acceptable:['public','home','education','religion','grocery','medical'], conditional:[], avoided:[] },
  extrovert:        { preferred:['social','food_drink','outdoor'], acceptable:['gym','public','education','religion','grocery','medical'], conditional:['home'], avoided:[] },
};
const _AA = {
  'guardian':{'boost':['home','religion','medical','grocery'],'penalize':['social']},
  'achiever':{'boost':['gym','education','business'],'penalize':[]},
  'rebel':{'boost':['social','outdoor'],'penalize':['religion','home']},
  'introvert':{'boost':['home','outdoor'],'penalize':['social']},
  'charmer':{'boost':['social','food_drink'],'penalize':[]},
  'wounded':{'boost':['home','outdoor','religion'],'penalize':['social']},
  'chaotic':{'boost':['social'],'penalize':['home','religion']},
  'people-pleaser':{'boost':['food_drink','social'],'penalize':[]},
  'self-destructive':{'boost':['social'],'penalize':['gym','medical']},
  'nurturer':{'boost':['home','medical','grocery','religion'],'penalize':[]},
  'intellectual':{'boost':['education','public','home'],'penalize':['social']},
  'homebody':{'boost':['home','grocery','outdoor'],'penalize':['social']},
  'social butterfly':{'boost':['social','food_drink','gym'],'penalize':['home']},
  'loner':{'boost':['home','outdoor','public'],'penalize':['social','food_drink']},
  'romantic':{'boost':['food_drink','outdoor','social'],'penalize':[]},
  'free spirit':{'boost':['outdoor','social','food_drink'],'penalize':['home']},
};
const _EM = {
  sad:{'boost':['home','outdoor','religion'],'penalize':['social'],'isolating':true},
  anxious:{'boost':['home','outdoor'],'penalize':['social'],'isolating':true},
  overwhelmed:{'boost':['home','outdoor'],'penalize':['social','gym'],'isolating':true},
  reflective:{'boost':['home','outdoor','religion','public'],'penalize':['social'],'isolating':false},
  'closed-off':{'boost':['home'],'penalize':['social','food_drink'],'isolating':true},
  'burnt out':{'boost':['home','outdoor'],'penalize':['social','gym'],'isolating':true},
  grief:{'boost':['home','religion','outdoor'],'penalize':['social'],'isolating':true},
  loneliness:{'boost':['social','food_drink','outdoor'],'penalize':['home'],'isolating':false},
  detachment:{'boost':['home','outdoor'],'penalize':['social'],'isolating':true},
  apathy:{'boost':['home'],'penalize':[],'isolating':true},
  hopelessness:{'boost':['home','religion'],'penalize':['social','gym'],'isolating':true},
  joyful:{'boost':['social','food_drink','outdoor','gym'],'penalize':[],'isolating':false},
  excited:{'boost':['social','food_drink','outdoor','gym'],'penalize':[],'isolating':false},
  content:{'boost':['home','outdoor','food_drink'],'penalize':[],'isolating':false},
  flirtatious:{'boost':['social','food_drink'],'penalize':['home'],'isolating':false},
  calm:{'boost':['outdoor','home','food_drink','religion'],'penalize':[],'isolating':false},
  bored:{'boost':['social','food_drink','outdoor'],'penalize':['home'],'isolating':false},
  irritated:{'boost':['outdoor','gym'],'penalize':['social'],'isolating':false},
  frustrated:{'boost':['gym','outdoor','home'],'penalize':['social'],'isolating':false},
  defensive:{'boost':['home','outdoor'],'penalize':['social'],'isolating':true},
  stress:{'boost':['outdoor','home','gym'],'penalize':['social'],'isolating':false},
  guilt:{'boost':['home','religion'],'penalize':['social'],'isolating':true},
  shame:{'boost':['home'],'penalize':['social','food_drink'],'isolating':true},
  longing:{'boost':['outdoor','religion','home'],'penalize':[],'isolating':false},
  confidence:{'boost':['social','gym','outdoor'],'penalize':[],'isolating':false},
  pride:{'boost':['social','gym','food_drink'],'penalize':[],'isolating':false},
  nostalgia:{'boost':['home','outdoor','food_drink'],'penalize':[],'isolating':false},
  curiosity:{'boost':['outdoor','education','public','food_drink'],'penalize':[],'isolating':false},
};

const _CONSERVATIVE_FLAGS = ['gay','lgbt','queer','lgbtq','drag','strip club','strip bar','adult club','adult entertainment','erotic','sex club','swinger','fetish'];
const _ALCOHOL_FLAGS = ['brewery','distillery','wine bar','cocktail bar','pub','bar'];
const _NIGHTCLUB_FLAGS = ['nightclub','night club','rave','dance club','lounge club'];
const _hasPattern = (text, patterns) => { const t=(text||'').toLowerCase(); return patterns.some(p=>t.includes(p)); };

function buildCharacterAffinityContext(character, availableLocations) {
  // Base profile
  const profile = {};
  const allCats = ['home','outdoor','public','food_drink','education','medical','grocery','religion','social','gym','workplace','school','business','generic'];
  allCats.forEach(c => { profile[c] = 0; });

  // Social energy
  const se = character.social_energy || 'ambivert';
  const ep = _SE[se] || _SE.ambivert;
  (ep.preferred||[]).forEach(c => { profile[c] = (profile[c]||0) + 3; });
  (ep.acceptable||[]).forEach(c => { profile[c] = (profile[c]||0) + 1; });
  (ep.conditional||[]).forEach(c => { profile[c] = (profile[c]||0) - 1; });
  (ep.avoided||[]).forEach(c => { profile[c] = (profile[c]||0) - 3; });

  // Archetype
  const arch = (character.archetype||'').toLowerCase().trim();
  const ao = _AA[arch] || _AA[Object.keys(_AA).find(k => arch.includes(k)||k.includes(arch))];
  if (ao) {
    (ao.boost||[]).forEach(c => { profile[c] = (profile[c]||0) + 2; });
    (ao.penalize||[]).forEach(c => { profile[c] = (profile[c]||0) - 2; });
  }

  // Religion
  const religion = (character.religion||'').toLowerCase().trim();
  const beliefLevel = character.belief_level || 'moderate';
  const isDevout = beliefLevel === 'devout';
  const isModerate = beliefLevel === 'moderate';
  if (religion && religion !== 'none') {
    profile.religion = (profile.religion||0) + (isDevout ? 5 : isModerate ? 2 : 1);
    if (isDevout) { profile.social = (profile.social||0) - 2; profile.home = (profile.home||0) + 1; }
    if ((religion.includes('islam')||religion.includes('muslim')) && (isDevout||isModerate)) {
      profile.social = (profile.social||0) - 1;
    }
  }

  // Health habits
  const hh = (character.health_habits||'').toLowerCase();
  if (/gym|workout|fitness|exercise|train|lift|crossfit/.test(hh)) profile.gym = (profile.gym||0) + 3;
  if (/run|jog|walk|hike|trail|outdoor|cycle|bike/.test(hh)) profile.outdoor = (profile.outdoor||0) + 2;
  if (/yoga|meditat|wellness|mindful|pilates/.test(hh)) profile.outdoor = (profile.outdoor||0) + 2;
  if (/drink|bar|nightclub|party|clubbing/.test(hh)) profile.social = (profile.social||0) + 2;

  // Personality traits
  const traits = (character.personality_traits||[]).map(t => t.toLowerCase()).join(' ');
  if (/nature|earthy|outdoors|grounded|peaceful|hiking|trail/.test(traits)) { profile.outdoor += 2; profile.home += 1; profile.social -= 1; }
  if (/foodie|culinary|brunch|coffee|food lover/.test(traits)) profile.food_drink += 2;
  if (/fitness|athletic|active|disciplined|sporty|runner|wellness/.test(traits)) { profile.gym += 2; profile.outdoor += 1; }
  if (/bookish|intellectual|studious|curious|academic|reader/.test(traits)) { profile.education += 2; profile.public += 1; }
  if (/outgoing|sociable|party|social|gregarious|extroverted/.test(traits)) profile.social += 2;
  if (/homebody|cozy|domestic|introverted|private/.test(traits)) { profile.home += 2; profile.social -= 1; }
  if (/spiritual|religious|faithful|devout|prayer|worship/.test(traits)) { profile.religion += 2; profile.home += 1; }
  if (/night owl|party lover|nightlife|club goer|bar hopper/.test(traits)) profile.social += 2;

  // Emotional state
  const em = _EM[character.emotional_state||'calm'];
  if (em) {
    (em.boost||[]).forEach(c => { profile[c] = (profile[c]||0) + 2; });
    (em.penalize||[]).forEach(c => { profile[c] = (profile[c]||0) - 2; });
    if (em.isolating) profile.home = (profile.home||0) + 1;
  }

  // Score locations
  const scored = (availableLocations||[]).map(loc => {
    let score = profile[loc.category] || 0;
    const venueText = [(loc.venue_identity||''),(loc.club_theme||''),(loc.name||''),(loc.subtype||[]).join(' ')].join(' ').toLowerCase();

    // Religion-based venue filtering
    if (religion && religion !== 'none') {
      if (isDevout && _hasPattern(venueText, _CONSERVATIVE_FLAGS)) score -= 8;
      else if (isModerate && _hasPattern(venueText, ['strip club','adult club','sex club'])) score -= 4;
      if ((religion.includes('islam')||religion.includes('muslim')) && (isDevout||isModerate)) {
        if (_hasPattern(venueText, _ALCOHOL_FLAGS)) score += isDevout ? -6 : -3;
      }
    }

    // Introvert + nightclub
    if (_hasPattern(venueText, _NIGHTCLUB_FLAGS) && ['introvert','mostly_introvert'].includes(se)) score -= 3;

    // Health need → medical
    if (loc.category === 'medical' && /sick|pain|recover|ill|injury|checkup/.test((character.health_status||'').toLowerCase())) score += 4;

    // Gym + burnt out
    if (loc.category === 'gym' && /burnt out|overwhelmed|exhausted/.test((character.emotional_state||'').toLowerCase())) score -= 2;

    // Home when worn out
    if (loc.category === 'home' && /burnt out|overwhelmed|sad|tired|exhausted|grief|anxious/.test((character.emotional_state||'').toLowerCase())) score += 2;

    // Frequented places
    const freq = (character.frequented_places||[]).map(p=>p.toLowerCase());
    if (freq.some(p => (loc.name||'').toLowerCase().includes(p) || p.includes((loc.name||'').toLowerCase()))) score += 2;

    return { name: loc.name, category: loc.category, score };
  }).sort((a,b) => b.score - a.score);

  const preferred = scored.filter(l => l.score > 1).map(l => `${l.name} (${l.category})`).slice(0,6);
  const avoided   = scored.filter(l => l.score < -1).map(l => `${l.name} (${l.category})`).slice(0,4);

  const socialDesc = {
    introvert:'prefers home/parks/quiet places, avoids crowds',
    mostly_introvert:'leans quiet, small gatherings',
    ambivert:'mood-dependent between social and quiet',
    mostly_extrovert:'enjoys lively social venues and restaurants',
    extrovert:'thrives in clubs, parties, crowded social spaces',
  }[se] || 'balanced preferences';

  const moodDesc = em
    ? (em.isolating ? `withdrawing — prefers ${(em.boost||[]).join('/')}` : `outward — drawn to ${(em.boost||[]).join('/')}`)
    : 'neutral';

  return { preferred, avoided, socialEnergy: se, socialDesc, religion, beliefLevel, moodDesc };
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

LOCATION AFFINITY (identity-driven — must shape every location choice during free time):
${locationAffinityContext ? `
SOCIAL ENERGY: ${locationAffinityContext.socialEnergy} — ${locationAffinityContext.socialDesc}
CURRENT MOOD: ${character.emotional_state || 'calm'} — ${locationAffinityContext.moodDesc}
${locationAffinityContext.religion && locationAffinityContext.religion !== 'none' ? `BELIEFS: ${locationAffinityContext.religion} (${locationAffinityContext.beliefLevel}) — filters uncomfortable venue types` : ''}
PREFERRED RIGHT NOW: ${locationAffinityContext.preferred.length > 0 ? locationAffinityContext.preferred.join(', ') : 'home or familiar spots'}
AVOID (identity conflict): ${locationAffinityContext.avoided.length > 0 ? locationAffinityContext.avoided.join(', ') : 'none flagged'}

LOCATION RULES (strictly enforced):
1. Schedule obligations always take priority (work/school/sleep times).
2. During free time, ${name} must go to places that fit their personality, beliefs, habits, and current mood.
3. Preferred venues = natural default. Acceptable = occasional. Avoided = only with a strong specific reason.
4. Do NOT randomly assign venues. Two characters with different identities must not default to the same places unless that makes sense for both.
5. Exceptions are allowed but must feel intentional — not accidental noise.
` : 'No specific location data — use personality, social energy, beliefs, and mood to infer appropriate venues. Do not default to random choices.'}

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

MORNING NARRATIVE ENGINE (5:00 AM – 11:00 AM — ACTIVE CREATED CHARACTERS ONLY):
If the current time falls between 5:00 AM and 11:00 AM, apply these rules for daily_micro_narration:

MORNING INTENT — pick one based on personality, needs, schedule, and mood:
productive | slow_start | self_care | social | obligation (if work/school) | escape | recovery | spiritual | chaotic

INTENT SELECTION GUIDE:
- introvert → slow_start or self_care
- extrovert → social or productive
- health-focused → productive or self_care
- religious → spiritual
- party-oriented traits → recovery or chaotic
- low energy/mental need → slow_start or recovery
- low social need → social
- low hygiene → self_care
- low hunger → food-first behavior
- if work or school scheduled → obligation (hard override)

LAYERING RULE (REQUIRED): Each morning narrative MUST include 2–3 connected actions — NOT a single action. Not a list — a flowing paragraph-style observation.

ANTI-REPETITION (CRITICAL):
- Do NOT default to "wakes up and drinks coffee" as the structure
- Do NOT make coffee/tea the first or only action
- Coffee/tea is acceptable ONLY as part of a sequence (e.g. after movement, after shower, after checking phone)
- Some characters drink water first, some move first, some eat first, some skip drinks entirely
- Vary structure across characters — no two mornings should feel identical

MORNING PATTERN EXAMPLES (reference only — reword everything, adapt tone, vary structure):
- Wakes before the alarm, sits a moment noticing body tension, then moves first before reaching for the phone
- Ignores notifications, puts on music before anything else, takes a slower more deliberate approach to the morning
- Gets up immediately when alarm goes off, checks schedule mentally, moves through routine efficiently
- Wakes still tired, doesn't rush, focuses on small resets — water, basic routine, minimal effort
- Notices something feels off, slows down, prioritizes balance over intensity
- Reaches for phone early not to scroll but to connect — sends a quick message, eases into interaction
- Starts morning with a financial or schedule check that shapes decisions for the rest of the day
- Wakes slower than planned, stabilizes first — hydration, quiet, keeps routine minimal

NIGHT OWL / LATE SHIFT ENGINE (applies when character works late, has night_owl trait, or is active late):
If ${name} is a night owl or works late shifts, morning narratives should reflect that reality:
- They may still be winding down, not waking up
- Sleep patterns are shifted — do not force early-morning productivity on a night worker
- Night shift intents: focused | social | restless | fatigued | perfectionist | withdrawn | routine_anchor | creative | time_aware
- Night workers have their own layered behaviors: checking time, adjusting pace across the shift, filling quiet with purpose or restlessness
- NOT all night workers are tired — some are locked in, some are restless, some are perfectionist
- Vary night behavior across characters just as with mornings

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