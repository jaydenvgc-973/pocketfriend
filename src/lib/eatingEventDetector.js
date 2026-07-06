/**
 * eatingEventDetector.js
 *
 * Structured eating-event detector with temporal context classification.
 *
 * Distinguishes actual present/completed food consumption from non-consumption mentions.
 * Does NOT use simple keyword matching — uses ordered pattern analysis.
 *
 * Output:
 *   {
 *     isEating: boolean,
 *     character_id: string,
 *     food_consumed: string | null,
 *     amount_category: "bite" | "snack" | "meal" | "full_meal",
 *     confidence: number (0-1),
 *     evidence_text: string,
 *     event_time_context: "current_action" | "past_reference" | "future_intent" | "negated" | "hypothetical" | "possession_only"
 *   }
 *
 * Hunger may only update when event_time_context is "current_action" and confidence >= 0.7.
 * Past, future, hypothetical, negated, or possession-only mentions must NOT update hunger.
 */

// ── HARD-BLOCKING PATTERNS ─────────────────────────────────────────────────
// Checked FIRST. If ANY match, eating is NOT a current action — no hunger update.
// These always override consumption patterns.

const PAST_PATTERNS = [
  /\b(ate|had|eaten|finished eating|fed)\s+(earlier|before|yesterday|earlier today|already|last night|this morning|the other day)\b/i,
  /\b(already ate|already eaten|already had|already finished)\b/i,
  /\b(remember when|earlier today|before work|before i came|before you came|a while ago)\b[^.]*\b(ate|eat|had|food|fed)\b/i,
  /\b(i ate|we ate|i had)\s+(yesterday|earlier|before|last)\b/i,
  /\b(had\s+.+\s+for\s+(breakfast|lunch|dinner)\s+(yesterday|earlier|before))\b/i,
];

