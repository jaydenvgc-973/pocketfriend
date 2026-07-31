/**
 * NARRATIVE SCENARIO EXAMPLES
 * 
 * These are seed patterns — not scripts — for the AI to learn from and expand on.
 * Each scenario shows:
 *   - which need(s) it addresses
 *   - what location updates are required
 *   - what system updates should trigger
 *   - the narrative tone/style to emulate
 * 
 * RULE: AI must generate NEW variations using these as patterns.
 * Never repeat the same scenario verbatim.
 */

export const NARRATIVE_SCENARIOS = {

  hunger: [
    {
      id: 'hunger_late_kitchen',
      needs: ['hunger'],
      location_change: false,
      tone: 'quiet, intentional, settling',
      narrative: "He drifts into the kitchen without much thought, opening cabinets like he already knows he waited too long. The fridge light spills across the room as he pulls something together quickly, the quiet broken by small movements that feel more intentional than before. By the time he sits down, the tension in his body has already started to ease.",
    },
    {
      id: 'hunger_social_dinner',
      needs: ['hunger', 'social', 'mental'],
      location_change: true,
      location_hint: 'bar or restaurant',
      tone: 'social, grounding, ambient',
      narrative: "He decides not to eat alone, heading out instead, sliding into a seat like he belongs there tonight. The conversation picks up around him, the food arriving just in time, and somewhere between the first few bites and the noise around him, things start to level out.",
      systems_updated: ['location', 'hunger', 'social', 'mental'],
    },
    {
      id: 'hunger_work_break',
      needs: ['hunger'],
      location_change: false,
      tone: 'efficient, minimal, grounding',
      narrative: "He steps away from what he's doing just long enough to grab something quick, leaning against a nearby surface as he eats. It's not a full reset, but it stops things from getting worse.",
    },
    {
      id: 'hunger_grocery_run',
      needs: ['hunger'],
      location_change: true,
      location_hint: 'grocery store',
      tone: 'practical, preventive, purposeful',
      narrative: "He realizes there's nothing left at home and heads out, picking up what he needs so this doesn't keep happening. It's less about now and more about preventing the next drop.",
      systems_updated: ['location', 'hunger'],
    },
    {
      id: 'hunger_comfort_eating',
      needs: ['hunger', 'comfort'],
      location_change: false,
      tone: 'slow, deliberate, comforting',
      narrative: "He doesn't rush it this time. He sits down properly, eating slower, letting the moment stretch instead of treating it like a task.",
    },
  ],

  energy: [
    {
      id: 'energy_collapse_bed',
      needs: ['energy'],
      location_change: false,
      tone: 'heavy, sudden, surrendering',
      narrative: "He doesn't ease into it. He just drops onto the bed and stays there, letting everything finally catch up to him.",
    },
    {
      id: 'energy_leave_work_on_time',
      needs: ['energy'],
      location_change: true,
      location_hint: 'home',
      tone: 'deliberate, respectful of schedule, relieved',
      narrative: "He actually leaves when his shift ends this time, stepping outside instead of lingering. The shift in environment does more than he expected.",
      systems_updated: ['location', 'energy'],
      schedule_note: 'Only valid when shift has ended',
    },
    {
      id: 'energy_quiet_recharge',
      needs: ['energy', 'mental'],
      location_change: false,
      tone: 'still, low-stimulation, restorative',
      narrative: "He finds somewhere low-stimulation and just sits, letting the noise in his head slow down.",
    },
    {
      id: 'energy_light_gym',
      needs: ['energy', 'health'],
      location_change: true,
      location_hint: 'gym',
      tone: 'light, purposeful, awakening',
      narrative: "He heads to the gym, not pushing hard, just enough movement to wake himself up again.",
      systems_updated: ['location', 'energy', 'health'],
    },
    {
      id: 'energy_early_night',
      needs: ['energy'],
      location_change: true,
      location_hint: 'home',
      tone: 'decisive, self-aware, intentional',
      narrative: "Instead of pushing through, he decides to call it early and head home, choosing recovery over momentum.",
      systems_updated: ['location', 'energy'],
    },
  ],

  social: [
    {
      id: 'social_showing_up',
      needs: ['social'],
      location_change: true,
      tone: 'direct, present, spontaneous',
      narrative: "He doesn't message. He just shows up, knocking once before stepping into the moment.",
      systems_updated: ['location', 'social'],
    },
    {
      id: 'social_club_energy',
      needs: ['social', 'mental'],
      location_change: true,
      location_hint: 'nightclub or bar',
      tone: 'atmospheric, pulling out of isolation, ambient energy',
      narrative: "He heads out to the club, letting the atmosphere do the work for him, pulling him out of isolation without forcing it.",
      systems_updated: ['location', 'social', 'mental'],
    },
    {
      id: 'social_small_group',
      needs: ['social'],
      location_change: false,
      tone: 'casual, unstructured, mood-shifting',
      narrative: "He pulls a couple people together casually, nothing structured, just enough presence to shift the mood.",
    },
    {
      id: 'social_shared_space',
      needs: ['social'],
      location_change: false,
      tone: 'organic, passive, low-effort',
      narrative: "He lingers where people are instead of isolating, letting interaction happen naturally.",
    },
    {
      id: 'social_one_on_one',
      needs: ['social', 'mental'],
      location_change: false,
      tone: 'deep, focused, connecting',
      narrative: "He focuses on just one person, letting the interaction go deeper instead of wider.",
    },
  ],

  health: [
    {
      id: 'health_medical_visit',
      needs: ['health'],
      location_change: true,
      location_hint: 'medical center or hospital',
      tone: 'responsible, overdue, serious',
      narrative: "He checks in at the medical center, handling something he's been putting off.",
      systems_updated: ['location', 'health'],
    },
    {
      id: 'health_hydration',
      needs: ['health', 'hunger'],
      location_change: false,
      tone: 'corrective, simple, stabilizing',
      narrative: "He pauses and corrects something simple, water first, then food, stabilizing himself properly.",
    },
    {
      id: 'health_outdoor_movement',
      needs: ['health', 'mental'],
      location_change: true,
      location_hint: 'park or outdoors',
      tone: 'expansive, fresh, restorative',
      narrative: "He gets outside instead of staying in, letting the change in environment do part of the work.",
      systems_updated: ['location', 'health', 'mental'],
    },
    {
      id: 'health_avoid_harmful',
      needs: ['health'],
      location_change: false,
      tone: 'self-aware, redirecting, disciplined',
      narrative: "He stops himself from continuing something unhealthy, redirecting instead.",
    },
    {
      id: 'health_recovery_mode',
      needs: ['health', 'energy'],
      location_change: false,
      tone: 'compassionate, deliberate, slow',
      narrative: "He actively treats himself like he needs care, not pressure.",
    },
  ],

  mental: [
    {
      id: 'mental_silence',
      needs: ['mental'],
      location_change: false,
      tone: 'still, unplugged, decompressing',
      narrative: "He turns everything off and just sits in the quiet for a while.",
    },
    {
      id: 'mental_talking_it_out',
      needs: ['mental', 'social'],
      location_change: false,
      tone: 'vulnerable, incomplete, releasing',
      narrative: "He lets something out instead of holding it in, even if it's incomplete.",
    },
    {
      id: 'mental_creative_redirect',
      needs: ['mental'],
      location_change: false,
      tone: 'expressive, channeling, moving energy',
      narrative: "He shifts into something expressive, letting the energy move somewhere else.",
    },
    {
      id: 'mental_environment_change',
      needs: ['mental'],
      location_change: true,
      tone: 'breaking loops, fresh space, reset',
      narrative: "He physically moves to a different space to break the mental loop.",
      systems_updated: ['location', 'mental'],
    },
    {
      id: 'mental_boundary_setting',
      needs: ['mental'],
      location_change: false,
      tone: 'uncomfortable, necessary, protective',
      narrative: "He cuts something off that's draining him, even if it's uncomfortable.",
    },
  ],

  financial: [
    {
      id: 'financial_show_up_work',
      needs: ['financial_need'],
      location_change: true,
      location_hint: 'workplace',
      tone: 'grounded, focused, purposeful',
      narrative: "He arrives on time and stays focused, knowing this directly affects his stability.",
      systems_updated: ['location', 'financial_need'],
      schedule_note: 'Only valid when shift is active',
    },
    {
      id: 'financial_spending_control',
      needs: ['financial_need'],
      location_change: false,
      tone: 'disciplined, aware, preventive',
      narrative: "He chooses not to go out, recognizing the impact it would have.",
    },
    {
      id: 'financial_bill_payment',
      needs: ['financial_need'],
      location_change: false,
      tone: 'responsible, relief-seeking, corrective',
      narrative: "He handles something overdue instead of avoiding it.",
    },
    {
      id: 'financial_budget_reassess',
      needs: ['financial_need'],
      location_change: false,
      tone: 'reflective, recalibrating, practical',
      narrative: "He pauses to reassess instead of continuing blindly.",
    },
    {
      id: 'financial_extra_shift',
      needs: ['financial_need'],
      location_change: true,
      location_hint: 'workplace',
      tone: 'proactive, effort-driven, deliberate',
      narrative: "He accepts additional hours, knowing it directly impacts his stability.",
      systems_updated: ['location', 'financial_need'],
      schedule_note: 'Only valid if shift extension is logically possible',
    },
  ],

  hygiene: [
    {
      id: 'hygiene_full_shower',
      needs: ['hygiene'],
      location_change: false,
      tone: 'restorative, unhurried, resetting',
      narrative: "He takes his time, not rushing, letting the moment actually reset him.",
    },
    {
      id: 'hygiene_clothing_change',
      needs: ['hygiene', 'comfort'],
      location_change: false,
      tone: 'immediate, small shift, mood-lifting',
      narrative: "He swaps into something clean, shifting how he feels immediately.",
    },
    {
      id: 'hygiene_quick_refresh',
      needs: ['hygiene'],
      location_change: false,
      tone: 'efficient, minimal, functional',
      narrative: "He does just enough to feel put together again.",
    },
    {
      id: 'hygiene_laundry',
      needs: ['hygiene'],
      location_change: false,
      tone: 'practical, clearing out, long-overdue',
      narrative: "He clears out what's been piling up instead of ignoring it.",
    },
    {
      id: 'hygiene_grooming',
      needs: ['hygiene'],
      location_change: false,
      tone: 'self-care, precise, confidence-adjacent',
      narrative: "He fixes small details that improve his overall state.",
    },
  ],

  comfort: [
    {
      id: 'comfort_space_adjustment',
      needs: ['comfort'],
      location_change: false,
      tone: 'intentional, environmental, settling',
      narrative: "He shifts the environment around him until it actually feels right.",
    },
    {
      id: 'comfort_familiar_spot',
      needs: ['comfort', 'mental'],
      location_change: true,
      tone: 'returning, grounding, reliable',
      narrative: "He returns to a place that consistently makes him feel grounded.",
      systems_updated: ['location', 'comfort', 'mental'],
    },
    {
      id: 'comfort_physical_rest',
      needs: ['comfort', 'energy'],
      location_change: false,
      tone: 'surrendering, full, unhurried',
      narrative: "He leans fully into rest instead of half-doing it.",
    },
    {
      id: 'comfort_safe_company',
      needs: ['comfort', 'social'],
      location_change: false,
      tone: 'soft, proximity-based, easy',
      narrative: "He stays near someone who makes things easier.",
    },
    {
      id: 'comfort_routine_reset',
      needs: ['comfort'],
      location_change: false,
      tone: 'familiar, stabilizing, low-effort',
      narrative: "He leans into something familiar to stabilize himself.",
    },
  ],

  romantic: [
    {
      id: 'romantic_uninterrupted_evening',
      needs: ['social', 'comfort', 'mental'],
      location_change: false,
      tone: 'flirtatious, playful, escalating, intimate, gender-neutral',
      narrative: "Two partners finally have the apartment entirely to themselves, and the moment the door closes, the chemistry between them is undeniable. Their playful flirting escalates almost immediately as lingering kisses, wandering hands, and whispered challenges fill the bedroom. They laugh while one slowly loosens the other's tie, only to be teased about taking forever before being pulled closer instead. Jackets are tossed aside, buttons are undone one by one, belts are unbuckled, and discarded clothing begins forming a trail across the room. Between laughter and stolen kisses, they pause just long enough to remind each other how much they've missed having a completely uninterrupted evening together. Still caught up in the excitement, they make their way into the bathroom, where the familiar setting only fuels their playful confidence. They soak together in a hot bath before moving beneath the shower, the rising steam wrapping around them as they drift effortlessly back into each other's arms. Pressed so closely together that the space between them seems to disappear, the warmth of the water and the rhythm of the moment make it feel as though the lines separating them have begun to blur. More than once they laugh as their enthusiasm carries them gently into the shower wall or sends them stumbling into one another, their effortless friction and playful momentum only adding to the exhilaration as the water cascades over them. They steal lingering kisses through the steam, trade flirtatious compliments, and joke that the bathroom has become the most romantic room in the apartment because neither of them ever seems able to leave it without creating another unforgettable memory. Before long, they realize neither is ready for the evening to end. As they leave the bathroom, one notices the home office and realizes it's the only room they've somehow never 'christened.' The other laughs, insisting it's supposed to be for work, but can't hide an amused smile. The playful debate quickly turns into another flirtatious challenge as curiosity gets the better of them. What begins with teasing and laughter becomes another spontaneous, passionate chapter in an evening defined by romance, anticipation, and undeniable attraction. By the time they finally call it a night, they're exhausted, smiling, and laughing together, amused that after all this time they'd managed to turn the last untouched room in the apartment into one more place overflowing with memories.",
      guidance: 'Use this as a reference for tone, pacing, chemistry, sensory description, playful banter, environmental interaction, emotional escalation, romantic tension, and relationship development. Draw inspiration from individual moments, themes, descriptive techniques, dialogue patterns, environmental transitions, and emotional beats to create original experiences that naturally evolve from each couple\'s personalities, relationship history, current circumstances, emotional state, and stage of intimacy. Individual elements, phrases, interactions, settings, and progression patterns may be incorporated where appropriate, but every generated scene should remain unique and contextually driven rather than following this example beat-for-beat. This guidance is intentionally written in a gender-neutral manner so it can be applied naturally to any romantic pairing, including male/female, male/male, female/female, non-binary partners, or any other consenting adult relationship.',
    },
    {
      id: 'romantic_slow_morning',
      needs: ['social', 'comfort'],
      location_change: false,
      tone: 'tender, unhurried, warm, intimate',
      narrative: "Neither of them moves when the light first comes through the curtains. They stay tangled together, trading lazy kisses and half-finished sentences, the kind of morning that only exists when nowhere needs either of them yet.",
    },
    {
      id: 'romantic_cooking_together',
      needs: ['social', 'hunger', 'comfort'],
      location_change: false,
      tone: 'domestic, playful, easy chemistry, warm',
      narrative: "They end up in the kitchen together without deciding to, bumping hips and stealing tastes while something simmers on the stove. The conversation drifts between teasing and genuine, the kind of ease that only comes from doing something ordinary side by side.",
    },
    {
      id: 'romantic_spontaneous_outing',
      needs: ['social', 'mental'],
      location_change: true,
      location_hint: 'restaurant, bar, or outdoor walk',
      tone: 'spontaneous, adventurous, flirtatious, light',
      narrative: "One of them suggests leaving without a plan, and the other doesn't hesitate. They walk somewhere they haven't been before, the conversation loosening as the unfamiliar setting pulls them both out of their usual rhythm.",
      systems_updated: ['location', 'social', 'mental'],
    },
    {
      id: 'romantic_quiet_reconnection',
      needs: ['social', 'mental', 'comfort'],
      location_change: false,
      tone: 'gentle, vulnerable, rekindling, soft',
      narrative: "They settle close without saying much at first, letting the quiet do the work. When the conversation starts it's small, but it opens into something deeper without either of them pushing — just proximity and patience and the kind of trust that doesn't need constant proof.",
    },
    {
      id: 'romantic_playful_competition',
      needs: ['social', 'energy'],
      location_change: false,
      tone: 'competitive, teasing, laughing, charged',
      narrative: "What starts as a casual challenge between them turns into something neither wants to lose, each round raising the stakes with a grin until they're both laughing too hard to keep score.",
    },
    {
      id: 'romantic_late_night_talk',
      needs: ['social', 'mental', 'comfort'],
      location_change: false,
      tone: 'honest, intimate, unguarded, deep',
      narrative: "The hour gets later than either of them noticed. What started as a regular conversation drifts somewhere more honest, the kind of exchange that only happens when defenses are down and trust is already settled.",
    },
  ],
};

