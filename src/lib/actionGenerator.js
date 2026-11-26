/**
 * actionGenerator.js — SINGLE AUTHORITATIVE SCENE ACTIVITY SOURCE
 *
 * All Scene activities are defined here. This is the sole activity catalog.
 * sceneInteractionEngine.js is a thin adapter that calls generateLocationActions().
 * sceneActionConfig.js provides image prompt metadata only — not a competing catalog.
 *
 * Action format:
 *   id              — unique identifier (used by ACTION_IMAGE_PROMPTS and handleAction)
 *   label           — display text
 *   emoji           — display icon
 *   cost            — numeric USD cost (0 = free)
 *   type            — functional | social | observational | spontaneous | risky | awkward
 *   payer           — "user" | "character" (only when cost > 0)
 *   action_category — "food" | "drink" | "clothing" | "grocery" (image generation routing)
 *   suggested_zone  — preferred zone name; adapter validates against real location zones
 *   requires_staff  — true when action needs an on-shift staff member
 */

import { isPrivateResidentialZone } from './sceneBackgroundPopulation.js';
import { HOUSEHOLD_ACTION_IDS } from './sceneActionConfig.js';
import { isOnSiteResidenceZone } from './onsiteResidence.js';
import { MERCHANDISE_FAMILIES, merchandiseFamiliesForVenue } from './venueMerchandise.js';
import { resolveZoneVenue } from './venueZoneOptions.js';

// ── ACTION CLASSIFICATION HELPER ─────────────────────────────────────────────
// Adds explicit action_class and is_paid to every action definition.
// This is the AUTHORITATIVE classification — no inference allowed downstream.
//
// Rules:
//   cost === 0  → is_paid: false, action_class derived from type
//   cost > 0 + action_category defined → is_paid: true, action_class: 'purchase'
//   cost > 0 + no action_category (services like salon) → is_paid: true, action_class: 'service'
//   cost > 0 + fee type (gov payment) → is_paid: true, action_class: 'fee'
//
function classify(action) {
  if (!action.cost || action.cost <= 0) {
    const classMap = {
      social: 'social',
      observational: 'narrative',
      functional: 'free_activity',
      spontaneous: 'narrative',
      risky: 'social',
      awkward: 'social',
    };
    return { ...action, cost: 0, is_paid: false, action_class: classMap[action.type] || 'free_activity' };
  }
  // Paid actions
  if (action.fee_class) {
    return { ...action, is_paid: true, action_class: 'fee', fee_source: action.fee_source || 'authority' };
  }
  if (action.action_category) {
    return { ...action, is_paid: true, action_class: 'purchase', purchase_source: action.purchase_source || 'menu' };
  }
  // No action_category but has cost = service
  return { ...action, is_paid: true, action_class: 'service', service_source: action.service_source || 'staff' };
}

function classifyAll(actions) { return actions.map(classify); }

// ── COFFEE SHOP ───────────────────────────────────────────────────────────────
const COFFEE_SHOP_ACTIONS = classifyAll([
  { id: "order_coffee", label: "Order coffee", emoji: "☕", cost: 5, type: "functional", payer: "user", action_category: "drink", suggested_zone: "Counter" },
  { id: "order_pastry", label: "Grab a pastry", emoji: "🥐", cost: 4, type: "functional", payer: "user", action_category: "food" },
  { id: "sit_work", label: "Sit and work", emoji: "💻", cost: 0, type: "functional" },
  { id: "people_watch", label: "People-watch", emoji: "👀", cost: 0, type: "observational" },
  { id: "read", label: "Read or study", emoji: "📖", cost: 0, type: "functional" },
  { id: "chat", label: "Chat with barista", emoji: "💬", cost: 0, type: "social", suggested_zone: "Counter", requires_staff: true },
  { id: "overhear", label: "Overhear conversation", emoji: "🎧", cost: 0, type: "observational" },
  { id: "share_table", label: "Ask to share table", emoji: "🪑", cost: 0, type: "social" },
  { id: "spill", label: "Accidentally spill", emoji: "💧", cost: 0, type: "awkward" },
  { id: "check_phone", label: "Browse on phone", emoji: "📱", cost: 0, type: "observational" },
  { id: "sketch", label: "Sketch or journal", emoji: "✏️", cost: 0, type: "functional" },
  { id: "meet_regular", label: "See familiar face", emoji: "👋", cost: 0, type: "social" },
]);

// ── DINER ─────────────────────────────────────────────────────────────────────
const DINER_ACTIONS = classifyAll([
  { id: "order_breakfast", label: "Order breakfast", emoji: "🍳", cost: 8, type: "functional", payer: "user", action_category: "food" },
  { id: "ask_refill", label: "Ask for refill", emoji: "☕", cost: 0, type: "functional", requires_staff: true },
  { id: "sit_booth", label: "Claim a booth", emoji: "🪑", cost: 0, type: "functional" },
  { id: "chat_server", label: "Chat with server", emoji: "🗣️", cost: 0, type: "social", requires_staff: true },
  { id: "linger", label: "Linger after meal", emoji: "⏰", cost: 0, type: "observational" },
  { id: "jukebox", label: "Play jukebox", emoji: "🎵", cost: 2, type: "functional", payer: "user", service_source: "jukebox" },
  { id: "pie", label: "Order pie", emoji: "🥧", cost: 5, type: "functional", payer: "user", action_category: "food" },
  { id: "chat_locals", label: "Chat with locals", emoji: "👥", cost: 0, type: "social" },
  { id: "watch_cook", label: "Watch the cook work", emoji: "👨‍🍳", cost: 0, type: "observational" },
  { id: "read_menu", label: "Study the menu", emoji: "📋", cost: 0, type: "observational" },
  { id: "milkshake", label: "Get a milkshake", emoji: "🥤", cost: 6, type: "functional", payer: "user", action_category: "drink" },
  { id: "order_late_night", label: "Order comfort food", emoji: "🍝", cost: 10, type: "functional", payer: "user", action_category: "food" },
  { id: "flirt_server", label: "Flirt with server", emoji: "😉", cost: 0, type: "social", requires_staff: true },
  { id: "sit_counter", label: "Sit at counter", emoji: "🔧", cost: 0, type: "observational" },
  { id: "overhead_story", label: "Hear someone's story", emoji: "📖", cost: 0, type: "observational" },
]);

// ── BAR / NIGHTCLUB / LOUNGE ──────────────────────────────────────────────────
const BAR_CLUB_ACTIONS = classifyAll([
  { id: "dance", label: "Hit the floor", emoji: "🕺", cost: 0, type: "social", suggested_zone: "Dance Floor" },
  { id: "order_drink", label: "Order a drink", emoji: "🍸", cost: 8, type: "functional", payer: "user", action_category: "drink", suggested_zone: "Bar", requires_staff: true },
  { id: "drinks", label: "Get drinks", emoji: "🍹", cost: 12, type: "functional", payer: "user", action_category: "drink", suggested_zone: "Bar", requires_staff: true },
  { id: "buy_round", label: "Buy a round", emoji: "🥂", cost: 25, type: "social", payer: "user", action_category: "drink", requires_staff: true },
  { id: "char_buy_round", label: "Let them buy", emoji: "🎁", cost: 25, type: "social", payer: "character", action_category: "drink" },
  { id: "flirt", label: "Flirt shamelessly", emoji: "😏", cost: 0, type: "social" },
  { id: "argue", label: "Start drama", emoji: "🔥", cost: 0, type: "risky" },
  { id: "navigate_crowd", label: "Move through crowd", emoji: "👥", cost: 0, type: "functional" },
  { id: "lose_group", label: "Lose your group", emoji: "❓", cost: 0, type: "spontaneous" },
  { id: "go_outside", label: "Step outside", emoji: "🚪", cost: 0, type: "functional" },
  { id: "vip_request", label: "Ask about VIP", emoji: "👑", cost: 0, type: "social", requires_staff: true },
  { id: "watch_dj", label: "Watch the DJ", emoji: "🎧", cost: 0, type: "observational", suggested_zone: "Stage" },
  { id: "bathroom_break", label: "Bathroom break", emoji: "🚻", cost: 0, type: "functional" },
  { id: "bottle_service", label: "Bottle service", emoji: "🍾", cost: 100, type: "social", payer: "user", action_category: "drink", requires_staff: true },
  { id: "chat_bartender", label: "Chat with bartender", emoji: "🍹", cost: 0, type: "social", suggested_zone: "Bar", requires_staff: true },
  { id: "dance_with_stranger", label: "Dance with someone new", emoji: "💃", cost: 0, type: "social", suggested_zone: "Dance Floor" },
  { id: "get_rejected", label: "Get shut down", emoji: "🚫", cost: 0, type: "risky" },
  { id: "make_friend", label: "Make a new friend", emoji: "👯", cost: 0, type: "social" },
  { id: "photo", label: "Take a selfie", emoji: "📸", cost: 0, type: "observational" },
]);

// ── GYM / FITNESS CENTER ──────────────────────────────────────────────────────
const GYM_ACTIONS = classifyAll([
  { id: "lift", label: "Lift weights", emoji: "🏋️", cost: 0, type: "functional", suggested_zone: "Weight Room" },
  { id: "cardio", label: "Do cardio", emoji: "🏃", cost: 0, type: "functional", suggested_zone: "Cardio Area" },
  { id: "stretch", label: "Stretch and cool down", emoji: "🤸", cost: 0, type: "functional" },
  { id: "ask_trainer", label: "Ask the trainer", emoji: "💪", cost: 0, type: "social", requires_staff: true },
  { id: "notice_watching", label: "Notice someone watching", emoji: "👀", cost: 0, type: "observational" },
  { id: "chat_member", label: "Chat with member", emoji: "👋", cost: 0, type: "social" },
  { id: "use_machine", label: "Try a new machine", emoji: "⚙️", cost: 0, type: "functional" },
  { id: "spot", label: "Spot someone", emoji: "🤝", cost: 0, type: "social" },
  { id: "challenge", label: "Friendly challenge", emoji: "🏆", cost: 0, type: "social" },
  { id: "locker_room", label: "Grab from locker", emoji: "🔒", cost: 0, type: "functional", suggested_zone: "Locker Room" },
  { id: "class", label: "Join a class", emoji: "👥", cost: 0, type: "functional", suggested_zone: "Studio" },
  { id: "check_mirror", label: "Check yourself out", emoji: "🪞", cost: 0, type: "observational" },
  { id: "workout", label: "Work out", emoji: "💪", cost: 0, type: "functional" },
]);

