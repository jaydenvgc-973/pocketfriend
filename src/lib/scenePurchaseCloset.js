/**
 * scenePurchaseCloset.js
 *
 * Connects a completed Scenes purchase to the buyer's existing Character Closet.
 *
 * This is not a second closet and not a second purchase system:
 * - the money was already taken by executeSceneTransaction (the transaction authority),
 * - this file only turns that completed purchase into the SAME closet records the
 *   Character Closet panel already reads and writes (character_closet on the character,
 *   user_closet on UserSettings), in the SAME two categories it already has:
 *     type: "piece"   → Items
 *     type: "outfit"  → Outfits
 *
 * One purchase produces exactly one closet entry. The entry is written as soon as the
 * charge succeeds, so a closed modal can never lose the purchase; the modal then fills
 * in its details in place (same entry, same id — never a duplicate, never a new charge).
 */

import { base44 } from "@/api/base44Client";

const PIECE_ID_PREFIX = "piece_";

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** The closet's own piece types (mirrors CharacterClosetPanel PIECE_TYPES). */
export function inferPieceType(label) {
  const l = String(label || "").toLowerCase();
  if (/\b(sneakers?|shoes?|boots?|heels?|sandals?|loafers?|trainers?|pumps?|flats?|cleats?)\b/.test(l)) return "shoes";
  if (/\b(hat|cap|beanie|beret|headband)\b/.test(l)) return "hat";
  if (/\b(bag|purse|handbag|tote|backpack|clutch|wallet)\b/.test(l)) return "bag";
  if (/\b(jacket|coat|hoodie|blazer|cardigan|parka|trench|vest)\b/.test(l)) return "outerwear";
  if (/\b(dress|gown|jumpsuit|romper)\b/.test(l)) return "dress";
  if (/\b(jeans?|pants|trousers|shorts|skirt|leggings|joggers)\b/.test(l)) return "bottom";
  if (/\b(necklace|bracelet|ring|earrings?|sunglasses|watch|belt|scarf|gloves?|jewelry|accessor)\b/.test(l)) return "accessories";
  if (/\b(shirt|t-shirt|tee|blouse|top|sweater|sweatshirt|tank|polo)\b/.test(l)) return "top";
  return "accessories";
}

/**
 * A single purchased item — goes to the recipient's Items section.
 * `pending_details` stays true until the owner's closet entry is completed.
 */
export function buildPurchasedPiece({ label, imageUrl, price, transactionId }) {
  const name = (label || "Purchased item").trim();
  return {
    piece_id: newId(PIECE_ID_PREFIX),
    outfit_id: newId(PIECE_ID_PREFIX),
    type: "piece",
    piece_type: inferPieceType(name),
    label: name,
    description: "",
    image_url: imageUrl || "",
    is_favorite: false,
    created_at: new Date().toISOString(),
    source: "scene_purchase",
    purchase_price: price ?? null,
    purchase_transaction_id: transactionId || null,
    pending_details: true,
  };
}

/**
 * A complete purchased outfit — goes to the recipient's Outfits section.
 * The outfit image generated in Scenes is its initial image, untouched.
 */
export function buildPurchasedOutfit({ label, imageUrl, price, transactionId }) {
  const name = (label || "Purchased outfit").trim();
  return {
    outfit_id: newId("outfit"),
    type: "outfit",
    label: name,
    category: "daily_casual",
    rotation_number: null,
    top: "",
    bottom: "",
    shoes: "",
    outerwear: "",
    accessories: "",
    hair_state: "",
    full_description: "",
    is_favorite: false,
    created_at: new Date().toISOString(),
    image_url: imageUrl || "",
    source: "scene_purchase",
    purchase_price: price ?? null,
    purchase_transaction_id: transactionId || null,
    pending_details: true,
  };
}

/**
 * The account holder's own wardrobe entry — shaped exactly like the entry the purchase
 * modal already wrote to user_closet, so their existing wardrobe keeps working unchanged.
 */
export function buildUserPurchaseEntry({ label, imageUrl, price, transactionId }) {
  return {
    outfit_id: `piece_${Date.now()}`,
    label: (label || "Purchased item").trim(),
    category: "daily_casual",
    image_url: imageUrl || null,
    full_description: "",
    created_at: new Date().toISOString(),
    is_favorite: false,
    source: "scene_purchase",
    purchase_price: price ?? null,
    purchase_transaction_id: transactionId || null,
    pending_details: true,
  };
}

/** Which closet the purchase belongs to. Recipient decides — never the payer. */
export function buildRecipient({ kind, character = null, settings = null, displayName = "" }) {
  if (kind === "character" && character?.id) {
    return {
      kind: "character",
      id: character.id,
      name: character.name || displayName,
      owner_email: character.owner_email || null,
      closet: character.character_closet || [],
    };
  }
  return {
    kind: "user",
    id: settings?.id || null,
    name: displayName || "You",
    closet: settings?.user_closet || [],
  };
}

/**
 * Write the new entry into the recipient's existing closet, using the same persistence
 * the Character Closet panel uses (character_closet / user_closet).
 */
export async function appendClosetEntry({ recipient, entry }) {
  const entryId = entry.piece_id || entry.outfit_id;
  const alreadyThere = (closet) =>
    (closet || []).some((item) => (item.piece_id || item.outfit_id) === entryId);

  if (recipient.kind === "character") {
    // Read the closet fresh: a retry of a paid purchase must find its own entry and stop,
    // never append a second one.
    const fresh = await base44.entities.Character.get(recipient.id);
    const closet = fresh?.character_closet || [];
    if (alreadyThere(closet)) return closet;
    const next = [...closet, entry];
    await base44.entities.Character.update(recipient.id, { character_closet: next });
    return next;
  }
  if (!recipient.id) throw new Error("No user settings record to save the purchase to");
  const freshSettings = await base44.entities.UserSettings.get(recipient.id);
  const closet = freshSettings?.user_closet || [];
  if (alreadyThere(closet)) return closet;
  const next = [...closet, entry];
  await base44.entities.UserSettings.update(recipient.id, { user_closet: next });
  return next;
}

/** Complete the details of an entry that already exists — never creates a second entry. */
export async function updateClosetEntry({ recipient, entryId, updates }) {
  const closet = recipient.closet || [];
  const next = closet.map((item) => {
    const id = item.piece_id || item.outfit_id;
    if (id !== entryId) return item;
    return { ...item, ...updates, pending_details: false };
  });
  if (recipient.kind === "character") {
    await base44.entities.Character.update(recipient.id, { character_closet: next });
  } else {
    await base44.entities.UserSettings.update(recipient.id, { user_closet: next });
  }
  return next;
}

/**
 * The feed line confirming a completed purchase. A closet entry says where it went;
 * merchandise that is not wearable is confirmed as owned, never as closeted.
 */
export function purchaseConfirmationLine({ recipient, entry, kind, price, itemLabel }) {
  const who = recipient?.kind === "character" ? recipient.name : null;
  if (!entry) {
    const what = itemLabel || "The item";
    return who ? `✓ Purchased for $${price} — ${what} is ${who}'s.` : `✓ Purchased for $${price} — ${what} is yours.`;
  }
  return who
    ? `✓ Purchased for $${price} — added to ${who}'s ${kind === "outfit" ? "Outfits" : "Items"}.`
    : `✓ Purchased for $${price} — added to your closet.`;
}

/** Find the closet entry a purchase produced, so it can be finished later. */
export function findClosetEntry(closet, entryId) {
  return (closet || []).find((item) => (item.piece_id || item.outfit_id) === entryId) || null;
}