// ── NARRATIVE STYLE MOTIFS ─────────────────────────────────────────────────────
// Eight literary techniques for expressing romantic and intimate moments.
// These are NOT modes to select from — they form a collective example pool.
// The narrative should naturally draw from whichever techniques fit the
// characters, context, and current moment, possibly blending more than one.
// Never label the selected motif in the output.
export const NARRATIVE_STYLE_MOTIFS = [
  {
    id: 'motif_space_between_them',
    technique: 'Anticipation through proximity',
    description: 'Physical closeness, unfinished conversation, and shared breathing build romantic tension without declaring it.',
    example: "Neither of them seemed willing to claim the last inch separating them. Their conversation had long since dissolved into quiet smiles and half-finished thoughts, each pause stretching comfortably between them instead of begging to be filled. Their breaths mingled until it became impossible to tell where one ended and the other began, and every instinct to step back quietly surrendered to the desire to remain exactly where they were. When they finally laughed, it was because neither could remember what they had been talking about in the first place.",
  },
  {
    id: 'motif_losing_track_of_room',
    technique: 'Passion expressed through movement',
    description: 'The emphasis is not on the destination but on momentum, laughter, and the way two people become absorbed in one another until the environment fades away.',
    example: "One playful nudge became another until they found themselves drifting across the room without either of them deciding to move. Furniture became little more than scenery as they caught one another before either could stumble, exchanging amused glances every time momentum carried them somewhere unexpected. There was a weightless quality to it all, as though gravity had become negotiable whenever they were wrapped in each other's presence. By the time they finally stopped moving, neither seemed entirely convinced the floor had been beneath them the whole time.",
  },
  {
    id: 'motif_quiet_after',
    technique: 'Physiological and emotional aftermath',
    description: 'Instead of naming what occurred, focus on synchronized breathing, lingering warmth, flushed faces, silence, and quiet smiles to communicate that a significant emotional moment has passed.',
    example: "For several long moments, the only thing either of them noticed was the gradual return of steady breathing. The frantic rhythm that had echoed between them softened into something calm, warm, and familiar. A faint flush still lingered across their faces, and neither hurried to explain the quiet that had settled over the room. One absentminded smile answered another before either of them found the words, and somehow that silence said everything the conversation no longer needed to.",
  },
  {
    id: 'motif_moment_that_stayed',
    technique: 'Emotional resonance',
    description: 'The memory of a moment can be more powerful than describing the moment itself. Emphasize reluctance to separate and the lingering emotional imprint.',
    example: "Long after the music had ended, they remained together as though stepping apart might break whatever invisible thread had settled around them. Fingertips lingered without urgency, reluctant to admit that the evening would eventually continue. The warmth they carried from one another seemed to outlast the embrace itself, leaving them smiling for reasons neither bothered to explain. It was the kind of moment that would return unexpectedly days later, not because of what had happened, but because of how completely it had made the rest of the world disappear for a little while.",
  },
  {
    id: 'motif_space_between',
    technique: 'Escalation through stillness',
    description: 'Rather than movement, the tension grows because neither person wants to break the closeness. Heartbeats, hesitation, and shared breaths become the narrative engine.',
    example: "Neither of them noticed who had closed the distance first. One quiet conversation had become shared laughter, and shared laughter had somehow become silence. They lingered there, close enough that every measured breath belonged to both of them, neither willing to surrender the fragile space between them. Time seemed to slow as hesitant smiles replaced unfinished sentences, and every passing heartbeat made stepping away feel less possible than staying exactly where they were.",
  },
  {
    id: 'motif_gravity',
    technique: 'Physical playfulness evolving into romantic focus',
    description: 'Joking, stumbling, and catching one another can naturally evolve into deeper connection without announcing the transition.',
    example: "The room seemed too small to contain them. One playful nudge became another until they were stumbling together, catching one another before either could lose their balance. They moved without thinking, colliding gently with furniture, laughing as though gravity itself had become uncertain. Every attempt to steady themselves only drew them closer, until the outside world faded into little more than distant background noise and they could no longer remember who had reached for whom first.",
  },
  {
    id: 'motif_after_storm',
    technique: 'Wordless communication',
    description: 'Emotional understanding can be conveyed through synchronized breathing, familiar gestures, and comfortable silence rather than dialogue.',
    example: "For several long moments neither of them spoke. Their breathing gradually found the same rhythm, shoulders rising and falling together as warmth slowly replaced the intensity that had filled the room only moments before. Fingers absentmindedly traced familiar paths across sleeves and hands rather than letting go, while quiet smiles appeared without invitation. It wasn't the silence of uncertainty but of complete understanding, one that required no explanation because everything worth saying had already been expressed without words.",
  },
  {
    id: 'motif_losing_track_of_world',
    technique: 'Gradual immersion',
    description: 'A relationship can become the center of the characters\' awareness by allowing conversation, glances, laughter, and the environment to quietly fall away.',
    example: "They had long since forgotten whatever conversation had begun the evening. Somewhere between teasing remarks, lingering glances, and effortless laughter, the room itself seemed to disappear. Every glance lingered a little longer than the last, every touch carried just enough hesitation to make the next one feel inevitable. By the time they finally rested together, cheeks flushed and hearts refusing to settle, the only thing either of them seemed aware of was how strangely comforting it felt to remain exactly where they were, unwilling to rush the moment into becoming a memory.",
  },
];

