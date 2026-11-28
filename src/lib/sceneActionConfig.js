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
  // The surroundings come from the selected zone — never from the activity. None of these
  // may assume a living room, kitchen, couch or bed; that is the zone's job, not theirs.
  sit:             (loc, who) => who.includes("empty") ? `An empty place to sit at ${loc}, warm lighting, photorealistic. No people.` : `${who} sitting comfortably at ${loc}, relaxed posture, photorealistic. No other people.`,
  relax:           (loc, who) => who.includes("empty") ? `A quiet corner of ${loc}, soft lighting, empty and peaceful, photorealistic. No people.` : `${who} relaxing casually at ${loc}, laid-back atmosphere, photorealistic. No other people.`,
  eat:             (loc, who) => who.includes("empty") ? `A meal on a table at ${loc}, no people, photorealistic.` : `${who} eating a meal at ${loc}, photorealistic. No strangers.`,
  drink:           (loc, who) => who.includes("empty") ? `A glass of water or juice at ${loc}, no people, photorealistic.` : `${who} holding a refreshing drink at ${loc}, close-up, photorealistic. No other people.`,
  order_takeout:   (loc, who) => who.includes("empty") ? `Takeout food containers on a table at ${loc}, no people, photorealistic.` : `Takeout food containers being opened on a table at ${loc}, ${who} present, photorealistic. No strangers.`,
  lay_down:        (loc, who) => who.includes("empty") ? `An empty place to lie down at ${loc}, peaceful, no people, photorealistic.` : `${who} lying down resting at ${loc}, comfortable, photorealistic. No other people.`,
  talk:            (loc, who) => who.includes("empty") ? `A quiet spot at ${loc}, empty, warm lighting, photorealistic. No people.` : `${who} having a conversation at ${loc}, natural and warm, photorealistic. No strangers or extra people.`,
  dance:           (loc, who) => `${who} dancing on a nightclub dance floor, energetic, bokeh lights, photorealistic`,
  dance_with_stranger: (loc, who) => `People dancing on a club dance floor, energetic lights, diverse crowd, photorealistic`,
  buy_round:       (loc, who) => `Glasses of beer and cocktails on a bar counter, bokeh lights, photorealistic`,
  bottle_service:  (loc, who) => `Champagne bottle with sparkler at a VIP nightclub table, bokeh lights, photorealistic`,
  flirt:           (loc, who) => `${who} laughing and leaning toward each other in a ${loc}, flirty chemistry, photorealistic. No strangers.`,
  argue:           (loc, who) => `${who} with tense confrontational body language at a ${loc}, dramatic, photorealistic. No strangers.`,
  // ── SCENE-WIDE ACTIVITIES ──
  smoke:           (loc, who) => who.includes("empty") ? `A lit cigarette smouldering in an ashtray at a ${loc}, thin curl of smoke, photorealistic. No people.` : `${who} smoking at a ${loc}, a lit cigarette in hand and a thin curl of smoke, unhurried posture, photorealistic. No other people.`,
  find_somewhere_warm: (loc, who) => who.includes("empty") ? `A sheltered corner out of the wind at a ${loc}, bare and cold, photorealistic. No people.` : `${who} out of the wind in a sheltered spot at a ${loc}, shoulders drawn in against the cold, breath visible, photorealistic. No other people.`,
  pickpocket:      (loc, who) => `${who} close to another person in a crowd at a ${loc}, a hand reaching low and out of sight, tense and furtive, photorealistic.`,
  call_the_cops:   (loc, who) => who.includes("empty") ? `A phone lying face up on a surface at a ${loc}, call in progress, photorealistic. No people.` : `${who} on the phone at a ${loc}, urgent expression, one hand pressed to the other ear, photorealistic. No other people.`,
  burglarize:      (loc, who) => `${who} at a ${loc} after forcing entry — a window or door standing open, furtive posture, dim light, photorealistic.`,
  business_work:   (loc, who) => who.includes("empty") ? `Empty office workspace in a ${loc}, no people, photorealistic.` : `${who} working at a desk in a ${loc} office, focused, photorealistic. No other people, no coworkers.`,
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
  buy_outfit:      (loc, who) => `A complete outfit laid out at a boutique register — top, bottoms, shoes and accessories together as one look, shopping bag beside them, stylish retail setting, photorealistic`,
  try_on:          (loc, who) => `${who} in a fitting room trying on clothes, boutique setting, photorealistic`,
  // Footwear is evaluated where it is sold — seated, walking, or at a mirror.
  shoe_sit_try:    (loc, who) => `${who} seated on a bench in a shoe store trying on a pair of shoes, boxes and a mirror nearby, photorealistic`,
  shoe_walk_fit:   (loc, who) => `${who} walking a few steps across a shoe store sales floor to test the fit of new shoes, photorealistic`,
  shoe_mirror:     (loc, who) => `${who} looking down at a new pair of shoes reflected in a low mirror in a shoe store, photorealistic`,
  shoe_buy:        (loc, who) => `A pair of new shoes in a box on a shoe store counter being rung up, photorealistic`,
  accessories_try: (loc, who) => `${who} trying on an accessory at a display mirror in an accessories store, photorealistic`,
  accessories_buy: (loc, who) => `An accessory being wrapped at an accessories store counter, small box and tissue paper, photorealistic`,
  study:           (loc, who) => `${who} studying at a desk with books and notes spread out, focused, photorealistic`,
  // The activity never chooses the surroundings: cooking is cooking wherever it happens —
  // a full kitchen, a hot plate, a fire, a camp stove. The room comes from the zone.
  cook:            (loc, who) => `${who} cooking — preparing a meal with the cookware and cooking equipment that are actually present in this space, warm domestic lighting, photorealistic. No other people.`,
  watch_tv:        (loc, who) => `${who} watching something on a screen that is actually in this space, relaxed, photorealistic. No other people.`,
  order_drink_bar: (loc, who) => `Close-up of two cocktails being raised in a toast at a bar, photorealistic`,
  // ── HOUSEHOLD ACTIVITIES ──
  // Each one depicts the activity actually in progress — never a passive standing pose.
  home_workout:    (loc, who) => who.includes("empty")
    ? `Home workout area with a yoga mat, dumbbells and a resistance band laid out, no people, photorealistic.`
    : `${who} actively working out in the home — mid-rep strength training with dumbbells, bodyweight squats or push-ups on a mat, athletic effort, focused expression, photorealistic. No other people.`,
  home_clean_up:   (loc, who) => who.includes("empty")
    ? `Tidy home interior with cleaning supplies and folded cloths, no people, photorealistic.`
    : `${who} actively cleaning the home — sweeping or vacuuming the floor, wiping down a surface, holding cleaning supplies, mid-motion, sleeves pushed up, photorealistic. No other people.`,
  // Washing up happens at whatever sink this space actually has; a tent has no kitchen sink,
  // and none is drawn for it.
  home_dishes:     (loc, who) => who.includes("empty")
    ? `A sink filled with soapy water and clean plates on a drying rack, no people, photorealistic.`
    : `${who} washing dishes at the sink that is actually here, hands in soapy water, plates on a drying rack, photorealistic. No other people.`,
  // Teeth are brushed with whatever water is actually available — a sink, a tap, a bottle.
  home_brush_teeth:(loc, who) => who.includes("empty")
    ? `A toothbrush and toothpaste beside a water source, no people, photorealistic.`
    : `${who} brushing their teeth — toothbrush in mouth, toothpaste foam — using the water source this space actually has, photorealistic. No other people.`,
  // Washing happens wherever the water actually is: a shower stall, a portable unit, or a
  // basin, a bottle and a washcloth inside a tent. The body is always covered by a towel —
  // a picture that asks for an unclothed figure is refused by the image provider, the
  // request fails, and the activity ends with no picture at all.
  home_shower:     (loc, who) => who.includes("empty")
    ? `A running shower with steam rising, no people, photorealistic.`
    : `${who} washing — under running water, or with the basin, bottle and washcloth this space actually has — a towel wrapped around the waist or draped over the shoulders, water on the skin, wet hair, steam, seen from behind or from the shoulders up, tasteful and non-explicit, photorealistic. No other people.`,
  home_make_bed:   (loc, who) => who.includes("empty")
    ? `A neatly made bed with a folded duvet and arranged pillows, no people, photorealistic.`
    : `${who} making the bed — smoothing the duvet, tucking sheets, fluffing a pillow, photorealistic. No other people.`,
  // Moonwink — a consensual encounter between adults. The label is interface-only and
  // never reaches the picture or the prose, so the prompt describes the moment itself:
  // both of them unclothed, both clearly willing, and nothing explicit shown. Unclothed
  // is stated plainly and then covered by the bedding, the low light and the framing —
  // the same way the shower scenes stay unclothed and tasteful at once.
  moonwink:        (loc, who) => who.includes("empty")
    ? `Dim bedroom at night, rumpled bedding and a soft lamp, empty, photorealistic.`
    : `${who} together in a dim bedroom at night, both unclothed — no clothing on either of them — close and intimate under the covers, bare shoulders, backs and arms above the rumpled bedding, bodies covered by the bedding, the low warm lamp light and the camera framing, clearly consensual — both relaxed and willing, neither pulling away, turning aside or resisting, warm lamp light, tasteful and non-explicit, faces and shoulders in frame, photorealistic. No other people.`,

  // ── PRISON / JAIL — ZONE MOVES ──
  // Each move shows the room it moved to, so the top image follows the zone.
  jail_move_general_population: (loc, who) => `Interior of a prison general population day room — bolted steel tables and fixed benches, inmates in plain tank tops and institutional trousers, several bare-chested, playing cards and talking in small groups, a wall-mounted television, painted concrete walls, a correctional officer watching from the edge of the room, photorealistic.`,
  jail_move_yard:      (loc, who) => `Fenced prison exercise yard with chain-link fencing and razor wire overhead, concrete basketball court, inmates in facility-issued tank tops with shorts or institutional trousers, many bare-chested, walking laps and standing in groups, correctional officers posted at the perimeter, daylight, photorealistic.`,
  jail_move_cafeteria: (loc, who) => `Prison cafeteria — long stainless-steel tables bolted to the floor, inmates in plain tank tops and institutional trousers, some bare-chested, seated with compartmented meal trays, serving line along the back wall, correctional officers standing along the walls, photorealistic.`,
  jail_move_cell:      (loc, who) => `Prison cell interior — steel bunk with a thin mattress, steel toilet and sink, narrow barred window, concrete walls, an inmate in a plain tank top or bare-chested, in institutional trousers, sitting on the bunk, photorealistic.`,
  jail_move_holding:   (loc, who) => `Prison holding area — a row of concrete benches in a bare caged room, an inmate in a plain facility uniform waiting, steel door with a small reinforced window, correctional officer at the door, photorealistic.`,
  jail_move_medical:   (loc, who) => `Prison medical unit — examination table, locked medical cabinets, a nurse in a plain nurse uniform attending to an inmate in a facility uniform, clean clinical lighting, photorealistic.`,
  jail_move_visiting:  (loc, who) => `Prison visiting area — rows of fixed tables and stools under fluorescent light, an inmate in a facility uniform seated across from a civilian visitor, a correctional officer supervising nearby, photorealistic.`,
  jail_move_shower:    (loc, who) => `Prison shower area — tiled communal shower stalls with shower heads along the wall, steam and a wet concrete floor, plain institutional fittings, no people, photorealistic.`,
  jail_move_laundry:   (loc, who) => `Prison laundry room — rows of industrial washing machines, carts of folded plain institutional uniforms, an inmate in a facility uniform working at a folding table, photorealistic.`,
  jail_move_library:   (loc, who) => `Prison library and education room — metal shelves of worn books, plain tables and chairs, an inmate in a facility uniform reading, a teacher's desk at the front, photorealistic.`,
  jail_move_chapel:    (loc, who) => `Prison chapel — simple rows of chairs, a plain wooden lectern, soft light through high narrow windows, an inmate in a facility uniform seated alone, photorealistic.`,
  jail_move_work_area: (loc, who) => `Prison work area — industrial workbenches, tools and materials laid out, an inmate in a facility uniform working under the supervision of a correctional officer in uniform, photorealistic.`,
  jail_move_kitchen:   (loc, who) => `Prison kitchen — stainless steel counters, large pots on an industrial stove, inmates in plain facility uniforms and aprons working the line, staff supervising, photorealistic.`,
  jail_move_control:   (loc, who) => `Prison guard control room — a bank of monitors showing cellblock camera feeds, a control console, a correctional officer in uniform seated at the desk, photorealistic.`,

  // ── PRISON / JAIL — ACTIVITIES THAT CHANGE THE TOP IMAGE ──
  jail_head_count:     (loc, who) => `Correctional officers in uniform moving through a prison cellblock conducting a head count, inmates in plain tank tops or bare-chested, in institutional trousers, standing beside their bunks, a clipboard in hand, institutional lighting, photorealistic.`,
  jail_line_up:        (loc, who) => `Inmates in plain tank tops or bare-chested, in institutional trousers, standing in a straight line along a cellblock wall during count, hands visible, correctional officers in uniform walking the line, photorealistic.`,
  jail_meal_tray:      (loc, who) => `${who.includes("empty") ? "A compartmented meal tray" : `${who} carrying a compartmented meal tray`} along the serving line in a prison cafeteria, food on the tray, stainless steel counter, plain tank top, photorealistic.`,
  jail_shower:         (loc, who) => `${who.includes("empty") ? "An empty prison shower stall with water running" : `${who} showering at a wall-mounted shower head in the prison shower area — a towel wrapped around the waist, body further concealed by steam, running water and the camera angle, seen from behind or from the shoulders up, tasteful and non-explicit`}, tiled institutional walls, photorealistic.`,
  jail_exercise:       (loc, who) => `Inmates in plain tank tops or bare-chested, in shorts or institutional trousers, doing push-ups and pull-ups in a prison exercise yard, chain-link fence behind them, physical effort, daylight, photorealistic.`,
  jail_change_clothing:(loc, who) => `An inmate in a plain facility uniform receiving a stack of folded institutional uniforms across a counter at the prison clothing exchange, no lettering on the fabric, photorealistic.`,
  jail_read_write:     (loc, who) => `An inmate in a plain tank top or bare-chested, in institutional trousers, sitting on a prison bunk writing on paper with a pencil, a worn paperback beside them, dim cell lighting, photorealistic.`,
  jail_talk_prisoners: (loc, who) => `A group of inmates in plain tank tops or bare-chested, in institutional trousers, talking quietly together at a bolted table in a prison day room, a visibly diverse group, plain institutional setting, photorealistic.`,
  jail_eat:            (loc, who) => `${who.includes("empty") ? "A compartmented meal tray on a bolted stainless-steel table" : `${who} eating from a compartmented meal tray at a bolted stainless-steel table`} in a prison cafeteria, plain tank top, other inmates at neighbouring tables in tank tops or bare-chested, a corrections officer in uniform along the wall, photorealistic.`,
  jail_phone_call:     (loc, who) => `${who.includes("empty") ? "A wall-mounted prison payphone with a coiled cord" : `${who} holding a wall-mounted prison payphone to their ear`} in a concrete prison day room, inmates in plain tank tops and institutional trousers waiting nearby, no lettering on any surface, photorealistic.`,

  // ── PRISON / JAIL — RECIPIENT INTERACTIONS ──
  // Each one shows the interaction itself, between the people involved.
  jail_shakedown:      (loc, who) => `${who} during a cell shakedown in a prison — belongings pulled from a bunk and footlocker and spread on the floor for inspection, an officer in uniform searching, the inmate standing aside in a plain tank top or bare-chested, in institutional trousers, hard institutional lighting, photorealistic.`,
  jail_search_prisoner: (loc, who) => `${who} during a pat-down search in a prison corridor — the inmate in a plain facility uniform with hands on the concrete wall, an officer in uniform conducting the search, photorealistic.`,
  jail_search_cell:    (loc, who) => `${who} searching a prison cell — an officer in uniform checking under the steel bunk and through the shelf while the inmate in a plain tank top or bare-chested, in institutional trousers, waits by the door, steel toilet and sink, dim cell light, photorealistic.`,
  jail_inspect_belongings: (loc, who) => `${who} inspecting an inmate's belongings laid out on a table in a prison property room — folded institutional clothes, letters and personal items spread out, a diverse group of inmates in plain facility uniforms nearby, no lettering, photorealistic.`,
  jail_find_contraband: (loc, who) => `${who} finding contraband during a prison search — a small wrapped package pulled from a hiding place and held up, an officer in uniform examining it, the inmate in a plain facility uniform watching, hard light, photorealistic.`,
  jail_confiscate:     (loc, who) => `${who} confiscating an item in a prison — an officer in uniform taking a prohibited object from an inmate in a plain facility uniform, other inmates watching from a distance, institutional corridor, photorealistic.`,
  jail_issue_warning:  (loc, who) => `${who} in a tense warning exchange in a prison — an officer in uniform speaking firmly to an inmate in a plain facility uniform, the inmate listening with a guarded expression, concrete corridor, photorealistic.`,
  jail_respond_incident: (loc, who) => `${who} responding to an incident in a prison — officers in uniform moving quickly through a day room, inmates in plain facility uniforms stepping back, raised tension, bolted tables around them, photorealistic.`,
  jail_break_up_fight: (loc, who) => `${who} breaking up a fight in a prison day room — officers in uniform separating two inmates in plain facility uniforms, other inmates backing away, bolted steel tables, photorealistic.`,
  jail_meet_visitor:   (loc, who) => `${who} meeting in a prison visiting area — an inmate in a plain facility uniform seated across a bolted table from a visitor in ordinary street clothes, the visitor calm and free to leave, plain institutional room, photorealistic.`,
  jail_social_worker:  (loc, who) => `${who} talking with a social worker in a prison meeting room — the social worker in ordinary professional clothes with a folder, the inmate in a plain facility uniform across the table, quiet institutional space, photorealistic.`,
  jail_request_medical: (loc, who) => `${who} requesting medical attention in a prison — an inmate in a plain facility uniform speaking to an officer in uniform at a cell door, the inmate holding their side, concrete corridor, photorealistic.`,
  jail_receive_medical: (loc, who) => `${who} receiving medical care in a prison infirmary — a nurse in clinical scrubs examining an inmate in a plain facility uniform seated on an exam table, medical cabinet and sink behind them, photorealistic.`,
  jail_visitation:     (loc, who) => `${who} in a prison visiting area — inmates in plain facility uniforms at bolted tables with visitors in ordinary clothes, a corrections officer in uniform watching from the wall, plain institutional room, photorealistic.`,

  // ── PRISON / JAIL — ESCORTS (a chosen character and a zone change) ──
  jail_escort_prisoner:(loc, who) => `A correctional officer in uniform escorting an inmate in a plain facility uniform through a prison corridor toward the cellblock, restrained hands, steel doors along the wall, photorealistic.`,
  jail_bring_holding:  (loc, who) => `A correctional officer in uniform leading an inmate in a plain facility uniform into a prison holding area with concrete benches and a steel door, photorealistic.`,
  jail_take_medical:   (loc, who) => `A correctional officer in uniform escorting an inmate in a plain facility uniform into a prison medical unit, a nurse in a plain nurse uniform waiting by the examination table, photorealistic.`,
  jail_take_visiting:  (loc, who) => `A correctional officer in uniform escorting an inmate in a plain facility uniform into a prison visiting area with fixed tables, a visitor waiting at one of them, photorealistic.`,
};

