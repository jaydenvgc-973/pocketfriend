/**
 * sceneStripConfig.js — the scene strip's own configuration.
 *
 * Directed interactions act on ONE chosen person who is actually present. They are
 * performed through the existing scene/narrative pathway — no new system.
 * `verb` is what the person is doing now; `past_verb` is the same thing already done, for
 * the moments that are established the instant they are chosen (a kiss has happened).
 */
export const DIRECTED_SCENE_ACTIONS = [
  { id: "kiss", label: "Kiss", emoji: "💋", verb: "kisses", past_verb: "kissed" },
  // Friendship interactions. The chosen person starts them in their own words or through a
  // real gesture, and the other answers however they actually would.
  { id: "goof_around", label: "Goof Around", emoji: "😄", verb: "goofs around with", past_verb: "goofed around with" },
  { id: "show_appreciation", label: "Show Appreciation", emoji: "🙏", verb: "shows appreciation to", past_verb: "showed appreciation to" },
  { id: "bond_with", label: "Bond With", emoji: "🤝", verb: "shares a real moment with", past_verb: "shared a real moment with" },
  { id: "flirt_with", label: "Flirt With", emoji: "😘", verb: "flirts with", past_verb: "flirted with" },
  { id: "argue_with", label: "Argue With", emoji: "💢", verb: "argues with", past_verb: "argued with" },
  // A physical confrontation, not a louder argument. Same who-and-who selector as Argue
  // With; Argue With keeps its own meaning and both stay available.
  { id: "fight_with", label: "Fight With", emoji: "🥊", verb: "fights", past_verb: "fought" },
  // Moonwink is a moment between two chosen adults, so it uses the same who-and-who
  // selection as Kiss and Flirt With. The strip title is interface-only: the verb and the
  // in-world wording are what the scene is given, never the button's name.
  { id: "moonwink", label: "Moonwink", emoji: "🌙", verb: "is intimate with", adults_only: true },
];

// Moonwink is drawn in the directed row beside Kiss and Flirt With. Its venue entry stays
// in the activity catalog — it is still this place's activity — but it is never drawn a
// second time as a one-person button.
export const MOONWINK_ACTION_ID = "moonwink";

export function stripActions(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((a) => a.id !== MOONWINK_ACTION_ID);
}

// ── STRIP ORGANIZATION ────────────────────────────────────────────────────────
// The strip is shown in three groups, in this order:
//   1. This place   — the venue's own activities (courtroom procedure, jail procedure,
//                     hotel desk, salon services…). They are the reason the user came
//                     here, so they come first whatever their Life Need effect.
//   2. Life Needs   — the everyday activities that address one of the eight established
//                     needs. Grouping only: no effect, value or calculation changes.
//   3. General      — the general interactions below, in exactly this relative order.
// Every activity appears in exactly ONE group.
// Send Money, Receive Money, Invite Character and Arrest are scene controls drawn inside
// this same folder; the list below is the activities between them.
export const GENERAL_STRIP_ORDER = [
  "goof_around",      // friendship — the actor starts the joking themselves
  "show_appreciation", // friendship — the actor actually says or does it
  "bond_with",        // friendship — a real shared moment, not an announcement
  "flirt_with",
  "kiss",
  "moonwink",         // existing pair activity — keeps its own place beside Kiss
  "wedding_ceremony", // the Wedding Ceremony action (gov_marry on a home / church)
  "smoke",
  "argue_with",
  "fight_with",
  "pickpocket",
  "burglarize",
  "call_the_cops",    // Arrest and Next Scene follow, as scene controls
];

/**
 * The general-order key of an activity, or null when it is not one of the general
 * activities. The marriage action is venue-supplied (a home or a church carries it); only
 * its Wedding Ceremony instance belongs in the general order — a City Hall Civil Marriage
 * is that venue's own business and stays in the first group.
 */
export function generalStripKey(action) {
  if (!action) return null;
  if (action.id === "gov_marry") {
    return String(action.label || "").toLowerCase() === "wedding ceremony" ? "wedding_ceremony" : null;
  }
  return GENERAL_STRIP_ORDER.includes(action.id) ? action.id : null;
}

// The eight established Life Needs, in their established order. These are groupings for
// finding an activity — never a second set of need rules.
export const LIFE_NEED_ORDER = ["hunger", "energy", "social", "health", "mental", "financial", "hygiene", "comfort"];

export const LIFE_NEED_LABELS = {
  hunger: "Hunger",
  energy: "Energy",
  social: "Social",
  health: "Health",
  mental: "Mental",
  financial: "Financial",
  hygiene: "Hygiene",
  comfort: "Comfort",
};