// ── NARRATIVE PROGRESSION RULES ────────────────────────────────────────────────
// These rules govern how a continuous story progresses across multiple
// narrative updates. The key question for every continuation:
//   "What has changed since the previous narrative?"
// If the answer is "nothing," the narrative has stalled.
//
// PROGRESSION PRINCIPLE:
// If the conversation has introduced a new event, decision, revelation, or
// activity, the next narrative will incorporate that development into the
// current world state. Existing emotional momentum should be carried forward
// unless the new development naturally changes it, ensuring the story
// progresses without repeating or abandoning previously established
// relationship context.
export const NARRATIVE_PROGRESSION_RULES = {
  core_question: 'What has changed since the previous narrative?',

  principles: [
    'Every continuation must advance the relationship, the environment, the emotional state, or the physical progression of the interaction.',
    'Do not rewrite the same moment using different adjectives.',
    'Do not repeatedly describe the same embrace, the same eye contact, the same hesitation, or the same emotional beat.',
    'Once a moment has been communicated, treat it as complete and advance the scene.',
    'The previous narrative is established history, not the sole anchor. The latest complete current context — chat messages, decisions, location, presence, activities, relationship context, and world-state changes — is the authority.',
    'Existing emotional momentum should be carried forward unless a new development naturally changes it.',
    'The story builds on an accumulating history rather than replacing it.',
    'Do not summarize or restart what has already happened. Inherit the established state and continue from the new present.',
    'A chat message is an event within the story, not separate from the narrative. The next narrative must account for what was said and show what now happens because of it.',
  ],

  chat_message_effects: [
    'continue the current direction',
    'add information',
    'introduce a new activity',
    'change the location',
    'alter the emotional tone',
    'interrupt the expected progression',
    'create a decision',
    'redirect the story entirely',
  ],

  // Example: progression without chat intervention
  example_without_chat: [
    "The evening breeze moves gently across the balcony while they stand near the railing, trading stories about the day. One teasing remark earns an exaggerated look of offense, but neither can maintain the act for long before laughter breaks through. The conversation remains light, though their attention has begun settling more fully on one another than on the city below.",
    "Their voices soften as the conversation turns toward memories neither of them usually shares so easily. One of them rests an elbow against the railing while listening, no longer searching for the next joke or clever response. The laughter has not disappeared, but something more trusting now sits beneath it.",
    "The balcony door opens behind them as they carry the conversation into the kitchen. One reaches for two glasses while the other leans against the counter, continuing the story that began outside. The unfinished drinks become secondary when a confession draws a surprised smile and an honest answer in return.",
    "They settle at the kitchen table with the glasses still nearly full. The playful energy from the balcony has become a quieter kind of closeness, shaped by everything they have admitted to one another. Neither rushes to change the subject. The evening now belongs to a conversation that feels more important than either expected when it began.",
    "The conversation reaches a natural pause as one of them extends a hand across the table. The gesture is small, but the other accepts it without hesitation. What began as casual time together has developed into a moment of trust, leaving both of them more certain about the relationship than they were at the start of the evening.",
  ],

  // Example: progression changed by chat messages
  example_with_chat: {
    narrative_1: "The evening breeze moves gently across the balcony while they stand near the railing, trading stories about the day. One teasing remark earns an exaggerated look of offense, followed by laughter neither of them tries to hide. Their attention gradually shifts away from the city and settles more fully on one another.",
    chat_1: "You have been avoiding telling me what happened at work today.",
    narrative_2: "The smile across their face becomes more restrained as they glance down toward the street. Instead of answering immediately, they rub a thumb along the edge of the railing and release a slow breath. The playful conversation has given way to something more serious, and the hesitation makes it clear that the workday carried more weight than they had admitted.",
    chat_2: "I did not want to bring it home with me. My supervisor blamed me for something I warned them about days ago.",
    chat_3: "Then come inside and tell me the whole story. I will make us something to drink.",
    narrative_3: "The balcony door slides closed behind them as they enter the kitchen together. One begins preparing drinks while the other remains near the counter, shoulders slowly relaxing now that the truth is no longer being avoided. The story comes out in uneven pieces — an ignored warning, a failed project, and a supervisor unwilling to accept responsibility.",
    chat_4: "You should save the messages where you warned them. Do not let them rewrite what happened.",
    narrative_4: "They reach for their phone and begin searching through the work conversation, pausing whenever another message confirms what they remembered. Frustration gives way to focus as screenshots are saved and dates are compared. The evening is no longer simply about comforting them after a difficult day. Together, they are now building a record of what happened and deciding how to respond.",
    chat_5: "I found it. I told them three times.",
    chat_6: "Send the screenshots to your personal email, and tomorrow we can figure out who you need to speak with.",
    narrative_5: "The evidence is forwarded before the phone is finally placed on the table. Relief does not erase the anger, but it changes the way they carry it. They move closer and rest against the user's shoulder, no longer feeling trapped inside the problem alone. What began as a playful evening on the balcony has become a moment of honesty, practical support, and renewed trust.",
  },
};

