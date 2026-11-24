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
 * Participation is per person. `presenceWindows` (character_id → { from, to }, message
 * positions recorded by pages/Scene as Who's Here changes) means someone who arrived
 * partway through is never given a firsthand memory of what happened before they got
 * there, and someone who left does not remember what came after.
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
 * @param {Object[]} params.participants     - everyone who took part in the scene
 * @param {Object}   params.location         - { id, name, category }
 * @param {Object[]} params.messages         - the scene's transcript and completed events
 * @param {Object}   params.presenceWindows  - character_id → { from, to } message positions
 * @param {string}   params.userDisplayName  - the user's world name
 * @param {string}   params.ownerEmail       - current user's email
 * @param {string}   params.outcome          - "left_together" | "stayed_behind" | null
 * @param {boolean}  params.userPresent      - false while watching / sent without the user
 */
export async function writeSceneLifeEvents({
  participants = [],
  location,
  messages = [],
  presenceWindows = null,
  userDisplayName,
  ownerEmail,
  outcome = null,
  userPresent = true,
}) {
  const cast = realParticipants(participants);
  if (!location?.name || cast.length === 0) return 0;

  // Established events (narrative lines) are the canon of the scene and are kept in full:
  // a moment that mattered early must still be available after much more happened. Talk
  // is context for meaning only — it is never written into the memory.
  const timeline = [];
  (messages || []).forEach((m, index) => {
    const text = String(m?.content || "").trim();
    if (!text) return;
    // A strip activity is a scene event, not something anyone said — it belongs in the
    // journal the same way an established narrative moment does.
    if (m.sender === "narrative" || m.sender === "activity") timeline.push({ index, kind: "event", text });
    else if (m.sender === "user" || m.sender === "character") {
      timeline.push({
        index,
        kind: "talk",
        text: `${m.sender === "user" ? (userDisplayName || "the user") : (m.senderName || "Someone")}: ${text}`,
      });
    }
  });
  if (timeline.length === 0) return 0;

  // Each person's own part of the scene, from when they were present to when they left.
  const parts = cast.map((char) => {
    const window = presenceWindows?.[char.id];
    const from = Number.isInteger(window?.from) ? window.from : 0;
    const to = Number.isInteger(window?.to) ? window.to : (messages || []).length;
    const mine = timeline.filter((t) => t.index >= from && t.index < to);
    return { char, mine, sig: mine.map((t) => t.index).join(",") };
  });
  // Only people with something of their own to remember are written for. An empty window
  // is not a memory, and nothing is invented to fill it.
  const writing = parts.filter((p) => p.mine.length > 0);
  if (writing.length === 0) return 0;

  const shared = writing.every((p) => p.sig === writing[0].sig);
  const blockFor = (lines) => {
    const events = lines.filter((t) => t.kind === "event").map((t) => t.text);
    const talk = lines.filter((t) => t.kind === "talk").slice(-20).map((t) => t.text);
    return {
      events: events.length > 0 ? events.join("\n") : "Nothing in particular happened — they were in the same place at the same time.",
      talk: talk.length > 0 ? talk.join("\n") : "They barely talked.",
    };
  };

  const sharedBlock = shared ? blockFor(writing[0].mine) : null;
  const sceneBlocks = shared
    ? `WHAT HAPPENED (established events, in order — these already happened)
${sharedBlock.events}

WHAT WAS SAID (context for meaning only — never written down)
${sharedBlock.talk}`
    : `Each person's own part of the scene is listed below. Whatever is not in a person's part, that person did not see or hear.

${writing.map((p) => {
  const b = blockFor(p.mine);
  return `WHAT ${String(p.char.name || "").toUpperCase()} WAS THERE FOR
${b.events}

WHAT ${String(p.char.name || "").toUpperCase()} HEARD
${b.talk}`;
}).join("\n\n")}`;

  const prompt = `A scene has just ended in Pocketfriend. These people lived it, and each keeps a memory of it — the same kind of memory Pocketfriend already writes when a Story Event ends: a short, personal account of what stood out, never a record of everything that happened.

PEOPLE TO WRITE FOR
${writing.map((p) => `- ${p.char.name} (id: ${p.char.id})`).join("\n")}

WHERE
${location.name}

${sceneBlocks}

Write ONE memory for EACH person above.
- A few sentences, one short paragraph, third person past tense, using that person's own name.
- SELECTIVE. Keep what mattered to that person, not everything that happened. If the defining moment was a kiss, that is the memory; the talk around it is not worth listing. Never list activities or statements.
- The moment that mattered stays even when much more happened afterwards. Importance is never decided by what came last, or by how much was said.
- When a specific act is what the person remembers, name it plainly. A kiss is a kiss, a hug is a hug, an argument is an argument. Never blur it into vague wording such as "a moment of connection".
- Do not read more into it than happened: a kiss does not create love, commitment, reconciliation, or a change in relationship.
- Never quote or replay the conversation. At most a few words, and only if those words are what stayed.
- Do not invent feelings, promises, arguments or relationship changes that did not happen. If they simply enjoyed each other's company, that is a complete memory.
- No life lesson, no dramatic realization, no psychological analysis.
- Only what this person actually experienced. Never state another person's private feelings as fact.
- People may remember the same moment differently, but nobody contradicts what happened.
${userPresent ? "" : "- The account holder was not there. They take no part in this memory and are not mentioned in it.\n"}
Return JSON only, nothing before or after it, exactly this shape:
{"entries":[{"character_id":"the person's id","title":"at most eight words","narrative":"the memory"}]}`;

  let entries = [];
  try {
    const res = await base44.integrations.Core.InvokeLLM({ prompt });
    // The reply is JSON text; read it tolerantly so a stray wrapper never loses the memory.
    const raw = typeof res === "string" ? res : JSON.stringify(res ?? {});
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    let parsed = null;
    if (start !== -1 && end > start) {
      try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { parsed = null; }
    }
    const list = Array.isArray(parsed?.entries) ? parsed.entries
      : Array.isArray(parsed?.memories) ? parsed.memories
        : Array.isArray(parsed) ? parsed : [];
    entries = list.map((item) => {
      if (typeof item === "string") {
        const [id, title, ...rest] = item.split("|").map((s) => s.trim());
        return { character_id: id, title, narrative: rest.join(" | ") };
      }
      return {
        character_id: item?.character_id || item?.id,
        character_name: item?.character_name || item?.name,
        title: item?.title,
        narrative: item?.narrative || item?.memory || item?.text,
      };
    });
  } catch (err) {
    // A failed generation is a failure, not a memory. Nothing is written for it.
    console.error("[sceneLifeJournal] ✗ Scene memory could not be written:", err?.message || err);
  }

  const now = new Date().toISOString();
  const hasTalk = timeline.some((t) => t.kind === "talk");

  const writes = writing.map(({ char }) => {
    const others = cast.filter((c) => c.id !== char.id).map((c) => c.name);
    const remembered = entries.find((e) =>
      e?.character_id === char.id
      || String(e?.character_name || "").trim().toLowerCase() === String(char.name || "").trim().toLowerCase()
    );
    const narrative = String(remembered?.narrative || "").trim();
    // No generated memory means no entry. A generic "was at X with Y" line would claim an
    // experience nobody established, so it is never written in its place.
    if (!narrative) {
      console.warn(`[sceneLifeJournal] No memory generated for ${char.name} — no entry written.`);
      return Promise.resolve(null);
    }

    return base44.entities.LifeEvent.create({
      character_id: char.id,
      character_name: char.name,
      event_type: hasTalk ? "emotional_exchange" : "routine_positive_event",
      valence: "neutral",
      severity: "minor",
      title: (String(remembered?.title || "").trim() || `At ${location.name}${others.length ? ` with ${others.join(", ")}` : ""}`).slice(0, 120),
      description: narrative.slice(0, 800),
      triggered_by: "character_decision",
      evidence_source: "conversation_derived",
      context_tags: ["scene", location.name, ...others],
      systems_updated: ["memory"],
      timestamp: now,
    }).then((created) => {
      queryClientInstance.invalidateQueries({ queryKey: ["lifeEvents", char.id] });
      return created;
    }).catch((err) => {
      console.error(`[sceneLifeJournal] ✗ LifeEvent FAILED for ${char.name} (${char.id}):`, err?.message || err);
      return null;
    });
  });

  const saved = await Promise.all(writes);
  return saved.filter(Boolean).length;
}