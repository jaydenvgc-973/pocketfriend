/**
 * governmentEventMemory.js
 *
 * A City Hall visit or a court proceeding is an ordinary Scenes experience, so what
 * happened in it is remembered through the SAME memory store every other Scene writes
 * to: a Memory record (surfaced by retrieveActiveMemory in Chat/Text) and a
 * CharacterMemory record (the durable layer the LLM pipeline reads), exactly as
 * sceneExitMemory.js already does for a scene's end.
 *
 * This is not a second memory system:
 *   • no new entity, no new retrieval path
 *   • nothing is rewritten, backfilled, or invented
 *   • each person gets their OWN record of the event, written from the part they
 *     actually played — a judge remembers presiding, a juror remembers the verdict
 *     they reached, a witness remembers testifying, someone appearing remotely
 *     remembers taking part remotely
 *
 * Only people who were actually there are ever written. A character who did not
 * attend receives nothing, so no one gains firsthand knowledge of a proceeding
 * they were not part of.
 */
import { base44 } from "@/api/base44Client";

// A temporary person of the court, a background person of the venue or the user
// themselves has no character record to remember with.
const isRecordablePerson = (p) =>
  !!(p && p.id && p.name && p.isNpc !== true && !String(p.id).startsWith("npc_"));

/**
 * Write this event into the memory of everyone who took part in it.
 *
 * @param {Object}   params
 * @param {string}   params.key          - stable id of this event (dedupes the same event)
 * @param {string}   params.title        - what the event was, e.g. "Criminal Case at CGV Courthouse"
 * @param {string}   params.summary      - what happened, stated exactly as it is on record
 * @param {Object[]} params.participants - [{ id, name, experience }] — experience is that
 *                                         person's own part in it, never another's knowledge
 * @param {Object}   params.location     - { id, name } the venue
 * @param {string}   params.ownerEmail   - owner of the account
 */
export async function recordGovernmentEventMemories({ key, title, summary, participants, location, ownerEmail }) {
  const people = [];
  const seen = new Set();
  for (const person of participants || []) {
    if (!isRecordablePerson(person) || seen.has(person.id)) continue;
    seen.add(person.id);
    people.push(person);
  }
  if (!key || !title || !summary || people.length === 0) return;

  const sourceContext = `government_event_${key}`;
  const timestamp = new Date().toISOString();

  await Promise.all(people.map(async (person) => {
    const experience = String(person.experience || "").trim();
    const description = [summary, experience].filter(Boolean).join(" ");

    try {
      // The same event is written once per person. Reopening a proceeding or a
      // ceremony never stacks duplicates of the same record.
      const existing = await base44.entities.Memory.filter(
        { character_id: person.id, source_context: sourceContext },
        "-created_date",
        20
      );
      const alreadyWritten = Array.isArray(existing) && existing.some((m) => m.title === title);
      if (alreadyWritten) return;

      await base44.entities.Memory.create({
        character_id: person.id,
        title,
        description,
        emotional_impact: "significant event",
        timestamp,
        source_context: sourceContext,
        owner_email: ownerEmail || undefined,
      });

      // The durable layer the existing LLM pipeline reads (Scene, Chat, Text).
      await base44.entities.CharacterMemory.create({
        character_id: person.id,
        memory_type: "event",
        memory_text: description,
        memory_summary: `${title}${experience ? ` — ${experience}` : ""}`.slice(0, 240),
        related_location_id: location?.id || null,
        importance_score: 8,
        confidence_score: 1.0,
        permanence: "long_term",
        validation_status: "confirmed",
      });
    } catch (err) {
      console.error(
        `[governmentEventMemory] ✗ Memory FAILED for ${person.name} (${person.id}):`,
        err?.message || err
      );
    }
  }));
}

/** Today's date in Eastern Time — the app's authoritative timezone. */
export function easternDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}