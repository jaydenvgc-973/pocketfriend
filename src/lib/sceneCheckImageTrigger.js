/**
 * sceneCheckImageTrigger.js
 *
 * Venue-aware purchase intent detection and image trigger logic for Scene.
 *
 * PURCHASE ARCHITECTURE:
 * - A product card ONLY appears when actionCategory is explicitly set (paid strip action) OR
 *   when the user types a purchase intent at a purchasable venue.
 * - Free strip actions (sit, relax, walk, watch TV, etc.) pass actionCategory=null — NO product card.
 * - explicitPrice = action.cost from a paid strip button — used as-is, NOT randomized.
 * - Missing price on a user-typed purchase falls back to range estimate, never random-fabricated.
 * - Government offices never spawn retail product cards.
 */

import { extractSceneItemLabel, isPurchaseIntent } from './sceneItemResolver.js';

// Price ranges [min, max] by category — ONLY used when no explicit price is provided
const PRICE_RANGES = {
  food:        [8,  35],
  drink:       [6,  22],
  clothing:    [25, 180],
  home_goods:  [15, 250],
  hardware:    [8,  120],
  grocery:     [5,  80],
  pharmacy:    [4,  50],
  electronics: [20, 400],
};

/**
 * Resolve the effective purchase category for a venue.
 * Priority: explicit actionCategory → venue subtype → venue category → null
 */
function resolveVenuePurchaseCategory(location, actionCategory) {
  if (actionCategory) return actionCategory;

  const cat = location?.category;
  const subtypes = (location?.subtype || []).map(s => s.toLowerCase().replace(/\s+/g, '_'));
  const venueIdentity = (location?.venue_identity || '').toLowerCase();
  const venueName = (location?.name || '').toLowerCase();

  if (cat === 'food_drink') return 'food';
  if (cat === 'social')     return 'drink';
  if (cat === 'grocery')    return 'grocery';
  if (cat === 'medical')    return 'pharmacy';

  if (cat === 'business' || cat === 'workplace') {
    if (subtypes.some(s => ['clothing','boutique','apparel','thrift','clothing_store','mall','shoe_store','accessories'].includes(s)) ||
        ['clothing','boutique','apparel','thrift','mall'].some(s => venueIdentity.includes(s) || venueName.includes(s))) return 'clothing';
    if (subtypes.some(s => ['hardware','home_improvement','tools','supply'].includes(s)) ||
        ['hardware','home depot','ace hardware','tools'].some(s => venueName.includes(s))) return 'hardware';
    if (subtypes.some(s => ['home_goods','furniture','decor','housewares'].includes(s)) ||
        ['home goods','ikea','furniture','decor','bed bath'].some(s => venueName.includes(s))) return 'home_goods';
    if (subtypes.some(s => ['pharmacy','drug_store','health'].includes(s)) ||
        ['pharmacy','cvs','walgreens','rite aid','drug store'].some(s => venueName.includes(s))) return 'pharmacy';
    if (subtypes.some(s => ['electronics','tech','computers'].includes(s)) ||
        ['electronics','best buy','apple','tech'].some(s => venueName.includes(s))) return 'electronics';
    if (subtypes.some(s => ['bar','restaurant','cafe','coffee','diner','food','pub','lounge'].includes(s))) return 'food';
    return null; // generic business — no auto-category
  }

  return null; // non-purchasable venue
}

/**
 * Check if a user message or strip action should trigger:
 * - A product card (purchase intent at purchasable venue)
 * - A focused scene image update ("show me X")
 *
 * CRITICAL: actionCategory is ONLY set for explicit paid strip actions.
 * Free actions (sit, relax, watch TV, nap, walk, talk, etc.) always pass actionCategory=null.
 * This ensures no product card ever fires for free activities.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string|null} params.actionImagePrompt
 * @param {string|null} params.actionCategory     — ONLY set for paid actions with action_category defined
 * @param {number|null} params.explicitPrice       — action.cost from paid strip button; use as-is, don't randomize
 * @param {Object} params.location
 * @param {Array}  params.messages
 * @param {Function} params.generateFocusedImage
 * @param {Function} params.setMessages
 */
export function checkImageTrigger({
  text,
  actionImagePrompt = null,
  actionCategory = null,
  explicitPrice = null,
  location,
  messages,
  generateFocusedImage,
  setMessages,
}) {
  if (actionImagePrompt) {
    generateFocusedImage(actionImagePrompt);
    return;
  }

  const t = text.toLowerCase();

  // Government offices: fees/forms only — no retail product cards
  if (location?.category === 'government') {
    const showMatch = t.match(/(?:show me|look at|can i see|i want to see)\s+(.+)/);
    if (showMatch) generateFocusedImage(`${showMatch[1]} at ${location.name},`);
    return;
  }

  // PAID STRIP ACTION: actionCategory is only set when a paid action button was pressed.
  // Use the explicit action cost — never randomize. Spawn product card immediately.
  if (actionCategory) {
    const effectiveCategory = actionCategory;
    const [pMin, pMax] = PRICE_RANGES[effectiveCategory] || [8, 50];
    // explicitPrice = action.cost (set by handleAction) — authoritative, no randomization.
    // Fall back to range midpoint only when no explicit price (should not happen for paid actions).
    const price = (explicitPrice != null && explicitPrice > 0)
      ? explicitPrice
      : Math.round((pMin + pMax) / 2);

    const resolved = extractSceneItemLabel(text, messages, effectiveCategory);
    const purchaseType = ['clothing', 'home_goods', 'hardware', 'electronics'].includes(effectiveCategory)
      ? 'purchase'
      : 'consumable';

    setMessages(prev => [...prev, {
      id: `product_${Date.now()}`,
      sender: 'product',
      price,
      locationName: location.name,
      preview_image_url: null,
      purchase_type: purchaseType,
      item_label: resolved.label,
      item_category: resolved.category,
      timestamp: new Date().toISOString(),
    }]);
    return;
  }

  // USER-TYPED PURCHASE INTENT: only at purchasable venue types (not home, gym, medical, etc.)
  const effectiveCategory = resolveVenuePurchaseCategory(location, null);
  if (effectiveCategory && isPurchaseIntent(text)) {
    const ep = t.match(/\$?(\d+(?:\.\d{1,2})?)/);
    const [pMin, pMax] = PRICE_RANGES[effectiveCategory] || [8, 50];
    // Use explicit price from message text if present; fall back to range midpoint — never random.
    const price = ep
      ? Math.min(Math.max(parseInt(ep[1]), pMin), pMax)
      : Math.round((pMin + pMax) / 2);

    const resolved = extractSceneItemLabel(text, messages, effectiveCategory);
    const purchaseType = ['clothing', 'home_goods', 'hardware', 'electronics'].includes(effectiveCategory)
      ? 'purchase'
      : 'consumable';

    setMessages(prev => [...prev, {
      id: `product_${Date.now()}`,
      sender: 'product',
      price,
      locationName: location.name,
      preview_image_url: null,
      purchase_type: purchaseType,
      item_label: resolved.label,
      item_category: resolved.category,
      timestamp: new Date().toISOString(),
    }]);
    return;
  }

  // "show me X" — general focused image trigger (free, no purchase)
  const showMatch = t.match(/(?:show me|look at|what does|can i see|i want to see)\s+(.+)/);
  if (showMatch) {
    generateFocusedImage(`${showMatch[1]} at ${location.name},`);
  }
}