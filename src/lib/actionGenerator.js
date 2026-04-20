/**
 * Dynamic action generation system
 * Produces contextually relevant, rotating actions based on:
 * - Location category & subtype
 * - Current zone
 * - Time of day
 * - Location features
 * - NPC presence
 * - Interaction history
 */

// ── ACTION LIBRARY BY VENUE TYPE ──────────────────────────────────────────

const COFFEE_SHOP_ACTIONS = [
  { id: "order_coffee", label: "Order coffee", emoji: "☕", cost: 5, type: "functional" },
  { id: "order_pastry", label: "Grab a pastry", emoji: "🥐", cost: 4, type: "functional" },
  { id: "sit_work", label: "Sit and work", emoji: "💻", cost: 0, type: "functional" },
  { id: "people_watch", label: "People-watch", emoji: "👀", cost: 0, type: "observational" },
  { id: "read", label: "Read or study", emoji: "📖", cost: 0, type: "functional" },
  { id: "chat", label: "Chat with barista", emoji: "💬", cost: 0, type: "social" },
  { id: "overhear", label: "Overhear conversation", emoji: "🎧", cost: 0, type: "observational" },
  { id: "share_table", label: "Ask to share table", emoji: "🪑", cost: 0, type: "social" },
  { id: "spill", label: "Accidentally spill drink", emoji: "💧", cost: 0, type: "awkward" },
  { id: "check_phone", label: "Browse on phone", emoji: "📱", cost: 0, type: "observational" },
  { id: "sketch", label: "Sketch or journal", emoji: "✏️", cost: 0, type: "functional" },
  { id: "meet_regular", label: "See familiar face", emoji: "👋", cost: 0, type: "social" },
];

const DINER_ACTIONS = [
  { id: "order_breakfast", label: "Order breakfast", emoji: "🍳", cost: 8, type: "functional" },
  { id: "ask_refill", label: "Ask for refill", emoji: "☕", cost: 0, type: "functional" },
  { id: "sit_booth", label: "Claim a booth", emoji: "🪑", cost: 0, type: "functional" },
  { id: "chat_server", label: "Chat with server", emoji: "🗣️", cost: 0, type: "social" },
  { id: "linger", label: "Linger after meal", emoji: "⏰", cost: 0, type: "observational" },
  { id: "jukebox", label: "Play jukebox", emoji: "🎵", cost: 2, type: "functional" },
  { id: "pie", label: "Order pie", emoji: "🥧", cost: 5, type: "functional" },
  { id: "chat_locals", label: "Chat with locals", emoji: "👥", cost: 0, type: "social" },
  { id: "watch_cook", label: "Watch the cook work", emoji: "👨‍🍳", cost: 0, type: "observational" },
  { id: "read_menu", label: "Study the menu carefully", emoji: "📋", cost: 0, type: "observational" },
  { id: "milkshake", label: "Get a milkshake", emoji: "🥤", cost: 6, type: "functional" },
  { id: "order_late_night", label: "Order comfort food", emoji: "🍝", cost: 10, type: "functional" },
  { id: "flirt_server", label: "Flirt with server", emoji: "😉", cost: 0, type: "social" },
  { id: "sit_counter", label: "Sit at counter", emoji: "🔧", cost: 0, type: "observational" },
  { id: "overhead_story", label: "Hear someone's story", emoji: "📖", cost: 0, type: "observational" },
];

const CLUB_ACTIONS = [
  { id: "dance", label: "Hit the floor", emoji: "🕺", cost: 0, type: "social" },
  { id: "order_drink", label: "Order a drink", emoji: "🍸", cost: 8, type: "functional" },
  { id: "flirt", label: "Flirt shamelessly", emoji: "😏", cost: 0, type: "social" },
  { id: "navigate_crowd", label: "Move through crowd", emoji: "👥", cost: 0, type: "functional" },
  { id: "lose_group", label: "Lose your group", emoji: "❓", cost: 0, type: "spontaneous" },
  { id: "go_outside", label: "Step outside", emoji: "🚪", cost: 0, type: "functional" },
  { id: "vip_request", label: "Ask about VIP", emoji: "👑", cost: 0, type: "social" },
  { id: "watch_dj", label: "Watch the DJ", emoji: "🎧", cost: 0, type: "observational" },
  { id: "bathroom_break", label: "Bathroom break", emoji: "🚻", cost: 0, type: "functional" },
  { id: "bottle_service", label: "Bottle service", emoji: "🍾", cost: 100, type: "social" },
  { id: "chat_bartender", label: "Chat with bartender", emoji: "🍹", cost: 0, type: "social" },
  { id: "dance_with_stranger", label: "Dance with someone new", emoji: "💃", cost: 0, type: "social" },
  { id: "get_rejected", label: "Get shut down", emoji: "🚫", cost: 0, type: "risky" },
  { id: "make_friend", label: "Make a new friend", emoji: "👯", cost: 0, type: "social" },
  { id: "photo", label: "Take a selfie", emoji: "📸", cost: 0, type: "observational" },
];

