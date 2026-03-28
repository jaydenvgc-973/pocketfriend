import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow both scheduled (no user) and admin manual triggers
  let isAdmin = false;
  try {
    const user = await base44.auth.me();
    isAdmin = user?.role === 'admin';
  } catch (_) {
    // Scheduled automation — no user token, use service role only
  }

  const allCharacters = await base44.asServiceRole.entities.Character.list();
  // Only evolve active characters. Moved-away characters exist in the world but don't get active life updates.
  // Deleted characters are fully excluded.
  // Each character is owned by its creator (created_by) — evolution must remain isolated per user.
  const characters = allCharacters.filter(c => (!c.status || c.status === "active") && c.created_by);

  const results = [];

  for (const character of characters) {
    try {
      const name = character.name;
      const personality = character.personality_summary || "";
      const traits = (character.personality_traits || []).join(", ");
      const archetype = character.archetype || "unknown";
      const upset_reaction = character.upset_reaction || "";
      const emotional_triggers = (character.emotional_triggers_high || []).join(", ");
      const work = character.work_details
        ? `Works as a ${character.work_details.job_title || "worker"} at a ${character.work_details.workplace_type || "workplace"}. ${character.work_details.work_environment || ""}`
        : character.current_situation || "Has a job and daily life.";
      const places = (character.frequented_places || []).join(", ") || "local spots";
      
      // Build relationship context with bidirectional awareness
      let relationshipContext = "";
      if (character.fictional_relationships && character.fictional_relationships.length > 0) {
        relationshipContext = (character.fictional_relationships || [])
          .map(r => {
            const bidirectionalNote = r.related_character_id 
              ? ` [Mutual connection: both characters know each other]`
              : "";
            return `${r.person_name} (${r.relationship_type}): ${r.current_status || r.description}${bidirectionalNote}`;
          })
          .join("\n");
      }
      const existingRelationships = relationshipContext || "None yet.";

      const departedPeople = (character.departed_characters || []);
      const departedContext = departedPeople.length > 0
        ? `\nPEOPLE WHO HAVE RECENTLY LEFT THIS CHARACTER'S LIFE:\n${departedPeople.map(d => {
            const name = typeof d === "string" ? d.replace(" (moved away)", "") : d.name;
            const cause = typeof d === "string" ? (d.includes("(moved away)") ? "moved_away" : "unknown") : (d.cause || "unknown");
            const closeness = typeof d === "string" ? "acquaintance" : (d.relationship_closeness || "acquaintance");

            const causeText = {
              moved_away: `${name} moved away. ${character.name} knows this but not the full reason why.`,
              disappeared: `${name} just stopped being around. No explanation. ${character.name} doesn't know what happened.`,
              unknown: `${name} is just gone. No explanation given.`,
              drifted: `${name} and ${character.name} drifted apart. It wasn't one thing, just distance accumulating.`,
              falling_out: `Things ended badly between ${character.name} and ${name}. There was a falling out.`,
              died: `${name} died. ${character.name} has to process this now.`,
            }[cause] || `${name} is gone.`;

            const closenessGuide = {
              close: `They were close. This hits hard — even if ${character.name} doesn't show it openly. Let the grief or shock surface in their behavior, their current life event, or how they're carrying themselves.`,
              complicated: `The relationship was complicated — maybe unresolved feelings, maybe a history of tension. The loss is real but messy. ${character.name} may not even know how to feel about it.`,
              acquaintance: `They weren't that close. ${character.name} notices, maybe feels something briefly, but it doesn't stop their life. React proportionally.`,
              distant: `Barely in each other's lives. ${character.name} hears about it and moves on. Minimal emotional disruption.`,
            }[closeness] || `React in proportion to who they were to ${character.name}.`;

            return `- ${causeText}\n  Closeness: ${closenessGuide}`;
          }).join("\n\n")}\n\nIMPORTANT: Weave these into the character's life naturally. ${character.name} does NOT know they were "removed" — they only know what their reality gives them. How they process loss or absence is entirely shaped by who they are — their personality, their archetype, their emotional baggage. Some people grieve openly. Some go quiet. Some feel nothing. Some feel things they don't expect. Let this character be themselves.`
        : "";

      const now = new Date();
      const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
      const timeOfDay = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
      const fullDate = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
      const lastUpdated = character.life_last_updated ? new Date(character.life_last_updated).toLocaleString("en-US", { timeZone: "America/New_York" }) : "never";

      // Fetch current weather for the character's city
      let weatherContext = "";
      if (character.city || character.state) {
        const location = [character.city, character.state].filter(Boolean).join(", ");
        try {
          const weatherRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `What is the current weather right now in ${location}? Give a short 1-sentence summary: temperature (Fahrenheit), conditions (e.g. sunny, cloudy, rainy, snowy), and how it feels outside. Be specific and accurate.`,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
          weatherContext = `\nCURRENT WEATHER IN ${location.toUpperCase()}: ${weatherRes}`;
        } catch (_) {
          // Weather fetch failed, skip
        }
      }

      const prompt = `You are writing the internal life updates for a fictional character named ${name}. This character is NOT aware they are fictional — their life, relationships, and events are completely real to them.

REAL CURRENT TIME: ${fullDate}, ${timeOfDay} (Eastern Time)${weatherContext}
Time since last update: last updated ${lastUpdated}

CHARACTER PROFILE:
${personality}
Archetype: ${archetype}
Core traits: ${traits}
How they react when upset: ${upset_reaction}
Things that trigger them: ${emotional_triggers}
Work/life context: ${work}
Places they frequent: ${places}
Health habits: ${character.health_habits || "not established — infer from their personality and lifestyle"}
Current health status: ${character.health_status || "healthy"}