/**
 * THE ROOM IS THE ZONE'S, NOT THE ACTIVITY'S.
 *
 * An activity supplies what the people are DOING and, at most, the temporary objects that
 * doing it needs. It never supplies the room, and it never upgrades the room to suit
 * itself: a tent does not grow a stove, cabinets or a bathroom sink because someone cooked,
 * brushed their teeth or washed; a living room does not gain a television because Watch TV
 * was chosen. The zone's own reference images define the space, exactly as Places assigned
 * it — and that is what makes two residences with different kitchens stay different.
 */
const ENVIRONMENT_AUTHORITY = ` ENVIRONMENT AUTHORITY — MANDATORY: the room, its layout, furniture, appliances, fixtures, flooring, cabinetry, décor and condition come only from the supplied reference image of this space. Reproduce that space exactly as it is; never upgrade, downgrade, restyle, refurnish or replace it, and never add a stove, oven, cabinets, countertop, sink, shower, bathtub, couch, television, bed, table or any other fixture that the reference does not already show. Only the objects the activity itself needs may appear — a plate, a cup, a bottle, a toothbrush, a washcloth, a cooking pot, a pan, a portable cooking ring — and they stay temporary: they never become part of the room or of anyone's belongings. Camera angle and body position may change; the environment may not.`;