// ── PARK / OUTDOOR SPACES ─────────────────────────────────────────────────────
const PARK_ACTIONS = classifyAll([
  { id: "walk", label: "Go for a walk", emoji: "🚶", cost: 0, type: "functional" },
  { id: "sit_bench", label: "Sit on a bench", emoji: "🪑", cost: 0, type: "observational" },
  { id: "people_watch", label: "People-watch", emoji: "👀", cost: 0, type: "observational" },
  { id: "read", label: "Read outside", emoji: "📖", cost: 0, type: "functional" },
  { id: "picnic", label: "Have a picnic", emoji: "🧺", cost: 0, type: "social" },
  { id: "exercise", label: "Exercise", emoji: "🏃", cost: 0, type: "functional" },
  { id: "play", label: "Play a game", emoji: "🎾", cost: 0, type: "social" },
  { id: "watch_sunset", label: "Watch the sunset", emoji: "🌅", cost: 0, type: "observational" },
  { id: "chat_stranger", label: "Chat with stranger", emoji: "💬", cost: 0, type: "social" },
  { id: "bring_dog", label: "Bring / pet a dog", emoji: "🐕", cost: 0, type: "social" },
  // Walk Pet walks the animal registered on the actor's own profile — never an invented one.
  { id: "walk_pet", label: "Walk Pet", emoji: "🦮", cost: 0, type: "functional", requires_actor: true },
  { id: "cloud_watch", label: "Cloud watch", emoji: "☁️", cost: 0, type: "observational" },
  { id: "sit_outside", label: "Sit outside", emoji: "🌤️", cost: 0, type: "observational" },
  // Marriage is not City Hall's alone: an open-air ceremony uses the same pipeline.
  { id: "gov_marry", label: "Wedding Ceremony", emoji: "💍", cost: 0, type: "functional" },
]);

// ── RESTAURANT ────────────────────────────────────────────────────────────────
const RESTAURANT_ACTIONS = classifyAll([
  { id: "order", label: "Order food", emoji: "🍔", cost: 18, type: "functional", payer: "user", action_category: "food", requires_staff: true },
  { id: "drinks", label: "Get drinks", emoji: "🍷", cost: 12, type: "functional", payer: "user", action_category: "drink", requires_staff: true },
  { id: "dessert", label: "Order dessert", emoji: "🍰", cost: 10, type: "functional", payer: "user", action_category: "food" },
  { id: "chat_server", label: "Chat with server", emoji: "🗣️", cost: 0, type: "social", requires_staff: true },
  { id: "check", label: "Pick up the check", emoji: "🧾", cost: 40, type: "functional", payer: "user", service_source: "restaurant" },
  { id: "char_pays", label: "Let them cover it", emoji: "💳", cost: 30, type: "functional", payer: "character", service_source: "restaurant" },
  { id: "bathroom", label: "Visit bathroom", emoji: "🚻", cost: 0, type: "functional" },
  { id: "watch_kitchen", label: "Watch the kitchen", emoji: "👨‍🍳", cost: 0, type: "observational" },
  { id: "check_phone", label: "Check phone", emoji: "📱", cost: 0, type: "observational" },
  { id: "flirt_server", label: "Flirt with server", emoji: "😉", cost: 0, type: "social", requires_staff: true },
]);

// ── FREE FOOD / SOUP KITCHEN ──────────────────────────────────────────────────
// Food here is provided at no charge. Every food action is a free offering:
// the Shopfeed card still shows the meal — with no price and no transaction.
const SOUP_KITCHEN_ACTIONS = classifyAll([
  { id: "sk_soup", label: "Get soup", emoji: "🍲", cost: 0, type: "functional", action_category: "food", free_offering: true, suggested_zone: "Dining Area" },
  { id: "sk_sandwich", label: "Get a sandwich", emoji: "🥪", cost: 0, type: "functional", action_category: "food", free_offering: true },
  { id: "sk_hot_meal", label: "Get a hot meal", emoji: "🍽️", cost: 0, type: "functional", action_category: "food", free_offering: true },
  { id: "sk_pasta", label: "Get pasta", emoji: "🍝", cost: 0, type: "functional", action_category: "food", free_offering: true },
  { id: "sk_bread", label: "Get bread", emoji: "🍞", cost: 0, type: "functional", action_category: "food", free_offering: true },
  { id: "sk_fruit", label: "Get fruit", emoji: "🍎", cost: 0, type: "functional", action_category: "food", free_offering: true },
  { id: "sk_sit", label: "Sit and eat", emoji: "🪑", cost: 0, type: "functional", suggested_zone: "Dining Area" },
  { id: "sk_volunteers", label: "Talk to the volunteers", emoji: "💬", cost: 0, type: "social" },
]);

// ── ALL-YOU-CAN-EAT BUFFET ───────────────────────────────────────────────────
// Paid dining through the existing purchase mechanism — one plate price,
// never a per-item charge. Seconds are included in that plate.
const BUFFET_ACTIONS = classifyAll([
  { id: "buffet_plate", label: "Get a buffet plate", emoji: "🍽️", cost: 18, type: "functional", payer: "user", action_category: "food", purchase_source: "buffet", suggested_zone: "Buffet" },
  { id: "buffet_spread", label: "Look over the spread", emoji: "👀", cost: 0, type: "observational", suggested_zone: "Buffet" },
  { id: "buffet_server", label: "Chat with the server", emoji: "🗣️", cost: 0, type: "social", requires_staff: true },
  { id: "buffet_water", label: "Get a glass of water", emoji: "🥤", cost: 0, type: "functional", action_category: "drink", free_offering: true },
]);

// ── BAR FOOD (only when the bar offers food service) ─────────────────────────
// Sold items use the existing purchase mechanism. Complimentary snacks stay free:
// peanuts and pretzels are never charged just because the bar sells meals.
const BAR_FOOD_ACTIONS = classifyAll([
  { id: "bar_food_tacos", label: "Order tacos", emoji: "🌮", cost: 12, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_sliders", label: "Order sliders", emoji: "🍔", cost: 12, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_burger", label: "Order a burger", emoji: "🍔", cost: 12, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_wings", label: "Order wings", emoji: "🍗", cost: 12, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_nachos", label: "Order nachos", emoji: "🧀", cost: 12, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_pizza", label: "Order a pizza", emoji: "🍕", cost: 12, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_sandwich", label: "Order a sandwich", emoji: "🥪", cost: 8, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_fries", label: "Order french fries", emoji: "🍟", cost: 8, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_hotdog", label: "Order a hotdog", emoji: "🌭", cost: 8, type: "functional", payer: "user", action_category: "food", purchase_source: "menu", requires_staff: true, suggested_zone: "Bar" },
  { id: "bar_food_pretzels", label: "Grab complimentary pretzels", emoji: "🥨", cost: 0, type: "functional", action_category: "food", free_offering: true, suggested_zone: "Bar" },
  { id: "bar_food_peanuts", label: "Grab complimentary peanuts", emoji: "🥜", cost: 0, type: "functional", action_category: "food", free_offering: true, suggested_zone: "Bar" },
]);

// ── HOME ──────────────────────────────────────────────────────────────────────
// ALL home actions are free. eat/drink at home use household resources, not a purchase.
const HOME_ACTIONS = classifyAll([
  { id: "sit", label: "Sit down", emoji: "🛋️", cost: 0, type: "functional", suggested_zone: "Living Room" },
  // requires_actor: a person performs it, so with more than one person here the scene
  // asks WHO does it instead of assuming everyone in the room is doing it.
  { id: "eat", label: "Eat something", emoji: "🍽️", cost: 0, type: "functional", suggested_zone: "Kitchen", requires_actor: true },
  { id: "drink", label: "Get a drink", emoji: "🥤", cost: 0, type: "functional", suggested_zone: "Kitchen", requires_actor: true },
  { id: "relax", label: "Just relax", emoji: "😌", cost: 0, type: "observational" },
  { id: "talk", label: "Talk", emoji: "💬", cost: 0, type: "social" },
  { id: "watch_tv", label: "Watch TV", emoji: "📺", cost: 0, type: "functional", suggested_zone: "Living Room" },
  { id: "music", label: "Listen to music", emoji: "🎵", cost: 0, type: "observational" },
  { id: "order_takeout", label: "Order takeout", emoji: "🥡", cost: 20, type: "functional", payer: "user", action_category: "food", purchase_source: "delivery" },
  // Cooking has no recipient: one person, or several people cooking together.
  { id: "cook", label: "Cook something", emoji: "👨‍🍳", cost: 0, type: "functional", suggested_zone: "Kitchen", requires_actor: true },
  { id: "nap", label: "Nap on couch", emoji: "😴", cost: 0, type: "observational", suggested_zone: "Living Room" },
  { id: "lay_down", label: "Lie down", emoji: "🛌", cost: 0, type: "observational", suggested_zone: "Bedroom" },
  // Household activities — available because this is a home.
  // zone_hints are matched against the real zones on the location by the adapter:
  // a zone that does not exist simply leaves the activity unlocked, never redirects.
  { id: "home_workout", label: "Workout", emoji: "💪", cost: 0, type: "functional", zone_hints: ["living room", "bedroom", "garage", "den"], requires_actor: true },
  { id: "home_clean_up", label: "Clean Up", emoji: "🧹", cost: 0, type: "functional", requires_actor: true },
  { id: "home_dishes", label: "Wash Dishes", emoji: "🍽️", cost: 0, type: "functional", zone_hints: ["kitchen", "sink", "scullery"], requires_actor: true },
  { id: "home_brush_teeth", label: "Brush Teeth", emoji: "🪥", cost: 0, type: "functional", zone_hints: ["bathroom", "bath", "powder room"], requires_actor: true },
  { id: "home_shower", label: "Shower", emoji: "🚿", cost: 0, type: "functional", zone_hints: ["bathroom", "bath", "shower room", "en suite", "ensuite"], requires_actor: true },
  { id: "home_make_bed", label: "Make Bed", emoji: "🛏️", cost: 0, type: "functional", zone_hints: ["bedroom", "bed room"], requires_actor: true },
  // Moonwink — the strip's title only. The label is never spoken, written, or remembered
  // by a character; the interaction is played out in ordinary language. Adults only.
  { id: "moonwink", label: "Moonwink", emoji: "🌙", cost: 0, type: "social", suggested_zone: "Bedroom", adults_only: true },
  // A wedding at home is the same marriage, recorded the same way.
  { id: "gov_marry", label: "Wedding Ceremony", emoji: "💍", cost: 0, type: "functional" },
]);

