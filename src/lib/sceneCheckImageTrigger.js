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

import { base44 } from '@/api/base44Client';
import { extractSceneItemLabel } from './sceneItemResolver.js';
import { pickMerchandise } from './venueMerchandise.js';
import { EATING_ACTION_IDS } from './sceneActionConfig.js';

/**
 * checkImageTrigger
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string|null} params.actionImagePrompt    — triggers focused image, no purchase
 * @param {string|null} params.actionCategory       — ONLY set for paid 'purchase' strip actions
 * @param {number|null} params.explicitPrice        — action.cost from paid strip button; must be > 0 for purchase card
 * @param {string|null} params.purchaseSource       — source context (e.g. 'menu', 'inventory', 'store')
 * @param {string|string[]|null} params.purchaseMerchandise — the merchandise family (or families) the
 *   selected shopping action sells. When present the offered item comes from the store's own
 *   categories, never from unrelated conversation text.
 * @param {Object} params.location
 * @param {Array}  params.messages
 * @param {Function} params.generateFocusedImage
 * @param {Function} params.setMessages
 */
/**
 * Whether choosing this activity makes an OFFER rather than describing something done:
 * an explicitly priced purchase, or an explicitly free item. These are the activities that
 * must present their product card — whoever is paying, and whether or not the user is
 * physically in the scene.
 */
export function isPurchaseOfferAction(action) {
  if (!action) return false;
  const cost = Number(action.cost) || 0;
  const paid = action.action_class === 'purchase' && cost > 0 && !!action.action_category && action.purchase_source != null;
  const free = !!action.free_offering && !!action.action_category;
  return paid || free;
}

/**
 * An offer chosen while the user is only watching: the activity line, then the same
 * product card the person standing here sees. Nothing is charged, eaten or owned until
 * the card is accepted. The character present is the buyer — their own funds, not the
 * absent user's.
 */
export function presentOfferInWatchedScene({ action, names, actorId, locationName, setMessages, checkImageTrigger, activityBehaviorFor, activityFeedLine }) {
  const cost = Number(action.cost) || 0;
  const isPaid = action.action_class === 'purchase' && cost > 0;
  const behavior = activityBehaviorFor(action);
  // A meal the character actually takes is recognised exactly as it is when the user is
  // present — the same established eating record, never a charge.
  if (EATING_ACTION_IDS.includes(action.id) && actorId) {
    const mealSize = ['buy_round', 'char_buy_round', 'drinks', 'drink'].includes(action.id) ? 'snack' : 'meal';
    base44.functions.invoke('recordEatingEvent', { characterId: actorId, mealSize, foodDescription: action.label, locationName }).catch(() => {});
  }
  setMessages((prev) => [...prev, {
    id: `obs_act_${Date.now()}`,
    sender: "activity",
    content: activityFeedLine({ actionId: action.id, label: action.label, verb: behavior === "immediate" ? (action.past_verb || action.verb) : action.verb, participants: names }),
    emoji: action.emoji,
    is_canon_event: false,
    timestamp: new Date().toISOString(),
  }]);
  checkImageTrigger(`[${action.emoji} ${action.label}]`, null, action.action_category, isPaid ? cost : null, isPaid ? (action.purchase_source || 'menu') : 'complimentary', !isPaid, action.item_kind || null, action.merchandise || null, 'character', actorId);
}

export function checkImageTrigger({
  text,
  actionImagePrompt = null,
  actionCategory = null,
  explicitPrice = null,
  purchaseSource = null,
  isFreeOffering = false,
  purchaseItemKind = null,
  purchaseMerchandise = null,
  // WHO PAYS this offer. The person clicking the interface is not automatically the payer:
  // a character buying their own food pays with their own funds, and a character-paid offer
  // is charged to that character. Carried on the card so Accept charges the right person.
  payerType = null,
  payerCharacterId = null,
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
  // FREE OFFERING: an explicitly free food action (soup kitchen meal, complimentary
  // bar snack). The card appears with no price and no transaction.
  const isPaidPurchase = actionCategory && explicitPrice != null && Number(explicitPrice) > 0;
  if (isPaidPurchase || (isFreeOffering && actionCategory)) {
    // A store purchase offers something the store actually sells. The action carries the
    // merchandise family (or families, for Buy Something); only a venue that sells no
    // known merchandise falls back to the established conversation resolution.
    const merchandise = purchaseMerchandise ? pickMerchandise(purchaseMerchandise) : null;
    const resolved = merchandise
      ? { label: merchandise.label, category: merchandise.category, wearable: merchandise.wearable }
      : extractSceneItemLabel(text, messages, actionCategory, location);
    // Store merchandise always goes through the existing purchase modal, so the payer and
    // the recipient are chosen and a gift never has to be present. Only consumables
    // (food, drink, groceries) keep the direct deduction.
    const purchaseType = purchaseMerchandise
      ? 'purchase'
      : ['clothing', 'home_goods', 'hardware', 'electronics'].includes(actionCategory)
        ? 'purchase'
        : 'consumable';

    setMessages(prev => [...prev, {
      id: `product_${Date.now()}`,
      sender: 'product',
      price: isPaidPurchase ? Number(explicitPrice) : 0, // Real price only — never invented
      is_free: !isPaidPurchase,
      action_class: isPaidPurchase ? 'purchase' : 'free_offering',
      purchase_source: isPaidPurchase ? (purchaseSource || 'menu') : 'complimentary',
      locationName: location.name,
      preview_image_url: null,
      purchase_type: purchaseType,
      // 'outfit' only for an explicit complete-outfit purchase (Buy Outfit); otherwise a
      // single item, which belongs in the closet's Items section.
      item_kind: purchaseItemKind === 'outfit' ? 'outfit' : 'item',
      // Non-wearable merchandise (home goods, records, books…) is purchased, never forced
      // into a closet.
      item_wearable: resolved.wearable !== false,
      item_label: resolved.label,
      item_category: resolved.category,
      // The shopping category this offer came from, kept on the card so Try On and
      // Show me something else stay in the same category and try on the same item.
      item_merchandise: merchandise?.family || null,
      item_merchandise_families: purchaseMerchandise ? [].concat(purchaseMerchandise) : null,
      payer_type: payerType || 'user',
      payer_character_id: payerType === 'character' ? (payerCharacterId || null) : null,
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