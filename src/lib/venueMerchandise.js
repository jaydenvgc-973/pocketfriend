/**
 * venueMerchandise.js — WHAT A STORE ACTUALLY SELLS
 *
 * The store determines what can be shopped for. This file is the single statement of the
 * merchandise each business venue type sells, used by the existing Scenes shopping
 * activity strip and the existing product card.
 *
 * It is not a product catalog and not a second shopping system: there is no inventory,
 * no price, no transaction and no closet here. It only answers two questions for the
 * established flow:
 *   - which shopping categories does this business carry (all of its venue types, never
 *     only the first one),
 *   - what is a representative item of that category (used as the product card's label).
 *
 * A business with no manually entered product catalog still sells what its venue type
 * sells. An unrelated or invented product is never produced.
 */

/**
 * Merchandise families.
 *   category — the existing product-card / image category the item belongs to
 *   wearable — true when the item is clothing, footwear or an accessory, i.e. it belongs
 *              in the Character Closet. Non-wearable merchandise is still purchased, but
 *              is never forced into a closet.
 *   pool     — representative items of this family. Always things this kind of shop sells.
 */
export const MERCHANDISE_FAMILIES = {
  sneakers: {
    category: "clothing",
    wearable: true,
    pool: [
      "Sneakers",
      "Running Shoes",
      "High-Top Sneakers",
      "Leather Sneakers",
      "Canvas Sneakers",
      "Trail Sneakers",
    ],
  },
  clothing: {
    category: "clothing",
    wearable: true,
    pool: [
      "Denim Jacket",
      "Crewneck Sweater",
      "Straight-Leg Jeans",
      "Button-Down Shirt",
      "Wool Coat",
      "Summer Dress",
      "Hoodie",
      "Pleated Skirt",
      "Cardigan",
      "Linen Shirt",
    ],
  },
  accessories: {
    category: "clothing",
    wearable: true,
    pool: [
      "Leather Handbag",
      "Leather Belt",
      "Sunglasses",
      "Silk Scarf",
      "Leather Wallet",
      "Gold Necklace",
      "Wool Beanie",
      "Leather Gloves",
    ],
  },
  home_goods: {
    category: "home_goods",
    wearable: false,
    pool: [
      "Bed Pillow",
      "Down Comforter",
      "Cotton Sheet Set",
      "Throw Blanket",
      "Bath Towel Set",
      "Table Lamp",
      "Scented Candle",
      "Ceramic Vase",
    ],
  },
  music: {
    category: "music",
    wearable: false,
    pool: ["Vinyl Record", "CD Album", "Record Player", "Vinyl Storage Crate"],
  },
  books: {
    category: "book",
    wearable: false,
    pool: [
      "Hardcover Novel",
      "Paperback Thriller",
      "Cookbook",
      "Poetry Collection",
      "Biography",
    ],
  },
  electronics: {
    category: "electronics",
    wearable: false,
    pool: [
      "Wireless Earbuds",
      "Bluetooth Speaker",
      "Phone Charger",
      "Smart Watch",
      "Tablet",
    ],
  },
  toys: {
    category: "toy",
    wearable: false,
    pool: ["Board Game", "Building Set", "Plush Toy", "Jigsaw Puzzle"],
  },
  gifts: {
    category: "gift",
    wearable: false,
    pool: ["Scented Candle", "Gift Basket", "Ceramic Mug Set", "Photo Frame"],
  },
};

/** Business venue type → the merchandise family it sells. */
export const VENUE_MERCHANDISE_FAMILY = {
  // Footwear
  sneaker_store: "sneakers",
  shoe_store: "sneakers",
  sneakers: "sneakers",
  // Apparel
  clothing_store: "clothing",
  clothing: "clothing",
  boutique: "clothing",
  apparel: "clothing",
  thrift_store: "clothing",
  thrift: "clothing",
  mall: "clothing",
  department_store: "clothing",
  // Accessories
  accessories_store: "accessories",
  accessories: "accessories",
  // Home goods
  home_goods_store: "home_goods",
  home_goods: "home_goods",
  // Music
  record_store: "music",
  // Books
  bookstore: "books",
  book_store: "books",
  // Electronics
  electronics_store: "electronics",
  // Toys and gifts
  toy_store: "toys",
  gift_shop: "gifts",
};

function normalizeSubtypes(subtypes) {
  const raw = Array.isArray(subtypes) ? subtypes : [subtypes];
  return raw
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().replace(/[\s\-&]+/g, "_").replace(/_+/g, "_"));
}

/**
 * Every merchandise family this venue carries, in the order its venue types were assigned.
 * All assigned types count — a sneaker, clothing and accessories business sells all three.
 * Empty when the venue sells no retail merchandise (a bar, a gym, an office…).
 */
export function merchandiseFamiliesForVenue(subtypes) {
  const families = [];
  for (const subtype of normalizeSubtypes(subtypes)) {
    const family = VENUE_MERCHANDISE_FAMILY[subtype];
    if (family && MERCHANDISE_FAMILIES[family] && !families.includes(family)) {
      families.push(family);
    }
  }
  return families;
}

/**
 * One representative item from the given families.
 * A single family offers its own merchandise; several families (Buy Something at a
 * combined store) offer an item from any of the categories that business actually sells.
 * Returns null when nothing is known about the venue — the caller then keeps its own
 * established resolution instead of inventing merchandise.
 */
export function pickMerchandise(families) {
  const keys = (Array.isArray(families) ? families : [families]).filter(
    (f) => MERCHANDISE_FAMILIES[f]
  );
  if (keys.length === 0) return null;
  const family = keys[Math.floor(Math.random() * keys.length)];
  const meta = MERCHANDISE_FAMILIES[family];
  const label = meta.pool[Math.floor(Math.random() * meta.pool.length)];
  return { family, label, category: meta.category, wearable: meta.wearable };
}