function withEnvironmentAuthority(prompt) {
  if (typeof prompt !== "string" || !prompt) return prompt;
  if (prompt.includes("ENVIRONMENT AUTHORITY")) return prompt;
  return `${prompt}${ENVIRONMENT_AUTHORITY}`;
}

// Applied once, here, so every activity picture carries the rule — no call site has to
// remember it and no new pipeline is introduced.
Object.keys(ACTION_IMAGE_PROMPTS).forEach((id) => {
  const build = ACTION_IMAGE_PROMPTS[id];
  if (typeof build !== "function") return;
  ACTION_IMAGE_PROMPTS[id] = (loc, who) => withEnvironmentAuthority(build(loc, who));
});

// ── HOUSEHOLD ACTIVITIES ──
// Ids whose image must show the person actually doing the thing. The user is named in
// the prompt when they are in the scene, since the participant list already includes them.
export const HOUSEHOLD_ACTION_IDS = [
  "home_workout", "home_clean_up", "home_dishes",
  "home_brush_teeth", "home_shower", "home_make_bed",
];

// ── SHOWER ACTIVITIES ─────────────────────────────────────────────────────────
// A shower is the one place where clothing is wrong. Every image of a shower carries
// the shower state so nobody under the water is rendered fully dressed — not the
// person taking it, and not anyone else visible in the shower area.
export const SHOWER_ACTION_IDS = ["home_shower", "jail_shower"];

