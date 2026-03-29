import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

ONGOING RELATIONSHIPS:
${relationshipContext || 'None established yet.'}
${departedContext}
${eventHistoryContext}
${vulnerabilityContext}
${growthContext}

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

TODAY'S TASK:
Generate realistic life updates grounded in current time, the character's history, and their specific vulnerabilities/strengths.

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
            emotional_state: { type: 'string' },
            health_status: { type: 'string' },
            health_habits: { type: 'string' },
            life_event_to_log: { type: 'object' },
          },
        },
      });

      // Preserve bidirectional relationship IDs
      const preservedRelationships = (update.fictional_relationships || []).map(updatedRel => {
        const original = (character.fictional_relationships || []).find(r => r.person_name === updatedRel.person_name);
        return { ...updatedRel, related_character_id: original?.related_character_id || updatedRel.related_character_id };
      });

      await base44.asServiceRole.entities.Character.update(character.id, {
        fictional_relationships: preservedRelationships,
        transient_encounters: update.transient_encounters || [],
        current_life_event: update.current_life_event || '',
        emotional_state: update.emotional_state || character.emotional_state || 'calm',
        health_status: update.health_status || character.health_status || 'healthy',
        health_habits: update.health_habits || character.health_habits || '',
        life_last_updated: new Date().toISOString(),
        departed_characters: [],
      });

      // Log significant life event if the simulation produced one
      const eventToLog = update.life_event_to_log;
      if (eventToLog?.should_log && eventToLog.event_type && eventToLog.title && eventToLog.description) {
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
      }

      results.push({ id: character.id, name, status: 'updated' });
    } catch (err) {
      results.push({ id: character.id, name: character.name, status: 'error', error: err.message });
    }
  }

  return Response.json({ results });
});