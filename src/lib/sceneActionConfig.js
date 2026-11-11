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
  // ── HOUSEHOLD ACTIVITIES ──
  // Each one depicts the activity actually in progress — never a passive standing pose.
  home_workout:    (loc, who) => who.includes("empty")
    ? `Home workout area with a yoga mat, dumbbells and a resistance band laid out, no people, photorealistic.`
    : `${who} actively working out in the home — mid-rep strength training with dumbbells, bodyweight squats or push-ups on a mat, athletic effort, focused expression, exercise clothing, photorealistic. No other people.`,
  home_clean_up:   (loc, who) => who.includes("empty")
    ? `Tidy home interior with cleaning supplies and folded cloths, no people, photorealistic.`
    : `${who} actively cleaning the home — sweeping or vacuuming the floor, wiping down a surface, holding cleaning supplies, mid-motion, sleeves pushed up, photorealistic. No other people.`,
  home_dishes:     (loc, who) => who.includes("empty")
    ? `Kitchen sink filled with soapy water and clean plates on the drying rack, no people, photorealistic.`
    : `${who} standing at the kitchen sink washing dishes, hands in soapy water, plates on the drying rack, warm kitchen light, photorealistic. No other people.`,
  home_brush_teeth:(loc, who) => who.includes("empty")
    ? `Bathroom sink with a toothbrush and toothpaste, mirror, no people, photorealistic.`
    : `${who} brushing their teeth at the bathroom sink, toothbrush in mouth, toothpaste foam, mirror reflection, photorealistic. No other people.`,
  home_shower:     (loc, who) => who.includes("empty")
    ? `Steamy bathroom with the shower running behind glass, no people, photorealistic.`
    : `${who} taking a shower, water running, steam filling the bathroom, wet hair, shoulders visible above a towel-wrapped or frosted-glass frame, tasteful and non-explicit, photorealistic. No other people.`,
  home_make_bed:   (loc, who) => who.includes("empty")
    ? `Neatly made bed in a sunlit bedroom, folded duvet and arranged pillows, no people, photorealistic.`
    : `${who} making the bed in the bedroom — smoothing the duvet, tucking sheets, fluffing a pillow, morning light, photorealistic. No other people.`,
};

// ── HOUSEHOLD ACTIVITIES ──
// Ids whose image must show the person actually doing the thing. The user is named in
// the prompt when they are in the scene, since the participant list already includes them.
export const HOUSEHOLD_ACTION_IDS = [
  "home_workout", "home_clean_up", "home_dishes",
  "home_brush_teeth", "home_shower", "home_make_bed",
];

// ── DIRECTED INTERACTION PROMPTS ──────────────────────────────────────────────
// Kiss / Flirt With / Argue With are interactions BETWEEN two specific people, so the
// prompt always names both of them and states the body language plainly. A directed
// action must never render as one person alone, a crowd, or affectionate body language
// during an argument.
export function buildDirectedActionPrompt({ actionId, actorName, targetName, locationName }) {
  const actor = actorName || "the person";
  const target = targetName || "the other person";
  const loc = locationName || "this place";
  const together = `BOTH ${actor} and ${target} are clearly visible in frame — this is a moment between the two of them, never one person standing alone. `;

  switch (actionId) {
    case "kiss":
      return `${actor} kissing ${target} at ${loc}, their lips meeting, close romantic embrace, hands on a cheek and around a waist, eyes closed, intimate and tasteful, non-explicit, photorealistic. ${together}No other people.`;
    case "flirt_with":
      return `${actor} flirting with ${target} at ${loc}, leaning in close, playful smile, teasing eye contact, a light touch on the arm, warm chemistry between them, photorealistic. ${together}No other people.`;
    case "argue_with":
      return `${actor} arguing with ${target} at ${loc}, standing face to face in a tense confrontation, hard expressions, raised hands mid-gesture, defensive posture, clearly NOT affectionate, dramatic lighting, photorealistic. ${together}No other people.`;
    default:
      return `${actor} and ${target} at ${loc}, photorealistic. ${together}`;
  }
}

// Re-export from the authoritative adapter
export { getSceneInteractions } from './sceneInteractionEngine.js';

/**
 * getLocationActions — compatibility shim for any legacy callers.
 * Delegates to generateLocationActions from the authoritative source.
 */
export { generateLocationActions as getLocationActions } from './actionGenerator.js';