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

  const characters = await base44.asServiceRole.entities.Character.list();

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

      const prompt = `You are writing the internal life updates for a fictional character named ${name}. This character is NOT aware they are fictional — their life, relationships, and events are completely real to them.

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
Generate updates for this character's ongoing life. Return a JSON object with:

1. "fictional_relationships": An updated array of 3-5 ongoing people in their life. For each:
   - person_name (string)
   - relationship_type (e.g. "best friend", "coworker", "ex", "sibling", "romantic interest", "neighbor")
   - description (who this person is, their dynamic)
   - current_status (what's going on between them RIGHT NOW — an ongoing situation, tension, good news, unresolved thing)
   - emotional_impact (how this relationship makes the character feel)
   - last_interaction_summary (what happened most recently — a specific moment or exchange)
   - history_summary (how this relationship developed over time)

   RULES for relationships:
   - Must match the character's personality — a "Rebel" has different relationship dynamics than a "Caretaker"
   - Some should be warm/positive, some should be tense or complicated, some neutral
   - Use specific details — names, moments, specific words said
   - If existing relationships exist above, keep them but evolve their current_status based on what would naturally happen
   - Add new ones if there are fewer than 3

2. "transient_encounters": An array of 1-3 recent one-off interactions that happened in the last few days. These are people they crossed paths with but may never see again. For each:
   - description (who the person was, what happened)
   - context (where it happened — at work, at their frequented places, etc.)
   - emotional_reaction (how it made the character feel, matching their personality)
   - date (ISO date string, within the last 3 days)

3. "current_life_event": A single sentence describing something currently active in the character's life — could be positive, negative, or neutral. Something they might bring up naturally in conversation. Must feel real and specific.

4. "emotional_state": One of: calm, irritated, defensive, reflective, closed-off — based on everything going on in their life right now.

Make everything feel authentic to this specific person. Real, specific, human.`;

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