/**
 * sceneExitMemory.js
 *
 * Writes a Memory record for each brought character when a Scene session ends.
 * This is the source of truth for Scene → Chat continuity.
 *
 * Called from both exit paths:
 *   - "Leave together" (handleLeaveWithCharacters)
 *   - "Leave them here" (handleLeaveCharactersBehind)
 *
 * Rules:
 * - Uses existing Memory entity — no new entity created.
 * - Keyed by character_id (owner_email written for RLS compliance).
 * - source_context = 'scene_exit' so Chat and retrieveActiveMemory can surface it.
 * - Only writes for real characters (not NPC pseudo-objects).
 */

import { base44 } from "@/api/base44Client";

/**
 * Write a scene-exit memory for each brought character.
 *
 * @param {Object[]} broughtCharacters - characters who were in the scene
 * @param {Object}   location          - the location object { id, name, category }
 * @param {Object[]} messages          - scene messages array (user + character messages)
 * @param {string}   userDisplayName   - display name of the user
 * @param {string}   ownerEmail        - currentUser.email
 * @param {string}   outcome           - "left_together" | "stayed_behind"
 */
export async function writeSceneExitMemories({
  broughtCharacters,
  location,
  messages,
  userDisplayName,
  ownerEmail,
  outcome,
}) {
  if (!broughtCharacters?.length || !location || !ownerEmail) return;

  const now = new Date().toISOString();

  // Build a scene highlights excerpt from the actual dialogue (max 600 chars)
  const sceneHighlights = messages
    .filter(m => m.sender === "user" || m.sender === "character")
    .slice(-20)
    .map(m => `${m.sender === "user" ? (userDisplayName || "User") : m.senderName}: ${m.content}`)
    .join("\n")
    .slice(0, 600);

  const outcomeText =
    outcome === "left_together"
      ? `They left ${location.name} together and returned home.`
      : `${userDisplayName || "the user"} left — they stayed at ${location.name}.`;

  const companionNames = broughtCharacters.map(c => c.name).join(", ");

  await Promise.all(
    broughtCharacters
      .filter(c => c.id && !c.isNpc) // only real Character entity records
      .map(char => {
        const othersLabel = broughtCharacters
          .filter(c => c.id !== char.id)
          .map(c => c.name)
          .join(", ");

        const description = [
          `${char.name} visited ${location.name} (${location.category || "location"}) with ${userDisplayName || "the user"}${othersLabel ? ` and ${othersLabel}` : ""}.`,
          outcomeText,
          sceneHighlights ? `\nScene highlights:\n${sceneHighlights}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        return base44.entities.Memory.create({
          character_id: char.id,
          title: `Outing at ${location.name} with ${userDisplayName || "the user"}`,
          description,
          emotional_impact: "shared experience",
          timestamp: now,
          source_context: "scene_exit",
          owner_email: ownerEmail,
        }).catch(() => {}); // non-fatal — scene exit must not block on this
      })
  );
}