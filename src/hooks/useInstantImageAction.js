import { base44 } from "@/api/base44Client";
import { buildCharacterInScene } from "@/lib/chatSceneCharacter";
import { resolveCoPresence } from "@/lib/coPresenceResolver";

/**
 * useInstantImageAction
 *
 * Owns the "Instant Image" tap handler.
 *
 * It describes the character's ALREADY-EXISTING current scene, then hands that
 * description to the existing createImageMessage pipeline — the same pipeline a
 * character-generated image uses. Nothing is re-implemented here:
 *
 *   - The scene snapshot comes from the same resolved character location every
 *     other surface reads (buildCharacterInScene).
 *   - User physical presence comes from the shared co-presence resolver
 *     (resolveCoPresence), which reads UserSettings.user_current_location_id /
 *     user_presence_status against the character's resolved location.
 *   - Other people physically at that location come from the same character
 *     roster Chat already resolves image subjects against.
 *   - Identity binding is unchanged: when a person is named in the resulting
 *     prompt, createImageMessage's existing subject resolver binds that user ID
 *     / character ID to its authoritative avatar references.
 *
 * The only new work is telling the scene description WHO the established moment
 * actually contains, so the existing identity pathways have something to bind.
 */
export function useInstantImageAction({
  character,
  messages,
  messagesRef,
  createImageMessage,
  userSettings = null,
  currentUser = null,
  queryClient = null,
}) {
  const handleInstantImage = async () => {
    try {
      if (!character?.name) return;

      const allMessages = messagesRef?.current || messages || [];

      // The established moment: the most recent current-action narratives, newest first.
      // These carry the room / zone the scene is actually happening in.
      const narratives = [...allMessages]
        .reverse()
        .filter(
          msg =>
            msg?.is_narrative === true &&
            typeof msg?.content === "string" &&
            msg.content.trim()
        )
        .slice(0, 3)
        .map(msg => msg.content.trim());

      const latestNarrative = narratives[0] || null;

      const recentDialogue = allMessages
        .filter(
          msg =>
            !msg?.is_narrative &&
            typeof msg?.content === "string" &&
            msg.content.trim()
        )
        .slice(-4)
        .map(msg => {
          const speaker =
            msg.sender_type === "user"
              ? "User"
              : (msg.character_name || character.name);

          return `${speaker}: ${msg.content}`;
        })
        .join("\n");

      const genderValue =
        typeof character.gender === "string"
          ? character.gender.trim()
          : null;

      const genderRule = genderValue
        ? `Stored character gender: ${genderValue}. Respect the stored value.`
        : `Character gender is unset/null. Do NOT assign or infer a gender.
           Do not use "woman", "man", "female", "male", she/her, or he/him.
           Use ${character.name} or gender-neutral language/them if necessary.`;

      // ── AUTHORITATIVE SCENE SNAPSHOT (same pathway every surface uses) ─────
      const characterInScene = buildCharacterInScene(character);
      const worldName =
        userSettings?.fictional_world_name ||
        currentUser?.full_name ||
        null;

      // ── USER PHYSICAL PRESENCE (shared co-presence resolver) ───────────────
      // Location-level truth only. Whether the user is in the SAME immediate room
      // is decided by the established narrative below — never assumed.
      const coPresence = resolveCoPresence(characterInScene, userSettings, worldName);

      // ── OTHER PEOPLE PHYSICALLY AT THIS LOCATION (roster, same resolver) ───
      const allCharacters =
        queryClient?.getQueryData?.(["characters", currentUser?.email]) || [];
      const charLocId = coPresence?.characterLocationId || null;
      const othersHere = allCharacters
        .filter(
          c =>
            c &&
            c.id !== character.id &&
            c.status !== "deleted" &&
            c.status !== "merged" &&
            charLocId &&
            c.resolved_current_location_id === charLocId
        )
        .map(c => {
          const name = c.display_name || c.name;
          const state = c.resolved_presence_status || "here";
          return name ? `${name} (${state})` : null;
        })
        .filter(Boolean);

      const sceneState = [
        `CURRENT CHARACTER / PRIMARY SUBJECT: ${character.name}`,
        characterInScene.resolved_current_location_name
          ? `CURRENT LOCATION: ${characterInScene.resolved_current_location_name}`
          : null,
        (userSettings?.user_current_location_name || coPresence?.userLocationName)
          ? `USER'S CURRENT LOCATION: ${userSettings?.user_current_location_name || coPresence?.userLocationName}`
          : null,
        characterInScene.current_activity
          ? `CURRENT ACTIVITY: ${characterInScene.current_activity}`
          : null,
        character.current_situation
          ? `CURRENT SITUATION: ${character.current_situation}`
          : null,
        character.daily_micro_narration
          ? `CURRENT MICRO NARRATION: ${character.daily_micro_narration}`
          : null,
        latestNarrative
          ? `LATEST CURRENT-ACTION NARRATIVE: ${latestNarrative}`
          : null,
        narratives.length > 1
          ? `PRECEDING NARRATIVES (the scene leading into this moment):\n${narratives.slice(1).join("\n")}`
          : null,
        worldName ? `USER IDENTITY (world name): ${worldName}` : null,
        othersHere.length > 0
          ? `OTHER PEOPLE RESOLVED AT THIS LOCATION RIGHT NOW: ${othersHere.join(", ")}`
          : `OTHER PEOPLE RESOLVED AT THIS LOCATION RIGHT NOW: none`,
      ]
        .filter(Boolean)
        .join("\n");

      const sceneResult =
        await base44.integrations.Core.InvokeLLM({
          prompt: `
Create ONE concise image-generation description of what is happening
RIGHT NOW with the current character.

This is an Instant Image of the character's ALREADY-EXISTING current scene.
Do not create a new scenario and do not progress the story.

AUTHORITY:

${sceneState}

${coPresence?.promptBlock || ""}

${genderRule}

RULES:

The current character is the default primary image subject.

The character's stored current location is where the image takes place.

The current activity, current situation, and the current-action narratives
describe what is happening now.

Recent Chat/Text dialogue is SECONDARY information only. It may help with
expression or mood, but it must NOT relocate the character.

The user saying where the USER is does not move the character there.

WHO IS ACTUALLY IN THIS IMAGE:

- Start from what the established moment says is happening in that immediate
  space, and include exactly the people who are physically in it.

- ${worldName || "The user"} belongs in the image ONLY when both are true:
  the co-presence truth above says the user is physically at this location, AND
  the established moment shows the user in the same immediate space, taking part
  in what is being depicted. In that case write their name (${worldName || "the user"})
  explicitly into the description — for example "${worldName || "the user"} lying
  beside ${character.name}" — because naming them is what binds their real,
  established appearance. Do NOT describe their face, body, age or clothing.

- If the established moment places ${worldName || "the user"} in a different room
  or zone, or does not place them in the moment at all, leave them out. Sharing a
  home or property is NOT sharing the room.

- Anyone else resolved at this location belongs in the image ONLY when the
  established moment shows them in the same immediate space and participating.
  When they do belong, name them explicitly for the same reason. Always name
  ${character.name} rather than using only a pronoun, so nobody is ambiguous.

- A mentioned person is not a present person. Discussing, messaging, remembering
  or planning about someone never puts them in this image.

- NEVER write the name of anyone who is not physically in the image. If someone
  is only being talked about, texted, missed or thought about, the description
  must not contain their name at all — describe only what is actually in frame.

- FORMAT — when anyone other than ${character.name} is in the image, the
  description MUST begin with the exact prefix "[JOINT] " followed by the
  description. That prefix is this system's existing signal that the image holds
  the character together with other people. If ${character.name} is the only
  person in frame, do NOT use the prefix.

- Do not invent anyone entering, approaching, smiling, touching, walking over or
  sitting down. Do not invent a room or location when the character already has
  one. Do not invent a person who is not in the established moment.

- Do not describe or reinterpret anyone's identity, face, body, or wardrobe. The
  existing image system already handles those authorities.

Capture the current moment only.

RECENT DIALOGUE — SECONDARY CONTEXT ONLY:
${recentDialogue || "No additional dialogue context needed."}

Return ONLY the concise image prompt.
`
        });

      const scenePrompt =
        typeof sceneResult === "string"
          ? sceneResult
          : sceneResult?.response ||
            sceneResult?.text ||
            sceneResult?.content;

      if (!scenePrompt?.trim()) {
        console.error("[Instant Image] Scene prompt was empty");
        return;
      }

      await createImageMessage(scenePrompt.trim(), 300);
    } catch (err) {
      console.error("[Instant Image] Failed:", err);
    }
  };

  return { handleInstantImage };
}