// ── HOTEL ─────────────────────────────────────────────────────────────────────
const HOTEL_ACTIONS = classifyAll([
  { id: "hotel_checkin", label: "Check in", emoji: "🔑", cost: 0, type: "functional", suggested_zone: "Front Desk", requires_staff: true },
  { id: "hotel_room", label: "Go to room", emoji: "🛏️", cost: 0, type: "functional", suggested_zone: "Rooms" },
  { id: "hotel_dining", label: "Dine at hotel", emoji: "🍽️", cost: 20, type: "functional", payer: "user", action_category: "food", suggested_zone: "Restaurant", requires_staff: true },
  { id: "hotel_drink", label: "Drinks at the bar", emoji: "🍹", cost: 10, type: "functional", payer: "user", action_category: "drink", suggested_zone: "Bar", requires_staff: true },
  { id: "hotel_pool", label: "Use the pool", emoji: "🏊", cost: 0, type: "functional", suggested_zone: "Pool" },
  { id: "hotel_concierge", label: "Ask concierge", emoji: "🛎️", cost: 0, type: "social", requires_staff: true },
  { id: "hotel_relax", label: "Relax in room", emoji: "😌", cost: 0, type: "observational", suggested_zone: "Rooms" },
  { id: "moonwink", label: "Moonwink", emoji: "🌙", cost: 0, type: "social", suggested_zone: "Rooms", adults_only: true },
  { id: "hotel_gym", label: "Use hotel gym", emoji: "💪", cost: 0, type: "functional", suggested_zone: "Fitness Center" },
  { id: "hotel_checkout", label: "Check out", emoji: "🧾", cost: 0, type: "functional", suggested_zone: "Front Desk", requires_staff: true },
]);

// ── SHELTER ───────────────────────────────────────────────────────────────────
const SHELTER_ACTIONS = classifyAll([
  { id: "shelter_checkin", label: "Register / check in", emoji: "🚪", cost: 0, type: "functional", suggested_zone: "Reception", requires_staff: true },
  { id: "shelter_rest", label: "Rest", emoji: "🛌", cost: 0, type: "functional", suggested_zone: "Dormitory" },
  { id: "shelter_eat", label: "Get a meal", emoji: "🍽️", cost: 0, type: "functional", suggested_zone: "Dining Area" },
  { id: "shelter_talk", label: "Talk to staff", emoji: "💬", cost: 0, type: "social", requires_staff: true },
  { id: "shelter_resources", label: "Access resources", emoji: "📋", cost: 0, type: "functional", requires_staff: true },
  { id: "shelter_quiet", label: "Find a quiet spot", emoji: "🤫", cost: 0, type: "observational" },
]);