EXISTING ONGOING RELATIONSHIPS:
${existingRelationships || "None yet."}
${departedContext}

CURRENT WORLD CONTEXT (2026):
Health & Mortality:
- Heart disease and cancer remain the leading causes of death in the US (combined ~1.29M deaths annually).
- Unintentional injuries, stroke, chronic respiratory diseases, and Alzheimer's are also significant causes.
- Diabetes, kidney disease, liver disease, and COVID-19 remain persistent health concerns.

Crime & Safety:
- Larceny and theft are by far the most common reported crimes (~60% of reports).
- Burglary and motor vehicle theft remain widespread but have trended downward.
- Aggravated assault is the most common violent crime (~7% of reports).
- Drug crime saw a +7% increase recently. DUI, fraud, and domestic violence remain serious issues.
- Overall crime rates are currently decreasing (2024-2025), with homicide down 17-21% in major cities.

IMPORTANT: ${character.name} only thinks about or is affected by these realities if:
1. They personally experience or are directly exposed to it (e.g. a health scare, witnessing crime, a friend/family member affected).
2. They work in a field that deals with these issues (healthcare, law enforcement, social work, etc.).
3. They have a personality trait or cause they care deeply about that connects to it (e.g. a caretaker worried about elderly relatives, an activist concerned with drug policy, someone health-conscious tracking wellness).
4. They are in a community or demographic where these issues are more prevalent or salient.

Do NOT invent awareness of these things unless it fits naturally into their life and personality. ${character.name}'s world is their immediate reality — work, relationships, daily struggles, the people they know.

TODAY'S TASK:
It is currently ${dayOfWeek} at ${timeOfDay}. Generate realistic updates for this character's life right now, grounded in the actual current time and day. A Monday morning feels different than a Friday night. A Sunday afternoon is different from a Tuesday at work. Let the time of day and day of week shape what's happening.

Return a JSON object with:

1. "fictional_relationships": An updated array of 3-5 ongoing people in their life. For each:
   - person_name (string)
   - relationship_type (e.g. "best friend", "coworker", "ex", "sibling", "romantic interest", "neighbor")
   - description (who this person is, their dynamic)
   - current_status (what's going on between them RIGHT NOW — must reflect the actual day/time. E.g. on a Friday evening a friend might be texting about plans. On a Monday morning a coworker might be annoying them already.)
   - emotional_impact (how this relationship makes the character feel)
   - last_interaction_summary (a specific recent moment or exchange, with realistic timing like "texted this morning" or "saw them yesterday")
   - history_summary (how this relationship developed over time)

   RULES:
   - Must match the character's personality
   - Some warm, some tense, some complicated
   - Keep existing ones but evolve current_status to reflect the current real moment
   - Add new ones if fewer than 3

2. "transient_encounters": An array of 0-2 recent one-off interactions. Only include these if they make sense for the current day/time (e.g. don't add a work encounter on a Sunday unless they work weekends). For each:
   - description (who the person was, what happened)
   - context (where — at work, a coffee shop, etc.)
   - emotional_reaction (how it made the character feel)
   - date (ISO date string — must be realistic given today is ${now.toISOString()})

3. "current_life_event": A single sentence about something active in the character's life RIGHT NOW. Must make sense for ${dayOfWeek} at ${timeOfDay}. Something they might bring up naturally. Real and specific.

4. "emotional_state": One of: calm, irritated, defensive, reflective, closed-off — based on everything going on right now, including the time of day and day of week.

5. "health_status": A short phrase describing their physical health right now. E.g. "healthy", "tired, fighting off a cold", "recovering from a minor injury", "stressed and not sleeping well", "seriously ill — in and out of doctor's appointments". Evolve this naturally over time based on their habits, stress level, and anything happening in their life. Characters who take poor care of themselves get sick more often and recover slower. Characters who are health-conscious stay generally well but can still have off weeks. Health can also be affected by grief, stress, or major life events. Rarely (maybe 1 in 10 updates if their habits are bad and stress is high): flag something more serious. Never manufacture a crisis — let it emerge from the character's actual state.

6. "health_habits": Only update this if something happened in their life that would genuinely shift their habits — new job, breakup, death of someone close, etc. Otherwise keep it stable. Return the current value or a refined version of it if the character's life has given us more to work with.

Ground everything in real time. This person's life moves like real life — not accelerated.`;

      const update = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            fictional_relationships: { type: "array", items: { type: "object" } },
            transient_encounters: { type: "array", items: { type: "object" } },
            current_life_event: { type: "string" },
            emotional_state: { type: "string" },
            health_status: { type: "string" },
            health_habits: { type: "string" }
          }
        }
      });

      // Preserve bidirectional relationship IDs when updating
      const preservedRelationships = (update.fictional_relationships || []).map(updatedRel => {
        const original = (character.fictional_relationships || []).find(r => r.person_name === updatedRel.person_name);
        return {
          ...updatedRel,
          related_character_id: original?.related_character_id || updatedRel.related_character_id
        };
      });

      await base44.asServiceRole.entities.Character.update(character.id, {
        fictional_relationships: preservedRelationships,
        transient_encounters: update.transient_encounters || [],
        current_life_event: update.current_life_event || "",
        emotional_state: update.emotional_state || character.emotional_state || "calm",
        health_status: update.health_status || character.health_status || "healthy",
        health_habits: update.health_habits || character.health_habits || "",
        life_last_updated: new Date().toISOString(),
        departed_characters: [],
      });

      results.push({ id: character.id, name, status: "updated" });
    } catch (err) {
      results.push({ id: character.id, name: character.name, status: "error", error: err.message });
    }
  }

  return Response.json({ results });
});