/**
 * sceneActionConfig.js — IMAGE PROMPT METADATA ONLY
 *
 * This file is NOT an activity catalog.
 * All Scene activities are defined in actionGenerator.js.
 *
 * This file provides only:
 *   ACTION_IMAGE_PROMPTS — image generation templates keyed by action ID
 *   getSceneInteractions — re-export from the authoritative adapter
 *   getLocationActions   — compatibility shim (delegates to actionGenerator)
 */

// ── IMAGE PROMPT GENERATORS ───────────────────────────────────────────────────
// Called by handleAction in Scene.jsx when an action should trigger an image update.
// Functions accept (locationName, presentNames) and return a prompt string.
export const ACTION_IMAGE_PROMPTS = {
  sit:             (loc, who) => who.includes("empty") ? `Empty couch in a ${loc} living room, warm lighting, photorealistic. No people.` : `${who} sitting comfortably on the couch in a ${loc} interior, relaxed posture, photorealistic. No other people.`,
  relax:           (loc, who) => who.includes("empty") ? `Cozy ${loc} living room, soft lighting, empty and peaceful, photorealistic. No people.` : `${who} relaxing casually in a ${loc} living room, laid-back atmosphere, photorealistic. No other people.`,
  eat:             (loc, who) => who.includes("empty") ? `Homemade meal on a table in a cozy kitchen, no people, photorealistic.` : `${who} eating a meal at the kitchen table in a ${loc}, photorealistic. No strangers.`,
  drink:           (loc, who) => who.includes("empty") ? `Glass of water or juice on a kitchen counter, cozy home, no people, photorealistic.` : `${who} holding a refreshing drink in a ${loc} kitchen, close-up, photorealistic. No other people.`,
  order_takeout:   (loc, who) => who.includes("empty") ? `Takeout food containers on a coffee table in a cozy home, no people, photorealistic.` : `Takeout food containers being opened on a coffee table, ${who} present, cozy home, photorealistic. No strangers.`,
  lay_down:        (loc, who) => who.includes("empty") ? `Empty couch or bed in a ${loc}, cozy and peaceful, no people, photorealistic.` : `${who} lying down relaxing on a couch or bed in a ${loc}, comfortable, photorealistic. No other people.`,
  talk:            (loc, who) => who.includes("empty") ? `Quiet ${loc} living room, empty, warm lighting, photorealistic. No people.` : `${who} having a conversation in a ${loc} living room, natural and warm, photorealistic. No strangers or extra people.`,
  dance:           (loc, who) => `${who} dancing on a nightclub dance floor, energetic, bokeh lights, photorealistic`,
  dance_with_stranger: (loc, who) => `People dancing on a club dance floor, energetic lights, diverse crowd, photorealistic`,
  buy_round:       (loc, who) => `Glasses of beer and cocktails on a bar counter, bokeh lights, photorealistic`,
  bottle_service:  (loc, who) => `Champagne bottle with sparkler at a VIP nightclub table, bokeh lights, photorealistic`,
  flirt:           (loc, who) => `${who} laughing and leaning toward each other in a ${loc}, flirty chemistry, photorealistic. No strangers.`,
  argue:           (loc, who) => `${who} with tense confrontational body language at a ${loc}, dramatic, photorealistic. No strangers.`,
  workout:         (loc, who) => `${who} working out with gym equipment, athletic energy, photorealistic`,
  lift:            (loc, who) => `${who} lifting weights at the gym, athletic, photorealistic`,
  cardio:          (loc, who) => `${who} on a treadmill or doing cardio at a gym, energetic, photorealistic`,
  spot:            (loc, who) => `${who} spotting someone on the bench press at the gym, photorealistic`,
  challenge:       (loc, who) => `${who} in a friendly fitness challenge at the gym, competitive energy, photorealistic`,
  class:           (loc, who) => `Group fitness class at a gym studio, energetic instructor, photorealistic`,
  order:           (loc, who) => `Beautifully plated restaurant meal arriving at a table, warm lighting, photorealistic`,
  order_breakfast: (loc, who) => `Classic breakfast plate — eggs, toast, coffee — on a diner table, warm lighting, photorealistic`,
  drinks:          (loc, who) => `Colorful cocktails or drinks on a restaurant table, ${loc} setting, photorealistic`,
  order_drink:     (loc, who) => `Bartender preparing a cocktail at a bar, bokeh lighting, photorealistic`,
  dessert:         (loc, who) => `Decadent dessert on a plate — chocolate cake or tiramisu — restaurant setting, photorealistic`,
  pie:             (loc, who) => `Slice of pie on a diner plate with a fork, warm cafe lighting, photorealistic`,
  milkshake:       (loc, who) => `Thick milkshake with whipped cream and straw on a diner counter, photorealistic`,
  check:           (loc, who) => `Restaurant bill on a table, relaxed end-of-meal atmosphere, photorealistic`,
  order_late_night:(loc, who) => `Comfort food — pasta, mac and cheese, or soup — on a diner table, late-night atmosphere, photorealistic`,
  order_coffee:    (loc, who) => `Latte art in a ceramic cup on a coffee shop counter, soft lighting, photorealistic`,
  order_pastry:    (loc, who) => `Fresh croissant or pastry on a cafe plate, warm cafe lighting, photorealistic`,
  walk:            (loc, who) => `${who} walking outdoors, relaxed stroll, natural surroundings, photorealistic`,
  picnic:          (loc, who) => `${who} at a picnic in a park, blanket and food spread out, sunny day, photorealistic`,
  watch_sunset:    (loc, who) => `Beautiful park sunset, golden hour light, silhouette of trees, photorealistic`,
  sit_outside:     (loc, who) => `${who} sitting outside on a bench or steps, enjoying fresh air, photorealistic`,
  sit_bench:       (loc, who) => `Park bench in dappled sunlight, peaceful outdoor setting, photorealistic`,
  buy:             (loc, who) => `Items being purchased at a checkout counter, ${loc} setting, photorealistic`,
  checkout:        (loc, who) => `Grocery items at a checkout register, photorealistic`,
  retail_checkout: (loc, who) => `Retail store checkout counter, items being bagged, photorealistic`,
  clothing_buy:    (loc, who) => `Boutique shopping bag with tissue paper, stylish retail setting, photorealistic`,
  try_on:          (loc, who) => `${who} in a fitting room trying on clothes, boutique setting, photorealistic`,
  study:           (loc, who) => `${who} studying at a desk with books and notes spread out, focused, photorealistic`,
  cook:            (loc, who) => `${who} cooking in a kitchen, warm domestic lighting, photorealistic`,
  watch_tv:        (loc, who) => `${who} relaxing on a couch watching TV in a cozy living room, photorealistic`,
  order_drink_bar: (loc, who) => `Close-up of two cocktails being raised in a toast at a bar, photorealistic`,
};

// Re-export from the authoritative adapter
export { getSceneInteractions } from './sceneInteractionEngine.js';

/**
 * getLocationActions — compatibility shim for any legacy callers.
 * Delegates to generateLocationActions from the authoritative source.
 */
export { generateLocationActions as getLocationActions } from './actionGenerator.js';