const GYM_ACTIONS = [
  { id: "lift", label: "Lift weights", emoji: "🏋️", cost: 0, type: "functional" },
  { id: "cardio", label: "Do cardio", emoji: "🏃", cost: 0, type: "functional" },
  { id: "stretch", label: "Stretch and cool down", emoji: "🤸", cost: 0, type: "functional" },
  { id: "ask_trainer", label: "Ask the trainer", emoji: "💪", cost: 0, type: "social" },
  { id: "notice_watching", label: "Notice someone watching", emoji: "👀", cost: 0, type: "observational" },
  { id: "chat_member", label: "Chat with member", emoji: "👋", cost: 0, type: "social" },
  { id: "use_machine", label: "Try a new machine", emoji: "⚙️", cost: 0, type: "functional" },
  { id: "spot", label: "Spot someone", emoji: "🤝", cost: 0, type: "social" },
  { id: "challenge", label: "Friendly challenge", emoji: "🏆", cost: 0, type: "social" },
  { id: "locker_room", label: "Grab something from locker", emoji: "🔒", cost: 0, type: "functional" },
  { id: "class", label: "Join a class", emoji: "👥", cost: 0, type: "functional" },
  { id: "check_mirror", label: "Check yourself out", emoji: "🪞", cost: 0, type: "observational" },
];

const PARK_ACTIONS = [
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
  { id: "cloud_watch", label: "Cloud watch", emoji: "☁️", cost: 0, type: "observational" },
];

const RESTAURANT_ACTIONS = [
  { id: "order_food", label: "Order food", emoji: "🍔", cost: 18, type: "functional" },
  { id: "drinks", label: "Get drinks", emoji: "🍷", cost: 12, type: "functional" },
  { id: "dessert", label: "Order dessert", emoji: "🍰", cost: 10, type: "functional" },
  { id: "chat_server", label: "Chat with server", emoji: "🗣️", cost: 0, type: "social" },
  { id: "pick_check", label: "Pick up the check", emoji: "💳", cost: 0, type: "functional" },
  { id: "bathroom", label: "Visit bathroom", emoji: "🚻", cost: 0, type: "functional" },
  { id: "watch_kitchen", label: "Watch the kitchen", emoji: "👨‍🍳", cost: 0, type: "observational" },
  { id: "check_phone", label: "Check phone", emoji: "📱", cost: 0, type: "observational" },
  { id: "flirt_server", label: "Flirt with server", emoji: "😉", cost: 0, type: "social" },
];

const HOME_ACTIONS = [
  { id: "sit", label: "Sit down", emoji: "🛋️", cost: 0, type: "functional" },
  { id: "eat", label: "Eat something", emoji: "🍽️", cost: 0, type: "functional" },
  { id: "drink", label: "Get a drink", emoji: "🥤", cost: 0, type: "functional" },
  { id: "relax", label: "Just relax", emoji: "😌", cost: 0, type: "observational" },
  { id: "talk", label: "Talk", emoji: "💬", cost: 0, type: "social" },
  { id: "watch_tv", label: "Watch TV", emoji: "📺", cost: 0, type: "functional" },
  { id: "music", label: "Listen to music", emoji: "🎵", cost: 0, type: "observational" },
  { id: "order_takeout", label: "Order takeout", emoji: "🥡", cost: 20, type: "functional" },
  { id: "cook", label: "Cook something", emoji: "👨‍🍳", cost: 0, type: "functional" },
  { id: "nap", label: "Nap on couch", emoji: "😴", cost: 0, type: "observational" },
];

