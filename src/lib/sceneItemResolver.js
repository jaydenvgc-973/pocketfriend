/**
 * sceneItemResolver.js
 *
 * Pronoun resolution and item identity parsing for Scene purchase flows.
 *
 * Rules:
 * - Pronouns ("it", "that", "it now", "can I get it now") NEVER become item names.
 * - Resolve backward through messages to find the active pending item.
 * - Character confirmation messages are the highest-priority source.
 * - action_category from the strip button always overrides venue inference.
 * - Item must match the venue category — no drills at restaurants, no cocktails at clothing stores.
 */

// Conversational modifiers — never valid as standalone purchasable item names
const PRONOUN_FRAGMENTS = /^(it|that|this|one|the one|it now|that one|this one|right now|please|can i|i guess|sure|okay|ok|yes|yep|yeah|now|go ahead|let's go|let me|make it|give it|get it|bring it|get it now|can i get it|can i get it now|i'll take it|i want it|bring it|it please)\b/i;

// Whole-message pronoun patterns — entire message is a pronoun confirmation
const WHOLE_MSG_PRONOUN = /^(it now|yes please|sure|go ahead|i'll take it|give it to me|i want it now|make it|bring it|get it now|yes|yep|yeah|ok|okay|now please|right now|please|can i get it now|can i get it|i'll take it now)\s*[.!?]?$/i;

// ── VENUE-CATEGORY ITEM PATTERNS ────────────────────────────────────────────

const KNOWN_DRINK_PATTERN = /\b(Long Beach Iced Tea|Long Island Iced Tea|Margarita|Mojito|Cosmopolitan|Old Fashioned|Whiskey Sour|Gin and Tonic|Vodka Soda|Rum and Coke|Sangria|Moscow Mule|Daiquiri|Martini|Pina Colada|Mai Tai|Negroni|Aperol Spritz|Lager|IPA|Pale Ale|Stout|Cider|Red Wine|White Wine|Champagne|Prosecco|Tequila Shot|Scotch|Bourbon|Brandy|Whiskey|Vodka Shot|Beer|Coffee|Latte|Espresso|Cappuccino|Iced Coffee|Cold Brew|Juice|Soda|Water|Tea|Smoothie|Milkshake)\b/i;

const KNOWN_FOOD_PATTERN = /\b(Cheeseburger|Burger|Sandwich|Pizza|Tacos|Taco|Salad|Wings|Buffalo Wings|Fries|French Fries|Nachos|Pasta|Steak|Chicken|Fish|Shrimp|Lobster|Sushi|Ramen|Soup|Appetizer|Dessert|Cheesecake|Ice Cream|Waffle|Pancakes|Omelette|Burrito|Quesadilla|Hot Dog|Ribs|Brisket|Pulled Pork|Bagel|Croissant|Muffin|Donut|Wrap|Bowl|Platter)\b/i;

const KNOWN_CLOTHING_PATTERN = /\b(shirt|t-shirt|tee|blouse|top|jacket|coat|hoodie|sweater|sweatshirt|cardigan|blazer|suit|dress|skirt|pants|jeans|shorts|leggings|joggers|trousers|sneakers|shoes|boots|heels|sandals|loafers|bag|purse|handbag|backpack|wallet|belt|hat|cap|beanie|scarf|gloves|socks|underwear|bra|boxers|briefs|outfit|accessory|jewelry|necklace|bracelet|ring|earrings|sunglasses|watch)\b/i;

const KNOWN_HOME_GOODS_PATTERN = /\b(trash can|waste bin|garbage can|lamp|light|candle|rug|mat|curtain|blind|pillow|blanket|throw|duvet|sheet|towel|vase|frame|mirror|shelf|bookshelf|chair|stool|table|desk|couch|sofa|bed frame|mattress|dresser|nightstand|storage|bin|basket|organizer|planter|pot|decoration|decor|art print|clock|door mat|shower curtain|bath mat|hangers|hook)\b/i;

const KNOWN_HARDWARE_PATTERN = /\b(drill|hammer|screwdriver|wrench|pliers|tape measure|level|saw|nails|screws|bolts|nuts|washers|sandpaper|paint|primer|brush|roller|caulk|sealant|pipe|fitting|valve|wire|cable|outlet|switch|lumber|wood|plywood|drywall|insulation|ladder|toolbox|utility knife|glue|adhesive|zip ties|extension cord|battery|light bulb|socket|fuse|hose|spray bottle)\b/i;

