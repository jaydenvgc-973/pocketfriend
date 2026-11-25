/**
 * sceneTryOnPrompt.js — TRY ON, AS A SCENE MOMENT
 *
 * Trying on merchandise is an ordinary shopping activity, not a separate fitting-room
 * system. This file only states two things for the established top-Scenes image path:
 *
 *   - WHERE it happens: an existing zone of the store (its fitting rooms for clothing,
 *     its sales floor for footwear). No location is ever created for it.
 *   - WHAT the picture shows: the chosen character wearing the exact merchandise from the
 *     product card. The card's own image is passed as a reference, so the garment is the
 *     one being tried on — never a different or generic item.
 *
 * The character keeps their own face, hair and everything they were already wearing; only
 * the garment being tried on changes.
 */

const FOOTWEAR_FAMILIES = new Set(["sneakers"]);

/** True when the merchandise is footwear — evaluated on the sales floor, not in a fitting room. */
export function isFootwearMerchandise(family) {
  return FOOTWEAR_FAMILIES.has(family);
}

/**
 * The existing zone of this store where this merchandise would be tried on.
 * Clothing prefers the store's fitting rooms, footwear its sales floor; when the store
 * has no such zone the scene's current zone is kept. A zone is never invented.
 */
export function resolveTryOnZone(location, merchandiseFamily, activeZone) {
  const zones = (location?.zones || []).map((z) => z?.zone_name).filter(Boolean);
  const find = (re) => zones.find((z) => re.test(z));
  const preferred = isFootwearMerchandise(merchandiseFamily)
    ? find(/sales floor|shop floor|shoe|sneaker|footwear/i)
    : find(/fitting|dressing|change room|changeroom|try/i);
  return preferred || activeZone || zones[0] || null;
}

/**
 * The prompt for the try-on image. The merchandise's own product-card image is supplied
 * alongside it as a reference; this text says what that reference is and what must not
 * change about the person wearing it.
 */
export function buildTryOnPrompt({ itemLabel, itemKind, merchandiseFamily, actorName, locationName, zoneName }) {
  const actor = actorName || "the person";
  const item = itemLabel || "the item";
  const loc = locationName || "the store";
  const where = zoneName ? `the ${zoneName} at ${loc}` : loc;
  const footwear = isFootwearMerchandise(merchandiseFamily);
  const outfit = itemKind === "outfit";

  const moment = footwear
    ? `${actor} seated on a bench in ${where}, having just put on the ${item}, looking down at them and flexing an ankle to test the fit, shoe box and a low mirror nearby, retail lighting`
    : outfit
      ? `${actor} standing in front of the fitting-room mirror in ${where}, wearing the complete ${item} outfit as one look, turning slightly to see how it fits`
      : `${actor} standing in front of the fitting-room mirror in ${where}, wearing the ${item} and checking how it looks in the mirror`;

  const itemRule = `THE EXACT MERCHANDISE IS BEING TRIED ON: the ${item} must be the same item as the supplied product photograph — identical colour, pattern, cut, fabric, material, hardware and every recognizable detail. It is the item from the product card, never a different, similar or generic garment.`;

  // A single garment replaces only itself; the rest of what they wore stays their own.
  const keepRule = footwear
    ? `${actor} keeps the rest of their own outfit exactly as they were already dressed — only the shoes change.`
    : outfit
      ? `The complete outfit replaces the garments it is made of; ${actor} keeps their own face, hair, body and accessories.`
      : `${actor} keeps the rest of their own outfit exactly as it was — their own trousers or skirt, their own shoes and accessories are unchanged. Only the ${item} is different.`;

  return `${moment}. ${itemRule} ${actor} keeps their own face, hair, body and identity exactly as in their reference image — no other person's appearance is used. ${keepRule} The product photograph is merchandise only: take no face, hair or body from it. No other people in frame — no cashier, no staff, no shoppers, no bystanders.`;
}