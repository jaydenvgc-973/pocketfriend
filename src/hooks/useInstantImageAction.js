import { base44 } from "@/api/base44Client";

/**
 * useInstantImageAction
 *
 * Owns the "Instant Image" tap handler: it asks the LLM for a description of the
 * character's ALREADY-EXISTING current scene, then hands that description to the
 * existing createImageMessage pipeline. Extracted verbatim from Chat.jsx to keep
 * that file within its size limit; behaviour is unchanged.
 */
export function useInstantImageAction({ character, messages, messagesRef, createImageMessage }) {
  const handleInstantImage = async () => {
    try {
      if (!character?.name) return;

      const allMessages = messagesRef.current || messages || [];

      const latestNarrative = [...allMessages]
        .reverse()
        .find(
          msg =>
            msg?.is_narrative === true &&
            typeof msg?.content === "string" &&
            msg.content.trim()
        );

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

      const sceneState = [
        `CURRENT CHARACTER / PRIMARY SUBJECT: ${character.name}`,
        character.resolved_current_location_name
          ? `CURRENT LOCATION: ${character.resolved_current_location_name}`
          : null,
        character.current_activity
          ? `CURRENT ACTIVITY: ${character.current_activity}`
          : null,
        character.current_situation
          ? `CURRENT SITUATION: ${character.current_situation}`
          : null,
        character.daily_micro_narration
          ? `CURRENT MICRO NARRATION: ${character.daily_micro_narration}`
          : null,
        latestNarrative?.content
          ? `LATEST CURRENT-ACTION NARRATIVE: ${latestNarrative.content}`
          : null,
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

${genderRule}

RULES:

The current character is the default primary image subject.

The character's stored current location is where the image takes place.

The current activity, current situation, and latest current-action narrative
describe what is happening now.

Recent Chat/Text dialogue is SECONDARY information only. It may help with
expression or mood, but it must NOT relocate the character.

The user saying where the USER is does not move the character there.

Mentioning a husband, wife, child, friend, coworker, or anyone else does not
make that person physically present in the character's scene.

Do not add another person unless the established current scene actually says
that person is physically present.

Do not invent someone entering, approaching, smiling, touching, walking over,
sitting down, or beginning another action.

Do not invent a room or location when the character already has a current
location.

Do not describe or reinterpret the character's identity, face, body, or
wardrobe. The existing image system already handles those authorities.

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