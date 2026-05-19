/**
 * sceneItemResolver.js
 *
 * Pronoun resolution and item identity parsing for Scene purchase flows.
 *
 * Rules:
 * - Pronouns ("it", "that", "it now", "can I get it now") NEVER become item names.
 * - Resolve backward through messages to find the active pending item.
 * - Character confirmation messages are the highest-priority source
 *   (bartender said "your Long Beach Iced Tea will be right up" → use that).
 * - action_category from the strip button always overrides venue inference.
 */

// Conversational modifiers — never valid as standalone purchasable item names
const PRONOUN_FRAGMENTS = /^(it|that|this|one|the one|it now|that one|this one|right now|please|can i|i guess|sure|okay|ok|yes|yep|yeah|now|go ahead|let's go|let me|make it|give it|get it|bring it|get it now|can i get it|can i get it now|i'll take it|i want it|bring it|it please)\b/i;

// Whole-message pronoun patterns — entire message is a pronoun confirmation
const WHOLE_MSG_PRONOUN = /^(it now|yes please|sure|go ahead|i'll take it|give it to me|i want it now|make it|bring it|get it now|yes|yep|yeah|ok|okay|now please|right now|please|can i get it now|can i get it|i'll take it now)\s*[.!?]?$/i;

// Named drink items
const KNOWN_DRINK_PATTERN = /\b(Long Beach Iced Tea|Long Island Iced Tea|Margarita|Mojito|Cosmopolitan|Old Fashioned|Whiskey Sour|Gin and Tonic|Vodka Soda|Rum and Coke|Sangria|Moscow Mule|Daiquiri|Martini|Pina Colada|Mai Tai|Negroni|Aperol Spritz|Lager|IPA|Pale Ale|Stout|Cider|Red Wine|White Wine|Champagne|Prosecco|Tequila Shot|Scotch|Bourbon|Brandy|Whiskey|Vodka Shot|Beer)\b/i;

// Named food items
const KNOWN_FOOD_PATTERN = /\b(Cheeseburger|Burger|Sandwich|Pizza|Tacos|Taco|Salad|Wings|Buffalo Wings|Fries|French Fries|Nachos|Pasta|Steak|Chicken|Fish|Shrimp|Lobster|Sushi|Ramen|Soup|Appetizer|Dessert|Cheesecake|Ice Cream|Waffle|Pancakes|Omelette|Burrito|Quesadilla|Hot Dog|Ribs|Brisket|Pulled Pork)\b/i;

/**
 * Scan recent messages (newest first) for an established named item.
 * Prioritises character/bartender messages (confirmations) over user messages.
 * @param {Array}  messages
 * @param {'drink'|'food'|null} preferCategory — prefer items of this category if specified
 * @returns {{ label: string, category: 'drink'|'food' } | null}
 */
export function resolveActiveItemFromContext(messages, preferCategory = null) {
  const recentForContext = (messages || []).slice(-10);

  // Pass 1: character/bartender confirmation messages (highest trust)
  for (let i = recentForContext.length - 1; i >= 0; i--) {
    const m = recentForContext[i];
    if (m.sender !== 'character' || !m.content) continue;

    if (preferCategory !== 'food') {
      const drinkMatch = m.content.match(KNOWN_DRINK_PATTERN);
      if (drinkMatch?.[0]) return { label: drinkMatch[0], category: 'drink' };
    }
    if (preferCategory !== 'drink') {
      const foodMatch = m.content.match(KNOWN_FOOD_PATTERN);
      if (foodMatch?.[0]) return { label: foodMatch[0], category: 'food' };
    }
  }

  // Pass 2: user messages (explicit orders)
  for (let i = recentForContext.length - 1; i >= 0; i--) {
    const m = recentForContext[i];
    if (!m.content) continue;

    if (preferCategory !== 'food') {
      const drinkMatch = m.content.match(KNOWN_DRINK_PATTERN);
      if (drinkMatch?.[0]) return { label: drinkMatch[0], category: 'drink' };
    }
    if (preferCategory !== 'drink') {
      const foodMatch = m.content.match(KNOWN_FOOD_PATTERN);
      if (foodMatch?.[0]) return { label: foodMatch[0], category: 'food' };
    }
  }

  return null;
}

