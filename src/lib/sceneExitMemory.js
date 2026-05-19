/**
 * sceneExitMemory.js
 *
 * Writes Memory records when a Scene session ends.
 * Source of truth for Scene → Chat continuity.
 *
 * Covers ALL participant cases:
 *   1. Characters who traveled to the location with the user (broughtCharacters)
 *   2. Characters already at the location when the user arrived (selectedNpcs / homeResidentsPresent)
 *   3. Characters who actually spoke during the scene (derived from messages with characterId)
 *
 * Called from both exit paths in pages/Scene:
 *   - handleLeaveWithCharacters  (outcome: "left_together")
 *   - handleLeaveCharactersBehind (outcome: "stayed_behind")
 *
 * Rules:
 * - Uses existing Memory entity — no new entity created.
 * - owner_email only (never created_by).
 * - source_context = 'scene_exit' so retrieveActiveMemory surfaces it in Chat.
 * - Skips pseudo-NPC objects (isNpc flag or missing stable id).
 * - Logs failures visibly — never silently swallows errors.
 */

import { base44 } from "@/api/base44Client";

/**
 * Derive the full set of real characters who participated in the scene.
 *
 * Priority union (deduped by id):
 *   1. broughtCharacters    — traveled with user
 *   2. alreadyPresentChars  — were at location when user arrived (selectedNpcs, homeResidentsPresent, etc.)
 *   3. dialogueSpeakers     — derived from messages where sender === "character" and characterId exists
 *
 * @param {Object[]} broughtCharacters      - characters the user traveled with
 * @param {Object[]} alreadyPresentChars    - characters already at the location (selectedNpcs, etc.)
 * @param {Object[]} messages               - scene messages array
 * @param {Object[]} allSceneChars          - full character roster for the scene (used to hydrate characterId → object)
 * @returns {Object[]} deduplicated array of real character objects
 */
export function resolveSceneParticipants(broughtCharacters, alreadyPresentChars, messages, allSceneChars) {
  const seen = new Set();
  const participants = [];

  const addChar = (char) => {
    if (!char?.id || char.isNpc) return; // skip pseudo-NPCs
    if (seen.has(char.id)) return;
    seen.add(char.id);
    participants.push(char);
  };

  // 1. Traveled with user
  (broughtCharacters || []).forEach(addChar);

  // 2. Already present (selectedNpcs, homeResidentsPresent passed through)
  (alreadyPresentChars || []).forEach(addChar);

  // 3. Characters who actually spoke — hydrate from characterId on message
  (messages || [])
    .filter(m => m.sender === "character" && m.characterId)
    .forEach(m => {
      const char = (allSceneChars || []).find(c => c.id === m.characterId);
      if (char) addChar(char);
    });

  return participants;
}

/**
 * Write a scene-exit Memory record for every scene participant.
 *
 * @param {Object}   params
 * @param {Object[]} params.broughtCharacters      - characters who traveled with user
 * @param {Object[]} params.alreadyPresentChars    - characters already at location on arrival
 * @param {Object[]} params.allSceneChars           - full scene character roster (for hydrating message speakers)
 * @param {Object}   params.location               - { id, name, category }
 * @param {Object[]} params.messages               - scene messages array
 * @param {string}   params.userDisplayName        - display name of the user
 * @param {string}   params.ownerEmail             - currentUser.email (required for RLS)
 * @param {string}   params.outcome                - "left_together" | "stayed_behind"
 */
export async function writeSceneExitMemories({
  broughtCharacters = [],
  alreadyPresentChars = [],
  allSceneChars = [],
  location,
  messages = [],
  userDisplayName,
  ownerEmail,
  outcome,
}) {
  if (!location || !ownerEmail) {
    console.warn('[sceneExitMemory] Skipped — missing location or ownerEmail');
    return;
  }

  const participants = resolveSceneParticipants(broughtCharacters, alreadyPresentChars, messages, allSceneChars);

  if (participants.length === 0) {
    console.log('[sceneExitMemory] No real participants found — nothing to write');
    return;
  }

  const now = new Date().toISOString();

  // Scene highlights: last 20 dialogue turns, max 600 chars
  const sceneHighlights = messages
    .filter(m => m.sender === "user" || m.sender === "character")
    .slice(-20)
    .map(m => `${m.sender === "user" ? (userDisplayName || "User") : (m.senderName || "Character")}: ${m.content}`)
    .join("\n")
    .slice(0, 600);

  const outcomeText =
    outcome === "left_together"
      ? `They left ${location.name} together and returned home.`
      : `${userDisplayName || "the user"} left — they stayed at ${location.name}.`;

  const allParticipantNames = participants.map(c => c.name).join(", ");

  const writes = participants.map(async (char) => {
    const othersLabel = participants
      .filter(c => c.id !== char.id)
      .map(c => c.name)
      .join(", ");

    const howPresent = broughtCharacters.some(b => b.id === char.id)
      ? `traveled to ${location.name} with ${userDisplayName || "the user"}`
      : `was already at ${location.name} when ${userDisplayName || "the user"} arrived`;

    const description = [
      `${char.name} ${howPresent}${othersLabel ? `. Others present: ${othersLabel}` : ""}.`,
      outcomeText,
      sceneHighlights ? `\nScene highlights:\n${sceneHighlights}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    try {
      // Write to Memory entity (existing — used by memory audit/review)
      await base44.entities.Memory.create({
        character_id: char.id,
        title: `Scene at ${location.name} with ${userDisplayName || "the user"}`,
        description,
        emotional_impact: "shared experience",
        timestamp: now,
        source_context: "scene_exit",
        owner_email: ownerEmail,
      });
      console.log(`[sceneExitMemory] ✓ Memory written for ${char.name} (${char.id})`);
    } catch (err) {
      console.error(`[sceneExitMemory] ✗ Memory FAILED for ${char.name} (${char.id}):`, err?.message || err);
    }

    // BILATERAL MEMORY: Also write CharacterMemory record so retrieveActiveMemory
    // surfaces this scene event in Chat/Text dialogue context.
    // CharacterMemory is the durable layer read by the LLM pipeline.
    try {
      const memoryText = [
        `${userDisplayName || "the user"} and ${char.name} were at ${location.name} (${location.category || "venue"}) together.`,
        othersLabel ? `Others present: ${othersLabel}.` : "",
        outcomeText,
        sceneHighlights ? `Key moments: ${sceneHighlights.substring(0, 300)}` : "",
      ].filter(Boolean).join(" ");

      await base44.entities.CharacterMemory.create({
        character_id: char.id,
        memory_type: "event",
        memory_text: memoryText,
        memory_summary: `Scene at ${location.name} with ${userDisplayName || "the user"}${othersLabel ? ` and ${othersLabel}` : ""}`,
        related_location_id: location.id || null,
        importance_score: 7,
        confidence_score: 1.0,
        permanence: "long_term",
        validation_status: "confirmed",
      });
      console.log(`[sceneExitMemory] ✓ CharacterMemory written for ${char.name} (${char.id})`);
    } catch (err) {
      console.error(`[sceneExitMemory] ✗ CharacterMemory FAILED for ${char.name} (${char.id}):`, err?.message || err);
    }
  });

  await Promise.all(writes);
  console.log(`[sceneExitMemory] Done. Wrote memories for ${participants.length} participant(s): ${allParticipantNames}`);
}