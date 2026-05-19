/**
 * sceneItemResolver.js
 *
 * Pronoun resolution and item identity parsing for Scene purchase flows.
 *
 * Fixes the "it now" bug:
 * - "Can I get it now?" with active context "Long Beach Iced Tea" → "Long Beach Iced Tea"
 * - Pronoun fragments ("it", "that", "it now") never become item names
 * - Context is resolved from the last 8 messages
 */

// Conversational modifiers — never valid as standalone purchasable item names
const PRONOUN_FRAGMENTS = /^(it|that|this|one|the one|it now|that one|this one|right now|please|can i|i guess|sure|okay|ok|yes|yep|yeah|now|go ahead|let's go|let me|make it|give it|get it|bring it)\b/i;

// Named drink/food items to detect in conversation history
const KNOWN_ITEM_PATTERN = /\b(Long Beach Iced Tea|Long Island Iced Tea|Margarita|Mojito|Cosmopolitan|Old Fashioned|Whiskey Sour|Gin and Tonic|Vodka Soda|Rum and Coke|Sangria|Moscow Mule|Daiquiri|Martini|Pina Colada|Mai Tai|Negroni|Aperol Spritz|Lager|IPA|Pale Ale|Stout|Cider|Red Wine|White Wine|Champagne|Prosecco|Tequila Shot|Scotch|Bourbon|Brandy|Whiskey|Vodka|Rum|Gin|Cheeseburger|Burger|Sandwich|Pizza|Tacos|Salad|Wings|Fries|Nachos|Pasta|Steak|Chicken|Fish|Shrimp|Lobster|Sushi|Ramen)\b/i;

/**
 * Scan the last N messages for an established named food/drink item.
 * Returns the item name or null if none found.
 */
export function resolveActiveItemFromContext(messages) {
  const recentForContext = (messages || []).slice(-8);
  for (let i = recentForContext.length - 1; i >= 0; i--) {
    const m = recentForContext[i];
    if (!m.content) continue;
    const itemMatch = m.content.match(KNOWN_ITEM_PATTERN);
    if (itemMatch?.[1]) return itemMatch[1];
  }
  return null;
}

/**
 * Extract a valid item label from a user message.
 * Resolves pronoun references ("Can I get it now?") to the active context item.
 * Never returns a raw pronoun fragment as an item name.
 *
 * @param {string} rawText - The user's raw message text
 * @param {Array}  messages - Recent scene messages for context resolution
 * @param {boolean} isFoodDrinkContext - True if in a food/drink venue
 * @returns {string} Resolved item label
 */
export function extractSceneItemLabel(rawText, messages, isFoodDrinkContext = false) {
  // Attempt to extract a candidate noun phrase from the message
  const tryMatch = rawText.match(/(?:i'll (?:have|take|get|order)|can i (?:get|have|order)|give me|i want|i'd like|show me|let me see|i'll take|bring me|get me)\s+(?:a |an |some |the |one )?(.+)/i);
  const lookMatch = rawText.match(/(?:looking for|need|want)\s+(?:a |an |some |the )?(.+)/i);
  const candidate = tryMatch?.[1]?.trim().replace(/[.!?]$/, '') || lookMatch?.[1]?.trim().replace(/[.!?]$/, '') || null;

  // Reject pronoun-only fragments — resolve from conversation context instead
  if (!candidate || PRONOUN_FRAGMENTS.test(candidate.trim())) {
    const contextItem = resolveActiveItemFromContext(messages);
    if (contextItem) {
      console.log(`[Scene] Pronoun resolved: "${rawText}" → "${contextItem}" (from context)`);
      return contextItem;
    }
    // Generic category fallback if no context established
    return isFoodDrinkContext ? "cocktail" : rawText.replace(/[.!?]$/, '').trim().slice(0, 60);
  }

  return candidate.slice(0, 60);
}

/**
 * Detect if a user message is a purchase confirmation (pronoun-only or explicit order phrase).
 * Returns true when the message should trigger a product card at a food/drink venue.
 */
export function isPurchaseIntent(text) {
  const t = text.toLowerCase().trim();
  // Explicit order phrases
  if (/(?:i'll (?:have|take|get)|can i (?:get|have|order)|give me|order\b|i want|i'd like|bring me|get me)\s+(?:a |an |some |the )?.+/.test(t)) return true;
  if (/(?:that(?:'s| is| will be)|it(?:'s| is))\s+\$?\d+|\$\d+\s+(?:for|per)/.test(t)) return true;
  // Pronoun-only confirmations — these also count as purchase intent when item context exists
  if (/^(it now|yes please|sure|go ahead|i'll take it|give it to me|i want it now|make it|bring it|get it now)\b/i.test(t)) return true;
  return false;
}