/**
 * Extract a valid item label + category from a user message.
 * Resolves pronoun references to the active context item.
 * Never returns a raw pronoun fragment as an item name.
 *
 * @param {string} rawText           - The user's raw message text
 * @param {Array}  messages          - Recent scene messages for context resolution
 * @param {'food'|'drink'|'clothing'|null} actionCategory - Explicit category from strip action
 * @returns {{ label: string, category: 'drink'|'food'|'clothing' }}
 */
export function extractSceneItemLabel(rawText, messages, actionCategory = null) {
  const isFoodAction   = actionCategory === 'food';
  const isDrinkAction  = actionCategory === 'drink';
  const isClothingAction = actionCategory === 'clothing';

  // ── STEP 1: Check if the whole message is a pronoun confirmation ─────────
  const isWholePronoun = WHOLE_MSG_PRONOUN.test(rawText.trim());

  // ── STEP 2: Try to extract a real noun phrase from the message ───────────
  let candidate = null;
  if (!isWholePronoun) {
    const tryMatch = rawText.match(/(?:i'll (?:have|take|get|order)|can i (?:get|have|order)|give me|i want|i'd like|show me|let me see|i'll take|bring me|get me)\s+(?:a |an |some |the |one )?(.+)/i);
    const lookMatch = rawText.match(/(?:looking for|need|want)\s+(?:a |an |some |the )?(.+)/i);
    const raw = tryMatch?.[1]?.trim().replace(/[.!?]$/, '') || lookMatch?.[1]?.trim().replace(/[.!?]$/, '') || null;
    // Only keep candidate if it isn't itself a pronoun fragment
    if (raw && !PRONOUN_FRAGMENTS.test(raw.trim())) {
      candidate = raw;
    }
  }

  // ── STEP 3: Validate the candidate matches the action category ───────────
  // If action says food but candidate looks like a drink name, override to context.
  if (candidate && isFoodAction && KNOWN_DRINK_PATTERN.test(candidate)) {
    candidate = null; // force context resolution
  }
  if (candidate && isDrinkAction && KNOWN_FOOD_PATTERN.test(candidate)) {
    candidate = null;
  }

  // ── STEP 4: If no valid candidate, resolve from conversation context ─────
  if (!candidate) {
    const preferCategory = isFoodAction ? 'food' : isDrinkAction ? 'drink' : null;
    const contextItem = resolveActiveItemFromContext(messages, preferCategory);
    if (contextItem) {
      console.log(`[Scene] Pronoun resolved: "${rawText}" → "${contextItem.label}" (from context, category=${contextItem.category})`);
      const resolvedCategory = actionCategory || contextItem.category;
      return { label: contextItem.label, category: resolvedCategory };
    }
    // No context at all — use category-correct generic fallback
    if (isFoodAction)     return { label: 'burger',    category: 'food' };
    if (isDrinkAction)    return { label: 'cocktail',  category: 'drink' };
    if (isClothingAction) return { label: 'clothing item', category: 'clothing' };
    return { label: rawText.replace(/[.!?]$/, '').trim().slice(0, 60) || 'item', category: 'drink' };
  }

  // ── STEP 5: Derive category from candidate if not action-locked ──────────
  let category = actionCategory;
  if (!category) {
    if (KNOWN_DRINK_PATTERN.test(candidate)) category = 'drink';
    else if (KNOWN_FOOD_PATTERN.test(candidate)) category = 'food';
    else category = 'drink'; // default for food/drink venues
  }

  return { label: candidate.slice(0, 60), category };
}

/**
 * Detect if a user message is a purchase confirmation.
 */
export function isPurchaseIntent(text) {
  const t = text.toLowerCase().trim();
  if (/(?:i'll (?:have|take|get)|can i (?:get|have|order)|give me|order\b|i want|i'd like|bring me|get me)\s+(?:a |an |some |the )?.+/.test(t)) return true;
  if (/(?:that(?:'s| is| will be)|it(?:'s| is))\s+\$?\d+|\$\d+\s+(?:for|per)/.test(t)) return true;
  if (WHOLE_MSG_PRONOUN.test(t)) return true;
  return false;
}