/**
 * sceneLifeJournal.js
 *
 * Writes the character's Life Journal entry for a completed scene.
 *
 * A scene is something the people in it actually lived through, so when it ends it
 * belongs in their journal exactly like a conversation does — one entry per person who
 * was really there. The entry follows the same standard Pocketfriend already uses when
 * a Story Event ends: a short, personal account of what stood out to that person, never
 * a transcript and never a record of everything that happened.
 *
 * Uses the existing LifeEvent entity, which is what the Life Journal reads, and the
 * existing InvokeLLM narrative capability. No new entity, no new field, no new pipeline.
 *
 * Called once per scene from pages/Scene (sceneJournalDoneRef), on either exit path.
 */

import { base44 } from "@/api/base44Client";
import { queryClientInstance } from "@/lib/query-client";

function realParticipants(participants = []) {
  const seen = new Set();
  return (participants || []).filter((char) => {
    // A background NPC has no record of its own, so there is nothing to journal for it.
    if (!char?.id || char.isNpc) return false;
    if (seen.has(char.id)) return false;
    seen.add(char.id);
    return true;
  });
}

/**
 * @param {Object}   params
 * @param {Object[]} params.participants    - everyone who took part in the scene
 * @param {Object}   params.location        - { id, name, category }
 * @param {Object[]} params.messages        - the scene's transcript and completed events
 * @param {string}   params.userDisplayName - the user's world name
 * @param {string}   params.ownerEmail      - current user's email
 * @param {string}   params.outcome         - "left_together" | "stayed_behind" | null
 * @param {boolean}  params.userPresent     - false while watching / sent without the user
 */
export async function writeSceneLifeEvents({
  participants = [],
  location,
  messages = [],
  userDisplayName,
  ownerEmail,
  outcome = null,
  userPresent = true,
}) {
  const cast = realParticipants(participants);
  if (!location?.name || cast.length === 0) return 0;

  // Everything the scene already leaves behind. Completed events (narrative lines) are
  // kept in full: a moment that mattered early in the scene must still be there at the
  // end. Talk is context only, and is read the way sceneExitMemory already reads it.
  const happened = [];
  const spoken = [];
  (messages || []).forEach((m) => {
    const text = String(m?.content || "").trim();
    if (!text) return;
    if (m.sender === "narrative") happened.push(text);
    else if (m.sender === "user" || m.sender === "character") {
      spoken.push(`${m.sender === "user" ? (userDisplayName || "the user") : (m.senderName || "Someone")}: ${text}`);
    }
  });

  const roster = cast.map((c) => `- ${c.name} (id: ${c.id})`).join("\n");
  const happenedBlock = happened.length > 0
    ? happened.join("\n")
    : "Nothing in particular happened — they were in the same place at the same time.";
  const spokenBlock = spoken.length > 0
    ? spoken.slice(-20).join("\n")
    : "They barely talked.";

  const prompt = `A scene has just ended in Pocketfriend. These people lived it, and each keeps a memory of it — the same kind of memory Pocketfriend already writes when a Story Event ends: a short, personal account of what stood out, not a record of everything that happened.

PEOPLE WHO WERE THERE
${roster}

WHERE
${location.name}

WHAT HAPPENED (the scene's completed events, in order)
${happenedBlock}

WHAT WAS SAID (context for meaning only — never to be written down)
${spokenBlock}

For EACH person listed, write what that person remembers of it.
- A few sentences, one short paragraph, in the voice the journal already reads in: third person, past tense, using that person's own name.
- SELECTIVE. A memory keeps what mattered to that person, not everything that happened. If the defining moment was a kiss, that is the memory; the talk around it is not worth listing. Never enumerate activities or statements.
- The moment that mattered must be there even if it happened early and much more followed — that is what they carry away.
- Never quote or replay the conversation. At most a few words of what was said, and only if those words are what stayed.
- Do not invent feelings, romance, promises, arguments or relationship changes that did not happen. If they simply enjoyed spending time together, that is a complete memory.
- No life lesson, no dramatic realization, no analysis of anyone's psychology.
- Each person may remember it differently, but no one contradicts what happened.
- Only what this person actually experienced. Never state another person's private feelings as fact.
${userPresent ? "" : "- The account holder was not there. They take no part in this memory and are not mentioned in it.\n"}
Return JSON only: for each person, their id, a short title of at most eight words, and the memory itself.`;

  let entries = [];
  if (happened.length > 0 || spoken.length > 0) {
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  character_id: { type: "string" },
                  character_name: { type: "string" },
                  title: { type: "string" },
                  narrative: { type: "string" },
                },
                required: ["character_id", "narrative"],
              },
            },
          },
          required: ["entries"],
        },
      });
      entries = Array.isArray(res?.entries) ? res.entries : [];
    } catch (err) {
      console.error("[sceneLifeJournal] ✗ Scene memory could not be written:", err?.message || err);
    }
  }

  const now = new Date().toISOString();

  const writes = cast.map((char) => {
    const others = cast.filter((c) => c.id !== char.id).map((c) => c.name).join(", ");
    const remembered = entries.find((e) =>
      e?.character_id === char.id
      || String(e?.character_name || "").trim().toLowerCase() === String(char.name || "").trim().toLowerCase()
    );

    return base44.entities.LifeEvent.create({
      character_id: char.id,
      character_name: char.name,
      event_type: spoken.length > 0 || happened.length > 0 ? "emotional_exchange" : "routine_positive_event",
      valence: "neutral",
      severity: "minor",
      title: (String(remembered?.title || "").trim() || `At ${location.name}${others ? ` with ${others}` : ""}`).slice(0, 120),
      description: String(remembered?.narrative || "").trim().slice(0, 800)
        || `${char.name} spent time at ${location.name}${others ? ` with ${others}` : ""}.`,
      triggered_by: "character_decision",
      evidence_source: "conversation_derived",
      context_tags: ["scene", location.name, ...cast.filter((c) => c.id !== char.id).map((c) => c.name)],
      systems_updated: ["memory"],
      timestamp: now,
    }).catch((err) => {
      console.error(`[sceneLifeJournal] ✗ LifeEvent FAILED for ${char.name} (${char.id}):`, err?.message || err);
      return null;
    });
  });

  await Promise.all(writes);

  // The journal view keeps its own cached list (5 min by app default) and does not
  // refetch on mount, so a freshly written entry would stay invisible until that cache
  // expired. The entry exists now: mark each participant's journal stale so the next
  // look at their profile shows it immediately.
  cast.forEach((char) => {
    queryClientInstance.invalidateQueries({ queryKey: ["lifeEvents", char.id] });
  });

  return cast.length;
}