/**
 * Scene Action Configuration
 * Image prompt generators and action definitions for Scene locations.
 */

// Actions where the image MUST update to reflect the action.
// These are functions that accept (loc, presentNames) where presentNames is a string
// describing who is physically there — to avoid generating random strangers.
export const ACTION_IMAGE_PROMPTS = {
  sit:         (loc, who) => who.includes("empty") ? `Empty couch in a ${loc} living room, warm lighting, photorealistic. No people.` : `${who} sitting comfortably on the couch in a ${loc} interior, relaxed posture, photorealistic. No other people.`,
  relax:       (loc, who) => who.includes("empty") ? `Cozy ${loc} living room, soft lighting, empty and peaceful, photorealistic. No people.` : `${who} relaxing casually in a ${loc} living room, laid-back atmosphere, photorealistic. No other people.`,
  eat:         (loc, who) => who.includes("empty") ? `Homemade meal on a table in a cozy kitchen, food clearly visible, no people, photorealistic.` : `${who} eating a meal at the kitchen table in a ${loc}, photorealistic. No strangers.`,
  drink:       (loc, who) => who.includes("empty") ? `Glass of water or juice on a kitchen counter, cozy home, no people, photorealistic.` : `${who} holding a refreshing drink in a ${loc} kitchen, close-up, photorealistic. No other people.`,
  order_takeout: (loc, who) => who.includes("empty") ? `Takeout food containers on a coffee table in a cozy home, no people, photorealistic.` : `Takeout food containers being opened on a coffee table, ${who} present, cozy home, photorealistic. No strangers.`,
  lay_down:    (loc, who) => who.includes("empty") ? `Empty couch or bed in a ${loc}, cozy and peaceful, no people, photorealistic.` : `${who} lying down relaxing on a couch or bed in a ${loc}, comfortable, photorealistic. No other people.`,
  talk:        (loc, who) => who.includes("empty") ? `Quiet ${loc} living room, empty, warm lighting, photorealistic. No people.` : `${who} having a conversation in a ${loc} living room, natural and warm, photorealistic. No strangers or extra people.`,
  dance:       (loc, who) => `${who} dancing on a nightclub dance floor, energetic, bokeh lights, photorealistic`,
  buy_round:   (loc, who) => `Glasses of beer and cocktails on a bar counter, bokeh lights, photorealistic`,
  flirt:       (loc, who) => `${who} laughing and leaning toward each other in a ${loc}, flirty chemistry, photorealistic. No strangers.`,
  argue:       (loc, who) => `${who} with tense confrontational body language at a ${loc}, dramatic, photorealistic. No strangers.`,
  workout:     (loc, who) => `${who} working out with gym equipment, athletic energy, photorealistic`,
  spot:        (loc, who) => `${who} spotting someone on the bench press at the gym, photorealistic`,
  challenge:   (loc, who) => `${who} in a friendly fitness challenge at the gym, competitive energy, photorealistic`,
  order:       (loc, who) => `Beautifully plated restaurant meal arriving at a table, warm lighting, photorealistic`,
  drinks:      (loc, who) => `Colorful cocktails or drinks on a restaurant table, ${loc} setting, photorealistic`,
  check:       (loc, who) => `Restaurant bill on a table, relaxed end-of-meal atmosphere, photorealistic`,
  walk:        (loc, who) => `${who} walking outdoors, relaxed stroll, natural surroundings, photorealistic`,
  sit_outside: (loc, who) => `${who} sitting outside on a bench or steps, enjoying fresh air, photorealistic`,
  buy:         (loc, who) => `Items being purchased at a checkout counter, ${loc} setting, photorealistic`,
  checkout:    (loc, who) => `Grocery items at a checkout register, photorealistic`,
  study:       (loc, who) => `${who} studying at a desk with books and notes spread out, focused, photorealistic`,
};

// Re-export from sceneInteractionEngine for backward compatibility
export { getSceneInteractions } from './sceneInteractionEngine.js';

