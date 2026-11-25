/**
 * closetImageGeneration.js
 *
 * Every image generated inside a closet depicts the closet's own owner.
 *
 * A closet always belongs to someone — a character (character_closet) or the account
 * holder (user_closet) — so the identity is already known and never guessed:
 * - a character closet generates that character wearing the outfit,
 * - the user closet generates the account holder wearing it.
 *
 * The reference photos anchor the face and body only. The clothing comes solely from the
 * outfit description, so editing an outfit's pieces and regenerating shows the new pieces
 * on the same person rather than copying the clothes in the old photo.
 *
 * If no identity can be resolved, this refuses to generate rather than producing a
 * generic person: a closet image that does not depict its owner is a failure.
 */

import { base44 } from "@/api/base44Client";
import { resolveCharacterVisualRefs, resolveUserVisualRefs } from "@/lib/mediaGridIdentityLock";

/** The owner's likeness: reference images plus any text description of their appearance. */
export async function resolveClosetOwnerIdentity({ ownerKind, characterId, userEmail }) {
  if (ownerKind === "character") {
    if (!characterId) throw new Error("This closet is not linked to a character, so their likeness cannot be resolved.");
    const resolved = await resolveCharacterVisualRefs(base44, characterId);
    return { refs: resolved.refs || [], appearanceText: resolved.appearanceText || null };
  }
  if (!userEmail) throw new Error("Your account could not be identified, so your likeness cannot be resolved.");
  const resolved = await resolveUserVisualRefs(base44, userEmail);
  return { refs: resolved.refs || [], appearanceText: null };
}

/**
 * Generate the closet owner wearing the described outfit.
 *
 * @param {object} args
 * @param {"character"|"user"} args.ownerKind  which closet this is
 * @param {string} [args.characterId]          the closet's character, when ownerKind is character
 * @param {string} [args.userEmail]            the account holder, when ownerKind is user
 * @param {string} args.ownerName              who must appear in the image
 * @param {string} args.description            the outfit as written in the closet
 * @returns {Promise<string>} the generated image URL
 */
export async function generateClosetImage({ ownerKind, characterId, userEmail, ownerName, description }) {
  const name = ownerName || (ownerKind === "character" ? "this character" : "you");
  const outfit = String(description || "").trim();
  if (!outfit) throw new Error("Describe the outfit first — the image is generated from that description.");

  const { refs, appearanceText } = await resolveClosetOwnerIdentity({ ownerKind, characterId, userEmail });

  if (refs.length === 0 && !appearanceText) {
    throw new Error(
      ownerKind === "character"
        ? `Add a reference photo of ${name} first — an image of this outfit has to show ${name}, not a stranger.`
        : "Add a photo of yourself in My Profile first — an image of this outfit has to show you, not a stranger."
    );
  }

  const prompt = [
    `Photorealistic head-to-toe fashion photograph of ${name} wearing: ${outfit}.`,
    appearanceText ? `Appearance: ${appearanceText}.` : null,
    `${name} is the exact person in the reference photograph — same face, facial features, skin tone, hair and body. Their identity must not change.`,
    `The reference photograph is for ${name}'s face and body ONLY: do not copy its clothing, pose or background. The clothing is exactly what is described above.`,
    `Full body visible from head to toe, standing pose, plain neutral studio backdrop, soft even lighting, editorial fashion photography, sharp focus, no text, no watermark.`,
  ].filter(Boolean).join(" ");

  const result = await base44.integrations.Core.GenerateImage({
    prompt,
    ...(refs.length > 0 ? { existing_image_urls: refs.slice(0, 2) } : {}),
  });
  if (!result?.url) throw new Error("The image could not be generated. Try again.");
  return result.url;
}