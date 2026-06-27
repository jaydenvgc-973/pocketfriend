/**
 * sceneCheckImageTrigger.js
 *
 * Image trigger logic for Scene. Commerce separation is enforced here.
 *
 * ARCHITECTURE:
 * - Product cards appear ONLY when actionCategory AND explicitPrice > 0 are BOTH provided.
 *   This means the action came from an explicitly paid 'purchase' action button with a real price.
 * - Free actions never pass actionCategory, so they never trigger product cards.
 * - Typed messages NEVER trigger product cards or balance deductions. No purchase intent detection.
 *   Typed text may only trigger a focused scene IMAGE (e.g. "show me the menu").
 * - No fallback pricing. No random pricing. No invented pricing.
 *   If explicitPrice is missing or zero, no product card spawns.
 * - Government offices: no product cards, only focused images.
 *
 * REMOVED:
 * - PRICE_RANGES (fallback/random pricing) — gone
 * - resolveVenuePurchaseCategory — gone
 * - isPurchaseIntent typed-message detection — gone
 * - Category-based auto-purchase — gone
 */

import { extractSceneItemLabel } from './sceneItemResolver.js';

/**
 * checkImageTrigger
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string|null} params.actionImagePrompt    — triggers focused image, no purchase
 * @param {string|null} params.actionCategory       — ONLY set for paid 'purchase' strip actions
 * @param {number|null} params.explicitPrice        — action.cost from paid strip button; must be > 0 for purchase card
 * @param {string|null} params.purchaseSource       — source context (e.g. 'menu', 'inventory', 'store')
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
  purchaseSource = null,
  location,
  messages,
  generateFocusedImage,
  setMessages,
}) {
  // Action-triggered focused image (never a purchase)
  if (actionImagePrompt) {
    generateFocusedImage(actionImagePrompt);
    return;
  }

  const t = text.toLowerCase();

  // Government offices: no product cards ever. Focused images only.
  if (location?.category === 'government') {
    const showMatch = t.match(/(?:show me|look at|can i see|i want to see)\s+(.+)/);
    if (showMatch) generateFocusedImage(`${showMatch[1]} at ${location.name},`);
    return;
  }

  // EXPLICIT PAID PURCHASE ACTION ONLY:
  // Both actionCategory AND explicitPrice > 0 must be present.
  // This is set ONLY by handleAction when action.action_class === 'purchase' && action.cost > 0.
  // Free actions, services, fees, social, navigation, environment, and narrative actions
  // NEVER reach this branch — they always pass actionCategory=null.
  if (actionCategory && explicitPrice != null && Number(explicitPrice) > 0) {
    const resolved = extractSceneItemLabel(text, messages, actionCategory);
    const purchaseType = ['clothing', 'home_goods', 'hardware', 'electronics'].includes(actionCategory)
      ? 'purchase'
      : 'consumable';

    setMessages(prev => [...prev, {
      id: `product_${Date.now()}`,
      sender: 'product',
      price: Number(explicitPrice), // Real price only — never invented
      action_class: 'purchase',
      purchase_source: purchaseSource || 'menu',
      locationName: location.name,
      preview_image_url: null,
      purchase_type: purchaseType,
      item_label: resolved.label,
      item_category: resolved.category,
      timestamp: new Date().toISOString(),
    }]);
    return;
  }

  // TYPED MESSAGE: "show me X" → focused image only, never a purchase
  // No purchase intent detection. No price generation. No product cards from text.
  const showMatch = t.match(/(?:show me|look at|what does|can i see|i want to see)\s+(.+)/);
  if (showMatch) {
    generateFocusedImage(`${showMatch[1]} at ${location.name},`);
  }
}