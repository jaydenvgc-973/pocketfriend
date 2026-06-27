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
  { id: "cloud_watch", label: "Cloud watch", emoji: "☁️", cost: 0, type: "observational" },
  { id: "sit_outside", label: "Sit outside", emoji: "🌤️", cost: 0, type: "observational" },
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

// ── HOME ──────────────────────────────────────────────────────────────────────
// ALL home actions are free. eat/drink at home use household resources, not a purchase.
const HOME_ACTIONS = classifyAll([
  { id: "sit", label: "Sit down", emoji: "🛋️", cost: 0, type: "functional", suggested_zone: "Living Room" },
  { id: "eat", label: "Eat something", emoji: "🍽️", cost: 0, type: "functional", suggested_zone: "Kitchen" },
  { id: "drink", label: "Get a drink", emoji: "🥤", cost: 0, type: "functional", suggested_zone: "Kitchen" },
  { id: "relax", label: "Just relax", emoji: "😌", cost: 0, type: "observational" },
  { id: "talk", label: "Talk", emoji: "💬", cost: 0, type: "social" },
  { id: "watch_tv", label: "Watch TV", emoji: "📺", cost: 0, type: "functional", suggested_zone: "Living Room" },
  { id: "music", label: "Listen to music", emoji: "🎵", cost: 0, type: "observational" },
  { id: "order_takeout", label: "Order takeout", emoji: "🥡", cost: 20, type: "functional", payer: "user", action_category: "food", purchase_source: "delivery" },
  { id: "cook", label: "Cook something", emoji: "👨‍🍳", cost: 0, type: "functional", suggested_zone: "Kitchen" },
  { id: "nap", label: "Nap on couch", emoji: "😴", cost: 0, type: "observational", suggested_zone: "Living Room" },
  { id: "lay_down", label: "Lie down", emoji: "🛌", cost: 0, type: "observational", suggested_zone: "Bedroom" },
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
  { id: "business_work", label: "Work", emoji: "💼", cost: 0, type: "functional", suggested_zone: "Office" },
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

// ── JAIL / PRISON ─────────────────────────────────────────────────────────────
const JAIL_ACTIONS = classifyAll([
  { id: "jail_visitation", label: "Visit inmate", emoji: "👤", cost: 0, type: "social", suggested_zone: "Visitation", requires_staff: true },
  { id: "jail_paperwork", label: "File paperwork", emoji: "📝", cost: 0, type: "functional", suggested_zone: "Records", requires_staff: true },
  { id: "jail_wait", label: "Wait to be processed", emoji: "⏳", cost: 0, type: "observational" },
  { id: "jail_talk", label: "Talk to guard", emoji: "💬", cost: 0, type: "social", requires_staff: true },
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
  { id: "clothing_accessories", label: "Check accessories", emoji: "👜", cost: 0, type: "observational", suggested_zone: "Accessories" },
  { id: "clothing_register", label: "Go to register", emoji: "🏷️", cost: 0, type: "functional", suggested_zone: "Register", requires_staff: true },
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
  shoe_store:            CLOTHING_STORE_ACTIONS,
  accessories:           CLOTHING_STORE_ACTIONS,
  // General retail
  bookstore:         RETAIL_STORE_ACTIONS,
  record_store:      RETAIL_STORE_ACTIONS,
  electronics_store: RETAIL_STORE_ACTIONS,
  home_goods:        RETAIL_STORE_ACTIONS,
  toy_store:         RETAIL_STORE_ACTIONS,
  gift_shop:         RETAIL_STORE_ACTIONS,
  retail:            RETAIL_STORE_ACTIONS,
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
export function generateLocationActions(location, activeZone = null, hour = 12, options = {}) {
  if (!location) return DEFAULT_ACTIONS;
  if (options.isCharacterAsleep) return [];

  const actions = resolveActionLibrary(location);

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