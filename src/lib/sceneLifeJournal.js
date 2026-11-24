/**
 * sceneLifeJournal.js
 *
 * Writes the character's Life Journal entry for a completed scene.
 *
 * A scene is something the people in it actually lived through, so when it ends it
 * belongs in their journal exactly like a conversation does — one entry per person who
 * was really there. The entry is what that person REMEMBERS: what happened, who they
 * were with, and what stayed with them. It is never a transcript of the scene, never a
 * list of completed activities and never a chapter.
 *
 * Uses the existing LifeEvent entity, which is what the Life Journal reads, and the
 * existing InvokeLLM narrative capability already used for scene narratives. No new
 * entity, no new field, no new generator: the same records Chat already produces.
 */

import { base44 } from "@/api/base44Client";
import { queryClientInstance } from "@/lib/query-client";

const MAX_ACTION_LINES = 12;
const MAX_DIALOGUE_LINES = 16;
const MAX_ENTRY_LENGTH = 900;

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
 * Separates what the scene actually left behind. Completed actions are events and must
 * reach the journal; dialogue is only context for what the moment meant.
 */
function sceneMaterial(messages = [], userDisplayName) {
  const spoken = [];
  const happened = [];

  (messages || []).forEach((m) => {
    const text = String(m?.content || "").trim();
    if (!text) return;
    if (m.sender === "user" || m.sender === "character") {
      spoken.push(`${m.sender === "user" ? (userDisplayName || "the user") : (m.senderName || "Someone")}: ${text}`);
    } else if (m.sender === "narrative") {
      // Narrative lines are things that already happened: an action performed, a moment
      // the scene itself established. Stage directions and product cards are not events.
      happened.push(text);
    }
  });

  return {
    actions: happened.slice(-MAX_ACTION_LINES),
    dialogue: spoken.slice(-MAX_DIALOGUE_LINES),
    spoke: spoken.length > 0,
  };
}

function buildJournalPrompt({ cast, location, actions, dialogue, userPresent }) {
  const roster = cast
    .map((c) => {
      const note = [c.archetype, c.personality_summary].filter(Boolean).join(" — ").slice(0, 200);
      return `- ${c.name} (id: ${c.id})${note ? `: ${note}` : ""}`;
    })
    .join("\n");

  const actionBlock = actions.length > 0
    ? actions.join("\n")
    : "Nothing notable was done — they were simply in the same place at the same time.";

  const dialogueBlock = dialogue.length > 0
    ? dialogue.join("\n")
    : "They did not really talk.";

  return `You are writing the Life Journal entry for a scene that has just ended in Pocketfriend. The Life Journal is a character's own private record of their life, and it is read back to them later as their memory of that day.

PEOPLE WHO WERE ACTUALLY THERE
${roster}

WHERE IT HAPPENED
${location.name}

WHAT ACTUALLY HAPPENED (completed events, in order — real, and never to be left out)
${actionBlock}

WHAT WAS SAID (context for what the moment meant only — this is NOT to be written down)
${dialogueBlock}

Write one entry for EACH person listed above, from that person's own point of view, in first person ("I"), past tense, in their own voice. Each entry answers: what happened, how I experienced it, and what I took away from it.

HOW IT MUST READ
- One short paragraph: two to four sentences. Never longer.
- Like a remembered moment, not a report.
- Include the physical things that actually happened — a kiss, a hug, holding hands, dancing, eating, playing. They are real events and are often the whole memory. Never omit one, and never add one that is not listed.
- Do NOT quote or list the conversation, and never write one line of dialogue followed by another as if transcribing it. At most one short spoken phrase, and only if those words are what mattered.
- Do not invent feelings, romance, promises, arguments, reconciliation or relationship changes the material does not support. If nothing romantic happened, do not imply it. If they only talked, that is what happened.
- No lesson, no dramatic conclusion, no analysis of anyone's psychology. "The time together was what stayed with me" is a complete takeaway.
- Only what this person actually experienced. Never state another person's inner feelings as fact.
- Every entry must agree about what happened, while each may notice different things.
${userPresent ? "" : "- The account holder was NOT there. Never mention them, and never describe anything as something they asked for or directed.\n"}
Return JSON only: for each person, their id, a short title of at most eight words that reads like a remembered moment, and the entry itself.`;
}

function fallbackEntry({ char, location, others }) {
  const who = others.length > 0 ? ` with ${others.join(", ")}` : "";
  return {
    title: `At ${location.name}${who}`.slice(0, 120),
    narrative: `I was at ${location.name}${who}.`,
  };
}

/**
 * @param {Object}   params
 * @param {Object[]} params.participants    - everyone who took part in the scene
 * @param {Object}   params.location        - { id, name, category }
 * @param {Object[]} params.messages        - the scene's transcript and completed events
 * @param {string}   params.userDisplayName - the user's world name
 * @param {string}   params.ownerEmail      - current user's email
 * @param {string}   params.outcome         - "left_together" | "stayed_behind" | null
 * @param {boolean}  params.userPresent     - false in Watch / Send Them Without Me
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

  const { actions, dialogue, spoke } = sceneMaterial(messages, userDisplayName);

  // One pass for the whole cast: each person's own entry, all agreeing on what happened.
  let entries = [];
  if (actions.length > 0 || dialogue.length > 0) {
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: buildJournalPrompt({ cast, location, actions, dialogue, userPresent }),
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
      console.error("[sceneLifeJournal] ✗ Scene narrative could not be written:", err?.message || err);
    }
  }

  const now = new Date().toISOString();

  const writes = cast.map((char) => {
    const others = cast.filter((c) => c.id !== char.id).map((c) => c.name);

    const generated = entries.find((e) =>
      e?.character_id === char.id
      || String(e?.character_name || "").trim().toLowerCase() === String(char.name || "").trim().toLowerCase()
    );

    const narrative = String(generated?.narrative || "").trim().slice(0, MAX_ENTRY_LENGTH);
    const fallback = fallbackEntry({ char, location, others });

    const title = String(generated?.title || "").trim().slice(0, 120) || fallback.title;
    const description = narrative || fallback.narrative;

    return base44.entities.LifeEvent.create({
      character_id: char.id,
      character_name: char.name,
      event_type: spoke || actions.length > 0 ? "emotional_exchange" : "routine_positive_event",
      valence: "neutral",
      severity: "minor",
      title,
      description,
      triggered_by: "character_decision",
      evidence_source: "conversation_derived",
      context_tags: ["scene", location.name, ...others],
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