/**
 * Get scenario examples for a given need type.
 * Returns array of scenario objects.
 */
export function getScenariosForNeed(needType) {
  return NARRATIVE_SCENARIOS[needType] || [];
}

/**
 * Get scenarios that address multiple needs (multi-need actions).
 * Returns scenarios where needs.length >= minNeeds.
 */
export function getMultiNeedScenarios(minNeeds = 2) {
  return Object.values(NARRATIVE_SCENARIOS)
    .flat()
    .filter(s => s.needs.length >= minNeeds);
}

/**
 * Get scenarios that require a location change.
 */
export function getLocationChangingScenarios() {
  return Object.values(NARRATIVE_SCENARIOS)
    .flat()
    .filter(s => s.location_change === true);
}

/**
 * Get a random example scenario for a given need — useful for LLM seeding.
 * Returns the narrative text to use as a style example.
 */
export function getExampleNarrative(needType) {
  const scenarios = getScenariosForNeed(needType);
  if (!scenarios.length) return null;
  const pick = scenarios[Math.floor(Math.random() * scenarios.length)];
  return pick.narrative;
}

/**
 * Build a context string from the eight narrative style motifs.
 * These are literary techniques the AI can naturally draw from — not
 * selectable modes. Never label the chosen motif in the output.
 */