const KNOWN_GROCERY_PATTERN = /\b(milk|eggs|bread|butter|cheese|yogurt|apple|banana|orange|strawberry|blueberry|grape|tomato|lettuce|spinach|cucumber|carrot|broccoli|pepper|onion|garlic|potato|rice|pasta|cereal|oatmeal|flour|sugar|salt|pepper|oil|vinegar|sauce|ketchup|mustard|mayo|jam|honey|chips|crackers|cookies|chocolate|candy|ice cream|frozen|canned|beans|lentils|chicken breast|ground beef|bacon|sausage|fish fillet|shrimp|tofu|detergent|soap|shampoo|toilet paper|paper towels|trash bags|dish soap)\b/i;

const KNOWN_PHARMACY_PATTERN = /\b(ibuprofen|tylenol|advil|aspirin|acetaminophen|cold medicine|cough syrup|allergy medicine|antacid|vitamins|supplement|bandage|band-aid|gauze|antiseptic|antibiotic ointment|hydrogen peroxide|rubbing alcohol|thermometer|blood pressure monitor|heating pad|ice pack|eye drops|ear drops|nasal spray|inhaler|prescription|medication|sunscreen|lotion|moisturizer|lip balm|deodorant|toothpaste|toothbrush|floss|mouthwash|razors|tampons|pads|condoms|pregnancy test)\b/i;

const KNOWN_ELECTRONICS_PATTERN = /\b(phone|smartphone|case|charger|cable|adapter|earbuds|headphones|speaker|laptop|tablet|keyboard|mouse|monitor|webcam|router|hard drive|SSD|USB|flash drive|memory card|battery pack|power bank|smart watch|fitness tracker|camera|lens|tripod|gaming controller|console|game|TV|remote|smart bulb|smart plug|Alexa|Google Home|Echo|iPad|iPhone|Samsung|AirPods|cord|cord cutter)\b/i;

/**
 * Map action_category to the item pattern that should be used for context scanning.
 */
const CATEGORY_PATTERN_MAP = {
  food:       KNOWN_FOOD_PATTERN,
  drink:      KNOWN_DRINK_PATTERN,
  clothing:   KNOWN_CLOTHING_PATTERN,
  home_goods: KNOWN_HOME_GOODS_PATTERN,
  hardware:   KNOWN_HARDWARE_PATTERN,
  grocery:    KNOWN_GROCERY_PATTERN,
  pharmacy:   KNOWN_PHARMACY_PATTERN,
  electronics: KNOWN_ELECTRONICS_PATTERN,
};

/**
 * Category-specific generic fallback labels.
 * Used when no item can be resolved from message, action label, or context.
 * Food/drink fallbacks are venue-resolved (see venueAppropriateItem) — a universal
 * "cocktail" fallback is forbidden because it contradicts a coffee order in a café.
 */
const CATEGORY_FALLBACKS = {
  clothing:    'clothing item',
  home_goods:  'home item',
  hardware:    'tool',
  grocery:     'grocery item',
  pharmacy:    'health item',
  electronics: 'electronics item',
};

/**
 * Venue-appropriate fallback items for food and drink.
 * Order matters — the first matching venue family wins.
 */
const VENUE_ITEM_FALLBACKS = [
  { pattern: /(caf|coffee|espresso|roaster|teahouse|tea house|bakery|patisserie|diner|breakfast|brunch|juice|smoothie)/i, drink: 'Coffee', food: 'Pastry' },
  { pattern: /(bar|pub|lounge|tavern|club|brewery|winery|distiller|cocktail|speakeasy|rooftop)/i, drink: 'Cocktail', food: 'Bar Snack' },
  { pattern: /(restaurant|bistro|grill|kitchen|eatery|steakhouse|pizzeria|trattoria|cantina|food truck)/i, drink: 'Soft Drink', food: 'Meal' },
];

/**
 * Resolve a food or drink item that belongs to the given venue.
 * Never returns an item from an unrelated venue family.
 */
export function venueAppropriateItem(category, location) {
  const venueText = `${location?.name || ''} ${location?.category || ''} ${location?.venue_identity || ''} ${location?.club_theme || ''}`;
  const match = VENUE_ITEM_FALLBACKS.find((v) => v.pattern.test(venueText));
  if (category === 'drink') return match?.drink || 'Drink';
  if (category === 'food') return match?.food || 'Meal';
  return CATEGORY_FALLBACKS[category] || 'item';
}

