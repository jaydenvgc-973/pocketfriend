/**
 * sceneCheckImageTrigger.js
 *
 * Venue-aware purchase intent detection and image trigger logic for Scene.
 *
 * Rules:
 * - actionCategory from strip buttons is the authoritative category.
 * - Item must match venue type — no drills at restaurants, no cocktails at clothing stores.
 * - Government offices never spawn retail product cards.
 * - Each venue type has a realistic price range.
 */

import { extractSceneItemLabel, isPurchaseIntent } from './sceneItemResolver.js';

// Price ranges [min, max] by category
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
 * @param {Object} params
 * @param {string} params.text
 * @param {string|null} params.actionImagePrompt
 * @param {string|null} params.actionCategory
 * @param {Object} params.location
 * @param {Array}  params.messages
 * @param {Function} params.generateFocusedImage
 * @param {Function} params.setMessages
 */
export function checkImageTrigger({
  text,
  actionImagePrompt = null,
  actionCategory = null,
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

  const effectiveCategory = resolveVenuePurchaseCategory(location, actionCategory);
  const isActionTriggered = !!actionCategory;
  const isPurchasable = effectiveCategory !== null;

  if (isActionTriggered || (isPurchasable && isPurchaseIntent(text))) {
    const ep = t.match(/\$?(\d+(?:\.\d{1,2})?)/);
    const [pMin, pMax] = PRICE_RANGES[effectiveCategory] || [8, 50];
    const price = ep
      ? Math.min(Math.max(parseInt(ep[1]), pMin), pMax)
      : Math.floor(Math.random() * (pMax - pMin + 1)) + pMin;

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

  // "show me X" — general focused image trigger
  const showMatch = t.match(/(?:show me|look at|what does|can i see|i want to see)\s+(.+)/);
  if (showMatch) {
    generateFocusedImage(`${showMatch[1]} at ${location.name},`);
  }
}