/**
 * closetImageAutofill.js
 *
 * Reads the image a purchased closet entry already carries (the product / outfit photo
 * generated in Scenes) and turns what is actually visible in it into the entry's own
 * fields — top, bottom, shoes, outerwear, accessories, hair state, full description —
 * so the entry opens filled in instead of blank.
 *
 * It never invents a piece that is not in the photo: a field the photo does not show
 * comes back as an empty string. It never overwrites anything already written on the
 * entry, and it never creates or charges anything — it only proposes values for the
 * existing entry's own form.
 */

import { base44 } from "@/api/base44Client";

const OUTFIT_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    category: { type: "string" },
    top: { type: "string" },
    bottom: { type: "string" },
    shoes: { type: "string" },
    outerwear: { type: "string" },
    accessories: { type: "string" },
    hair_state: { type: "string" },
    full_description: { type: "string" },
  },
};

const PIECE_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    piece_type: { type: "string" },
    description: { type: "string" },
  },
};

/** Analyze the entry's own image and return the fields the photo actually shows. */
export async function analyzeClosetImage({ imageUrl, isOutfit }) {
  if (!imageUrl) return {};

  const prompt = isOutfit
    ? `You are cataloguing a clothing outfit for a character's closet. Look only at what is visible in this image and describe it exactly.
Return JSON:
{
  "label": "Short outfit name (2-4 words) taken from what is visible",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|swimwear|bath|school|date_night|special",
  "top": "The top/shirt/sweater/dress visible, with color and material — empty string if no top is visible",
  "bottom": "The pants/shorts/skirt visible, with color and material — empty string if no bottom is visible",
  "shoes": "The shoes/footwear visible, with color and style — empty string if no shoes are visible",
  "outerwear": "Any jacket/coat/hoodie/cardigan visible — empty string if none",
  "accessories": "Any hat, bag, jewelry, belt, glasses or scarf visible — empty string if none",
  "hair_state": "How the hair is worn, if a person's hair is visible — empty string otherwise",
  "full_description": "A complete vivid description of the whole look as worn, 50-80 words, built only from what is visible"
}
Never describe a piece that is not in the photo. Never write a person's name or identity.`
    : `You are cataloguing a single clothing or accessory item for a closet. Look only at what is visible in this image.
Return JSON:
{
  "label": "Short item name (e.g. White Air Force 1s)",
  "piece_type": "top|bottom|shoes|outerwear|dress|accessories|hat|bag",
  "description": "Detailed description of the item — color, material, style, brand only if visible (50-80 words)"
}
Describe only this item. Never describe a person wearing it, and never add other pieces.`;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt,
    file_urls: [imageUrl],
    response_json_schema: isOutfit ? OUTFIT_SCHEMA : PIECE_SCHEMA,
  });
  return res || {};
}

/**
 * The entry's place in the rotation: however many outfits the owner already has, plus
 * this one. Never lower than an existing rotation number, so two outfits can't collide.
 */
export function nextOutfitRotationNumber(closet, entryId) {
  // Items carry type "piece"; anything else in the closet is an outfit entry.
  const outfits = (closet || []).filter((item) => item?.type !== "piece");
  const others = outfits.filter((item) => (item.outfit_id || item.piece_id) !== entryId);
  const highestSet = others.reduce((max, item) => {
    const n = parseInt(item.rotation_number, 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return Math.max(others.length + 1, highestSet + 1);
}

/** The owner's closet as it is right now — not the snapshot taken before the purchase. */
export async function loadFreshCloset(recipient) {
  if (!recipient?.id) return recipient?.closet || [];
  if (recipient.kind === "character") {
    const fresh = await base44.entities.Character.get(recipient.id);
    return fresh?.character_closet || [];
  }
  const freshSettings = await base44.entities.UserSettings.get(recipient.id);
  return freshSettings?.user_closet || [];
}

/** Fill only what is still empty — nothing already written is replaced. */
export function mergePrefill(entry, prefill) {
  const merged = { ...(entry || {}) };
  Object.entries(prefill || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    const current = merged[key];
    if (current === null || current === undefined || current === "") merged[key] = value;
  });
  return merged;
}