export function getLocationActions(category) {
  const base = {
    home: [
      { id: "sit", label: "Sit down", emoji: "🛋️", cost: 0, type: "neutral" },
      { id: "eat", label: "Eat something", emoji: "🍽️", cost: 0, type: "positive" },
      { id: "drink", label: "Get a drink", emoji: "🥤", cost: 0, type: "positive" },
      { id: "relax", label: "Just relax", emoji: "😌", cost: 0, type: "positive" },
      { id: "talk", label: "Start talking", emoji: "💬", cost: 0, type: "neutral" },
      { id: "order_takeout", label: "Order takeout", emoji: "🥡", cost: 20, type: "positive", payer: "user" },
    ],
    social: [
      { id: "buy_round", label: "Buy a round", emoji: "🥂", cost: 25, type: "positive", payer: "user" },
      { id: "char_buy_round", label: "Let them buy", emoji: "🎁", cost: 25, type: "positive", payer: "character" },
      { id: "flirt", label: "Flirt a little", emoji: "😏", cost: 0, type: "positive" },
      { id: "dance", label: "Hit the floor", emoji: "🕺", cost: 0, type: "positive" },
      { id: "argue", label: "Start drama", emoji: "🔥", cost: 0, type: "negative" },
    ],
    gym: [
      { id: "workout", label: "Work out together", emoji: "💪", cost: 0, type: "positive" },
      { id: "spot", label: "Spot them", emoji: "🏋️", cost: 0, type: "positive" },
      { id: "challenge", label: "Challenge them", emoji: "🏆", cost: 0, type: "positive" },
      { id: "observe", label: "Watch quietly", emoji: "👀", cost: 0, type: "neutral" },
    ],
    food_drink: [
      { id: "order", label: "Order food", emoji: "🍔", cost: 18, type: "positive", payer: "user" },
      { id: "drinks", label: "Get drinks", emoji: "🍹", cost: 12, type: "positive", payer: "user" },
      { id: "char_pays", label: "Let them cover it", emoji: "💳", cost: 30, type: "positive", payer: "character" },
      { id: "talk", label: "Good conversation", emoji: "💬", cost: 0, type: "neutral" },
      { id: "check", label: "Pick up the check", emoji: "🧾", cost: 40, type: "positive", payer: "user" },
    ],
    outdoor: [
      { id: "walk", label: "Go for a walk", emoji: "🚶", cost: 0, type: "positive" },
      { id: "sit_outside", label: "Sit outside", emoji: "🌤️", cost: 0, type: "positive" },
      { id: "photo", label: "Take a picture", emoji: "📸", cost: 0, type: "positive" },
      { id: "talk", label: "Talk it out", emoji: "💬", cost: 0, type: "neutral" },
    ],
    business: [
      { id: "browse", label: "Browse items", emoji: "🛍️", cost: 0, type: "neutral" },
      { id: "try_on", label: "Try something on", emoji: "👗", cost: 0, type: "positive" },
      { id: "ask_help", label: "Ask for help", emoji: "🙋", cost: 0, type: "neutral" },
      { id: "buy", label: "Buy something", emoji: "💳", cost: 35, type: "positive", payer: "user" },
    ],
    grocery: [
      { id: "shop", label: "Grab items", emoji: "🛒", cost: 0, type: "neutral" },
      { id: "checkout", label: "Check out", emoji: "💳", cost: 60, type: "positive", payer: "user" },
      { id: "ask_aisle", label: "Ask where something is", emoji: "🙋", cost: 0, type: "neutral" },
      { id: "talk", label: "Small talk", emoji: "💬", cost: 0, type: "neutral" },
    ],
    school: [
      { id: "study", label: "Study together", emoji: "📚", cost: 0, type: "positive" },
      { id: "ask_question", label: "Ask a question", emoji: "✋", cost: 0, type: "neutral" },
      { id: "pass_note", label: "Pass a note", emoji: "📝", cost: 0, type: "positive" },
      { id: "chat", label: "Chat between class", emoji: "💬", cost: 0, type: "neutral" },
    ],
  };

  const defaults = [
    { id: "talk", label: "Talk", emoji: "💬", cost: 0, type: "neutral" },
    { id: "observe", label: "Look around", emoji: "👀", cost: 0, type: "neutral" },
    { id: "joke", label: "Crack a joke", emoji: "😂", cost: 0, type: "positive" },
    { id: "ask", label: "Ask something", emoji: "🤔", cost: 0, type: "neutral" },
  ];

  return base[category] || defaults;
}