/**
 * Derive the best category from a candidate string.
 * Returns the most specific match, or null if no pattern matches.
 */
function deriveCategoryFromCandidate(candidate) {
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERN_MAP)) {
    if (pattern.test(candidate)) return cat;
  }
  return null;
}

// ── ACTION-LABEL ITEM EXTRACTION ────────────────────────────────────────────
// The Scene action strip wraps its label into the outgoing text as
// "[☕ Order coffee — $5]". The selected action IS the order, so the item the
// Shopfeed offers must come from that label — never from a category default.

const ACTION_LEAD_VERBS = /^(?:i(?:'ll| will| want to)?\s+)?(?:order|buy|purchase|grab|get|have|take|pick up|try|sip|drink|eat|go for)\s+(?:a|an|some|the|one|another)?\s*/i;

// Words that name no actual item — they must never become the offered item.
const GENERIC_ITEMS = /^(?:drink|drinks|food|meal|snack|something|anything|option|item|another|round|one|it|that|this|stuff|beverage)$/i;

/**
 * Extract the item named by a Scene action label (or its bracketed echo).
 * Returns a display label such as "Coffee", "Hotdog", "Pastry" — or null when
 * the action names nothing specific.
 */
export function extractItemFromActionLabel(rawText) {
  if (!rawText) return null;
  let s = String(rawText).trim();

  // Unwrap the action echo: "[☕ Order coffee — $5]"
  const bracketed = s.match(/^\[(.+)\]$/);
  if (bracketed) s = bracketed[1];

  s = s.replace(/[—–-]\s*\$[\d.,]+/g, ' ')   // price tail
       .replace(/\([^)]*\)/g, ' ')            // "(Maya pays)"
       .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')   // emoji, symbols
       .replace(/\s+/g, ' ')
       .trim();
  if (!s) return null;

  const withoutVerb = s.replace(ACTION_LEAD_VERBS, '').trim() || s;
  if (!withoutVerb || GENERIC_ITEMS.test(withoutVerb)) return null;

  return withoutVerb
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    .slice(0, 60);
}

/**
 * Scan recent messages (newest first) for an established named item.
 * Prioritises character/bartender messages (confirmations) over user messages.
 *
 * @param {Array}  messages
 * @param {string|null} preferCategory — limit search to this category if specified
 * @returns {{ label: string, category: string } | null}
 */
export function resolveActiveItemFromContext(messages, preferCategory = null) {
  const recentForContext = (messages || []).slice(-10);
  const pattern = preferCategory ? CATEGORY_PATTERN_MAP[preferCategory] : null;

  // Pass 1: character/NPC/bartender confirmation messages (highest trust)
  for (let i = recentForContext.length - 1; i >= 0; i--) {
    const m = recentForContext[i];
    if (m.sender !== 'character' || !m.content) continue;

    if (pattern) {
      const match = m.content.match(pattern);
      if (match?.[0]) return { label: match[0], category: preferCategory };
    } else {
      // Try all categories in priority order
      for (const [cat, pat] of Object.entries(CATEGORY_PATTERN_MAP)) {
        const match = m.content.match(pat);
        if (match?.[0]) return { label: match[0], category: cat };
      }
    }
  }

  // Pass 2: user messages (explicit orders)
  for (let i = recentForContext.length - 1; i >= 0; i--) {
    const m = recentForContext[i];
    if (!m.content) continue;

    if (pattern) {
      const match = m.content.match(pattern);
      if (match?.[0]) return { label: match[0], category: preferCategory };
    } else {
      for (const [cat, pat] of Object.entries(CATEGORY_PATTERN_MAP)) {
        const match = m.content.match(pat);
        if (match?.[0]) return { label: match[0], category: cat };
      }
    }
  }

  return null;
}

/**
 * Validate that a candidate item label is appropriate for the given action category.
 * Prevents cross-category contamination (e.g., a drill showing up at a restaurant).
 *
 * @param {string} candidate
 * @param {string} actionCategory
 * @returns {boolean} true if the candidate is acceptable for this category
 */
function isCandidateValidForCategory(candidate, actionCategory) {
  if (!actionCategory || !candidate) return true; // no constraint
  const expectedPattern = CATEGORY_PATTERN_MAP[actionCategory];
  if (!expectedPattern) return true; // unknown category — allow all

  // If the candidate explicitly matches a DIFFERENT known category, reject it
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERN_MAP)) {
    if (cat === actionCategory) continue;
    if (pattern.test(candidate)) return false; // cross-category contamination
  }
  return true; // passes — either matches expected or is unknown (free-form)
}

