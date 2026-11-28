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
  // A clothing retailer offers men's and women's apparel as two separate shopping
  // categories. The chosen category decides the merchandise — never the shopper's gender.
  mens_clothing: {
    category: "clothing",
    wearable: true,
    pool: [
      "Men's Button-Down Shirt",
      "Men's Crewneck Sweater",
      "Men's Denim Jacket",
      "Men's Chino Pants",
      "Men's Wool Coat",
      "Men's Polo Shirt",
      "Men's Graphic Tee",
      "Men's Straight-Leg Jeans",
      "Men's Zip Hoodie",
      "Men's Suit Jacket",
      "Men's Linen Shirt",
    ],
  },
  womens_clothing: {
    category: "clothing",
    wearable: true,
    pool: [
      "Women's Wrap Dress",
      "Women's Cardigan",
      "Women's Pleated Skirt",
      "Women's Denim Jacket",
      "Women's Blouse",
      "Women's Straight-Leg Jeans",
      "Women's Midi Dress",
      "Women's Cropped Sweater",
      "Women's Linen Shirt",
      "Women's Wool Coat",
      "Women's Jumpsuit",
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
  // A pet store sells live animals and a dealership sells vehicles. Neither is clothing:
  // both are bought through the same product card and transaction, and registered under
  // Property / Belongings rather than a closet. Their offers are built by the generators
  // below, so the pool here stays empty.
  pets: { category: "pet", wearable: false, pool: [] },
  vehicles: { category: "vehicle", wearable: false, pool: [] },
};

/**
 * The pet types a pet store's visit can be aimed at. These are preferences, not the
 * registration record: the existing Property / Belongings pet fields still record what
 * the animal actually is once it is bought.
 */
export const PET_TYPE_OPTIONS = [
  { value: "dog", label: "Dog" },
  { value: "cat", label: "Cat" },
  { value: "bird", label: "Bird" },
  { value: "fish", label: "Fish" },
  { value: "reptile", label: "Reptile" },
  { value: "small_mammal", label: "Small Mammal" },
  { value: "other", label: "Other" },
];

/**
 * The vehicle types a dealership visit can be aimed at. It describes the kind of vehicle,
 * never a manufacturer: the shopper names a make, model or colour in their own words.
 */
export const VEHICLE_TYPE_OPTIONS = [
  { value: "sedan", label: "Sedan" },
  { value: "suv", label: "SUV" },
  { value: "coupe", label: "Coupe" },
  { value: "convertible", label: "Convertible" },
  { value: "hatchback", label: "Hatchback" },
  { value: "pickup_truck", label: "Pickup Truck" },
  { value: "van_minivan", label: "Van / Minivan" },
  { value: "sports_car", label: "Sports Car" },
  { value: "other", label: "Other" },
];

/** Representative animals a pet store actually has, by the pet type they belong to. */
const PET_BREEDS = {
  dog: ["Golden Retriever puppy", "Labrador Retriever puppy", "French Bulldog", "Beagle", "Pembroke Welsh Corgi", "German Shepherd puppy", "Poodle", "Shih Tzu", "Border Collie puppy", "Dachshund"],
  cat: ["Tabby kitten", "Maine Coon kitten", "Siamese kitten", "Ragdoll kitten", "Black domestic shorthair", "Orange tabby"],
  bird: ["Cockatiel", "Budgie", "Lovebird", "African Grey Parrot"],
  fish: ["Betta fish", "Goldfish", "Guppy", "Angelfish"],
  reptile: ["Bearded Dragon", "Leopard Gecko", "Corn Snake", "Ball Python"],
  small_mammal: ["Holland Lop rabbit", "Guinea pig", "Syrian hamster", "Ferret"],
  other: ["Hedgehog", "Chinchilla", "Sugar Glider"],
};

/** The existing Property / Belongings pet_type a species is recorded as. */
const PET_RECORD_TYPE = {
  dog: "dog",
  cat: "cat",
  bird: "bird",
  fish: "fish",
  reptile: "reptile",
};

/** Representative vehicles of each type, as make + model. */
const VEHICLE_MODELS = {
  sedan: [["Honda", "Accord"], ["Toyota", "Camry"], ["Nissan", "Altima"], ["Hyundai", "Sonata"], ["Tesla", "Model 3"]],
  suv: [["Toyota", "RAV4"], ["Honda", "CR-V"], ["Jeep", "Grand Cherokee"], ["Ford", "Explorer"], ["Subaru", "Outback"]],
  coupe: [["Honda", "Civic Coupe"], ["BMW", "430i"], ["Ford", "Mustang"], ["Chevrolet", "Camaro"]],
  convertible: [["Mazda", "MX-5 Miata"], ["BMW", "Z4"], ["Ford", "Mustang Convertible"], ["Audi", "A5 Cabriolet"]],
  hatchback: [["Volkswagen", "Golf"], ["Honda", "Fit"], ["Toyota", "Corolla Hatchback"], ["Mini", "Cooper"]],
  pickup_truck: [["Ford", "F-150"], ["Chevrolet", "Silverado"], ["Toyota", "Tacoma"], ["Ram", "1500"]],
  van_minivan: [["Honda", "Odyssey"], ["Toyota", "Sienna"], ["Chrysler", "Pacifica"], ["Ford", "Transit"]],
  sports_car: [["Porsche", "911"], ["Chevrolet", "Corvette"], ["Nissan", "GT-R"], ["BMW", "M4"]],
  other: [["Subaru", "Crosstrek"], ["Volvo", "V60"], ["Kia", "Telluride"]],
};

const VEHICLE_COLORS = ["black", "white", "silver", "gray", "dark blue", "red", "green", "beige"];
const VEHICLE_INTERIORS = ["black leather", "tan leather", "gray cloth", "beige leather", "black cloth"];

const pickFrom = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * A pet offered by a pet store. The shopper's chosen pet types decide which animals can be
 * offered; their own words describe what they are looking for and are carried with the
 * offer (and into the picture), never turned into the animal's name.
 */
export function pickPetOffer(preferences = null) {
  const chosen = (preferences?.petTypes || []).filter((t) => PET_BREEDS[t]);
  const type = chosen.length > 0 ? pickFrom(chosen) : pickFrom(Object.keys(PET_BREEDS));
  const breed = pickFrom(PET_BREEDS[type]);
  return {
    family: "pets",
    label: breed,
    category: "pet",
    wearable: false,
    details: {
      pet_type: PET_RECORD_TYPE[type] || "other",
      pet_type_custom: PET_RECORD_TYPE[type] ? "" : breed,
      species: type,
      breed,
      description: String(preferences?.note || "").trim(),
    },
  };
}

/**
 * A vehicle offered by a dealership. The shopper's chosen vehicle types decide the kind of
 * vehicle; the make, model, year and colours belong to the offered vehicle itself and stay
 * with it through Test, the reference images and the registration.
 */
export function pickVehicleOffer(preferences = null) {
  const chosen = (preferences?.vehicleTypes || []).filter((t) => VEHICLE_MODELS[t]);
  const type = chosen.length > 0 ? pickFrom(chosen) : pickFrom(Object.keys(VEHICLE_MODELS));
  const [make, model] = pickFrom(VEHICLE_MODELS[type]);
  const year = 2019 + Math.floor(Math.random() * 7);
  const exterior = pickFrom(VEHICLE_COLORS);
  return {
    family: "vehicles",
    label: `${year} ${make} ${model}`,
    category: "vehicle",
    wearable: false,
    details: {
      vehicle_type: type,
      manufacturer: make,
      make,
      model,
      year,
      exterior_color: exterior,
      interior_color: pickFrom(VEHICLE_INTERIORS),
      description: String(preferences?.note || "").trim(),
    },
  };
}

/** A readable name for each existing merchandise family. */
export const MERCHANDISE_FAMILY_LABELS = {
  sneakers: "Sneakers",
  clothing: "Clothing",
  mens_clothing: "Men's Clothing",
  womens_clothing: "Women's Clothing",
  accessories: "Accessories",
  home_goods: "Home Goods",
  music: "Music",
  books: "Books",
  electronics: "Electronics",
  toys: "Toys",
  gifts: "Gifts",
  pets: "Pets",
  vehicles: "Vehicles",
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
  // Live animals and vehicles — bought through the same card, registered under belongings.
  pet_store: "pets",
  car_dealership: "vehicles",
};

/**
 * The families that make up a clothing retailer's apparel. A venue type mapped to
 * "clothing" carries both: men's and women's are separate shopping categories of the
 * same store, and the user picks either one regardless of who is shopping.
 */
export const CLOTHING_FAMILIES = ["mens_clothing", "womens_clothing"];

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
    if (!family) continue;
    // An apparel venue sells men's and women's clothing as two separate categories.
    const offered = family === "clothing" ? CLOTHING_FAMILIES : [family];
    for (const f of offered) {
      if (MERCHANDISE_FAMILIES[f] && !families.includes(f)) families.push(f);
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
export function pickMerchandise(families, preferences = null) {
  let keys = (Array.isArray(families) ? families : [families]).filter(
    (f) => MERCHANDISE_FAMILIES[f]
  );
  if (keys.length === 0) return null;

  // A stated preference for particular merchandise types narrows the offer to those, among
  // the ones this store actually sells. It never adds a category the store does not carry.
  const preferred = (preferences?.families || []).filter((f) => keys.includes(f));
  if (preferred.length > 0) keys = preferred;

  const family = keys[Math.floor(Math.random() * keys.length)];
  // A pet or a vehicle is offered as an individual animal or an individual car, with its
  // own established details — never as a generic label.
  if (family === "pets") return pickPetOffer(preferences);
  if (family === "vehicles") return pickVehicleOffer(preferences);
  const meta = MERCHANDISE_FAMILIES[family];

  // The shopper's own words describe the item they are looking for. When they gave none,
  // an item from this family's own pool is offered — filtered to the stated styles where
  // those pools contain something that fits, and never invented beyond them.
  const note = String(preferences?.note || "").trim().replace(/[.!]+$/, "");
  let label;
  if (note) {
    label = note.charAt(0).toUpperCase() + note.slice(1);
  } else {
    const styleHint = STYLE_POOL_HINTS[(preferences?.categories || [])[0]];
    const matching = styleHint ? meta.pool.filter((item) => styleHint.test(item)) : [];
    const pool = matching.length > 0 ? matching : meta.pool;
    label = pool[Math.floor(Math.random() * pool.length)];
  }

  return { family, label, category: meta.category, wearable: meta.wearable };
}

/**
 * Which of a family's own established items suit a stated outfit category. These only
 * filter labels that already exist in the pools above; no item is created here.
 */
const STYLE_POOL_HINTS = {
  formal: /suit|blazer|coat|dress|gown|heels|loafer|oxford/i,
  work: /suit|blazer|shirt|blouse|chino|pants|coat|cardigan|loafer|oxford/i,
  church: /suit|blazer|dress|shirt|blouse|coat/i,
  school: /shirt|sweater|hoodie|jeans|sneaker|cardigan/i,
  gym: /sneaker|running|trail|hoodie|tank|short/i,
  daily_casual: /tee|jean|hoodie|sneaker|shirt|sweater|cardigan/i,
  outdoor: /jacket|coat|sneaker|trail|boot/i,
  nightlife: /dress|jacket|sneaker|heels|statement|jumpsuit/i,
  date_night: /dress|jacket|blouse|shirt|suit/i,
  lounge: /sweater|hoodie|cardigan|tank/i,
  sleepwear: /sweater|hoodie|tank/i,
  swimwear: /sneaker|tee/i,
  bath: /sweater|hoodie/i,
  special: /dress|jacket|coat|statement|jumpsuit/i,
};