// ── MEDICAL ───────────────────────────────────────────────────────────────────
const MEDICAL_ACTIONS = classifyAll([
  { id: "medical_intake", label: "Check in", emoji: "🏥", cost: 0, type: "functional", suggested_zone: "Reception", requires_staff: true },
  { id: "medical_visit", label: "See the doctor", emoji: "👨‍⚕️", cost: 0, type: "functional", suggested_zone: "Examination", requires_staff: true },
  { id: "medical_wait", label: "Wait in lobby", emoji: "⏳", cost: 0, type: "observational", suggested_zone: "Waiting Room" },
  { id: "medical_pharmacy", label: "Pick up prescription", emoji: "💊", cost: 0, type: "functional", suggested_zone: "Pharmacy", requires_staff: true },
  { id: "medical_ask", label: "Ask about wait time", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
  { id: "medical_phone", label: "Scroll phone in lobby", emoji: "📱", cost: 0, type: "observational" },
]);

// ── EDUCATION (classrooms, tutoring, libraries) ───────────────────────────────
const EDUCATION_ACTIONS = classifyAll([
  { id: "study", label: "Study", emoji: "📚", cost: 0, type: "functional", suggested_zone: "Study Area" },
  { id: "education_class", label: "Attend class", emoji: "✏️", cost: 0, type: "functional", suggested_zone: "Classroom", requires_staff: true },
  { id: "education_ask", label: "Ask instructor", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
  { id: "education_note", label: "Take notes", emoji: "📓", cost: 0, type: "functional" },
  { id: "education_group", label: "Join study group", emoji: "👥", cost: 0, type: "social" },
  { id: "education_library", label: "Browse the library", emoji: "📖", cost: 0, type: "functional", suggested_zone: "Library" },
  { id: "education_break", label: "Take a break", emoji: "☕", cost: 0, type: "observational" },
]);

// ── COMMUNITY CENTER ──────────────────────────────────────────────────────────
const COMMUNITY_ACTIONS = classifyAll([
  { id: "community_gather", label: "Join the gathering", emoji: "👥", cost: 0, type: "social", suggested_zone: "Main Hall" },
  { id: "community_event", label: "Attend an event", emoji: "🗓️", cost: 0, type: "functional", suggested_zone: "Event Space" },
  { id: "community_volunteer", label: "Volunteer", emoji: "🤝", cost: 0, type: "social" },
  { id: "community_talk", label: "Talk to someone", emoji: "💬", cost: 0, type: "social" },
  { id: "community_activity", label: "Join an activity", emoji: "🎯", cost: 0, type: "functional" },
  { id: "community_check", label: "Check bulletin board", emoji: "📋", cost: 0, type: "observational" },
]);

// ── GROCERY STORE ─────────────────────────────────────────────────────────────
const GROCERY_ACTIONS = classifyAll([
  { id: "grocery_shopping", label: "Grab groceries", emoji: "🛒", cost: 0, type: "functional", suggested_zone: "Store Floor" },
  { id: "checkout", label: "Check out", emoji: "💳", cost: 60, type: "functional", payer: "user", action_category: "grocery", suggested_zone: "Checkout", requires_staff: true },
  { id: "buy", label: "Buy items", emoji: "🛍️", cost: 35, type: "functional", payer: "user", action_category: "grocery" },
  { id: "ask_aisle", label: "Ask where something is", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
  { id: "produce", label: "Check the produce", emoji: "🥦", cost: 0, type: "observational", suggested_zone: "Produce" },
  { id: "sample", label: "Try a sample", emoji: "🥄", cost: 0, type: "functional" },
  { id: "list", label: "Check your list", emoji: "📝", cost: 0, type: "observational" },
]);

// ── SCHOOL ────────────────────────────────────────────────────────────────────
const SCHOOL_ACTIONS = classifyAll([
  { id: "school_class", label: "Attend class", emoji: "📚", cost: 0, type: "functional", suggested_zone: "Classroom", requires_staff: true },
  { id: "study", label: "Study", emoji: "✏️", cost: 0, type: "functional", suggested_zone: "Library" },
  { id: "school_sports", label: "Sports / athletics", emoji: "⚽", cost: 0, type: "functional", suggested_zone: "Field" },
  { id: "pass_note", label: "Pass a note", emoji: "📝", cost: 0, type: "social" },
  { id: "school_lunch", label: "Lunch break", emoji: "🥗", cost: 5, type: "functional", payer: "user", action_category: "food", suggested_zone: "Cafeteria" },
  { id: "chat_classmates", label: "Chat with classmates", emoji: "💬", cost: 0, type: "social" },
  { id: "school_hall", label: "Walk the hallway", emoji: "🚶", cost: 0, type: "functional", suggested_zone: "Hallway" },
  { id: "ask_question", label: "Ask a question", emoji: "✋", cost: 0, type: "social", requires_staff: true },
]);

// ── WORKPLACE ─────────────────────────────────────────────────────────────────
const WORKPLACE_ACTIONS = classifyAll([
  // Work asks who does it, through the same selector Kiss and the other activities use.
  { id: "business_work", label: "Work", emoji: "💼", cost: 0, type: "functional", suggested_zone: "Office", requires_actor: true },
  { id: "business_meet", label: "Meeting", emoji: "📊", cost: 0, type: "functional", suggested_zone: "Conference Room" },
  { id: "workplace_break", label: "Coffee break", emoji: "☕", cost: 0, type: "observational" },
  { id: "workplace_chat", label: "Chat with coworker", emoji: "💬", cost: 0, type: "social" },
  { id: "workplace_email", label: "Check emails", emoji: "📧", cost: 0, type: "functional" },
  { id: "workplace_lunch", label: "Lunch break", emoji: "🥗", cost: 0, type: "functional" },
  { id: "workplace_checkin", label: "Check in at reception", emoji: "🗣️", cost: 0, type: "social", suggested_zone: "Reception", requires_staff: true },
  { id: "workplace_phone", label: "Take a call", emoji: "📞", cost: 0, type: "functional" },
]);

// ── RELIGION / WORSHIP ────────────────────────────────────────────────────────
const RELIGION_ACTIONS = classifyAll([
  { id: "religion_pray", label: "Pray", emoji: "🙏", cost: 0, type: "functional", suggested_zone: "Sanctuary" },
  { id: "religion_study", label: "Study scripture", emoji: "📖", cost: 0, type: "functional", suggested_zone: "Library" },
  { id: "religion_service", label: "Attend service", emoji: "⛪", cost: 0, type: "functional", suggested_zone: "Sanctuary" },
  { id: "religion_talk", label: "Speak with clergy", emoji: "💬", cost: 0, type: "social", requires_staff: true },
  { id: "religion_community", label: "Join fellowship", emoji: "👥", cost: 0, type: "social" },
  { id: "religion_quiet", label: "Sit in reflection", emoji: "🕯️", cost: 0, type: "observational" },
  // A wedding here is the same marriage, recorded through the same pipeline.
  { id: "gov_marry", label: "Wedding Ceremony", emoji: "💍", cost: 0, type: "functional", suggested_zone: "Sanctuary" },
]);

// ── GOVERNMENT ────────────────────────────────────────────────────────────────
const GOVERNMENT_ACTIONS = classifyAll([
  { id: "gov_documents", label: "File documents", emoji: "📋", cost: 0, type: "functional", suggested_zone: "Records", requires_staff: true },
  { id: "gov_payment", label: "Pay a fine", emoji: "⚖️", cost: 0, type: "functional", suggested_zone: "Payment", requires_staff: true },
  { id: "gov_official", label: "Speak with official", emoji: "📞", cost: 0, type: "social", suggested_zone: "Offices", requires_staff: true },
  { id: "gov_wait", label: "Wait in line", emoji: "⏳", cost: 0, type: "observational" },
  { id: "gov_forms", label: "Fill out forms", emoji: "📝", cost: 0, type: "functional" },
  { id: "gov_ask", label: "Ask for information", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
]);

// ── CITY HALL ─────────────────────────────────────────────────────────────────
// Municipal activities. Marriage is one activity among them, never the reason
// everyone is here: a general visit, a license appointment and a hearing are
// complete visits on their own. Choosing Get Married opens the marriage
// participant selection; the ceremony itself is played out in the scene and the
// established marriage pipeline records it when it actually happens.
const CITY_HALL_ACTIONS = classifyAll([
  { id: "gov_marry", label: "Get Married", emoji: "💍", cost: 0, type: "functional" },
  { id: "gov_marriage_license", label: "Marriage License", emoji: "📄", cost: 0, type: "functional", suggested_zone: "Reception" },
  { id: "gov_civic_hearing", label: "Attend Civic Hearing", emoji: "🏛️", cost: 0, type: "observational", suggested_zone: "Meeting Room" },
  { id: "gov_municipal_hearing", label: "Municipal Hearing", emoji: "⚖️", cost: 0, type: "functional", suggested_zone: "Meeting Room" },
  { id: "gov_administrative", label: "Administrative Dispute", emoji: "🗂️", cost: 0, type: "functional", suggested_zone: "Office" },
  { id: "gov_documents", label: "File documents", emoji: "📋", cost: 0, type: "functional", suggested_zone: "Reception", requires_staff: true },
  { id: "gov_payment", label: "Pay a fine", emoji: "💳", cost: 0, type: "functional", requires_staff: true },
  { id: "gov_official", label: "Speak with official", emoji: "📞", cost: 0, type: "social", requires_staff: true },
  { id: "gov_wait", label: "Wait in line", emoji: "⏳", cost: 0, type: "observational" },
  { id: "gov_forms", label: "Fill out forms", emoji: "📝", cost: 0, type: "functional" },
  { id: "gov_ask", label: "Ask for information", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
]);

// ── COURTHOUSE ────────────────────────────────────────────────────────────────
// Judicial proceedings. Every activity is contextually available rather than a
// required sequence: a hearing can be watched, a ruling delivered, or the court
// adjourned without a verdict. Only Sentencing and Contempt open a consequence
// flow, and both require the user to confirm who is affected.
const COURTHOUSE_ACTIONS = classifyAll([
  { id: "court_attend", label: "Attend Hearing", emoji: "🪑", cost: 0, type: "observational" },
  { id: "court_open", label: "Open Court", emoji: "🔔", cost: 0, type: "functional" },
  { id: "court_opening", label: "Opening Statement", emoji: "🗣️", cost: 0, type: "functional" },
  { id: "court_testimony", label: "Present Testimony", emoji: "🙋", cost: 0, type: "functional" },
  { id: "court_call_witness", label: "Call Witness", emoji: "📣", cost: 0, type: "functional" },
  { id: "court_question_witness", label: "Question Witness", emoji: "❓", cost: 0, type: "social" },
  { id: "court_present_evidence", label: "Present Evidence", emoji: "📎", cost: 0, type: "functional" },
  { id: "court_cross_examine", label: "Cross-Examine", emoji: "🔍", cost: 0, type: "social" },
  { id: "court_objection", label: "Raise Objection", emoji: "✋", cost: 0, type: "social" },
  { id: "court_deliberate", label: "Deliberate", emoji: "🤝", cost: 0, type: "functional" },
  { id: "court_verdict", label: "Deliver Verdict", emoji: "📜", cost: 0, type: "functional" },
  { id: "court_ruling", label: "Issue Ruling", emoji: "⚖️", cost: 0, type: "functional" },
  { id: "court_civil_dispute", label: "Hear Civil Dispute", emoji: "🏛️", cost: 0, type: "functional" },
  { id: "court_plea", label: "Enter a Plea", emoji: "📝", cost: 0, type: "functional" },
  { id: "court_bail", label: "Bail Hearing", emoji: "🔓", cost: 0, type: "functional" },
  { id: "court_dismiss", label: "Dismiss Charges", emoji: "🗑️", cost: 0, type: "functional" },
  { id: "gov_sentence", label: "Sentencing", emoji: "🧑‍⚖️", cost: 0, type: "functional" },
  { id: "gov_contempt", label: "Hold in Contempt", emoji: "⚠️", cost: 0, type: "functional" },
  { id: "court_adjourn", label: "Adjourn Court", emoji: "🚪", cost: 0, type: "functional" },
  { id: "gov_marry", label: "Civil Marriage", emoji: "💍", cost: 0, type: "functional" },
]);

// ── JAIL / PRISON ─────────────────────────────────────────────────────────────
// Prison and jail activities.
//   zone_move: true                     → the activity moves everyone to that zone (zone + top image update)
//   requires_selected_character: true   → the activity needs a chosen character before it can run
const JAIL_ACTIONS = classifyAll([
  // ── ZONE MOVES — zone and top image change with the move ──
  { id: "jail_move_general_population", label: "Go to Day Room", emoji: "🚶", cost: 0, type: "functional", suggested_zone: "General Population / Day Room", zone_hints: ["general population", "day room", "cellblock"], zone_move: true },
  { id: "jail_move_yard", label: "Go to Yard", emoji: "🌤️", cost: 0, type: "functional", suggested_zone: "Exercise Yard", zone_hints: ["yard"], zone_move: true },
  { id: "jail_move_cafeteria", label: "Go to Cafeteria", emoji: "🍽️", cost: 0, type: "functional", suggested_zone: "Cafeteria", zone_hints: ["cafeteria", "mess hall"], zone_move: true },
  { id: "jail_move_cell", label: "Go to Cell", emoji: "🚪", cost: 0, type: "functional", suggested_zone: "Cell", zone_hints: ["cell"], zone_move: true },
  { id: "jail_move_holding", label: "Go to Holding", emoji: "⛓️", cost: 0, type: "functional", suggested_zone: "Holding Area", zone_hints: ["holding"], zone_move: true },
  { id: "jail_move_medical", label: "Go to Medical", emoji: "🩺", cost: 0, type: "functional", suggested_zone: "Medical", zone_hints: ["medical", "infirmary"], zone_move: true },
  { id: "jail_move_visiting", label: "Go to Visiting", emoji: "👥", cost: 0, type: "functional", suggested_zone: "Visiting Area", zone_hints: ["visiting", "visitation"], zone_move: true },
  { id: "jail_move_shower", label: "Go to Showers", emoji: "🚿", cost: 0, type: "functional", suggested_zone: "Shower Area", zone_hints: ["shower"], zone_move: true },
  { id: "jail_move_laundry", label: "Go to Laundry", emoji: "🧺", cost: 0, type: "functional", suggested_zone: "Laundry", zone_hints: ["laundry"], zone_move: true },
  { id: "jail_move_library", label: "Go to Library", emoji: "📚", cost: 0, type: "functional", suggested_zone: "Library / Education Room", zone_hints: ["library", "education", "classroom"], zone_move: true },
  { id: "jail_move_chapel", label: "Go to Chapel", emoji: "🕯️", cost: 0, type: "functional", suggested_zone: "Chapel", zone_hints: ["chapel"], zone_move: true },
  { id: "jail_move_work_area", label: "Go to Work Area", emoji: "🔧", cost: 0, type: "functional", suggested_zone: "Work Area", zone_hints: ["work area", "shop"], zone_move: true },
  { id: "jail_move_kitchen", label: "Go to Kitchen", emoji: "🍳", cost: 0, type: "functional", suggested_zone: "Kitchen", zone_hints: ["kitchen"], zone_move: true },
  { id: "jail_move_control", label: "Go to Control Room", emoji: "🖥️", cost: 0, type: "functional", suggested_zone: "Guard / Control Room", zone_hints: ["control", "guard room"], zone_move: true },

  // ── ACTIVITIES THAT CHANGE THE TOP IMAGE ──
  { id: "jail_head_count", label: "Head Count", emoji: "🧮", cost: 0, type: "functional", suggested_zone: "General Population / Day Room", zone_hints: ["general population", "day room", "cellblock"] },
  { id: "jail_line_up", label: "Line Up for Count", emoji: "🧍", cost: 0, type: "functional", suggested_zone: "General Population / Day Room", zone_hints: ["general population", "day room", "cellblock"] },
  { id: "jail_meal_tray", label: "Get Meal Tray", emoji: "🥣", cost: 0, type: "functional", suggested_zone: "Cafeteria", zone_hints: ["cafeteria", "mess hall"] },
  { id: "jail_eat", label: "Eat", emoji: "🍴", cost: 0, type: "functional", suggested_zone: "Cafeteria", zone_hints: ["cafeteria", "mess hall"] },
  { id: "jail_phone_call", label: "Phone Call", emoji: "📞", cost: 0, type: "functional", suggested_zone: "General Population / Day Room", zone_hints: ["phone", "general population", "day room", "cellblock"] },
  { id: "jail_shower", label: "Shower", emoji: "🚿", cost: 0, type: "functional", suggested_zone: "Shower Area", zone_hints: ["shower"] },
  { id: "jail_exercise", label: "Exercise", emoji: "💪", cost: 0, type: "functional", suggested_zone: "Exercise Yard", zone_hints: ["yard"] },
  { id: "jail_change_clothing", label: "Prison Clothing", emoji: "👕", cost: 0, type: "functional", suggested_zone: "Laundry", zone_hints: ["laundry", "property", "clothing"] },
  { id: "jail_read_write", label: "Read / Write", emoji: "📖", cost: 0, type: "functional", suggested_zone: "Cell", zone_hints: ["cell", "library"] },
  { id: "jail_talk_prisoners", label: "Talk with Prisoners", emoji: "💬", cost: 0, type: "social", suggested_zone: "General Population / Day Room", zone_hints: ["general population", "day room", "cellblock"], requires_selected_character: true },

  // ── INTERACTIONS — a chosen character is required ──
  { id: "jail_shakedown", label: "Shakedown", emoji: "🔦", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_search_prisoner", label: "Search Prisoner", emoji: "🧤", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_search_cell", label: "Search Cell", emoji: "🔎", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_inspect_belongings", label: "Inspect Belongings", emoji: "🎒", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_find_contraband", label: "Find Contraband", emoji: "📦", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_confiscate", label: "Confiscate Item", emoji: "🚫", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_issue_warning", label: "Issue Warning", emoji: "⚠️", cost: 0, type: "social", requires_selected_character: true },
  { id: "jail_respond_incident", label: "Respond to Incident", emoji: "🚨", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_break_up_fight", label: "Break Up Fight", emoji: "✋", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_meet_visitor", label: "Meet Visitor / Lawyer", emoji: "👥", cost: 0, type: "social", suggested_zone: "Visiting Area", zone_hints: ["visiting", "visitation"], requires_selected_character: true },
  { id: "jail_social_worker", label: "Speak with Social Worker", emoji: "🗣️", cost: 0, type: "social", requires_selected_character: true },
  { id: "jail_request_medical", label: "Request Medical", emoji: "🩺", cost: 0, type: "functional", requires_selected_character: true },
  { id: "jail_receive_medical", label: "Receive Medical Care", emoji: "💉", cost: 0, type: "functional", suggested_zone: "Medical", zone_hints: ["medical", "infirmary"], requires_selected_character: true },

  // ── ESCORTS — a chosen character AND a zone change ──
  { id: "jail_escort_prisoner", label: "Escort Prisoner", emoji: "🚶‍♂️", cost: 0, type: "functional", suggested_zone: "Cell", zone_hints: ["cell"], zone_move: true, requires_selected_character: true },
  { id: "jail_bring_holding", label: "Bring to Holding", emoji: "⛓️", cost: 0, type: "functional", suggested_zone: "Holding Area", zone_hints: ["holding"], zone_move: true, requires_selected_character: true },
  { id: "jail_take_medical", label: "Take to Medical", emoji: "🩺", cost: 0, type: "functional", suggested_zone: "Medical", zone_hints: ["medical", "infirmary"], zone_move: true, requires_selected_character: true },
  { id: "jail_take_visiting", label: "Take to Visiting", emoji: "👥", cost: 0, type: "functional", suggested_zone: "Visiting Area", zone_hints: ["visiting", "visitation"], zone_move: true, requires_selected_character: true },

  // ── VISITOR / ADMINISTRATION ACTIVITIES ──
  { id: "jail_visitation", label: "Visit inmate", emoji: "👤", cost: 0, type: "social", suggested_zone: "Visiting Area", zone_hints: ["visiting", "visitation"], requires_staff: true },
  { id: "jail_paperwork", label: "File paperwork", emoji: "📝", cost: 0, type: "functional", suggested_zone: "Intake / Booking", zone_hints: ["records", "intake", "booking"], requires_staff: true },
  { id: "jail_wait", label: "Wait to be processed", emoji: "⏳", cost: 0, type: "observational", suggested_zone: "Holding Area", zone_hints: ["holding", "intake", "booking"] },
  { id: "jail_talk", label: "Talk to guard", emoji: "💬", cost: 0, type: "social", suggested_zone: "Guard / Control Room", zone_hints: ["control", "guard room"], requires_staff: true },
]);

// ── SALON / SPA / BARBERSHOP ──────────────────────────────────────────────────
// Salon services are action_class: 'service' — they NEVER render product cards.
const SALON_ACTIONS = classifyAll([
  { id: "salon_book", label: "Book a service", emoji: "💇", cost: 0, type: "functional", suggested_zone: "Reception", requires_staff: true },
  { id: "salon_cut", label: "Get a cut", emoji: "✂️", cost: 45, type: "functional", payer: "user", service_source: "stylist", suggested_zone: "Styling Area", requires_staff: true },
  { id: "salon_color", label: "Color treatment", emoji: "🎨", cost: 80, type: "functional", payer: "user", service_source: "stylist", suggested_zone: "Styling Area", requires_staff: true },
  { id: "salon_nails", label: "Get nails done", emoji: "💅", cost: 40, type: "functional", payer: "user", service_source: "nail_tech", requires_staff: true },
  { id: "salon_wait", label: "Wait your turn", emoji: "📱", cost: 0, type: "observational", suggested_zone: "Waiting Area" },
  { id: "salon_chat", label: "Chat with stylist", emoji: "💬", cost: 0, type: "social", requires_staff: true },
  { id: "salon_gossip", label: "Get the gossip", emoji: "🗣️", cost: 0, type: "social", requires_staff: true },
]);

// ── CLOTHING / BOUTIQUE ───────────────────────────────────────────────────────
const CLOTHING_STORE_ACTIONS = classifyAll([
  { id: "clothing_browse", label: "Browse the racks", emoji: "🛍️", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "try_on", label: "Try something on", emoji: "👗", cost: 0, type: "functional", suggested_zone: "Fitting Rooms" },
  { id: "clothing_try_on", label: "Try it on", emoji: "🪞", cost: 0, type: "functional", suggested_zone: "Fitting Rooms" },
  { id: "clothing_ask_size", label: "Ask for a size", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
  { id: "clothing_ask_price", label: "Ask the price", emoji: "💰", cost: 0, type: "social", requires_staff: true },
  { id: "buy", label: "Buy something", emoji: "💳", cost: 35, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", suggested_zone: "Register", requires_staff: true },
  { id: "clothing_buy", label: "Buy item", emoji: "🛒", cost: 35, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", suggested_zone: "Register", requires_staff: true },
  // A complete outfit is a different purchase from a single piece: it goes through the
  // same product card and transaction authority, and lands in the recipient's Outfits.
  { id: "buy_outfit", label: "Buy outfit", emoji: "👗", cost: 120, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", item_kind: "outfit", suggested_zone: "Register", requires_staff: true },
  { id: "clothing_accessories", label: "Check accessories", emoji: "👜", cost: 0, type: "observational", suggested_zone: "Accessories" },
  { id: "clothing_register", label: "Go to register", emoji: "🏷️", cost: 0, type: "functional", suggested_zone: "Register", requires_staff: true },
  { id: "ask_help", label: "Ask for help", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
]);

// ── SHOE / SNEAKER STORE ─────────────────────────────────────────────────────
// Footwear is tried on where it is sold: seated in the sales area, a few steps to test
// the fit, a look in the mirror — never a clothing fitting room.
const SHOE_STORE_ACTIONS = classifyAll([
  { id: "shoe_browse", label: "Look at the shoes", emoji: "👟", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "shoe_sit_try", label: "Sit down and try on a pair", emoji: "🪑", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "shoe_walk_fit", label: "Walk a few steps to test the fit", emoji: "🚶", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "shoe_mirror", label: "Check them in the mirror", emoji: "🪞", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "shoe_ask_size", label: "Ask for a size", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
  { id: "shoe_ask_price", label: "Ask the price", emoji: "💰", cost: 0, type: "social", requires_staff: true },
  { id: "shoe_buy", label: "Buy the shoes", emoji: "💳", cost: 120, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", suggested_zone: "Register", requires_staff: true },
  { id: "buy", label: "Buy something", emoji: "🛒", cost: 120, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", suggested_zone: "Register", requires_staff: true },
  { id: "ask_help", label: "Ask for help", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
]);

// ── ACCESSORIES STORE ────────────────────────────────────────────────────────
// Accessories are examined and tried on in the sales area, at a counter or mirror.
const ACCESSORIES_STORE_ACTIONS = classifyAll([
  { id: "accessories_browse", label: "Look over the displays", emoji: "👜", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "accessories_try", label: "Try a piece on", emoji: "🪞", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "accessories_mirror", label: "Check it in the mirror", emoji: "✨", cost: 0, type: "functional", suggested_zone: "Sales Floor" },
  { id: "accessories_ask", label: "Ask about a piece", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
  { id: "accessories_buy", label: "Buy the accessory", emoji: "💳", cost: 65, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", suggested_zone: "Register", requires_staff: true },
  { id: "buy", label: "Buy something", emoji: "🛒", cost: 65, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", suggested_zone: "Register", requires_staff: true },
  { id: "ask_help", label: "Ask for help", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
]);

// ── GENERAL RETAIL (bookstore, electronics, home goods, etc.) ─────────────────
const RETAIL_STORE_ACTIONS = classifyAll([
  { id: "retail_browse", label: "Browse", emoji: "🛍️", cost: 0, type: "functional", suggested_zone: "Store Floor" },
  { id: "retail_ask", label: "Ask staff", emoji: "❓", cost: 0, type: "social", requires_staff: true },
  { id: "retail_checkout", label: "Check out", emoji: "💳", cost: 35, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store", suggested_zone: "Checkout", requires_staff: true },
  { id: "buy", label: "Buy something", emoji: "🛒", cost: 35, type: "functional", payer: "user", action_category: "clothing", purchase_source: "store" },
  { id: "try_on", label: "Try it", emoji: "👔", cost: 0, type: "functional" },
  { id: "ask_help", label: "Ask for help", emoji: "🙋", cost: 0, type: "social", requires_staff: true },
]);

// ── SCENE-WIDE ACTIVITIES ─────────────────────────────────────────────────────
// Activities that belong to the moment rather than to one venue type. They are added
// to whatever the venue already offers — never a replacement, never a re-price.
// `requires_actor` means the existing actor selector asks who does it.
const SMOKE_ACTION = { id: "smoke", label: "Smoke", emoji: "🚬", cost: 0, type: "functional", requires_actor: true };
const CALL_COPS_ACTION = { id: "call_the_cops", label: "Call the Cops", emoji: "📞", cost: 0, type: "functional", requires_actor: true };
const FIND_WARM_ACTION = { id: "find_somewhere_warm", label: "Find Somewhere Warm", emoji: "🔥", cost: 0, type: "functional", requires_actor: true };
const PICKPOCKET_ACTION = { id: "pickpocket", label: "Pickpocket", emoji: "🤏", cost: 0, type: "risky", requires_actor: true };
const BURGLARIZE_ACTION = { id: "burglarize", label: "Burglarize", emoji: "🪟", cost: 0, type: "risky", requires_actor: true };

// Places that actually contain property someone could break into. Outdoors and transit
// are excluded: standing in the open is not a burglary opportunity.
const BURGLARY_VENUE_EXCLUDED_CATEGORIES = new Set(['outdoor', 'public', 'transportation']);

// Pickpocket and Burglarize are available everywhere a suitable target exists for the
// characters who live that way — Thief and Lawbreaker. This is CHARACTER-specific
// availability, decided by Scene from the traits of the people actually in the scene;
// it is never a venue-wide addition for everyone.
export const TRAIT_GATED_CRIME_ACTIONS = classifyAll([PICKPOCKET_ACTION, BURGLARIZE_ACTION]);

// ── GENERIC FALLBACK ──────────────────────────────────────────────────────────
const DEFAULT_ACTIONS = classifyAll([
  { id: "talk", label: "Talk", emoji: "💬", cost: 0, type: "social" },
  { id: "observe", label: "Look around", emoji: "👀", cost: 0, type: "observational" },
  { id: "joke", label: "Crack a joke", emoji: "😂", cost: 0, type: "social" },
  { id: "ask", label: "Ask something", emoji: "🤔", cost: 0, type: "social" },
]);

// ── CATEGORY → ACTION LIBRARY ─────────────────────────────────────────────────
const ACTION_LIBRARY_BY_CATEGORY = {
  food_drink:  RESTAURANT_ACTIONS,
  home:        HOME_ACTIONS,
  gym:         GYM_ACTIONS,
  outdoor:     PARK_ACTIONS,
  social:      BAR_CLUB_ACTIONS,
  hotel:       HOTEL_ACTIONS,
  shelter:     SHELTER_ACTIONS,
  medical:     MEDICAL_ACTIONS,
  education:   EDUCATION_ACTIONS,
  community:   COMMUNITY_ACTIONS,
  grocery:     GROCERY_ACTIONS,
  school:      SCHOOL_ACTIONS,
  workplace:   WORKPLACE_ACTIONS,
  business:    RETAIL_STORE_ACTIONS, // default; subtype overrides below
  religion:    RELIGION_ACTIONS,
  government:  GOVERNMENT_ACTIONS,
  jail_prison: JAIL_ACTIONS,
  public:      PARK_ACTIONS,
};

// ── SUBTYPE → ACTION LIBRARY (overrides category, checked first) ──────────────
// Keys: lowercase, spaces/hyphens normalized to underscores
const ACTION_LIBRARY_BY_SUBTYPE = {
  // Government venues with official proceedings
  city_hall:      CITY_HALL_ACTIONS,
  courthouse:     COURTHOUSE_ACTIONS,
  // Free food / soup kitchen — food is provided at no charge
  free_food_soup_kitchen: SOUP_KITCHEN_ACTIONS,
  soup_kitchen:     SOUP_KITCHEN_ACTIONS,
  free_food_venue:  SOUP_KITCHEN_ACTIONS,
  community_meal:   SOUP_KITCHEN_ACTIONS,
  // All-you-can-eat buffet
  all_you_can_eat_buffet: BUFFET_ACTIONS,
  buffet:           BUFFET_ACTIONS,
  buffet_restaurant: BUFFET_ACTIONS,
  // Coffee shop
  coffee_shop:    COFFEE_SHOP_ACTIONS,
  coffee:         COFFEE_SHOP_ACTIONS,
  cafe:           COFFEE_SHOP_ACTIONS,
  coffeehouse:    COFFEE_SHOP_ACTIONS,
  coffee_house:   COFFEE_SHOP_ACTIONS,
  espresso_bar:   COFFEE_SHOP_ACTIONS,
  // Diner
  diner:          DINER_ACTIONS,
  breakfast_spot: DINER_ACTIONS,
  brunch_spot:    DINER_ACTIONS,
  breakfast:      DINER_ACTIONS,
  brunch:         DINER_ACTIONS,
  // Restaurant
  restaurant:          RESTAURANT_ACTIONS,
  casual_restaurant:   RESTAURANT_ACTIONS,
  fine_dining:         RESTAURANT_ACTIONS,
  lunch_spot:          RESTAURANT_ACTIONS,
  lunch:               RESTAURANT_ACTIONS,
  // Bar / nightclub
  bar:             BAR_CLUB_ACTIONS,
  nightclub:       BAR_CLUB_ACTIONS,
  club:            BAR_CLUB_ACTIONS,
  lounge:          BAR_CLUB_ACTIONS,
  bar_only:        BAR_CLUB_ACTIONS,
  bar_grill:       BAR_CLUB_ACTIONS,
  bar_and_grill:   BAR_CLUB_ACTIONS,
  cocktail_bar:    BAR_CLUB_ACTIONS,
  wine_bar:        BAR_CLUB_ACTIONS,
  brewery:         BAR_CLUB_ACTIONS,
  pub:             BAR_CLUB_ACTIONS,
  tavern:          BAR_CLUB_ACTIONS,
  speakeasy:       BAR_CLUB_ACTIONS,
  // Gym / fitness
  gym:             GYM_ACTIONS,
  fitness_center:  GYM_ACTIONS,
  fitness:         GYM_ACTIONS,
  health_club:     GYM_ACTIONS,
  // Park / outdoor
  park:            PARK_ACTIONS,
  // Salon / beauty
  salon:           SALON_ACTIONS,
  barbershop:      SALON_ACTIONS,
  spa:             SALON_ACTIONS,
  nail_salon:      SALON_ACTIONS,
  beauty_salon:    SALON_ACTIONS,
  hair_salon:      SALON_ACTIONS,
  // Clothing
  clothing:              CLOTHING_STORE_ACTIONS,
  boutique:              CLOTHING_STORE_ACTIONS,
  clothing_store:        CLOTHING_STORE_ACTIONS,
  apparel:               CLOTHING_STORE_ACTIONS,
  thrift:                CLOTHING_STORE_ACTIONS,
  thrift_store:          CLOTHING_STORE_ACTIONS,
  mall:                  CLOTHING_STORE_ACTIONS,
  department_store:      CLOTHING_STORE_ACTIONS,
  shoe_store:            SHOE_STORE_ACTIONS,
  sneaker_store:         SHOE_STORE_ACTIONS,
  sneakers:              SHOE_STORE_ACTIONS,
  accessories:           ACCESSORIES_STORE_ACTIONS,
  accessories_store:     ACCESSORIES_STORE_ACTIONS,
  // General retail
  bookstore:         RETAIL_STORE_ACTIONS,
  record_store:      RETAIL_STORE_ACTIONS,
  electronics_store: RETAIL_STORE_ACTIONS,
  home_goods:        RETAIL_STORE_ACTIONS,
  toy_store:         RETAIL_STORE_ACTIONS,
  gift_shop:         RETAIL_STORE_ACTIONS,
  retail:            RETAIL_STORE_ACTIONS,
  // Venue types a mixed-use Generic property can carry. Each resolves to the library its
  // own category already uses, so a hospital, a house, a store or a jail inside a property
  // behaves exactly as one anywhere else — the Generic parent never suppresses them.
  hospital:            MEDICAL_ACTIONS,
  medical_facility:    MEDICAL_ACTIONS,
  health_center:       MEDICAL_ACTIONS,
  clinic:              MEDICAL_ACTIONS,
  jail:                JAIL_ACTIONS,
  prison:              JAIL_ACTIONS,
  police_station:      GOVERNMENT_ACTIONS,
  government_facility: GOVERNMENT_ACTIONS,
  building:            HOME_ACTIONS,
  residential_building: HOME_ACTIONS,
  apartment_building:  HOME_ACTIONS,
  residential_complex: HOME_ACTIONS,
  mixed_use:           HOME_ACTIONS,
  apartment:           HOME_ACTIONS,
  studio_apartment:    HOME_ACTIONS,
  house:               HOME_ACTIONS,
  condo:               HOME_ACTIONS,
  dormitory:           HOME_ACTIONS,
  business:            RETAIL_STORE_ACTIONS,
  commercial_building: RETAIL_STORE_ACTIONS,
  store_retail:        RETAIL_STORE_ACTIONS,
  office:              WORKPLACE_ACTIONS,
  city:                PARK_ACTIONS,
  district:            PARK_ACTIONS,
  neighborhood:        PARK_ACTIONS,
  slums:               PARK_ACTIONS,
  campus:              PARK_ACTIONS,
  street:              PARK_ACTIONS,
  public_square_plaza: PARK_ACTIONS,
  courtyard:           PARK_ACTIONS,
};

// Name hints for when subtype/identity fields aren't set (checked against location.name)
const NAME_HINTS = [
  ['coffee', COFFEE_SHOP_ACTIONS],
  ['café', COFFEE_SHOP_ACTIONS],
  ['cafe', COFFEE_SHOP_ACTIONS],
  ['espresso', COFFEE_SHOP_ACTIONS],
  ['diner', DINER_ACTIONS],
  ['breakfast', DINER_ACTIONS],
  ['brunch', DINER_ACTIONS],
  ['nightclub', BAR_CLUB_ACTIONS],
  ['night club', BAR_CLUB_ACTIONS],
  ['lounge', BAR_CLUB_ACTIONS],
  ['brewery', BAR_CLUB_ACTIONS],
  ['pub', BAR_CLUB_ACTIONS],
  ['tavern', BAR_CLUB_ACTIONS],
  ['gym', GYM_ACTIONS],
  ['fitness', GYM_ACTIONS],
  ['salon', SALON_ACTIONS],
  ['barber', SALON_ACTIONS],
  ['spa', SALON_ACTIONS],
  ['boutique', CLOTHING_STORE_ACTIONS],
  ['thrift', CLOTHING_STORE_ACTIONS],
  // Government venues whose subtype was never set
  ['courthouse', COURTHOUSE_ACTIONS],
  ['court house', COURTHOUSE_ACTIONS],
  ['city hall', CITY_HALL_ACTIONS],
];

/**
 * Resolve the action library for a location.
 * Priority: subtype match → venue_identity match → name hint → category match → DEFAULT_ACTIONS
 */
function resolveActionLibrary(location) {
  // 1. Normalize subtypes
  const rawSubtypes = Array.isArray(location.subtype) ? location.subtype : [location.subtype];
  const subtypes = rawSubtypes
    .filter(Boolean)
    .map(s => s.toLowerCase().replace(/[\s\-&]+/g, '_').replace(/_+/g, '_'));

  for (const st of subtypes) {
    if (ACTION_LIBRARY_BY_SUBTYPE[st]) return ACTION_LIBRARY_BY_SUBTYPE[st];
  }

  // 2. Try venue_identity string match
  const identity = (location.venue_identity || '').toLowerCase();
  if (identity) {
    for (const [key, lib] of Object.entries(ACTION_LIBRARY_BY_SUBTYPE)) {
      if (identity.includes(key.replace(/_/g, ' ')) || identity.includes(key)) return lib;
    }
  }

  // 3. Name-based hint for common venue types
  const name = (location.name || '').toLowerCase();
  for (const [hint, lib] of NAME_HINTS) {
    if (name.includes(hint)) return lib;
  }

  // 4. Category match
  const category = (location.category || 'generic').toLowerCase();
  return ACTION_LIBRARY_BY_CATEGORY[category] || DEFAULT_ACTIONS;
}

/**
 * Every action library this venue's assigned types resolve to, primary first.
 * A business may carry several venue types (a sneaker, clothing and accessories store);
 * each one is an established classification of the same business, so none is dropped.
 */
function resolveActionLibraries(location) {
  const libraries = [];
  for (const subtype of normalizeSubtypes(location)) {
    const library = ACTION_LIBRARY_BY_SUBTYPE[subtype];
    if (library && !libraries.includes(library)) libraries.push(library);
  }
  if (libraries.length === 0) libraries.push(resolveActionLibrary(location));
  return libraries;
}

// ── STORE MERCHANDISE → SHOPPING ACTIONS ─────────────────────────────────────
// The store determines what can be shopped for. Each merchandise family the business
// carries gets its own purchase action, and Buy Something draws from all of them.
// Established ids, prices, the product card and the transaction pathway are unchanged.
const SHOPPING_ACTION_BY_FAMILY = {
  sneakers:    { id: 'shoe_buy',        label: 'Buy Sneakers',    emoji: '👟', cost: 120 },
  clothing:    { id: 'clothing_buy',    label: 'Buy Clothing',    emoji: '🛒', cost: 35 },
  // Apparel is shopped as men's or women's — the chosen category decides the merchandise.
  mens_clothing:   { id: 'shop_mens_clothing',   label: "Shop Men's Clothing",   emoji: '👔', cost: 35 },
  womens_clothing: { id: 'shop_womens_clothing', label: "Shop Women's Clothing", emoji: '👗', cost: 35 },
  accessories: { id: 'accessories_buy', label: 'Buy Accessories', emoji: '👜', cost: 65 },
  home_goods:  { id: 'buy_home_goods',  label: 'Buy Home Goods',  emoji: '🛏️', cost: 35 },
  music:       { id: 'buy_music',       label: 'Buy Music',       emoji: '💿', cost: 25 },
  books:       { id: 'buy_books',       label: 'Buy Books',       emoji: '📚', cost: 20 },
  electronics: { id: 'buy_electronics', label: 'Buy Electronics', emoji: '🎧', cost: 60 },
  toys:        { id: 'buy_toys',        label: 'Buy Toys',        emoji: '🧸', cost: 25 },
  gifts:       { id: 'buy_gifts',       label: 'Buy Gifts',       emoji: '🎁', cost: 30 },
};

/** A retail purchase action (a complete outfit keeps its own established action). */
const isStorePurchaseAction = (action) =>
  action.action_class === 'purchase' && action.purchase_source === 'store' && action.item_kind !== 'outfit';

function buildVenueShoppingActions(venue, libraries) {
  const families = merchandiseFamiliesForVenue(normalizeSubtypes(venue));
  if (families.length === 0) return null;

  const actions = families
    .map((family) => {
      const def = SHOPPING_ACTION_BY_FAMILY[family];
      const meta = MERCHANDISE_FAMILIES[family];
      if (!def || !meta) return null;
      return {
        id: def.id,
        label: def.label,
        emoji: def.emoji,
        cost: def.cost,
        type: 'functional',
        payer: 'user',
        action_category: meta.category,
        purchase_source: 'store',
        // The category this action sells. Buy Something carries every family instead.
        merchandise: family,
        suggested_zone: 'Register',
        requires_staff: true,
      };
    })
    .filter(Boolean);

  // Buy Something is the general retail action: any category this business actually sells.
  const primary = SHOPPING_ACTION_BY_FAMILY[families[0]];
  actions.push({
    id: 'buy',
    label: 'Buy something',
    emoji: '🛒',
    cost: primary?.cost ?? 35,
    type: 'functional',
    payer: 'user',
    action_category: MERCHANDISE_FAMILIES[families[0]].category,
    purchase_source: 'store',
    merchandise: families,
    suggested_zone: 'Register',
    requires_staff: true,
  });

  // A complete outfit stays its own purchase wherever clothing is sold.
  if (families.some((f) => MERCHANDISE_FAMILIES[f]?.category === 'clothing')) {
    const outfit = libraries.flat().find((a) => a.id === 'buy_outfit');
    if (outfit) actions.push(outfit);
  }

  return classifyAll(actions);
}

// ── VENUE-SPECIFIC FOOD ADDITIONS ────────────────────────────────────────────
// Restaurant type informs which dishes the venue actually serves. These actions
// are ADDED to the venue's existing actions; no existing action or price changes.
// Price uses the established restaurant food price — no new price points.
const VENUE_DISH_MENU = {
  fine_dining_restaurant: ["Ribeye Steak", "Filet Mignon", "Lobster Tail", "Crab Legs"],
  fine_dining:            ["Ribeye Steak", "Filet Mignon", "Lobster Tail"],
  steakhouse:             ["Ribeye Steak", "Filet Mignon", "Lamb Chops"],
  seafood_restaurant:     ["Lobster", "Crab Legs", "Seafood Platter"],
  pizza_place:            ["Margherita Pizza", "Pepperoni Pizza"],
  sushi_restaurant:       ["Sushi Platter", "Salmon Nigiri"],
  taco_stand:             ["Tacos", "Burrito"],
  burger_joint:           ["Cheeseburger", "French Fries"],
  bbq_place:              ["Brisket Plate", "Pulled Pork Sandwich"],
  ramen_shop:             ["Tonkotsu Ramen", "Gyoza"],
  thai_restaurant:        ["Pad Thai", "Green Curry"],
  mexican_restaurant:     ["Enchiladas", "Carnitas Tacos"],
  italian_restaurant:     ["Spaghetti Carbonara", "Chicken Parmigiana"],
  asian_fusion:           ["Poke Bowl", "Korean Fried Chicken"],
  vegan_restaurant:       ["Buddha Bowl", "Vegan Burger"],
  gastropub:              ["Burger", "Fish and Chips"],
};

function normalizeSubtypes(location) {
  const raw = Array.isArray(location?.subtype) ? location.subtype : [location?.subtype];
  return raw
    .filter(Boolean)
    .map(s => String(s).toLowerCase().replace(/[\s\-&]+/g, '_').replace(/_+/g, '_'));
}

/** True when a Night Out / bar location has food service enabled by the user. */
function offersFoodService(location) {
  return (location?.features || []).map(f => String(f).toLowerCase()).includes('serves_food');
}

/** Dish actions for the venue's restaurant type (empty when the type has no menu). */
function buildVenueDishActions(location) {
  const dishes = normalizeSubtypes(location).map(s => VENUE_DISH_MENU[s]).find(Boolean);
  if (!dishes) return [];
  return classifyAll(dishes.map((dish) => ({
    id: `dish_${dish.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    label: `Order ${dish}`,
    emoji: "🍽️",
    cost: 18,
    type: "functional",
    payer: "user",
    action_category: "food",
    purchase_source: "menu",
    requires_staff: true,
  })));
}

/**
 * generateLocationActions — authoritative entry point
 *
 * Returns the full contextual action list for a location with no arbitrary cap.
 * The Scene.jsx action strip uses overflow-x-auto to expose all actions.
 *
 * @param {Object} location - LocationReference record
 * @param {string|null} activeZone - Currently active zone name
 * @param {number} hour - Current hour in Eastern Time (0-23)
 * @param {Object} options
 * @param {boolean} options.isCharacterAsleep - Block all activities
 * @param {number} options.sleepStartHour - Character's scheduled sleep start (default 23)
 */
/**
 * The business whose zones the current zone belongs to, when this location contains
 * workplaces. A Home keeps its Home category; inside one of its businesses' own zones,
 * that business's venue type decides the activity library — the same catalog, prices and
 * staff rules every location of that type already uses. Null when the zone belongs to no
 * business, in which case the location is resolved exactly as before.
 */
export function resolveWorkplaceVenue(location, activeZone) {
  if (!activeZone || !Array.isArray(location?.workplaces) || location.workplaces.length === 0) return null;
  const zone = String(activeZone).toLowerCase();
  return location.workplaces.find(w =>
    w?.business_type && (w.zone_names || []).some(z => String(z).toLowerCase() === zone)
  ) || null;
}

/**
 * Every venue type this business carries — its primary type plus each additional type
 * assigned to it. The same business is never split into separate stores.
 */
export function workplaceVenueSubtypes(workplace) {
  const types = [
    workplace?.business_type,
    ...(Array.isArray(workplace?.business_types) ? workplace.business_types.map((t) => t?.type) : []),
  ].filter(Boolean);
  return [...new Set(types)];
}

export function generateLocationActions(location, activeZone = null, hour = 12, options = {}) {
  if (!location) return DEFAULT_ACTIONS;
  if (options.isCharacterAsleep) return [];

  // Venue identity: the business this zone belongs to, or the location itself.
  const workplace = resolveWorkplaceVenue(location, activeZone);
  // The business keeps every venue type assigned to it — never only the primary one.
  const venue = workplace
    ? {
        ...location,
        category: workplace.business_category || location.category,
        subtype: workplaceVenueSubtypes(workplace),
        name: workplace.name || location.name,
        venue_identity: workplace.name || location.venue_identity,
      }
    : location;

  // A Generic property may carry several venue types. Inside a space that belongs to
  // exactly one of them, that venue type is the setting — its own established library,
  // prices and staff rules. An ambiguous or unrecognized space changes nothing, and the
  // precise zone decides, so one venue's activities never spread across the property.
  const zoneVenue = resolveZoneVenue(venue, activeZone);

  // A confinement facility is a prison/jail whatever its category says: its activities
  // are the facility's own.
  const isConfinementVenue = venue.category === 'jail_prison' || venue.is_confinement_facility === true;

  // An On-Site Residence inside a business property is a living space. Inside its own
  // zones the established home activities are the strip — exactly what any other home
  // shows — and the business's own activities stay in the business's zones. A zone the
  // user never assigned to the residence is untouched.
  const inOnSiteResidence = !isConfinementVenue && isOnSiteResidenceZone(location, activeZone);
  // Every assigned venue type contributes its library; the primary type's library is the
  // venue's own strip, and the shopping actions below are built from all of them.
  const libraries = isConfinementVenue
    ? [JAIL_ACTIONS]
    : inOnSiteResidence ? [HOME_ACTIONS] : resolveActionLibraries(zoneVenue);
  let actions = libraries[0];

  // The store determines what can be shopped for. Every venue type the business carries
  // gets its own purchase action, and Buy Something draws from all of them. A venue that
  // sells no retail merchandise is untouched.
  if (!isConfinementVenue && !inOnSiteResidence) {
    const shopping = buildVenueShoppingActions(zoneVenue, libraries);
    if (shopping) {
      const kept = actions.filter((a) => !isStorePurchaseAction(a));
      const ids = new Set(kept.map((a) => a.id));
      actions = [...kept, ...shopping.filter((a) => !ids.has(a.id))];
    }
  }

  // Venue food additions — additive only. Existing actions and prices are untouched.
  // Bars offer food only when the user enabled food service on that location.
  // A residence is not the venue, so it never inherits the business's menu.
  const venueExtras = [];
  if (!inOnSiteResidence) {
    if (actions === BAR_CLUB_ACTIONS && offersFoodService(zoneVenue)) venueExtras.push(...BAR_FOOD_ACTIONS);
    venueExtras.push(...buildVenueDishActions(zoneVenue));
    if (venueExtras.length > 0) actions = [...actions, ...venueExtras];
  }

  // A school's private student living spaces — a dorm room, a studio apartment, an
  // apartment unit — ARE living spaces. Inside one, the household activities a home
  // already has (make the bed, shower, brush teeth, clean up, wash dishes) are added
  // alongside the school's own activities, so being at home on campus never removes
  // Attend class or the rest. Shared school zones are untouched, and this adds no new
  // activity: the catalog entries below are the existing HOME actions.
  if (!isConfinementVenue && venue.category === 'school' && isPrivateResidentialZone(venue, activeZone)) {
    const householdActions = HOME_ACTIONS.filter((a) => HOUSEHOLD_ACTION_IDS.includes(a.id));
    const alreadyPresent = new Set(actions.map((a) => a.id));
    actions = [...actions, ...householdActions.filter((a) => !alreadyPresent.has(a.id))];
  }

  // Scene-wide activities — added to the venue's own list, never replacing any of it.
  //   Smoke               — everywhere, indoors and out, subject to what the place is
  //   Call the Cops       — everywhere
  //   Find Somewhere Warm — the Slums, where seeking warmth is a real errand
  //   Pickpocket          — Slums and City (Thief/Lawbreaker get it elsewhere, via Scene)
  //   Burglarize          — wherever there is a property to break into
  const subtypesHere = normalizeSubtypes(zoneVenue);
  const sceneExtras = [SMOKE_ACTION, CALL_COPS_ACTION];
  if (subtypesHere.includes('slums')) sceneExtras.push(FIND_WARM_ACTION);
  if (subtypesHere.includes('slums') || subtypesHere.includes('city')) sceneExtras.push(PICKPOCKET_ACTION);
  if (!BURGLARY_VENUE_EXCLUDED_CATEGORIES.has(String(venue.category || 'generic').toLowerCase())) {
    sceneExtras.push(BURGLARIZE_ACTION);
  }
  const alreadyPresent = new Set(actions.map((a) => a.id));
  const sceneAdditions = classifyAll(sceneExtras).filter((a) => !alreadyPresent.has(a.id));
  if (sceneAdditions.length > 0) actions = [...actions, ...sceneAdditions];

  // Caffeine filter: only restrict within 2 hours of character's scheduled sleep.
  // The old arbitrary 1:00 PM Eastern cutoff has been removed — it was incorrect.
  const sleepStartHour = (typeof options.sleepStartHour === 'number' && options.sleepStartHour >= 3)
    ? options.sleepStartHour
    : 23;
  const coffeeDeadline = (sleepStartHour - 2 + 24) % 24;

  // True when current hour falls in the "near sleep" caffeine window
  const isCoffeeProhibited = coffeeDeadline < sleepStartHour
    ? (hour >= coffeeDeadline && hour <= sleepStartHour)
    : (hour >= coffeeDeadline || hour <= sleepStartHour); // wraps midnight

  if (isCoffeeProhibited) {
    return actions.filter(a =>
      a.id !== 'order_coffee' &&
      a.id !== 'ask_refill' &&
      !a.label.toLowerCase().includes('espresso') &&
      !(a.label.toLowerCase() === 'order coffee')
    );
  }

  return actions;
}

/**
 * Get conversation type options for a location.
 */
export function getConversationTypes(location, selectedNpcs = [], employees = []) {
  const types = [
    { id: "group", label: "Talk with group", description: "Address everyone present" },
    { id: "one_on_one", label: "Pull aside for private chat", description: "One person only" },
  ];
  if (employees.length > 0) {
    types.push({ id: "employee", label: "Order / Ask staff", description: "Brief employee interaction" });
  }
  return types;
}