/**
 * Extract a valid item label + category from a user message.
 * Resolves pronoun references to the active context item.
 * Never returns a raw pronoun fragment as an item name.
 * Always respects venue/action category boundaries.
 *
 * @param {string} rawText           - The user's raw message text
 * @param {Array}  messages          - Recent scene messages for context resolution
 * @param {string|null} actionCategory - Explicit category from strip action (food/drink/clothing/home_goods/hardware/grocery/pharmacy/electronics)
 * @param {Object|null} location     - Current location, used so a fallback item belongs to this venue
 * @returns {{ label: string, category: string }}
 */
export function extractSceneItemLabel(rawText, messages, actionCategory = null, location = null) {
  // ── STEP 1: Check if the whole message is a pronoun confirmation ─────────
  const isWholePronoun = WHOLE_MSG_PRONOUN.test(rawText.trim());

  // ── STEP 2: A selected action names the item directly — it outranks
  //            conversation context. "Order coffee" → Coffee, never a default.
  //            Only the Scene's bracketed action echo ("[☕ Order coffee — $5]")
  //            qualifies, so typed messages keep their existing parsing.
  const isActionEcho = /^\[[^\]]+\]$/.test(rawText.trim());
  if (!isWholePronoun && isActionEcho) {
    const actionItem = extractItemFromActionLabel(rawText);
    if (actionItem && (!actionCategory || isCandidateValidForCategory(actionItem, actionCategory))) {
      return { label: actionItem, category: actionCategory || deriveCategoryFromCandidate(actionItem) || 'food' };
    }
  }

  // ── STEP 3: Try to extract a real noun phrase from a typed message ───────
  let candidate = null;
  if (!isWholePronoun) {
    const tryMatch = rawText.match(/(?:i'll (?:have|take|get|order)|can i (?:get|have|order)|give me|i want|i'd like|show me|let me see|i'll take|bring me|get me|looking for|i need|i want to buy|i'd like to buy|i'll buy)\s+(?:a |an |some |the |one )?(.+)/i);
    const raw = tryMatch?.[1]?.trim().replace(/[.!?]$/, '') || null;
    // Only keep candidate if it isn't itself a pronoun fragment
    if (raw && !PRONOUN_FRAGMENTS.test(raw.trim())) {
      candidate = raw;
    }
  }

  // ── STEP 4: Validate the candidate matches the action category ───────────
  if (candidate && actionCategory && !isCandidateValidForCategory(candidate, actionCategory)) {
    console.log(`[Scene] Candidate "${candidate}" rejected — cross-category mismatch with action=${actionCategory}`);
    candidate = null; // force context resolution
  }

  // ── STEP 5: If no valid candidate, resolve from conversation context ─────
  if (!candidate) {
    const contextItem = resolveActiveItemFromContext(messages, actionCategory);
    if (contextItem) {
      console.log(`[Scene] Pronoun resolved: "${rawText}" → "${contextItem.label}" (category=${contextItem.category})`);
      return { label: contextItem.label, category: actionCategory || contextItem.category };
    }
    // No context at all — use a category-correct, venue-correct fallback
    const fallbackCategory = actionCategory || 'food';
    const fallbackLabel = venueAppropriateItem(fallbackCategory, location);
    return { label: fallbackLabel, category: fallbackCategory };
  }

  // ── STEP 6: Derive category from candidate if not action-locked ──────────
  const category = actionCategory || deriveCategoryFromCandidate(candidate) || 'food';

  return { label: candidate.slice(0, 60), category };
}

/**
 * Detect if a user message is a purchase confirmation.
 */
export function isPurchaseIntent(text) {
  const t = text.toLowerCase().trim();
  if (/(?:i'll (?:have|take|get)|can i (?:get|have|order)|give me|order\b|i want|i'd like|bring me|get me|i'll buy|i want to buy|i'd like to buy|looking for|i need)\s+(?:a |an |some |the )?.+/.test(t)) return true;
  if (/(?:that(?:'s| is| will be)|it(?:'s| is))\s+\$?\d+|\$\d+\s+(?:for|per)/.test(t)) return true;
  if (WHOLE_MSG_PRONOUN.test(t)) return true;
  return false;
}