const DEFAULT_ACTIONS = [
  { id: "talk", label: "Talk", emoji: "💬", cost: 0, type: "social" },
  { id: "observe", label: "Look around", emoji: "👀", cost: 0, type: "observational" },
  { id: "joke", label: "Crack a joke", emoji: "😂", cost: 0, type: "social" },
  { id: "ask", label: "Ask something", emoji: "🤔", cost: 0, type: "social" },
];

// ── ACTION LIBRARY BY CATEGORY ────────────────────────────────────────────

const ACTION_LIBRARY_BY_CATEGORY = {
  food_drink: RESTAURANT_ACTIONS,
  home: HOME_ACTIONS,
  gym: GYM_ACTIONS,
  outdoor: PARK_ACTIONS,
  social: CLUB_ACTIONS,
};

const ACTION_LIBRARY_BY_SUBTYPE = {
  "coffee shop": COFFEE_SHOP_ACTIONS,
  "diner": DINER_ACTIONS,
  "breakfast spot": DINER_ACTIONS,
  "brunch spot": DINER_ACTIONS,
  "lunch spot": RESTAURANT_ACTIONS,
  "casual restaurant": RESTAURANT_ACTIONS,
  "fine dining": RESTAURANT_ACTIONS,
  "bar & grill": [...RESTAURANT_ACTIONS, ...CLUB_ACTIONS.slice(0, 5)],
  "bar only": CLUB_ACTIONS,
  "lounge": CLUB_ACTIONS,
  "club": CLUB_ACTIONS,
  "gym": GYM_ACTIONS,
  "park": PARK_ACTIONS,
};

// ── MAIN ACTION GENERATOR ────────────────────────────────────────────────

/**
 * Generate contextually relevant actions for a location
 * Returns 12-20 actions, rotated and varied
 * Filters out coffee-related actions after 1pm ET and near sleep times
 * Blocks all awake-only activities if character is asleep
 */
export function generateLocationActions(location, activeZone = null, hour = 12, npcPresent = [], visitCount = 0, isCharacterAsleep = false, sleepStartHour = 23) {
  if (!location) return DEFAULT_ACTIONS;

  // CRITICAL: If character is asleep, return empty array — no activities possible during sleep
  if (isCharacterAsleep) {
    return [];
  }

  // 1. Get base action library for this location
  let baseActions = [];
  
  const subtypeStr = Array.isArray(location.subtype) ? location.subtype[0] : location.subtype;
  if (subtypeStr && ACTION_LIBRARY_BY_SUBTYPE[subtypeStr.toLowerCase()]) {
    baseActions = ACTION_LIBRARY_BY_SUBTYPE[subtypeStr.toLowerCase()];
  } else if (location.category && ACTION_LIBRARY_BY_CATEGORY[location.category]) {
    baseActions = ACTION_LIBRARY_BY_CATEGORY[location.category];
  } else {
    baseActions = DEFAULT_ACTIONS;
  }

  // 2. Filter out coffee actions after 1pm ET (hour >= 13) and near sleep times (1 hour before bed)
  const coffeeDeadline = sleepStartHour > 0 ? sleepStartHour - 1 : 22; // 1 hour before sleep
  const isCoffeeProhibited = hour >= 13 || hour >= coffeeDeadline;
  
  if (isCoffeeProhibited) {
    baseActions = baseActions.filter(action => 
      !action.id.includes('coffee') && 
      action.label.toLowerCase() !== 'ask for refill' // refill often implies coffee
    );
  }

  // 3. Filter and shuffle
  return shuffle(baseActions).slice(0, Math.min(baseActions.length, 12 + Math.floor(Math.random() * 8)));
}

/**
 * Get conversation type options for a location
 */
export function getConversationTypes(location, selectedNpcs = [], employees = []) {
  const types = [
    { id: "group", label: "Talk with group", description: "Address everyone present" },
    { id: "one_on_one", label: "Pull aside for private chat", description: "One person only" },
  ];

  if (employees.length > 0) {
    types.push({
      id: "employee",
      label: "Order / Ask staff",
      description: "Brief employee interaction",
    });
  }

  return types;
}

/**
 * Fisher-Yates shuffle
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}