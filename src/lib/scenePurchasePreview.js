/**
 * scenePurchasePreview.js
 *
 * The purchase preview is the person the item is being bought for — not a flat product
 * shot. The recipient is already chosen when this runs, so the image is generated with
 * that person's own reference photos: a character's reference images, or the account
 * holder's own, and the item is shown worn by them.
 */

import { base44 } from "@/api/base44Client";
import { resolveCharacterVisualRefs, resolveUserVisualRefs } from "@/lib/mediaGridIdentityLock";
import { inferPieceType } from "@/lib/scenePurchaseCloset";

/** How much of the body the frame needs for this kind of purchase. */
function wornFocus(itemLabel, isOutfit) {
  if (isOutfit) {
    return {
      framing: "head-to-toe full-body photograph",
      note: "the complete outfit worn together, every piece visible",
    };
  }
  switch (inferPieceType(itemLabel)) {
    case "shoes":
      return { framing: "full-body photograph", note: "the footwear clearly visible and sharply in focus" };
    case "bottom":
      return { framing: "full-body photograph", note: "the trousers or skirt clearly visible and in focus" };
    case "top":
    case "outerwear":
      return { framing: "three-quarter photograph from the waist up", note: "the garment clearly visible and in focus" };
    case "dress":
      return { framing: "head-to-toe full-body photograph", note: "the dress clearly visible and in focus" };
    case "hat":
      return { framing: "head-and-shoulders portrait", note: "the hat clearly visible on their head" };
    case "bag":
      return { framing: "full-body photograph", note: "the bag clearly visible and carried" };
    case "accessories":
      return { framing: "three-quarter photograph", note: "the accessory clearly visible" };
    default:
      return { framing: "full-body photograph", note: "the item clearly visible" };
  }
}

/**
 * Generate the recipient wearing the purchased item.
 *
 * @param {object}   args
 * @param {string}   args.itemLabel     what was bought (e.g. "Leather Sneakers")
 * @param {string}   args.itemKind      "outfit" | "item"
 * @param {string}   args.wearerKind    "user" | "character"
 * @param {string}   [args.characterId] the recipient character, when wearerKind is character
 * @param {string}   args.wearerName    display name used in the prompt
 * @param {string}   [args.userEmail]   account email, when wearerKind is user
 * @returns {Promise<string>} the generated image URL
 */
export async function generateWornPreview({
  itemLabel,
  itemKind,
  wearerKind,
  characterId,
  wearerName,
  userEmail,
}) {
  const isOutfit = itemKind === "outfit";
  const { framing, note } = wornFocus(itemLabel, isOutfit);
  const name = wearerName || "the person";

  // The recipient's own likeness, from the app's existing identity resolution.
  let refs = [];
  let appearanceText = null;
  if (wearerKind === "character" && characterId) {
    const resolved = await resolveCharacterVisualRefs(base44, characterId);
    refs = resolved.refs || [];
    appearanceText = resolved.appearanceText || null;
  } else if (wearerKind === "user") {
    const resolved = await resolveUserVisualRefs(base44, userEmail);
    refs = resolved.refs || [];
  }

  const prompt = [
    `Photorealistic ${framing} of ${name}, wearing ${itemLabel}.`,
    appearanceText ? `Appearance: ${appearanceText}.` : null,
    `${name} is the exact person in the reference image — same face, hair, skin tone and build.`,
    `The ${isOutfit ? "outfit" : "item"} is the subject of the photograph: ${note}.`,
    "Plain neutral studio backdrop, soft even lighting, editorial fashion photography, sharp focus, no text, no watermark.",
  ].filter(Boolean).join(" ");

  const result = await base44.integrations.Core.GenerateImage({
    prompt,
    ...(refs.length > 0 ? { existing_image_urls: refs.slice(0, 2) } : {}),
  });
  return result.url;
}