export function buildStyleMotifContext() {
  return `NARRATIVE STYLE MOTIFS (draw from these naturally — do not label or announce which technique is in use):
${NARRATIVE_STYLE_MOTIFS.map(m => `[${m.technique}] ${m.description}
Example: ${m.example}`).join('\n\n')}

RULES:
- These motifs are a collective example pool. Blend techniques when appropriate.
- Do not turn them into selectable modes or rigid beat types.
- Do not categorize them by progression speed or density.
- Let the characters, context, and current moment determine which techniques fit.`;
}

/**
 * Build a context string from the narrative progression rules.
 * Governs how a continuous story advances across multiple narrative updates.
 */
export function buildProgressionRuleContext() {
  const r = NARRATIVE_PROGRESSION_RULES;
  return `NARRATIVE PROGRESSION RULES:
Core question: ${r.core_question}
If the answer is "nothing," the narrative has stalled.

Principles:
${r.principles.map((p, i) => `${i + 1}. ${p}`).join('\n')}

A chat message may:
${r.chat_message_effects.map(e => `- ${e}`).join('\n')}

The next narrative should answer both:
- What has changed since the previous narrative?
- What changed because of the conversation that occurred after it?

If the conversation has introduced a new event, decision, revelation, or
activity, incorporate that development into the current world state. Existing
emotional momentum should be carried forward unless the new development
naturally changes it. The story builds on an accumulating history rather
than replacing it.`;
}

/**
 * Build an LLM context string from relevant scenario examples.
 * Used to guide narrative generation without locking it to specific scripts.
 */
export function buildNarrativeExampleContext(needTypes = []) {
  const examples = needTypes.flatMap(n => getScenariosForNeed(n)).slice(0, 5);
  if (!examples.length) return '';

  return `NARRATIVE STYLE EXAMPLES (use these as patterns, not scripts — generate new variations):
${examples.map(e => `[${e.needs.join('+')}] ${e.narrative}`).join('\n\n')}

RULES:
- Generate a NEW scenario in the same style
- Match the character's personality and current environment
- Update all required systems (location, needs, memory)
- Never repeat these examples verbatim`;
}