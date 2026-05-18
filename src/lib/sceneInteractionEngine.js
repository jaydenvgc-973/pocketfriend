/**
 * sceneInteractionEngine.js
 *
 * Provides category + zone aware interactions for the Scene page.
 *
 * RULES:
 * - Interactions come from location category first
 * - Venue type / subtype can refine
 * - Active zone narrows the list further
 * - Zone routing only targets REAL zones that exist on the location record
 * - Prices come from location.services config — never hallucinated
 * - Workers come from location assignments — never invented
 */

// ────────────────────────────────────────────────────────────────────────────
// SECTION 1: Category default interaction templates
// Each action: { id, label, emoji, category, action_type, result_prompt,
//   required_zone_types (optional array of fuzzy zone matches),
//   cost_config_key (looks up in location.services), default_cost,
//   payer, type, blocks_if_unavailable }
// ────────────────────────────────────────────────────────────────────────────

const CATEGORY_INTERACTIONS = {
  government: [
    { id: "get_marriage_license", label: "Get marriage license", emoji: "💍", action_type: "service", required_zone_types: ["clerk", "records", "office", "lobby"], cost_config_key: "marriage_license", default_cost: 85, payer: "user", type: "positive", result_prompt: "You approach the clerk's window to apply for a marriage license." },
    { id: "get_birth_certificate", label: "Request birth certificate", emoji: "📄", action_type: "service", required_zone_types: ["records", "clerk", "office"], cost_config_key: "birth_certificate", default_cost: 25, payer: "user", type: "positive", result_prompt: "You request a copy of a birth certificate from the records office." },
    { id: "renew_id", label: "Renew ID / license", emoji: "🪪", action_type: "service", required_zone_types: ["dmv", "id", "clerk", "office", "lobby"], cost_config_key: "state_id", default_cost: 40, payer: "user", type: "positive", result_prompt: "You fill out the forms to renew your identification." },
    { id: "apply_permit", label: "Apply for permit", emoji: "📋", action_type: "service", required_zone_types: ["permits", "clerk", "office"], cost_config_key: "permit_fee", default_cost: 50, payer: "user", type: "neutral", result_prompt: "You submit a permit application at the appropriate window." },
    { id: "appear_in_court", label: "Appear in court", emoji: "⚖️", action_type: "service", required_zone_types: ["court", "courtroom"], cost_config_key: "court_filing_fee", default_cost: 0, payer: "user", type: "neutral", result_prompt: "You enter the courtroom for your scheduled appearance.", blocks_if_unavailable: true },
    { id: "speak_to_clerk", label: "Speak to clerk", emoji: "🗣️", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You wait at the counter to speak with the clerk on duty." },
    { id: "wait_in_line", label: "Wait in line", emoji: "🕐", action_type: "wait", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You take a number and wait your turn." },
    { id: "go_through_security", label: "Go through security", emoji: "🔐", action_type: "move", required_zone_types: ["security", "entrance", "lobby", "checkpoint"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You hand over your bag and walk through the security checkpoint.", blocks_if_unavailable: false },
    { id: "pay_fine", label: "Pay court fine", emoji: "💵", action_type: "payment", required_zone_types: ["court", "clerk", "cashier", "records"], cost_config_key: "court_fine", default_cost: 125, payer: "user", type: "negative", result_prompt: "You pay the outstanding fine at the cashier window." },
  ],

  hotel: [
    { id: "check_in", label: "Check in", emoji: "🏨", action_type: "service", required_zone_types: ["front desk", "lobby", "reception"], cost_config_key: "nightly_rate", default_cost: 180, payer: "user", type: "positive", result_prompt: "You approach the front desk to check in for your stay." },
    { id: "check_out", label: "Check out", emoji: "🔑", action_type: "service", required_zone_types: ["front desk", "lobby", "reception"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You return the keycard and settle your bill at the front desk." },
    { id: "hold_bags", label: "Ask to hold bags", emoji: "🧳", action_type: "service", required_zone_types: ["front desk", "lobby", "reception", "concierge"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You ask the front desk to hold your luggage while you wait." },
    { id: "look_at_room", label: "Look at a room", emoji: "🚪", action_type: "explore", required_zone_types: ["room", "suite", "floor"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You ask to see a sample room before deciding." },
    { id: "go_to_room", label: "Go to room", emoji: "🛏️", action_type: "move", required_zone_types: ["room", "suite", "floor", "hallway"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You head up to your room to settle in." },
    { id: "ask_about_pool", label: "Ask about pool", emoji: "🏊", action_type: "inquire", required_zone_types: ["front desk", "lobby", "concierge", "pool"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You ask the front desk for information about the pool hours and location." },
    { id: "ask_about_gym", label: "Ask about gym", emoji: "🏋️", action_type: "inquire", required_zone_types: ["front desk", "lobby", "concierge", "gym", "fitness"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You inquire about gym access during your stay." },
    { id: "request_towels", label: "Request extra towels", emoji: "🛁", action_type: "service", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You call down to housekeeping for extra towels." },
    { id: "complain_room", label: "Complain about room", emoji: "😤", action_type: "interact", required_zone_types: ["front desk", "lobby", "reception"], cost_config_key: null, default_cost: 0, payer: null, type: "negative", result_prompt: "You return to the front desk to raise a complaint about your room." },
    { id: "room_service", label: "Order room service", emoji: "🍽️", action_type: "purchase", required_zone_types: null, cost_config_key: "room_service", default_cost: 35, payer: "user", type: "positive", result_prompt: "You dial room service and place your order." },
    { id: "late_checkout", label: "Request late checkout", emoji: "⏰", action_type: "service", required_zone_types: ["front desk", "lobby"], cost_config_key: "late_checkout", default_cost: 35, payer: "user", type: "neutral", result_prompt: "You ask about extending your checkout time." },
  ],

  shelter: [
    { id: "go_over_rules", label: "Go over rules", emoji: "📋", action_type: "service", required_zone_types: ["lobby", "intake", "office", "front desk"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "An intake worker walks you through the shelter's rules and expectations." },
    { id: "sign_paperwork", label: "Sign paperwork", emoji: "✍️", action_type: "service", required_zone_types: ["intake", "office", "front desk", "lobby"], cost_config_key: "intake_fee", default_cost: 0, payer: "user", type: "neutral", result_prompt: "You fill out and sign the intake forms." },
    { id: "find_bed", label: "Find a bed", emoji: "🛏️", action_type: "service", required_zone_types: ["dorm", "sleeping", "beds", "room", "floor"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "A shelter monitor shows you to an available bed.", blocks_if_unavailable: true },
    { id: "speak_intake", label: "Speak with intake worker", emoji: "🗣️", action_type: "interact", required_zone_types: ["intake", "office", "lobby", "front desk"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You sit down with the intake worker to discuss your situation." },
    { id: "ask_meals", label: "Ask about meals", emoji: "🍲", action_type: "inquire", required_zone_types: ["kitchen", "dining", "cafeteria", "lobby"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You ask what time meals are served and what's on the menu." },
    { id: "ask_showers", label: "Ask about showers", emoji: "🚿", action_type: "inquire", required_zone_types: ["bathroom", "shower", "hygiene", "lobby"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You find out when shower time is and where the bathrooms are." },
    { id: "make_friend", label: "Make a friend", emoji: "🤝", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You introduce yourself to someone else staying at the shelter." },
    { id: "wait_placement", label: "Wait for placement", emoji: "🕐", action_type: "wait", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You take a seat in the waiting area while case management reviews your situation." },
    { id: "rent_locker", label: "Rent a locker", emoji: "🔒", action_type: "purchase", required_zone_types: ["locker", "storage", "lobby"], cost_config_key: "locker_rental", default_cost: 5, payer: "user", type: "positive", result_prompt: "You pay for a small locker to secure your belongings." },
  ],

  gym: [
    { id: "find_locker", label: "Find a locker", emoji: "🔒", action_type: "explore", required_zone_types: ["locker", "locker room", "changing"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You head to the locker room to stow your gear." },
    { id: "ask_membership", label: "Ask about membership", emoji: "💳", action_type: "inquire", required_zone_types: ["front desk", "lobby", "reception"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You ask the front desk about membership options and pricing." },
    { id: "buy_membership", label: "Buy membership", emoji: "✅", action_type: "purchase", required_zone_types: ["front desk", "lobby", "reception"], cost_config_key: "monthly_membership", default_cost: 45, payer: "user", type: "positive", result_prompt: "You sign up for a gym membership at the front desk." },
    { id: "day_pass", label: "Buy day pass", emoji: "🎫", action_type: "purchase", required_zone_types: ["front desk", "lobby", "reception"], cost_config_key: "day_pass", default_cost: 15, payer: "user", type: "positive", result_prompt: "You pay for a day pass to use the facilities." },
    { id: "clean_machine", label: "Clean a machine", emoji: "🧹", action_type: "task", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You grab a paper towel and wipe down the equipment after use." },
    { id: "use_treadmill", label: "Use treadmill", emoji: "🏃", action_type: "activity", required_zone_types: ["cardio", "gym floor", "fitness", "treadmill"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You hop on an available treadmill and start your cardio session." },
    { id: "lift_weights", label: "Lift weights", emoji: "🏋️", action_type: "activity", required_zone_types: ["weights", "gym floor", "fitness", "strength"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You head to the free weights section and start lifting." },
    { id: "ask_trainer", label: "Ask trainer for help", emoji: "🙋", action_type: "interact", required_zone_types: ["gym floor", "fitness", "trainer", "studio"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You flag down a trainer to ask for form tips or a custom program." },
    { id: "book_trainer", label: "Book trainer session", emoji: "📅", action_type: "purchase", required_zone_types: ["front desk", "lobby", "trainer", "studio"], cost_config_key: "personal_trainer", default_cost: 60, payer: "user", type: "positive", result_prompt: "You book a one-on-one personal training session." },
    { id: "shower_change", label: "Shower / change", emoji: "🚿", action_type: "task", required_zone_types: ["locker room", "shower", "changing", "bathroom"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You hit the showers after a solid workout session." },
    { id: "yoga_class", label: "Join yoga class", emoji: "🧘", action_type: "purchase", required_zone_types: ["studio", "yoga", "class"], cost_config_key: "yoga_class", default_cost: 20, payer: "user", type: "positive", result_prompt: "You join the yoga class in the studio." },
  ],

  food_drink: [
    { id: "order_food", label: "Order food", emoji: "🍔", action_type: "purchase", required_zone_types: null, cost_config_key: "food_order", default_cost: 18, payer: "user", type: "positive", result_prompt: "You flag down the server and place your food order." },
    { id: "order_drink", label: "Order a drink", emoji: "🍹", action_type: "purchase", required_zone_types: null, cost_config_key: "drink_order", default_cost: 12, payer: "user", type: "positive", result_prompt: "You order a drink from the bar or server." },
    { id: "ask_menu", label: "Ask for menu", emoji: "📖", action_type: "inquire", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You ask the server for a menu to look over the options." },
    { id: "pay_tab", label: "Pay the tab", emoji: "🧾", action_type: "payment", required_zone_types: null, cost_config_key: "tab", default_cost: 40, payer: "user", type: "positive", result_prompt: "You ask for the check and pay the bill." },
    { id: "char_pays", label: "Let them cover it", emoji: "💳", action_type: "payment", required_zone_types: null, cost_config_key: null, default_cost: 40, payer: "character", type: "positive", result_prompt: "You let the other person pick up the tab this time." },
    { id: "sit_at_bar", label: "Sit at bar", emoji: "🪑", action_type: "move", required_zone_types: ["bar", "counter", "bartop"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You take a seat at the bar and get comfortable." },
    { id: "talk_bartender", label: "Talk to bartender", emoji: "🍸", action_type: "interact", required_zone_types: ["bar", "counter"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You strike up a conversation with the bartender." },
    { id: "use_restroom", label: "Use restroom", emoji: "🚻", action_type: "task", required_zone_types: ["restroom", "bathroom"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You excuse yourself to find the restroom." },
    { id: "find_table", label: "Find a table", emoji: "🪑", action_type: "move", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You scan the room for an available table and grab it." },
    { id: "buy_round", label: "Buy a round", emoji: "🥂", action_type: "purchase", required_zone_types: null, cost_config_key: "round_of_drinks", default_cost: 25, payer: "user", type: "positive", result_prompt: "You treat everyone at the table to a round of drinks." },
  ],

  social: [
    { id: "order_drink_social", label: "Order a drink", emoji: "🍸", action_type: "purchase", required_zone_types: null, cost_config_key: "drink_order", default_cost: 14, payer: "user", type: "positive", result_prompt: "You order a drink from the bar." },
    { id: "dance", label: "Hit the dance floor", emoji: "🕺", action_type: "activity", required_zone_types: ["dance floor", "dance", "floor"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You make your way to the dance floor and lose yourself in the music." },
    { id: "talk_someone", label: "Talk to someone", emoji: "💬", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You catch someone's eye and strike up a conversation." },
    { id: "check_coat", label: "Check coat", emoji: "🧥", action_type: "service", required_zone_types: ["coat check", "entrance", "lobby"], cost_config_key: "coat_check", default_cost: 5, payer: "user", type: "neutral", result_prompt: "You hand your coat to the coat check attendant." },
    { id: "find_booth", label: "Find a booth", emoji: "🪑", action_type: "move", required_zone_types: ["vip", "booth", "lounge", "seating"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You scout out an open booth and claim it for the group." },
    { id: "tip_bartender", label: "Tip the bartender", emoji: "💵", action_type: "payment", required_zone_types: ["bar", "counter"], cost_config_key: null, default_cost: 10, payer: "user", type: "positive", result_prompt: "You leave a generous tip for the bartender." },
    { id: "watch_performance", label: "Watch performance", emoji: "🎤", action_type: "observe", required_zone_types: ["stage", "performance", "floor", "main room"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You turn your attention to the performer on stage." },
    { id: "buy_round_social", label: "Buy a round", emoji: "🥂", action_type: "purchase", required_zone_types: null, cost_config_key: "round_of_drinks", default_cost: 25, payer: "user", type: "positive", result_prompt: "You announce you're buying the next round." },
    { id: "flirt", label: "Flirt a little", emoji: "😏", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You lean in and exchange a few flirtatious words." },
  ],

  medical: [
    { id: "check_in_medical", label: "Check in", emoji: "📋", action_type: "service", required_zone_types: ["reception", "lobby", "front desk", "waiting"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You approach the reception desk and check in for your appointment." },
    { id: "fill_forms", label: "Fill out forms", emoji: "✍️", action_type: "task", required_zone_types: ["waiting", "reception", "lobby"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You take a seat and work through the intake paperwork." },
    { id: "wait_to_be_called", label: "Wait to be called", emoji: "🕐", action_type: "wait", required_zone_types: ["waiting", "lobby", "reception"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You take a seat in the waiting area and wait for your name to be called." },
    { id: "see_nurse", label: "See nurse", emoji: "👩‍⚕️", action_type: "service", required_zone_types: ["exam room", "triage", "nurse", "clinical"], cost_config_key: "copay", default_cost: 20, payer: "user", type: "positive", result_prompt: "A nurse calls you back to take your vitals and review your symptoms.", blocks_if_unavailable: true },
    { id: "see_doctor", label: "See doctor", emoji: "🩺", action_type: "service", required_zone_types: ["exam room", "doctor", "clinical", "office"], cost_config_key: "copay", default_cost: 40, payer: "user", type: "positive", result_prompt: "The doctor enters the exam room to discuss your condition.", blocks_if_unavailable: true },
    { id: "pick_up_prescription", label: "Pick up prescription", emoji: "💊", action_type: "purchase", required_zone_types: ["pharmacy", "counter", "reception"], cost_config_key: "prescription_fee", default_cost: 20, payer: "user", type: "positive", result_prompt: "You head to the pharmacy window to pick up your prescription." },
    { id: "billing_question", label: "Ask billing question", emoji: "💵", action_type: "inquire", required_zone_types: ["billing", "reception", "lobby", "office"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You ask the billing department about a charge on your account." },
  ],

  education: [
    { id: "attend_class", label: "Attend class", emoji: "📚", action_type: "activity", required_zone_types: ["classroom", "lecture", "hall", "lab"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You take your seat as class begins." },
    { id: "study", label: "Study", emoji: "📖", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You spread out your notes and get into study mode." },
    { id: "ask_question", label: "Ask a question", emoji: "✋", action_type: "interact", required_zone_types: ["classroom", "lecture", "hall", "office"], cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You raise your hand and ask the instructor a question." },
    { id: "meet_professor", label: "Meet professor", emoji: "👨‍🏫", action_type: "interact", required_zone_types: ["office", "classroom", "faculty"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You stop by office hours to speak with the professor." },
    { id: "enroll_class", label: "Enroll in a class", emoji: "📝", action_type: "service", required_zone_types: ["registrar", "office", "admin", "lobby"], cost_config_key: "tuition", default_cost: 0, payer: "user", type: "positive", result_prompt: "You visit the registrar to enroll in a new course." },
    { id: "pass_note", label: "Pass a note", emoji: "📝", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You slide a folded note across to someone nearby." },
  ],

  community: [
    { id: "join_activity", label: "Join an activity", emoji: "🎯", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You join in on whatever activity is going on." },
    { id: "talk_staff", label: "Talk to staff", emoji: "🗣️", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You chat with one of the community center staff members." },
    { id: "sign_up", label: "Sign up for program", emoji: "📋", action_type: "service", required_zone_types: ["office", "front desk", "lobby"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You ask to sign up for one of the center's programs." },
    { id: "use_resource", label: "Use a resource", emoji: "📂", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You make use of one of the community resources available." },
    { id: "meet_someone", label: "Meet someone new", emoji: "🤝", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You introduce yourself to someone else visiting the center." },
  ],

  jail_prison: [
    { id: "visitation", label: "Visitation", emoji: "👋", action_type: "interact", required_zone_types: ["visitation", "visiting room", "lobby"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You are escorted to the visitation area to meet with your visitor.", blocks_if_unavailable: true },
    { id: "speak_to_guard", label: "Speak to guard", emoji: "🔐", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You get the attention of a nearby guard to ask something." },
    { id: "request_call", label: "Request phone call", emoji: "📞", action_type: "service", required_zone_types: ["phone", "common area", "pod"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You request to use the phone to make a supervised call." },
    { id: "yard_time", label: "Go to yard", emoji: "🌤️", action_type: "activity", required_zone_types: ["yard", "outdoor", "recreation"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You head out to the yard during recreation time." },
    { id: "speak_case_manager", label: "Speak with case manager", emoji: "📋", action_type: "interact", required_zone_types: ["office", "case management", "admin"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You are brought to the case manager's office to discuss your case." },
  ],

  home: [
    { id: "sit", label: "Sit down", emoji: "🛋️", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You settle onto the couch or a comfortable chair." },
    { id: "eat", label: "Eat something", emoji: "🍽️", action_type: "activity", required_zone_types: ["kitchen", "dining", "living room"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You grab something to eat from the kitchen." },
    { id: "drink", label: "Get a drink", emoji: "🥤", action_type: "activity", required_zone_types: ["kitchen"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You head to the kitchen to pour yourself something to drink." },
    { id: "relax", label: "Just relax", emoji: "😌", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You let yourself fully relax and decompress at home." },
    { id: "talk", label: "Start talking", emoji: "💬", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You settle in and start up a conversation." },
    { id: "order_takeout", label: "Order takeout", emoji: "🥡", action_type: "purchase", required_zone_types: null, cost_config_key: null, default_cost: 20, payer: "user", type: "positive", result_prompt: "You pull out your phone and order food for delivery." },
    { id: "lay_down", label: "Lay down", emoji: "🛏️", action_type: "activity", required_zone_types: ["bedroom", "living room", "couch"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You find a comfortable spot and lie down for a bit." },
    { id: "cook", label: "Cook something", emoji: "🍳", action_type: "activity", required_zone_types: ["kitchen"], cost_config_key: null, default_cost: 10, payer: "user", type: "positive", result_prompt: "You head into the kitchen to cook a meal." },
  ],

  outdoor: [
    { id: "walk", label: "Go for a walk", emoji: "🚶", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You set off on a relaxing walk through the area." },
    { id: "sit_outside", label: "Sit outside", emoji: "🌤️", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You find a bench or patch of grass and sit down to enjoy the fresh air." },
    { id: "photo", label: "Take a picture", emoji: "📸", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You take in the scenery and snap a few photos." },
    { id: "talk", label: "Talk it out", emoji: "💬", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You find a quiet spot and settle in for a real conversation." },
    { id: "exercise", label: "Work out outside", emoji: "🏃", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You use the outdoor space to stretch and exercise." },
  ],

  business: [
    { id: "browse", label: "Browse items", emoji: "🛍️", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You browse the merchandise on display." },
    { id: "try_on", label: "Try something on", emoji: "👗", action_type: "activity", required_zone_types: ["fitting room", "dressing room"], cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You take an item to the fitting room to try it on." },
    { id: "ask_help", label: "Ask for help", emoji: "🙋", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You wave over a staff member to ask for assistance." },
    { id: "buy", label: "Buy something", emoji: "💳", action_type: "purchase", required_zone_types: ["checkout", "counter", "register", "cashier"], cost_config_key: null, default_cost: 35, payer: "user", type: "positive", result_prompt: "You bring your selection to the checkout and pay." },
  ],

  grocery: [
    { id: "shop", label: "Grab items", emoji: "🛒", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You grab a basket and start filling it with what you need." },
    { id: "checkout", label: "Check out", emoji: "💳", action_type: "purchase", required_zone_types: ["checkout", "register", "cashier", "self checkout"], cost_config_key: null, default_cost: 60, payer: "user", type: "positive", result_prompt: "You head to the checkout and pay for your groceries." },
    { id: "ask_aisle", label: "Ask where something is", emoji: "🙋", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You flag down an employee to ask which aisle has what you're looking for." },
    { id: "talk", label: "Small talk", emoji: "💬", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You make small talk with the cashier or someone nearby." },
  ],

  school: [
    { id: "study", label: "Study together", emoji: "📚", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You find a quiet corner to study together." },
    { id: "ask_question", label: "Ask a question", emoji: "✋", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You raise your hand and ask the teacher a question." },
    { id: "pass_note", label: "Pass a note", emoji: "📝", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "positive", result_prompt: "You carefully pass a note to someone nearby." },
    { id: "chat", label: "Chat between class", emoji: "💬", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You catch up with someone in the hallway between classes." },
  ],
};

const DEFAULT_INTERACTIONS = [
  { id: "talk", label: "Talk", emoji: "💬", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You strike up a conversation." },
  { id: "observe", label: "Look around", emoji: "👀", action_type: "observe", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You take in the surroundings." },
  { id: "sit", label: "Have a seat", emoji: "🪑", action_type: "activity", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You find a place to sit down." },
  { id: "ask", label: "Ask something", emoji: "🤔", action_type: "interact", required_zone_types: null, cost_config_key: null, default_cost: 0, payer: null, type: "neutral", result_prompt: "You think of something to ask." },
];

// ────────────────────────────────────────────────────────────────────────────
// SECTION 2: Zone name fuzzy match
// ────────────────────────────────────────────────────────────────────────────

function zoneMatchesType(zoneName, zoneTypes) {
  if (!zoneTypes || zoneTypes.length === 0) return null; // no requirement
  if (!zoneName) return null;
  const lower = zoneName.toLowerCase();
  for (const t of zoneTypes) {
    if (lower.includes(t.toLowerCase())) return zoneName;
  }
  return null;
}

/**
 * Given a location and an interaction's required_zone_types,
 * find a matching REAL zone on the location record.
 * Returns { matched: true, zone_name, zone_id } or { matched: false, unavailable_reason }
 */
export function resolveSceneInteractionTargetZone(location, interaction) {
  const requiredZoneTypes = interaction.required_zone_types;

  // No zone requirement — always available wherever user is
  if (!requiredZoneTypes || requiredZoneTypes.length === 0) {
    return { matched_from_existing_zone: true, target_zone_name: null, target_zone_id: null };
  }

  const zones = location?.zones || [];
  if (zones.length === 0) {
    // No zones on location — can still do actions without zone routing
    return { matched_from_existing_zone: false, target_zone_name: null, target_zone_id: null, unavailable_reason: "Location has no zones configured" };
  }

  // Try to find a real zone that matches the required types
  for (const zone of zones) {
    const matched = zoneMatchesType(zone.zone_name, requiredZoneTypes);
    if (matched) {
      return {
        matched_from_existing_zone: true,
        target_zone_name: zone.zone_name,
        target_zone_id: zone.zone_name, // using name as ID since zones array uses name
      };
    }
  }

  // No real zone matches — do NOT invent one
  return {
    matched_from_existing_zone: false,
    target_zone_name: null,
    target_zone_id: null,
    unavailable_reason: `Required zone type (${requiredZoneTypes.join(", ")}) not found at this location`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 3: Pricing resolution — from location.services config, never invented
// ────────────────────────────────────────────────────────────────────────────

function resolveInteractionCost(interaction, location) {
  if (!interaction.cost_config_key) return { cost: interaction.default_cost || 0, price_source: "default" };

  // Check location.services array
  const services = location?.services || [];
  const found = services.find(s =>
    s.service_name?.toLowerCase().replace(/\s+/g, "_") === interaction.cost_config_key ||
    s.category === interaction.cost_config_key
  );
  if (found && typeof found.price === "number") {
    return { cost: found.price, price_source: "configured" };
  }

  // Check flat location fields (e.g. gym_membership_fee, nightly_rate)
  const fieldMap = {
    monthly_membership: location?.gym_membership_fee,
    nightly_rate: location?.nightly_rate,
    day_pass: null, // not a standard field yet
  };
  const fromField = fieldMap[interaction.cost_config_key];
  if (typeof fromField === "number") {
    return { cost: fromField, price_source: "location_field" };
  }

  // Fall back to template default — mark as template so UI can display accordingly
  if (typeof interaction.default_cost === "number" && interaction.default_cost > 0) {
    return { cost: interaction.default_cost, price_source: "template_default" };
  }

  return { cost: 0, price_source: "unavailable" };
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 4: Main entry point — getSceneInteractions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns interaction actions for the current scene.
 *
 * @param {object} location — full LocationReference record
 * @param {string|null} activeZone — currently active zone name
 * @param {object|null} character — primary character in scene (optional)
 * @returns {Array} — enriched action objects ready for the action strip
 */
export function getSceneInteractions(location, activeZone, character = null) {
  if (!location) return DEFAULT_INTERACTIONS.map(i => ({ ...i, cost: 0 }));

  const category = location.category || "generic";
  const baseInteractions = CATEGORY_INTERACTIONS[category] || DEFAULT_INTERACTIONS;

  return baseInteractions.map(interaction => {
    // Resolve zone routing against REAL zones only
    const zoneResolution = resolveSceneInteractionTargetZone(location, interaction);

    // Determine if action is available given current zone
    let available = true;
    let zone_required_but_missing = false;
    let suggested_zone_name = null;

    if (interaction.required_zone_types && interaction.required_zone_types.length > 0) {
      if (zoneResolution.matched_from_existing_zone && zoneResolution.target_zone_name) {
        suggested_zone_name = zoneResolution.target_zone_name;
        // If user is already in the right zone, great. Otherwise note where to go.
        if (activeZone && activeZone !== zoneResolution.target_zone_name) {
          // Suggest they move — but don't block unless blocks_if_unavailable
          suggested_zone_name = zoneResolution.target_zone_name;
        }
      } else if (!zoneResolution.matched_from_existing_zone) {
        // Zone type required but doesn't exist at this location
        if (interaction.blocks_if_unavailable) {
          available = false;
          zone_required_but_missing = true;
        }
        // Otherwise allow action without zone routing
      }
    }

    // Resolve cost from location config
    const { cost, price_source } = resolveInteractionCost(interaction, location);

    return {
      id: interaction.id,
      label: interaction.label,
      emoji: interaction.emoji,
      category: interaction.action_type,
      cost,
      price_source,
      payer: interaction.payer || (cost > 0 ? "user" : null),
      type: interaction.type || "neutral",
      result_prompt: interaction.result_prompt,
      required_zone_type: interaction.required_zone_types ? interaction.required_zone_types[0] : null,
      suggested_zone_name,
      zone_resolution: zoneResolution,
      available,
      zone_required_but_missing,
    };
  }).filter(action => action.available !== false || !action.zone_required_but_missing);
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 5: Worker presence resolver
// Reads REAL work assignments from location record
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve workers for a scene from location assignment data.
 * NEVER invents staff. Falls back to role placeholders ONLY if no real workers exist.
 *
 * @param {object} location
 * @param {string|null} activeZone
 * @param {Date|null} currentTime
 * @returns {Array}
 */
export function resolveLocationWorkersForScene(location, activeZone, currentTime = null) {
  if (!location) return [];

  const now = currentTime || new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;

  const workerIds = location.worker_character_ids || [];
  const jobTitles = location.worker_job_titles || {};
  const workerShifts = location.worker_shifts || {};
  const workerPayTypes = location.worker_pay_type || {};

  const assignedWorkers = workerIds.map(wid => {
    const title = jobTitles[wid] || "Staff";
    const shift = workerShifts[wid];
    let isOnShift = false;

    if (shift) {
      const shiftDays = shift.days || [];
      const isWorkDay = shiftDays.length === 0 || shiftDays.includes(dayOfWeek);
      if (isWorkDay && shift.start && shift.end) {
        const [sH, sM] = shift.start.split(":").map(Number);
        const [eH, eM] = shift.end.split(":").map(Number);
        const startMin = sH * 60 + sM;
        const endMin = eH * 60 + eM;
        isOnShift = currentMinutes >= startMin && currentMinutes < endMin;
      } else if (isWorkDay && !shift.start) {
        isOnShift = true; // assigned but no specific shift time = always on
      }
    } else {
      // No shift config = treat as on shift (existing behavior)
      isOnShift = true;
    }

    // Assign zone based on job title
    const assignedZone = resolveWorkerZone(title, location);

    return {
      character_id: wid,
      display_name: null, // to be filled by Scene page from characters array
      role_title: title,
      staff_type: "assigned",
      zone_name: assignedZone,
      is_assigned_worker: true,
      is_generated_default_staff: false,
      is_on_shift: isOnShift,
      interaction_support_roles: getInteractionSupportRoles(title),
    };
  }).filter(w => w.is_on_shift);

  return assignedWorkers;
}

function resolveWorkerZone(title, location) {
  if (!title || !location?.zones) return null;
  const zones = location.zones.map(z => z.zone_name);
  const t = title.toLowerCase();

  const zoneHints = [
    { keywords: ["judge", "court officer", "bailiff"], zoneTerms: ["courtroom", "court"] },
    { keywords: ["front desk", "receptionist", "concierge", "check-in"], zoneTerms: ["front desk", "lobby", "reception"] },
    { keywords: ["security", "guard"], zoneTerms: ["entrance", "lobby", "security", "checkpoint"] },
    { keywords: ["trainer", "instructor", "coach"], zoneTerms: ["gym floor", "studio", "fitness", "weights"] },
    { keywords: ["nurse", "doctor", "physician"], zoneTerms: ["exam room", "clinical", "triage"] },
    { keywords: ["case manager", "case worker", "intake"], zoneTerms: ["intake", "office", "case management"] },
    { keywords: ["records", "clerk", "secretary"], zoneTerms: ["records", "clerk office", "office"] },
    { keywords: ["bartender", "bar"], zoneTerms: ["bar"] },
    { keywords: ["housekeeper", "housekeeping"], zoneTerms: ["room", "floor", "hallway"] },
    { keywords: ["manager"], zoneTerms: ["office", "back office", "manager office"] },
  ];

  for (const hint of zoneHints) {
    if (hint.keywords.some(k => t.includes(k))) {
      for (const zt of hint.zoneTerms) {
        const match = zones.find(z => z.toLowerCase().includes(zt));
        if (match) return match;
      }
    }
  }

  return null;
}

function getInteractionSupportRoles(title) {
  if (!title) return [];
  const t = title.toLowerCase();
  if (t.includes("judge") || t.includes("court")) return ["appear_in_court"];
  if (t.includes("clerk") || t.includes("records")) return ["get_marriage_license", "get_birth_certificate", "apply_permit", "speak_to_clerk"];
  if (t.includes("security") || t.includes("guard")) return ["go_through_security"];
  if (t.includes("trainer") || t.includes("instructor")) return ["ask_trainer", "book_trainer"];
  if (t.includes("front desk") || t.includes("receptionist") || t.includes("concierge")) return ["check_in", "check_out", "ask_membership", "buy_membership", "check_in_medical"];
  if (t.includes("nurse")) return ["see_nurse"];
  if (t.includes("doctor") || t.includes("physician")) return ["see_doctor"];
  if (t.includes("intake") || t.includes("case worker") || t.includes("case manager")) return ["speak_intake", "sign_paperwork", "wait_placement"];
  if (t.includes("bartender")) return ["talk_bartender", "order_drink", "order_drink_social"];
  return ["talk"];
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 6: Staff presence (role placeholders for locations with no assigned workers)
// ────────────────────────────────────────────────────────────────────────────

const CATEGORY_STAFF_ROLES = {
  government: [
    { role_title: "Front Desk Clerk", zone_terms: ["lobby", "front desk"], id: "gov_clerk" },
    { role_title: "Security Guard", zone_terms: ["entrance", "security", "lobby"], id: "gov_security" },
    { role_title: "Records Clerk", zone_terms: ["records", "office"], id: "gov_records" },
    { role_title: "Case Worker", zone_terms: ["office"], id: "gov_caseworker" },
    { role_title: "Court Officer", zone_terms: ["courtroom", "court"], id: "gov_court_officer" },
    { role_title: "Judge", zone_terms: ["courtroom"], id: "gov_judge" },
  ],
  hotel: [
    { role_title: "Front Desk Clerk", zone_terms: ["front desk", "lobby", "reception"], id: "hotel_frontdesk" },
    { role_title: "Concierge", zone_terms: ["lobby", "concierge"], id: "hotel_concierge" },
    { role_title: "Security Guard", zone_terms: ["lobby", "entrance"], id: "hotel_security" },
    { role_title: "Housekeeper", zone_terms: ["room", "floor", "hallway"], id: "hotel_housekeeper" },
    { role_title: "Manager", zone_terms: ["office", "back office"], id: "hotel_manager" },
  ],
  shelter: [
    { role_title: "Intake Worker", zone_terms: ["intake", "lobby", "front desk"], id: "shelter_intake" },
    { role_title: "Case Manager", zone_terms: ["office"], id: "shelter_casemgr" },
    { role_title: "Security Guard", zone_terms: ["entrance", "lobby"], id: "shelter_security" },
    { role_title: "Shelter Monitor", zone_terms: ["dorm", "sleeping", "common area"], id: "shelter_monitor" },
  ],
  gym: [
    { role_title: "Front Desk Clerk", zone_terms: ["front desk", "lobby", "reception"], id: "gym_frontdesk" },
    { role_title: "Personal Trainer", zone_terms: ["gym floor", "weights", "fitness"], id: "gym_trainer" },
    { role_title: "Fitness Instructor", zone_terms: ["studio", "class", "yoga"], id: "gym_instructor" },
    { role_title: "Manager", zone_terms: ["office", "back office"], id: "gym_manager" },
  ],
  medical: [
    { role_title: "Receptionist", zone_terms: ["reception", "lobby", "waiting"], id: "med_reception" },
    { role_title: "Nurse", zone_terms: ["exam room", "triage", "clinical"], id: "med_nurse" },
    { role_title: "Doctor", zone_terms: ["exam room", "clinical", "office"], id: "med_doctor" },
    { role_title: "Security Guard", zone_terms: ["lobby", "entrance"], id: "med_security" },
    { role_title: "Billing Clerk", zone_terms: ["billing", "office", "reception"], id: "med_billing" },
  ],
  business: [
    { role_title: "Sales Associate", zone_terms: [], id: "biz_associate" },
    { role_title: "Manager", zone_terms: ["office", "back"], id: "biz_manager" },
    { role_title: "Security Guard", zone_terms: ["entrance", "floor"], id: "biz_security" },
  ],
  education: [
    { role_title: "Teacher / Instructor", zone_terms: ["classroom", "lecture", "lab"], id: "edu_teacher" },
    { role_title: "Secretary", zone_terms: ["office", "front desk", "lobby"], id: "edu_secretary" },
    { role_title: "Security Guard", zone_terms: ["entrance", "lobby"], id: "edu_security" },
  ],
  community: [
    { role_title: "Program Coordinator", zone_terms: ["office", "front desk", "lobby"], id: "com_coordinator" },
    { role_title: "Front Desk Worker", zone_terms: ["front desk", "lobby"], id: "com_frontdesk" },
  ],
};

/**
 * Get staff presence for a scene — assigned workers first, then role placeholders.
 *
 * @param {object} location
 * @param {string|null} activeZone
 * @param {Array} assignedWorkers — result of resolveLocationWorkersForScene (enriched with name)
 * @returns {Array}
 */
export function getLocationStaffPresence(location, activeZone, assignedWorkers = []) {
  if (!location) return [];

  const category = location.category || "generic";
  const zones = (location.zones || []).map(z => z.zone_name);

  // If assigned workers already exist, return only them
  if (assignedWorkers.length > 0) {
    return assignedWorkers.map(w => ({
      ...w,
      display_name: w.display_name || w.role_title,
      is_assigned_worker: true,
      is_generated_default_staff: false,
    }));
  }

  // No assigned workers — return role placeholders appropriate to category
  const roleTemplates = CATEGORY_STAFF_ROLES[category] || [];

  return roleTemplates.map(template => {
    // Find a matching REAL zone for this role's zone_terms
    let matchedZone = null;
    for (const term of template.zone_terms) {
      const found = zones.find(z => z.toLowerCase().includes(term.toLowerCase()));
      if (found) { matchedZone = found; break; }
    }

    // If role requires a specific zone (like Judge → Courtroom) and zone doesn't exist, skip
    if (template.zone_terms.length > 0 && !matchedZone && template.zone_terms.every(t => !zones.some(z => z.toLowerCase().includes(t)))) {
      // Only show if the zone actually exists OR if this is a general-purpose role
      if (template.zone_terms.length > 0) return null; // zone-specific role, zone missing
    }

    return {
      id: template.id,
      display_name: template.role_title,
      role_title: template.role_title,
      staff_type: "generated_placeholder",
      zone_name: matchedZone,
      is_assigned_worker: false,
      is_generated_default_staff: true,
      interaction_support_roles: getInteractionSupportRoles(template.role_title),
    };
  }).filter(Boolean);
}