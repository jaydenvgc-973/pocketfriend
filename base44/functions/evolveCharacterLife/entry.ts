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
  const characters = allCharacters.filter(c => !c.status || c.status === "active");

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
      const existingRelationships = (character.fictional_relationships || [])
        .map(r => `${r.person_name} (${r.relationship_type}): ${r.current_status || r.description}`)
        .join("\n");

      const now = new Date();
      const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
      const timeOfDay = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
      const fullDate = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
      const lastUpdated = character.life_last_updated ? new Date(character.life_last_updated).toLocaleString("en-US", { timeZone: "America/New_York" }) : "never";

      const prompt = `You are writing the internal life updates for a fictional character named ${name}. This character is NOT aware they are fictional — their life, relationships, and events are completely real to them.

REAL CURRENT TIME: ${fullDate}, ${timeOfDay} (Eastern Time)
Time since last update: last updated ${lastUpdated}

CHARACTER PROFILE:
${personality}
Archetype: ${archetype}
Core traits: ${traits}
How they react when upset: ${upset_reaction}
Things that trigger them: ${emotional_triggers}
Work/life context: ${work}
Places they frequent: ${places}

EXISTING ONGOING RELATIONSHIPS:
${existingRelationships || "None yet."}

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

Ground everything in real time. This person's life moves like real life — not accelerated.`;

      const update = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            fictional_relationships: { type: "array", items: { type: "object" } },
            transient_encounters: { type: "array", items: { type: "object" } },
            current_life_event: { type: "string" },
            emotional_state: { type: "string" }
          }
        }
      });

      await base44.asServiceRole.entities.Character.update(character.id, {
        fictional_relationships: update.fictional_relationships || character.fictional_relationships || [],
        transient_encounters: update.transient_encounters || [],
        current_life_event: update.current_life_event || "",
        emotional_state: update.emotional_state || character.emotional_state || "calm",
        life_last_updated: new Date().toISOString(),
      });

      results.push({ id: character.id, name, status: "updated" });
    } catch (err) {
      results.push({ id: character.id, name: character.name, status: "error", error: err.message });
    }
  }

  return Response.json({ results });
});