// Which need an existing activity is grouped under. Membership says only where the button
// is found — an activity's established effects are unchanged (shopping spends money
// rather than satisfying Financial; smoking does not improve Health).
const NEED_ACTION_IDS = {
  hunger: [
    "eat", "cook", "drink", "order", "order_breakfast", "order_coffee", "order_pastry",
    "order_late_night", "order_takeout", "ask_refill", "dessert", "pie", "milkshake",
    "drinks", "order_drink", "buy_round", "char_buy_round", "char_pays", "check",
    "hotel_dining", "hotel_drink", "school_lunch", "workplace_lunch", "workplace_break",
    "education_break", "buffet_plate", "buffet_water", "grocery_shopping", "sample",
    "produce", "read_menu", "linger", "sit_booth", "sit_counter", "bottle_service",
    "picnic", "share_table", "shelter_eat", "jail_eat", "jail_meal_tray",
    "unhoused_eat", "unhoused_water",
  ],
  energy: [
    "lay_down", "nap", "relax", "hotel_relax", "shelter_rest", "sleep", "watch_tv",
    "unhoused_sleep", "unhoused_rest",
  ],
  social: [
    "talk", "chat", "chat_bartender", "chat_classmates", "chat_locals", "chat_member",
    "chat_server", "chat_stranger", "make_friend", "meet_regular", "community_talk",
    "community_gather", "community_activity", "community_event", "community_volunteer",
    "education_group", "workplace_chat", "jail_talk", "jail_talk_prisoners",
    "jail_visitation", "jail_meet_visitor", "jail_social_worker", "salon_chat",
    "salon_gossip", "buffet_server", "flirt", "flirt_server", "dance",
    "dance_with_stranger", "joke", "pass_note", "group", "one_on_one", "ask",
    "ask_question", "ask_help", "ask_aisle", "ask_trainer", "employee",
    "religion_community", "religion_talk", "shelter_talk", "medical_ask",
    "hotel_concierge", "retail_ask", "clothing_ask_price", "clothing_ask_size",
    "shoe_ask_price", "shoe_ask_size", "accessories_ask", "gov_ask", "vip_request",
    "overhear", "overhead_story", "notice_watching", "unhoused_socialize",
  ],
  health: [
    "exercise", "workout", "home_workout", "lift", "cardio", "spot", "challenge",
    "class", "use_machine", "stretch", "jail_exercise", "school_sports", "hotel_gym",
    "medical_visit", "medical_intake", "medical_pharmacy", "medical_wait",
    "medical_phone", "jail_request_medical", "jail_receive_medical", "bathroom",
    "bathroom_break",
  ],
  mental: [
    "read", "study", "sketch", "observe", "people_watch", "cloud_watch", "watch_sunset",
    "music", "jukebox", "play", "photo", "check_phone", "religion_pray",
    "religion_quiet", "religion_study", "religion_service", "shelter_quiet",
    "education_library", "education_note", "education_class", "education_ask",
    "school_class", "school_hall", "jail_read_write", "watch_cook", "watch_dj",
    "watch_kitchen",
  ],
  financial: [
    "business_work", "business_meet", "workplace_email", "workplace_phone",
    "workplace_checkin", "gov_documents", "gov_forms", "gov_payment", "buy",
    "buy_outfit", "checkout", "retail_checkout", "clothing_buy", "clothing_register",
    "shoe_buy", "accessories_buy", "shop_mens_clothing", "shop_womens_clothing",
    "buy_home_goods", "buy_music", "buy_books", "buy_electronics", "buy_toys",
    "buy_gifts", "salon_book", "hotel_checkin", "hotel_checkout", "shelter_checkin",
    "shelter_resources", "jail_paperwork", "jail_phone_call", "list",
    "clothing_browse", "shoe_browse", "accessories_browse", "retail_browse",
  ],
  hygiene: [
    "home_shower", "home_brush_teeth", "home_clean_up", "home_dishes",
    "home_make_bed", "jail_shower", "jail_change_clothing", "salon_cut", "salon_color",
    "salon_nails", "check_mirror", "try_on", "clothing_try_on", "shoe_sit_try",
    "shoe_walk_fit", "shoe_mirror", "accessories_try", "accessories_mirror",
    "clothing_accessories", "locker_room",
  ],
  comfort: [
    "sit", "sit_bench", "sit_outside", "sit_work", "find_somewhere_warm", "go_outside",
    "hotel_room",
  ],
};

// Families of established activities that all address the same need.
const NEED_ACTION_PREFIXES = {
  hunger: ["sk_", "bar_food_"],
};

const NEED_BY_ACTION_ID = (() => {
  const map = {};
  for (const need of LIFE_NEED_ORDER) {
    for (const id of NEED_ACTION_IDS[need] || []) if (!map[id]) map[id] = need;
  }
  return map;
})();

/** The Life Need an existing activity is grouped under, or null. */
export function needForAction(action) {
  if (!action?.id) return null;
  if (NEED_BY_ACTION_ID[action.id]) return NEED_BY_ACTION_ID[action.id];
  for (const need of LIFE_NEED_ORDER) {
    if ((NEED_ACTION_PREFIXES[need] || []).some((p) => action.id.startsWith(p))) return need;
  }
  return null;
}

/**
 * Split the strip's activities into the three groups, each activity exactly once.
 * Order is preserved inside every group; the Life Needs group follows the established
 * need order, and the General group follows GENERAL_STRIP_ORDER.
 */
export function buildActivitySections(list) {
  const place = [];
  const needs = [];
  const general = [];
  for (const action of list || []) {
    if (!action?.id) continue;
    if (generalStripKey(action)) { general.push(action); continue; }
    const need = needForAction(action);
    if (need) { needs.push({ action, need }); continue; }
    place.push(action);
  }
  needs.sort((a, b) => LIFE_NEED_ORDER.indexOf(a.need) - LIFE_NEED_ORDER.indexOf(b.need));
  return { place, needs, general };
}

export const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  food_drink: "🍽️", outdoor: "🌳", social: "🍸", medical: "🏨",
  bar: "🍸", generic: "📍", transportation: "🚉"
};

/**
 * The user's OWN presence, as the unified presence list represents it (`user_<id>`),
 * and the active user participant are the SAME person. Both must never become two
 * participants in the scene, its images, or its counts.
 */
export function isUserPresenceEntity(entity, userId) {
  if (!entity) return false;
  if (entity.effective_presence_type === 'user' || entity.is_user === true) return true;
  if (userId && entity.id === userId) return true;
  return typeof entity.id === 'string' && entity.id.startsWith('user_');
}