const NEGATED_PATTERNS = [
  /\b(haven't|didn't|don't|won't|not|cannot|can't)\s+(eat|eating|ate|had|have|hungry)\b/i,
  /\b(too tired to eat|not hungry|don't want to eat|refused|declined|not eating|not feeling hungry)\b/i,
  /\b(no thanks|not right now|can't eat|not hungry|still hungry|still starving)\b/i,
];

const FUTURE_PATTERNS = [
  /\b(will eat|going to eat|gonna eat|should eat|need to eat|want to eat|have to eat|ought to eat|i'll eat|i will eat|planning to eat)\b/i,
  /\b(eat later|eat soon|eat after|eat then|eat tomorrow)\b/i,
  /\b(saving|save)\s+(this|it|the)\s+\w+\s+(for later|for tomorrow)\b/i,
  /\b(for someone else|for him|for her|for them)\b/i,
];

const HYPOTHETICAL_PATTERNS = [
  /\b(would|could|might)\b[^.]*\b(eat|ate|eating|food)\b/i,
  /\b(should have|could have|would have)\s+(eaten|ate)\b/i,
  /\b(if i (eat|ate)|if (he|she|they) (eat|ate))\b/i,
];

// ── CONSUMPTION PATTERNS ───────────────────────────────────────────────────
// Checked SECOND (only if no hard-blocking pattern matched).
// If ANY match → current_action.

const CONSUMPTION_PATTERNS = [
  // Taking bites
  /\b(takes?|took|taking|take)\s+(a|another|some|the|a few)?\s*(bite|bites)\b/i,
  /\b(had a bite|had some bites|had a few bites|took a few bites|took another bite|took a bite)\b/i,

  // Present continuous eating
  /\b(is eating|are eating|am eating|'s eating|'m eating|eating the|eating a|eating some|eating his|eating her|eating their|eating)\b/i,
  /\b(still eating|keeps? eating|continues? eating|started eating)\b/i,

  // Completion — eating verbs with objects
  /\b(finishing|finished|finish|finishes)\s+(the|my|his|her|their|this|that|all|every)?\s*(food|tacos?|meal|plate|taco|pizza|burger|sandwich|spreadsheet|spreedsheets?)\b/i,
  /\b(ate the|ate all|ate it|ate them|ate every|ate some|ate his|ate her|ate their|ate my|ate this|ate that|ate three|ate two|ate four|ate a few)\s*(tacos?|pizza|burgers?|sandwiches?|plates?|meals?|food)?\b/i,
  /\b(polished off|devoured|consumed the|finished off|ate everything|ate it all)\b/i,

  // Being fed
  /\b(fed him|fed her|fed them|fed me|being fed|i'm fed|im fed|i am fed|he's fed|she's fed|they're fed|was fed|were fed)\b/i,
  /\b(feed him|feed her|feed them|feed me|feeds?|feeding him|feeding her|feeding them|feeding me)\b/i,
  /\b(fed)\s+([A-Z][a-z]+)/i, // "fed Ethan" (fed followed by capitalized name)

  // Acceptance + eating
  /\b(accepts?|accepted).*(bite|eat|food|taco).*(ate|eating|bite|took)\b/i,

  // General present-tense eating
  /\b(eats the|eats a|eats some|eats his|eats her|eats their)\b/i,
  /\b(had the tacos|had the food|had the meal|had a meal|had breakfast|had lunch|had dinner)\b/i,
  /\b(i'm full|im full|i am full|stuffed|full now|that hit the spot)\b/i,

  // Active consumption verbs
  /\b(chewing|swallowing|munching|nibbling|scarfing|stuffing|gobbling)\b/i,
];

// ── POSSESSION-ONLY PATTERNS ───────────────────────────────────────────────
// Checked LAST (only if no hard-blocking AND no consumption matched).
// Indicates food exists/arrived but was NOT consumed.

const POSSESSION_PATTERNS = [
  /\b(ordered|got|picked up)\s+(food|tacos|pizza|meal|takeout|burgers|sandwiches)\b/i,
  /\b(food|tacos|pizza|meal|order)\s+(arrived|is here|came|got here|on the table|on the way)\b/i,
  /\b(there (are|'s))\s+(tacos|food|pizza|burgers)\s+(on the table|here|over there)\b/i,
];

// ── FOOD KEYWORDS (for extracting food_consumed) ──────────────────────────
const FOOD_KEYWORDS = [
  'tacos', 'taco', 'pizza', 'burger', 'burgers', 'sandwich', 'sandwiches',
  'meal', 'food', 'breakfast', 'lunch', 'dinner', 'snack', 'dessert',
  'pie', 'milkshake', 'shake', 'drink', 'coffee', 'beer', 'wine',
  'cake', 'cookie', 'chips', 'fries', 'noodles', 'pasta', 'rice',
  'chicken', 'beef', 'fish', 'salad', 'soup', 'steak',
  'nachos', 'burrito', 'quesadilla', 'sushi', 'ramen', 'curry',
  'tacos', 'bottle service', 'cocktail', 'margarita',
];

function extractFoodConsumed(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const food of FOOD_KEYWORDS) {
    if (lower.includes(food)) return food;
  }
  return 'food';
}

function estimateAmount(text) {
  if (!text) return 'meal';
  const lower = text.toLowerCase();
  if (/\b(bite|bites|nibble|sip|taste)\b/.test(lower)) return 'bite';
  if (/\b(snack|small|little|handful|chip|cracker|drink|shot)\b/.test(lower)) return 'snack';
  if (/\b(large|feast|full meal|big meal|all three|all of|everything|whole|three tacos|all three tacos)\b/.test(lower)) return 'full_meal';
  return 'meal';
}

/**
 * Check hard-blocking patterns (past, negated, future, hypothetical).
 * Returns { context, evidence } if any match, or null.
 */
function checkHardBlockingPatterns(text) {
  if (!text) return null;

  for (const pattern of PAST_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { context: 'past_reference', evidence: match[0] };
  }
  for (const pattern of NEGATED_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { context: 'negated', evidence: match[0] };
  }
  for (const pattern of FUTURE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { context: 'future_intent', evidence: match[0] };
  }
  for (const pattern of HYPOTHETICAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { context: 'hypothetical', evidence: match[0] };
  }
  return null;
}

/**
 * Check consumption patterns.
 * Returns { evidence } if any match, or null.
 */
function checkConsumptionPatterns(text) {
  if (!text) return null;
  for (const pattern of CONSUMPTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { evidence: match[0] };
  }
  return null;
}

/**
 * Check possession-only patterns.
 * Returns { evidence } if any match, or null.
 */
function checkPossessionPatterns(text) {
  if (!text) return null;
  for (const pattern of POSSESSION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { evidence: match[0] };
  }
  return null;
}

/**
 * Narrative consumption patterns — third-person feeding/eating in user messages.
 * Only matches third-person narrative (he/she/they/name + feeding verb),
 * NEVER first-person "I ate" (which is the user talking about themselves).
 */
const NARRATIVE_CONSUMPTION_PATTERNS = [
  /\b(fed him|fed her|fed them|fed me|feeds?|feeding him|feeding her|feeding them|feeding me)\b/i,
  /\b(fed)\s+([A-Z][a-z]+)/i, // "fed Ethan"
  /\b(he|she|they)\s+(eats|is eating|takes a bite|took a bite|finishes|finished|devoured|consumed|started eating)\b/i,
  /\b([A-Z][a-z]+)\s+(eats|is eating|takes a bite|took a bite|finishes|finished|devoured|consumed|started eating)\b/i,
];

function checkNarrativeConsumptionPatterns(text) {
  if (!text) return null;
  for (const pattern of NARRATIVE_CONSUMPTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { evidence: match[0] };
  }
  return null;
}

/**
 * Detect eating event from chat dialogue/narrative.
 *
 * Pipeline:
 *   1. Hard-blocking patterns checked on CHARACTER RESPONSE only (not user message).
 *      User saying "you should eat" must not block the character's actual eating.
 *   2. Consumption patterns checked on CHARACTER RESPONSE first.
 *   3. If char response has no consumption, check NARRATIVE consumption in user message
 *      (third-person feeding: "Jayden fed Ethan the tacos").
 *   4. Possession-only patterns checked on CHARACTER RESPONSE.
 *   5. Neither → null (no eating detected)
 *
 * @param {Object} params
 * @param {string} params.userMessage - The user's message text
 * @param {string} params.characterResponse - The character's response text
 * @param {string} params.characterId - Character ID
 * @param {string} params.characterName - Character name
 * @param {string} [params.locationName] - Optional location name
 * @returns {Object|null} Structured eating event or null
 */
export function detectEatingEvent({ userMessage, characterResponse, characterId, characterName, locationName }) {
  if (!characterId) return null;

  const charText = (characterResponse || '').trim();
  const userText = (userMessage || '').trim();
  if (!charText && !userText) return null;

  // Step 1: Hard-blocking patterns on CHARACTER RESPONSE only
  // (User saying "you should eat" is a suggestion, not the character's future intent)
  const hardBlock = checkHardBlockingPatterns(charText);
  if (hardBlock) {
    return {
      isEating: false,
      character_id: characterId,
      food_consumed: extractFoodConsumed(charText || userText),
      amount_category: estimateAmount(charText || userText),
      confidence: 0.9,
      evidence_text: hardBlock.evidence,
      event_time_context: hardBlock.context,
    };
  }

  // Step 2: Consumption patterns on CHARACTER RESPONSE
  const charConsumption = checkConsumptionPatterns(charText);
  if (charConsumption) {
    return {
      isEating: true,
      character_id: characterId,
      food_consumed: extractFoodConsumed(charText),
      amount_category: estimateAmount(charText),
      confidence: 0.8,
      evidence_text: charConsumption.evidence,
      event_time_context: 'current_action',
    };
  }

  // Step 3: Narrative consumption in USER MESSAGE (third-person feeding)
  // Catches: "Jayden fed Ethan the tacos", "Jayden feed him all three of the taco"
  const narrativeConsumption = checkNarrativeConsumptionPatterns(userText);
  if (narrativeConsumption) {
    return {
      isEating: true,
      character_id: characterId,
      food_consumed: extractFoodConsumed(userText),
      amount_category: estimateAmount(userText),
      confidence: 0.8,
      evidence_text: narrativeConsumption.evidence,
      event_time_context: 'current_action',
    };
  }

  // Step 4: Possession-only on CHARACTER RESPONSE
  const possession = checkPossessionPatterns(charText);
  if (possession) {
    return {
      isEating: false,
      character_id: characterId,
      food_consumed: extractFoodConsumed(charText),
      amount_category: estimateAmount(charText),
      confidence: 0.75,
      evidence_text: possession.evidence,
      event_time_context: 'possession_only',
    };
  }

  // Step 5: No eating detected
  return null;
}

/**
 * Detect eating event from Scene action.
 * Scene food actions are consumption by default unless explicitly blocked.
 *
 * @param {Object} params
 * @param {string} params.actionId - Scene action ID
 * @param {string} params.actionLabel - Scene action label
 * @param {string} params.characterId - Character ID
 * @param {string} params.characterName - Character name
 * @param {string} [params.locationName] - Optional location name
 * @returns {Object|null} Structured eating event or null
 */
export function detectSceneEatingEvent({ actionId, actionLabel, characterId, characterName, locationName }) {
  if (!characterId || !actionId) return null;

  const labelText = actionLabel || '';

  // Check for explicit non-consumption language in the action label
  const hardBlock = checkHardBlockingPatterns(labelText);
  if (hardBlock) {
    return {
      isEating: false,
      character_id: characterId,
      food_consumed: extractFoodConsumed(labelText),
      amount_category: estimateAmount(labelText),
      confidence: 0.9,
      evidence_text: hardBlock.evidence,
      event_time_context: hardBlock.context,
    };
  }

  // Scene food actions = consumption by default
  return {
    isEating: true,
    character_id: characterId,
    food_consumed: extractFoodConsumed(labelText),
    amount_category: estimateAmount(labelText),
    confidence: 0.85,
    evidence_text: labelText || actionId,
    event_time_context: 'current_action',
  };
}

/**
 * Frontend helper: detect eating from chat and invoke recordEatingEvent if warranted.
 * Only fires when event_time_context is "current_action" and confidence >= 0.7.
 * Non-blocking, fire-and-forget.
 *
 * @param {Object} params
 * @param {string} params.userMessage - User's message
 * @param {string} params.characterResponse - Character's response
 * @param {string} params.characterId - Character ID
 * @param {string} params.characterName - Character name
 * @param {string} [params.locationName] - Location name
 * @returns {Promise<{ recorded: boolean, event: Object|null }>}
 */
export async function detectAndRecordEating({ userMessage, characterResponse, characterId, characterName, locationName }) {
  const event = detectEatingEvent({ userMessage, characterResponse, characterId, characterName, locationName });

  if (!event || !event.isEating || event.event_time_context !== 'current_action' || event.confidence < 0.7) {
    return { recorded: false, event };
  }

  const { base44 } = await import('@/api/base44Client');

  const mealSize = event.amount_category === 'bite'
    ? 'snack'
    : event.amount_category === 'full_meal'
      ? 'large_meal'
      : 'meal';

  const result = await base44.functions.invoke('recordEatingEvent', {
    characterId: event.character_id,
    mealSize,
    foodDescription: `${event.food_consumed} (${event.evidence_text})`,
    locationName,
  });

  return { recorded: true, event, result };
}