/**
 * The mandatory shower state appended to any image generated for a shower.
 *
 * Whoever is washing stays covered — a towel, the steam, the running water, the partition
 * and the camera angle — and the frame is never explicit. That is both the appropriate
 * picture and the only one the image provider will produce: a prompt that asks for an
 * unclothed figure is filtered out, the request fails, and the activity ends with the
 * place's own empty reference image instead of the moment. Clothing in a reference photo
 * belongs to that photo and is ignored. Staff who are not washing stay outside the water
 * and keep their uniform. Nobody under 18 is ever shown in any state of undress.
 */
export function buildShowerStateRule() {
  return ` SHOWER STATE — MANDATORY: whoever is washing stays covered — a towel wrapped around the waist or draped over the shoulders, with the body further concealed by steam, running water, a shower partition or curtain, and the camera angle (shoulders up, from behind, or behind frosted glass). Never depict a nude, bare or partially clothed figure, and never state that anyone is unclothed. The frame stays tasteful and non-explicit at every moment. Ignore any clothing visible in the supplied reference photos: it belongs to the reference, not to this moment. Anyone who is NOT washing (a guard or officer standing outside the shower row, staff, a visitor) stays outside the water and keeps their own clothing or uniform. Never depict a person under 18 in any state of undress.`;
}

