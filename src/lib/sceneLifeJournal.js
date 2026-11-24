/**
 * sceneLifeJournal.js
 *
 * Writes the character's Life Journal entry for a scene.
 *
 * A scene is something the people in it actually lived through, so when it ends it
 * belongs in their journal exactly like a conversation does — one entry per person who
 * was really there, describing where they were, who they were with and what was said.
 *
 * Uses the existing LifeEvent entity, which is what the Life Journal reads. No new
 * entity, no new field: the same records Chat already produces.
 */

import { base44 } from "@/api/base44Client";

const MAX_HIGHLIGHTS = 700;

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
 * @param {Object[]} params.messages        - the scene's transcript
 * @param {string}   params.userDisplayName - the user's world name
 * @param {string}   params.ownerEmail      - current user's email
 * @param {string}   params.outcome         - "left_together" | "stayed_behind" | null
 */
export async function writeSceneLifeEvents({
  participants = [],
  location,
  messages = [],
  userDisplayName,
  ownerEmail,
  outcome = null,
}) {
  const cast = realParticipants(participants);
  if (!location?.name || cast.length === 0) return 0;

  const who = userDisplayName || "the user";

  const spoken = (messages || []).filter(
    (m) => (m.sender === "user" || m.sender === "character") && String(m.content || "").trim()
  );

  const highlights = spoken
    .slice(-12)
    .map((m) => `${m.sender === "user" ? who : (m.senderName || "Someone")}: ${m.content}`)
    .join("\n")
    .slice(0, MAX_HIGHLIGHTS);

  const now = new Date().toISOString();

  const writes = cast.map((char) => {
    const others = cast.filter((c) => c.id !== char.id).map((c) => c.name).join(", ");

    const outcomeText =
      outcome === "left_together"
        ? `They left ${location.name} with ${who}.`
        : outcome === "stayed_behind"
          ? `${who} left; ${char.name} stayed at ${location.name}.`
          : null;

    const description = [
      `${char.name} spent time at ${location.name}${others ? ` with ${others}` : ""}.`,
      outcomeText,
      highlights ? `\nWhat was said:\n${highlights}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return base44.entities.LifeEvent.create({
      character_id: char.id,
      character_name: char.name,
      event_type: spoken.length > 0 ? "emotional_exchange" : "routine_positive_event",
      valence: "neutral",
      severity: "minor",
      title: `At ${location.name}${others ? ` with ${others}` : ""}`.slice(0, 120),
      description,
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
  return cast.length;
}