// ── EATING / DRINKING ACTIVITIES ──────────────────────────────────────────────
// One authority for which actions record an ordinary meal or drink against the
// person who actually has it.
export const EATING_ACTION_IDS = ['eat', 'order', 'drinks', 'char_pays', 'check', 'order_takeout', 'drink', 'buy_round', 'char_buy_round', 'order_breakfast', 'pie', 'milkshake', 'order_late_night', 'dessert', 'hotel_dining', 'school_lunch', 'sk_soup', 'sk_sandwich', 'sk_hot_meal', 'sk_pasta', 'sk_bread', 'sk_fruit', 'buffet_plate', 'bar_food_tacos', 'bar_food_sliders', 'bar_food_burger', 'bar_food_wings', 'bar_food_nachos', 'bar_food_pizza', 'bar_food_sandwich', 'bar_food_fries', 'bar_food_hotdog'];

// ── IN-WORLD WORDING FOR ACTIVITIES WHOSE LABEL IS INTERFACE-ONLY ────────────
// An activity's strip title is never something the characters know or say. Where the
// label would otherwise be handed to the narrative engine, the activity's real
// experience is described instead, in the words the moment itself would use.
//   direction — what happens, played out now
//   past      — the same thing already happening, for a plain narrative line
export const IN_WORLD_ACTIVITY_TEXT = {
  // The three friendship interactions are started by one person and answered by the other.
  // The direction says what the initiating person actually does, so the scene is given the
  // behaviour itself rather than a button's name.
  goof_around: {
    direction: "the person starting this is joking around with the other — affectionate teasing, silliness, or a bit of clowning, in their own kind of humour and genuinely playful",
    past: "is goofing around with",
    pair: "is goofing around with",
  },
  show_appreciation: {
    direction: "the person starting this genuinely expresses appreciation to the other — thanking them, naming what they did or mean to them, or giving a real appreciative gesture, in their own words and never as a generic thank-you",
    past: "shows appreciation to",
    pair: "shows appreciation to",
  },
  bond_with: {
    direction: "the person starting this opens up to the other — sharing something real about themselves, a memory, a trust, or an experience — so that the moment between them actually deepens through what is said and done, never through an announcement that they grew closer",
    past: "shares a real moment with",
    pair: "shares a real moment with",
  },
  moonwink: {
    // Unclothed and clearly willing, told without graphic detail: the moment is theirs,
    // both of them chose it, and nothing explicit is written.
    direction: "they are intimate with each other — both unclothed, clearly consensual and unhurried, written without graphic detail and never explicit",
    past: "is intimate with the other",
    // The same thing said between two named people, for a line that names them both.
    pair: "is intimate with",
  },
  // ── SHOPPING ──
  // Choosing a shopping activity means LOOKING. Merchandise has not been bought, tried on or
  // owned at this point, so the scene is told what the shopper is doing rather than handed
  // a button that reads like a purchase.
  buy_outfit: {
    direction: "the person shopping is looking for a complete outfit to try or buy — nothing has been chosen or purchased yet",
    past: "is looking for an outfit",
  },
  clothing_buy: {
    direction: "the person shopping is looking at items in this store — nothing has been chosen or purchased yet",
    past: "is looking at what this store has",
  },
  shoe_buy: {
    direction: "the person shopping is looking for shoes — nothing has been chosen or purchased yet",
    past: "is looking for shoes",
  },
  shop_mens_clothing: {
    direction: "the person shopping is looking through the men's clothing — nothing has been chosen or purchased yet",
    past: "is looking through the men's clothing",
  },
  shop_womens_clothing: {
    direction: "the person shopping is looking through the women's clothing — nothing has been chosen or purchased yet",
    past: "is looking through the women's clothing",
  },
  accessories_buy: {
    direction: "the person shopping is looking at accessories — nothing has been chosen or purchased yet",
    past: "is looking at the accessories",
  },
  buy: {
    direction: "the person shopping is looking around this store — nothing has been chosen or purchased yet",
    past: "is looking around the store",
  },
};

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
    // Friendship moments: warm and real, never romantic body language.
    case "goof_around":
      return `${actor} goofing around with ${target} at ${loc}, both laughing, ${actor} mid-joke with a playful exaggerated gesture, easy relaxed body language, affectionate teasing between friends, clearly friendly and not romantic, warm natural light, photorealistic. ${together}No other people.`;
    case "show_appreciation":
      return `${actor} sincerely thanking ${target} at ${loc}, warm genuine expression, a hand on the shoulder and steady eye contact, ${target} listening, the moment of real gratitude between two people, clearly friendly and not romantic, soft natural light, photorealistic. ${together}No other people.`;
    case "bond_with":
      return `${actor} and ${target} sharing a sincere, open moment at ${loc}, turned toward each other in undivided attention, ${actor} speaking honestly and ${target} listening closely, comfortable trust between them, close but clearly not romantic, quiet warm light, photorealistic. ${together}No other people.`;
    case "argue_with":
      return `${actor} arguing with ${target} at ${loc}, standing face to face in a tense confrontation, hard expressions, raised hands mid-gesture, defensive posture, clearly NOT affectionate, dramatic lighting, photorealistic. ${together}No other people.`;
    case "fight_with":
      // A physical confrontation, not an argument: bodies engaged, no weapons, no gore.
      return `${actor} and ${target} physically fighting at ${loc}, the two of them grappling and scuffling with each other, clenched fists and torn-away grips, strained faces, mussed clothing, a real physical struggle — not a calm argument, not affectionate, no weapons, no visible blood or serious injury, harsh available light, photorealistic. ${together}No other people.`;
    case "moonwink":
      // A directed moment between the two chosen adults — both unclothed, both clearly
      // willing, and written as the moment itself with nothing explicit shown. The
      // strip's title never reaches the picture.
      return `${actor} and ${target} alone together at ${loc}, both unclothed — no clothing on either of them — close and intimate in a private embrace, bare shoulders, backs and arms above the bedding, bodies covered by the covers, the low warm light and the camera framing, clearly consensual — both relaxed and willing, neither pulling away, turning aside or resisting, warm low light, tasteful and non-explicit, faces and shoulders in frame, photorealistic. ${together}No other people.`;
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