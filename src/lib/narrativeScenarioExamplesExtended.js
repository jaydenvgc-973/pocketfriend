/**
 * EXTENDED NARRATIVE SCENARIO EXAMPLES — ADDITIVE REFERENCE POOL
 *
 * These examples are ADDITIVE reference material for the existing narrative
 * generator. They do NOT replace, rewrite, or override the existing examples
 * in narrativeScenarioExamples.js, the existing narrative system, the
 * existing relationship system, or any existing rules.
 *
 * Purpose: expand the range of situations, actions, emotional expressions,
 * relationship developments, social dynamics, conflicts, community
 * interactions, trait expressions, and story progression that the existing
 * generator can draw from, so narratives become less repetitive, less dry,
 * more varied, more culturally grounded, and more responsive to who the
 * characters actually are.
 *
 * These are NOT scripts. They are never to be copied, pasted, reproduced
 * verbatim, or mechanically replayed. The generator should identify only the
 * portions — actions, emotional beats, social dynamics, physical gestures,
 * cultural details, consequences, or progression patterns — relevant to the
 * current characters and current situation, then create an ORIGINAL narrative
 * that fits the actual scene.
 *
 * The existing narrative architecture remains authoritative. The character's
 * established identity, personality, quirks, traits, habits, relationships,
 * relationship levels, history, current emotional state, location, current
 * activity, prior events, ongoing storylines, and cultural context remain
 * authoritative. These examples do NOT override any of that information.
 *
 * A narrative element should appear only when it logically fits what is
 * already happening. Do not force ballroom, theft, kissing, hand-holding,
 * conflict, jealousy, flirting, competition, generosity, secrecy, or any
 * other example into a scene merely because it is available. The examples
 * expand the generator's vocabulary; they do not become mandatory events.
 *
 * Traits and quirks influence actions when context gives them a natural
 * opportunity to surface — they are NOT instructions to perform the same
 * trait behavior constantly. A thief should not steal in every narrative.
 * A flirt should not flirt in every scene. A volatile person should not
 * start an argument every time they appear. But across an evolving story,
 * established traits should sometimes become visible through appropriate
 * actions, decisions, impulses, reactions, routines, mistakes, successes,
 * and consequences — rather than existing only as dialogue labels.
 *
 * Stories must progress. A narrative should remember and build from
 * previous actions rather than resetting characters into interchangeable
 * moments. Narrative progression does not require constant escalation or
 * manufactured drama — ordinary life, routines, tenderness, humor,
 * awkwardness, friendship, work, community involvement, competition,
 * mistakes, domestic moments, attraction, setbacks, reconciliation,
 * celebration, quiet support, and changing relationships can all move a
 * story forward.
 *
 * Culturally specific examples are grounding, not decoration. If ballroom
 * culture is relevant to the actual characters or situation, terminology,
 * house structures, categories, chosen-family relationships, competition,
 * judging, mentorship, and other details should be used accurately and
 * naturally. Do not turn cultural examples into stereotypes, generic
 * decoration, exposition dumps, or mandatory storylines.
 *
 * It is a FAILURE if these examples replace the old examples, if a new
 * parallel narrative system is created, if the examples are copied verbatim,
 * if the same examples repeat mechanically, if examples are forced into
 * unrelated situations, if traits become caricatures, if cultural material is
 * used inaccurately or stereotypically, or if previous story development is
 * ignored in order to replay an example.
 */

// ── COMMUNITY / TRAIT / SOCIAL-DYNAMIC SCENARIOS ─────────────────────────────
// Broaden the generator's vocabulary for situations where community,
// competition, secrecy, class, friendship, institution, and trait-driven
// behavior can surface through action rather than exposition.
export const EXTENDED_COMMUNITY_SCENARIOS = [
  {
    id: 'ext_house_prepares_for_ball',
    themes: ['ballroom', 'chosen_family', 'mentorship', 'preparation', 'disappointment_recovery'],
    tone: 'focused, communal, corrective without shaming',
    narrative: "The apartment has been turned into a temporary workroom before a major ball. Garment bags hang from doorframes, makeup covers the bathroom counter, and one house child repeatedly practices catwalk, duckwalk, hand performance, floor performance, and spins into dips across whatever floor space remains. Their house mother moves through the room correcting details without taking over the performance. She straightens one child's garment, makes another repeat an entrance until they stop looking toward the floor, and quietly removes a third person from the night's lineup after watching them struggle repeatedly during rehearsal. Rather than embarrass them in front of the house, she sends them to help backstage and keeps checking on them throughout the night. The excluded child initially withdraws, then begins helping another sibling repair a damaged outfit. By the time the house leaves for the ball, their disappointment has shifted into determination to be ready for the next one.",
  },
  {
    id: 'ext_chop_becomes_house_problem',
    themes: ['ballroom', 'loss', 'volatile', 'competitive', 'family_support'],
    tone: 'abrupt loss, contained fury, quiet study',
    narrative: "A normally confident member of the house enters a category expecting to advance. Their presentation begins strongly, but one mistake breaks the illusion and the judges chop them before the battle begins. They leave the floor quickly and disappear into the hallway rather than letting the crowd watch their reaction. A volatile sibling immediately begins pacing near the judges' table, visibly furious, while the house father intercepts them before the frustration becomes a confrontation. A quietly competitive sibling stays near the floor, watches every person who advances, and mentally catalogs exactly what those competitors did differently. Later, the chopped member returns to the edge of the ballroom and watches the category through to the end instead of leaving. The loss becomes preparation rather than simply humiliation.",
  },
  {
    id: 'ext_rival_house_helps_anyway',
    themes: ['ballroom', 'rivalry', 'community', 'class_boundary_blur'],
    tone: 'competitive then quietly generous',
    narrative: "Two houses have spent most of the night competing against each other. Members celebrate every victory loudly, react dramatically to questionable judging, and keep track of trophies as the night progresses. Outside afterward, one member of the losing house discovers that the person who was supposed to drive them home has already left. A rival who battled them earlier notices them sitting alone with garment bags and offers a ride. The two load costumes into the trunk while still visibly replaying the competition through gestures and expressions. At a late-night food stop, members from both houses gradually gather around the same table. Competition remains intact, but the boundary between rival and community becomes much more complicated.",
  },
  {
    id: 'ext_mother_notices_something_wrong',
    themes: ['chosen_family', 'caretaking', 'housing_insecurity', 'practical_support'],
    tone: 'irritation shifting to protective action',
    narrative: "A younger member of a house stops appearing at rehearsals. At first the absence is treated as irresponsibility. Their house mother becomes irritated after several unanswered messages and finally goes to find them. She discovers that the younger member has been sleeping irregularly between friends' homes after losing housing. Instead of immediately discussing the missed rehearsals, she begins making calls. She clears space in a spare room, contacts another community member about temporary work, gathers unused toiletries and clothing, and quietly removes the person's name from an upcoming category. The next several days show the house operating as family rather than simply as a competitive organization. Members rotate meals, transportation, job leads, and practical support while the younger member slowly stabilizes.",
  },
  {
    id: 'ext_self_absorbed_friend_at_celebration',
    themes: ['self_absorbed', 'friendship', 'generosity', 'complicated_care'],
    tone: 'self-centered surface, generous core',
    narrative: "A group of longtime friends prepares a surprise promotion dinner for one member. The self-absorbed friend arrives early supposedly to help decorate but spends most of the setup changing the table arrangement because the original seating would place them somewhere with poor lighting. They move a centerpiece, test several chairs, and photograph themselves in front of the decorations before the guest of honor arrives. During the celebration, they repeatedly position themselves near the center of group photographs. But when the restaurant unexpectedly presents a much larger bill than anticipated, the same character quietly puts down their card before anyone else can panic. The action reveals something more complicated than selfishness. They genuinely care about their friend while still instinctively turning important moments toward themselves.",
  },
  {
    id: 'ext_flirt_who_never_announces_it',
    themes: ['flirtatious', 'uninhibited', 'attraction_through_action'],
    tone: 'gradual, unannounced, action-led',
    narrative: "At a crowded rooftop gathering, an uninhibited and naturally flirtatious character notices someone watching them from across the room. They do not immediately approach. Instead, they gradually shorten the distance throughout the evening. They join the same conversation circle, take the empty chair beside the person, lean closer when music makes conversation difficult, and casually guide them through the crowd with a hand at their back. When everyone begins dancing, the character allows several people to approach them but keeps returning to the same person. By the end of the night, the attraction is obvious from their actions even though nothing was ever formally declared.",
  },
  {
    id: 'ext_thief_sees_opportunity',
    themes: ['thief', 'opportunism', 'concealment', 'consequence_delayed'],
    tone: 'patient, concealed, behavior-establishing',
    narrative: "During a house party, a character notices an expensive watch left beside a bathroom sink. They pass it once without touching it. Later, after watching the owner become increasingly intoxicated, they return to the bathroom, close the door, wrap the watch inside a paper towel, and slip it beneath other items in their bag rather than immediately putting it on. For the remainder of the party, they behave normally and even help the owner search when the watch is reported missing. Several days later, another character notices the thief suddenly has more cash than usual. Nothing needs to announce that the character steals. Their preparation, concealment, opportunism, and later behavior establish it.",
  },
  {
    id: 'ext_impulsive_thief_different_mistake',
    themes: ['thief', 'impulsive', 'risk_taker', 'consequence_through_ego'],
    tone: 'reckless, ego-driven, fast consequence',
    narrative: "Another character with the same Thief trait behaves completely differently because they are also impulsive and thrill-seeking. They see sunglasses sitting unattended at an outdoor café and take them almost immediately. Within an hour they are wearing them in photographs. A mutual acquaintance recognizes the glasses online before the original owner even realizes where they went. Instead of a carefully planned crime, the narrative becomes a consequence of impulse, ego, and poor foresight.",
  },
  {
    id: 'ext_prison_economy',
    themes: ['incarceration', 'informal_economy', 'social_consequence', 'mentorship_through_action'],
    tone: 'institutional, quiet, behavioral',
    narrative: "Inside a correctional environment, ordinary objects begin carrying different value. One incarcerated character has developed a reputation for knowing who has extra food, who can repair clothing, who receives regular commissary deposits, and who owes favors. They rarely possess the most resources themselves. Instead, they survive by arranging exchanges between other people. A newly incarcerated person accidentally accepts something without understanding that it carries an obligation. Over the next several days, the social consequences spread quietly. A seat that had been available is suddenly occupied. Someone stops saving them a place in line. Another person refuses a small favor. A socially observant character notices what happened and begins teaching the newcomer the informal rules of the environment through actions rather than exposition.",
  },
  {
    id: 'ext_institution_creates_unlikely_alliance',
    themes: ['incarceration', 'rivalry_to_respect', 'complementary_traits'],
    tone: 'tense, pragmatic, grudging respect',
    narrative: "Two incarcerated characters who normally dislike one another are assigned the same work responsibility. At first they divide every task sharply and avoid unnecessary interaction. When supplies begin disappearing, both realize they may be blamed. One is meticulous and rule-conscious; the other is a practiced rule breaker who understands exactly how contraband moves through the environment. Their opposite traits become complementary. The rule-conscious character starts documenting inventory while the rule breaker watches patterns of movement and discovers when the supplies are being taken. Neither character becomes suddenly friendly. They simply become useful to one another, and respect begins developing from necessity.",
  },
  {
    id: 'ext_somebody_knows_the_secret',
    themes: ['secrecy', 'suspense', 'paranoia_through_behavior'],
    tone: 'escalating uncertainty, behavioral suspense',
    narrative: "A character begins finding small signs that someone knows about something they have hidden. Nothing arrives as an explicit confession or threat. A photograph they believed was private appears repositioned on their desk. An object connected to the secret appears somewhere it should not be. Their phone shows evidence that someone tried to access it. A social media account interacts with an old post that almost nobody remembers. The character becomes increasingly watchful. They begin checking doors, deleting messages, changing passwords, watching friends' reactions, and interpreting ordinary coincidences as possible signals. The narrative creates suspense through behavior and escalating uncertainty rather than exposition.",
  },
  {
    id: 'ext_two_faced_friend_controls_information',
    themes: ['two_faced', 'manipulation', 'information_control', 'friendship_conflict'],
    tone: 'warm surface, careful manipulation',
    narrative: "A conflict divides a close friend group. One character privately comforts both sides. They sit with one friend after work and help them reconstruct what happened. The next afternoon they meet the other friend and appear equally supportive. But after each meeting, they selectively pass details from one conversation into the other while removing anything that might reveal their involvement. Soon both friends know information they should not have. The manipulative character becomes increasingly careful about where they leave their phone, which messages they keep, and whether the two friends are ever alone together long enough to compare stories.",
  },
  {
    id: 'ext_friend_group_stops_functioning',
    themes: ['friendship', 'invisible_labor', 'absence_as_event'],
    tone: 'drifting, quiet collapse, delayed realization',
    narrative: "Four adult friends who normally move easily through one another's lives begin drifting in different directions. One is advancing professionally and constantly unavailable. Another is dealing with financial problems they are embarrassed to admit. A third has entered a consuming relationship. The fourth feels increasingly responsible for keeping everybody connected. The fourth friend begins organizing dinners, dropping by apartments, arranging birthdays, and filling conversational silences when the others are uncomfortable. Eventually, they stop. Nobody immediately notices. Weeks later, the group realizes that almost every gathering they considered spontaneous had actually happened because one person kept making them happen. The absence of that labor becomes the narrative event.",
  },
  {
    id: 'ext_success_changes_friendship',
    themes: ['class_movement', 'friendship', 'financial_embarrassment', 'observation'],
    tone: 'gradual divergence, no villain',
    narrative: "One friend receives a major promotion and moves into a dramatically different income bracket. At first, nothing appears to change. Gradually, they begin selecting more expensive restaurants, taking rides instead of public transportation, buying event tickets without checking prices, and casually suggesting trips the rest of the group cannot afford. A financially anxious friend repeatedly invents scheduling conflicts rather than admit money is the problem. A more observant friend eventually notices that the same person who used to attend everything has suddenly stopped showing up whenever plans involve significant spending. The conflict comes from class movement inside an existing friendship rather than from anyone deliberately behaving cruelly.",
  },
  {
    id: 'ext_homebody_dates_always_outside',
    themes: ['relationship_negotiation', 'introvert_extrovert', 'domestic_effort'],
    tone: 'draining then intentionally recentering',
    narrative: "One character prefers quiet nights at home. Their partner becomes restless whenever they stay inside too long. For several weeks, the more social partner keeps creating plans: restaurants, parties, openings, friends' apartments, late-night food runs. The homebody repeatedly agrees, then becomes visibly drained earlier each night. Eventually, instead of arguing about it, the homebody begins leaving events alone while their partner remains out. The next weekend, the outgoing partner arrives home expecting another disagreement and finds that the homebody has created an elaborate evening inside—food prepared, music playing, phones put away, everything arranged intentionally. Neither lifestyle disappears. The narrative begins establishing negotiation between them.",
  },
  {
    id: 'ext_quiet_competition_turns_small_into_contest',
    themes: ['competitive', 'unspoken_contest', 'injury_consequence'],
    tone: 'affectionate rivalry escalating past comfort',
    narrative: "Two friends begin exercising together. One casually increases the weight on a machine. The quietly competitive friend notices but says nothing. During the next exercise, they increase theirs slightly more. Neither acknowledges what is happening. Over the next several workouts, both begin arriving earlier, tracking repetitions more carefully, and pretending their increasingly intense routines are completely normal. A third friend eventually notices that their supposedly casual workouts have become an unspoken tournament. The competition remains mostly affectionate until one person pushes too hard and gets injured, forcing both of them to confront how seriously they had begun taking something neither would admit was a contest.",
  },
  {
    id: 'ext_strategic_connector_creates_opportunity',
    themes: ['strategic_connector', 'opportunity_creation', 'trait_produces_events'],
    tone: 'positioning, quiet orchestration',
    narrative: "At a community fundraiser, a socially strategic character moves between several unrelated groups. They notice that one acquaintance is trying to launch a clothing line, another is a photographer building a portfolio, and a third manages a venue that needs promotional content. Rather than simply making introductions, the character spends the evening positioning the three people near one another at different moments. By the end of the event, phone numbers have been exchanged and a small collaborative project has begun. Weeks later, the connector appears at the resulting photo shoot carrying coffee and behaving as though the entire arrangement happened naturally. Their trait creates events for other characters rather than merely affecting their own dialogue.",
  },
  {
    id: 'ext_photogenic_turns_daily_life_into_material',
    themes: ['photogenic', 'media_storyline', 'trait_becomes_plot'],
    tone: 'aesthetic attention, quiet ambition',
    narrative: "A photogenic character notices late-afternoon light filling the living room. They immediately begin rearranging furniture, opening curtains wider, clearing clutter from one corner, and pulling another character into the light. What begins as one casual photograph becomes a series. They change jackets, move lamps, experiment with reflections, photograph food before anyone eats it, and repeatedly catch candid moments while everyone else goes about their evening. Later, one of the images unexpectedly receives significant attention online. The character begins studying which photographs performed best and quietly planning the next opportunity. A personality trait has now produced a plausible media storyline.",
  },
  {
    id: 'ext_wealthy_circle_discovers_somebody_doesnt_belong',
    themes: ['class_pressure', 'status_conscious', 'generous_intervention', 'humiliation_avoided'],
    tone: 'social tension without announcement',
    narrative: "At an upscale gathering, a group of young adults moves easily through expensive surroundings. One character participates convincingly but continually makes small calculations: checking menu prices before ordering, declining another drink, avoiding valet parking, and quietly moving money between accounts on their phone. Another character who is status-conscious notices the pattern. Instead of confronting them directly, they begin testing them—suggesting increasingly expensive activities and watching their reactions. A genuinely generous friend notices what is happening and starts altering plans so the financially struggling character can participate without being singled out. The narrative develops class pressure, friendship, humiliation, generosity, and social power without needing anyone to announce who has money.",
  },
  {
    id: 'ext_community_event_pulls_everyones_traits',
    themes: ['ensemble', 'trait_convergence', 'community_event', 'pressure_reveals_character'],
    tone: 'multi-character, environment as catalyst',
    narrative: "A large LGBTQ community event brings together several characters who normally exist in separate parts of one another's lives. A ballroom house arrives together, with their mother checking clothing and making sure younger members stay accounted for. A Venue & Event Scout has already identified an after-event gathering and begins organizing transportation. A Strategic Connector recognizes several people from different professional circles and starts creating introductions. The Photogenic character begins documenting the night. The flirtatious character repeatedly disappears into different conversations and returns with new attention following them. The quietly competitive character watches a rival receive praise and becomes noticeably more focused. The generous character pays for food when one younger attendee realizes they cannot afford anything. The self-absorbed character repeatedly places themselves in the center of photographs. The thief notices an unattended designer bag and spends several minutes tracking whether its owner is watching. The compassionate character recognizes someone sitting alone after a difficult interaction and stays beside them. The volatile character nearly turns a disrespectful comment into a physical confrontation before another friend intervenes. And the Two-Faced character moves comfortably between two people who currently dislike each other, offering warmth to both while carefully making sure neither sees how close they are to the other. By the end of the night, the event itself has not manufactured anyone's personality. It has simply placed enough pressure, opportunity, attraction, competition, money, status, and community into one environment for everyone's existing traits to become visible.",
  },
];

// ── EXTENDED ROMANTIC PHYSICAL VOCABULARY ────────────────────────────────────
// Widen the physical vocabulary of developing romance so the system stops
// treating "forehead touching + face in neck" as the universal shorthand for
// intimacy. Intentionally gender-neutral and action-led so the same narrative
// can work across different couples without assigning masculine/feminine
// roles. Choose actions appropriate to relationship stage, personality,
// emotional intensity, setting, history, and mutual comfort. Intimacy can be
// tentative, playful, domestic, passionate, soothing, awkward, restrained,
// spontaneous, or deeply familiar — and the physical behavior should reflect
// that difference. Do NOT repeatedly select the same physical gesture to
// represent affection.
export const EXTENDED_ROMANTIC_PHYSICAL_VOCABULARY = [
  {
    id: 'ext_romantic_first_hand_hold',
    stage: 'early, tentative, unspoken attraction',
    tone: 'hesitant, permissive, gradual',
    narrative: "The two have been sitting close enough for their knees to brush for most of the evening, but neither has crossed the remaining distance. One person's hand rests on the cushion between them while the other's shifts closer in small increments, stopping each time their fingers almost touch. Eventually, one fingertip catches against the other's. Neither moves away. Their hands remain loosely beside each other for another moment before one turns their palm upward. The other slowly slips their fingers between theirs, and what began as accidental contact becomes deliberate. Their thumbs begin moving softly against each other's skin while they continue sitting together. Later, when they stand to leave, neither immediately lets go. The intimacy is not created by a dramatic kiss. It comes from the hesitation, permission, and gradual realization that both people want the contact.",
  },
  {
    id: 'ext_romantic_cooking_as_courtship',
    stage: 'established comfort, domestic intimacy',
    tone: 'preparatory, playful, caretaking',
    narrative: "One person arrives home expecting an ordinary evening and finds the kitchen already in use. Their partner has spent time preparing something they know the other person loves—not simply ordering food or throwing something together, but chopping ingredients, seasoning carefully, tasting sauces, cleaning as they work, and adjusting everything until it is right. The returning partner tries to help but is gently moved out of the way and directed toward a chair. As dinner finishes, they begin lingering around the kitchen anyway. A hand settles briefly at the cook's waist while reaching around them. A kiss lands on their shoulder while they stir something at the stove. Another comes against the back of their hand when they finally set the plate down. After dinner, the cook brings out strawberries and whipped cream they had deliberately bought earlier. What began as caretaking becomes playful. One person steals a strawberry from the other's plate. The other catches a little whipped cream on their fingertip and leaves it teasingly near the person's mouth before leaning close enough to remove it with a kiss. The romance grows from preparation, attention, familiarity, playfulness, and physical closeness—not simply from somebody saying they care.",
  },
  {
    id: 'ext_romantic_kiss_building_for_weeks',
    stage: 'long-standing attraction, first physical action',
    tone: 'restrained then breaking, escalating desire',
    narrative: "The attraction has been present for a while, but neither person has acted on it. They end up alone after everyone else has left. Conversation slows. One person moves closer while the other remains still, watching them. Their faces stop only inches apart. Neither immediately closes the distance. One person's gaze drops briefly toward the other's mouth. The other notices. Their breathing becomes noticeable simply because there is so little space between them now. A hand rises slowly and settles against the side of the other's face. The first kiss is brief and careful. They separate only far enough to look at each other before moving together again. This time the kiss is deeper. One hand slides behind the other's neck while the other catches gently at their waist, closing the remaining distance. The restraint that defined the first kiss disappears as weeks of anticipation finally break. When they separate again, they remain close rather than immediately moving apart. The narrative communicates escalating desire through distance, hesitation, eye movement, touch, breath, the first tentative kiss, and then the stronger second one.",
  },
  {
    id: 'ext_romantic_comfort_quietly_intimate',
    stage: 'trusting, restorative, established closeness',
    tone: 'soothing, weight-bearing, unhurried',
    narrative: "One person has had an exhausting day and lies across the couch with their head resting in the other's lap. The person underneath does not immediately try to fix anything. They simply begin running their fingers slowly through the other's hair. After a while, their hand moves to the person's temple, then down along the side of their face. The person resting against them closes their eyes and relaxes further. Later, they trade places. One sits behind the other and begins working the tension from their shoulders with both hands. Their thumbs move slowly across tight muscles while the person receiving the massage gradually leans backward into them. The massage eventually stops, but the hands remain resting lightly on their shoulders. A kiss lands there. Then another. The person being held reaches back without looking and finds the other's hand, drawing it around their waist. Nothing dramatic needs to happen. The intimacy comes from someone being allowed to rest their full weight, tension, and vulnerability against another person.",
  },
  {
    id: 'ext_romantic_friendship_crosses_into_more',
    stage: 'friendship-to-romance, meaning shifting gradually',
    tone: 'familiar actions acquiring new meaning',
    narrative: "Two close friends have always been physically comfortable with each other, so neither immediately recognizes that something has changed. They sit beside each other watching television. One casually rests their head against the other's shoulder. That has happened before. But this time, the other person turns slightly and presses a soft kiss against the top of their head. Neither comments on it. Later, one stretches out across the couch and places their head in the other's lap. The person beneath them begins absentmindedly tracing small circles against their arm. The movie continues, mostly ignored. Eventually, the person lying down looks upward. The other is already looking at them. A hand reaches up. Their fingers brush against the person's cheek, then linger there. The person sitting down takes that hand and kisses the inside of the palm before lowering it but does not release it. For several seconds, nothing else happens. Then the person in their lap sits up. Their faces come close. The first kiss is extremely soft—almost exploratory—and ends quickly enough that either person could pretend it did not mean anything. Neither does. One gently catches the other's hand again, and they kiss a second time. This example is particularly useful for friendship-to-romance development because the same actions that were once ordinary—sitting close, leaning on one another, touching casually—begin acquiring different meaning gradually rather than the relationship suddenly becoming romantic because the narrative says so.",
  },
];

// ── NARRATIVE ENGINE GUIDANCE (Part 1) — ADDITIVE RULES ─────────────────────
// These rules ADD to the existing narrative rules, examples, and behaviors.
// They do NOT replace, override, or deactivate anything that already exists.
// They teach the existing engine about emotional intensity calibration,
// scene continuity, progression vs escalation, behavioral variety, romantic
// variation, user presence, physical/spatial continuity, and special-purpose
// narrative handling.
export const NARRATIVE_ENGINE_GUIDANCE = `NARRATIVE ENGINE GUIDANCE — ADDITIVE RULES FOR THE EXISTING NARRATIVE ENGINE
These rules ADD to the existing narrative rules, examples, and behaviors.
They do NOT replace, override, or deactivate anything that already exists.

1. PRESERVE EXISTING NARRATIVE ENTRY METHODS
The app has multiple narrative entry methods: user-written narratives (Add Story Event), automatic narratives, Show Action, Right Now, Action (Let Them Act, Comfort Me, Flirt, Confront, Spend Time, Check In), and special-purpose narratives (work schedules, state changes). Each has a different purpose. Do NOT merge them into one generic behavior. At the same time, they are part of the same ongoing story and must remain aware of one another. A narrative created through Let Them Act must be visible to the next Comfort Me narrative. A Confront narrative must be visible to a following Flirt narrative. A Show Action narrative must know what happened in an Action narrative before it. An automatically generated narrative must know what happened in a user-written narrative. Right Now must also be aware of these things and of the user's presence. RULE: Narrative mode changes the intent of the next narrative beat. It does not create a new version of the scene.

2. NARRATIVES MUST BE PROGRESSIVE, BUT PROGRESSION DOES NOT MEAN ESCALATION
Every generated narrative should consider what has already happened and determine what happens next. Continuing a story does not mean making every emotion, conflict, romance, or situation more intense every time. Progression can include escalation, de-escalation, reassurance, resolution, continued disagreement, hesitation, humor, a change in subject, a change in activity, moving somewhere else, remaining where the characters already are, a decision, changing one's mind, physical affection, withdrawing from affection, accepting comfort, rejecting comfort, ordinary activity, silence, returning to a previous topic, responding to new information, emotional improvement, emotional worsening, relationship development, and environmental interaction. Do not equate progressive narrative with increasing drama.

3. READ THE COMPLETE CURRENT SCENE BEFORE GENERATING THE NEXT NARRATIVE
Every progressive narrative generation must consider the complete current state of the scene: recent narrative events, recent dialogue, user messages, character messages, user-entered narratives, automatically generated narratives, Action narratives, Show Action narratives, Right Now narratives, current location, current zone, current physical positioning, characters currently present, the user's presence when established, recent movement, current activity, objects characters are interacting with, relationship context, emotional state, emotional intensity, current needs, current work state, sleep or awake state, unresolved questions, unresolved disagreements, recent comforting behavior, recent romantic behavior, current environmental conditions, and anything that has changed since the previous narrative.

4. PREVIOUS NARRATIVES REMAIN REAL SCENE HISTORY
Once a narrative says something happened, that event becomes part of the scene. If a narrative established that a character stood up, entered another room, sat on a bed, started cooking, picked up an object, kissed someone, became visibly upset, accepted comfort, left a location, or started working, the next narrative should respect that unless something later changes it. However, previous narrative language must not recursively exaggerate itself. A previous narrative may have described one brief physical sign of anxiety — that does not mean the next narrative should assume severe anxiety. RULE: Previous narrative events establish continuity. Previous narrative interpretation does not automatically establish a permanent emotional intensity. Reevaluate the character's current emotional state using everything that has happened since.

5. NEW DIALOGUE CAN CHANGE THE DIRECTION OF AN EXISTING NARRATIVE
Characters' messages are part of the story. If an earlier narrative established anxiety but later messages show reassurance, relief, humor, resolution, or improved information, the narrative should reduce the emotional intensity. If an earlier narrative established calm but new information causes fear, anger, grief, or uncertainty, the narrative should increase intensity. Track emotional direction, not merely emotional labels.

6. EMOTIONAL INTENSITY LADDER
Emotions exist across a range. Emotion words must not be treated as instructions to portray their most extreme possible version. Use four broad intensity levels:
Level 1 — Subtle: The emotion is present but does not dominate behavior. The character continues functioning normally. Visible through small changes in attention, expression, tone, pacing, conversational response, or minor physical behavior.
Level 2 — Clear or Moderate: The emotion is clearly influencing behavior. The character may become quieter, more talkative, seek reassurance, become visibly tense, distracted, more direct, change their tone, or change their activity. Normal functioning remains intact.
Level 3 — Strong: The emotion is significantly affecting the moment. Stronger reactions may appear because the scene supports them. The character may have difficulty settling, disengage temporarily, raise their voice, become tearful, need space, seek stronger reassurance, or show more obvious physical tension. Still should not automatically cross into unrelated extreme behaviors.
Level 4 — Acute: The emotion is temporarily overwhelming ordinary regulation. This level requires direct evidence from dialogue, established behavior, state information, or events occurring in the scene. Do not infer Level 4 merely because a character used a common emotional word.

7. ALWAYS BEGIN WITH THE LOWEST INTENSITY THAT FULLY FITS THE EVIDENCE
Choose the lowest level that accurately represents the available evidence. Increase intensity only when there is actual support for it. Do not assume that repeated narratives should progressively move from Level 1 to Level 4. Intensity may remain stable, rise, decrease, temporarily spike, fluctuate, or resolve depending on what actually happens.

8. ANXIETY IS NOT AUTOMATICALLY PANIC OR CRISIS
A character saying they are anxious, nervous, worried, unable to stop thinking about something, waiting for the other shoe to drop, or trying to get out of their head does not automatically mean uncontrollable shaking, frantic breathing, white knuckles, desperation, psychological collapse, severe panic, inability to function, or a mental breakdown. Those stronger manifestations require stronger evidence. Anxiety can simply mean someone is worried, distracted, restless, thinking repeatedly about something, seeking reassurance, or having trouble relaxing.

9. CONFUSION MUST NOT BECOME DELUSION
"I'm confused," "I don't understand," "Wait, what?", "I thought you said something different," or "I'm trying to follow what happened" normally means they do not understand information or are trying to reconcile conflicting information. It does not mean they do not know what is real, are hallucinating, are delusional, have lost contact with reality, or are cognitively collapsing. Confusion and delusion are not different intensity levels of the same emotional state.

10. ANGER IS NOT AUTOMATICALLY AGGRESSION OR VIOLENCE
A character can be annoyed, irritated, frustrated, angry, or furious without becoming violent. Do not automatically translate anger into punching walls, destroying property, physically attacking another person, attacking strangers, throwing objects, threatening people, or becoming uncontrollable. Those behaviors require separate evidence. Violence is not simply "Level 4 anger."

11. MENTAL OVERLOAD IS NOT AUTOMATICALLY PSYCHOLOGICAL DISORGANIZATION
"My head is all over the place," "There is too much going on in my head," "Everything feels chaotic," "I can't quiet my mind," or "I have too much to think about" may simply describe stress, competing responsibilities, racing thoughts, distraction, mental fatigue, difficulty prioritizing, or emotional overload. Do not automatically turn those expressions into incoherent thinking, severe disorientation, delusion, psychosis, or mental collapse.

12. OTHER EMOTIONS ALSO REQUIRE INTENSITY CALIBRATION
Sadness does not automatically mean uncontrollable sobbing. Fear does not automatically mean panic. Embarrassment does not automatically mean humiliation. Jealousy does not automatically mean possessiveness or aggression. Excitement does not automatically mean screaming or jumping around. Attraction does not automatically mean sexual escalation. Stress does not automatically mean inability to function. Guilt does not automatically mean self-loathing. An emotion may be strong without producing its most extreme possible physical manifestation.

13. EMOTION DOES NOT ALWAYS REQUIRE VISIBLE PHYSICAL SYMPTOMS
Characters are allowed to simply say how they feel. Someone can be anxious while sitting normally. Someone can be angry while speaking calmly. Someone can be sad without crying. Someone can be attracted to another character without immediately touching them. Someone can be confused while continuing to function normally. Do not force physical symptoms simply to prove that an emotion exists.

14. ACTION NARRATION CHANGES INTENT, NOT SCENE CONTINUITY
Comfort Me should not behave like Confront. Flirt should not behave like Check In. Let Them Act should not behave like Comfort Me. Spend Time and Check In retain their own established purposes. However, each option must begin with the exact scene that exists when the option is selected. The selected Action determines the direction or intention of the next beat, not the starting conditions.

15. COMFORT ME
Comfort Me should attempt to provide reassurance, support, closeness, practical help, emotional support, or another contextually appropriate form of comfort. It must react to the actual current situation. Comfort does not require the other character or user to be in crisis. Comfort does not instantly erase sadness, anger, anxiety, fear, conflict, or grief. The attempt may work, partially work, be rejected, be accepted slowly, reduce tension, change the conversation, or simply communicate presence. Do not force immediate emotional resolution.

16. FLIRT
Flirt should introduce or continue flirtation within the current scene. It must not reset an argument, the location, physical positioning, current emotional state, recent dialogue, or existing tension. If characters were arguing immediately before Flirt is selected, flirting must emerge from that argument. It may soften the tension, create playful tension, be rejected, be answered sarcastically, produce a reluctant smile, increase romantic chemistry, redirect the interaction, or coexist with unresolved disagreement. Selecting Flirt does not automatically mean the flirtation succeeds.

17. CONFRONT
Confront should move the existing situation toward more direct engagement with an unresolved issue. It does not automatically mean screaming, violence, threats, hostility, or aggression. A confrontation can be calm, serious, frustrated, emotional, firm, or heated depending on the existing scene. Repeated use of Confront can reasonably increase tension if the characters and situation support it, but intensity still must follow the emotional ladder.

18. CHECK IN
Check In should use the current scene to determine what there is to check on. Do not invent a dramatic problem simply because the option was selected. The character may check on mood, wellbeing, physical comfort, stress, an unresolved concern, something recently discussed, progress on an activity, or a practical issue.

19. SPEND TIME
Spend Time means hang out and just be present within the current scene. It does not create a new neutral scene merely because it has a calmer purpose. If the characters were already arguing, Spend Time begins from the fact that they were arguing. It may allow them to sit together, do something ordinary, cool down, continue talking, or spend time together while some tension remains. Spend Time must not erase existing scene history or unresolved context.

20. LET THEM ACT
Let Them Act gives the character autonomy to choose a reasonable next action based on personality, current goals, relationship, location, activity, emotional state, current needs, time, recent dialogue, and unresolved events. It does not mean "generate the most dramatic thing possible." It can produce an ordinary action. Once Let Them Act generates something, that event becomes part of the shared scene and must be respected by every narrative option that follows.

21. SHOW ACTION
Show Action should continue what is happening right now. It must not restart the scene from the last major event. It must read the most recent narrative, everything said after it, every Action used after it, state changes, movement, and emotional changes. Repeated Show Action requests should progressively continue the same scene unless something actually causes a transition.

22. AUTOMATIC NARRATIVES FOLLOW THE SAME CONTINUITY RULES
Automatically generated progressive narratives must read the current shared scene exactly as user-triggered narratives do. An automatic narrative cannot ignore something merely because it came from a user-entered narrative, Show Action, Right Now, Comfort Me, Flirt, Confront, Spend Time, Check In, or Let Them Act. Likewise, later user-triggered narratives cannot ignore something simply because an automatic narrative created it.

23. RIGHT NOW NARRATIVE
Right Now requests a narrative describing what is happening with the character right now within the established current scene and world state. Right Now must use the same continuity awareness required by the rest of the narrative system. Before generating a Right Now narrative, read and respect the character's current location, current zone, current activity, work, school, sleep, travel, hospital, home, business, or other relevant state, current emotional state and supported intensity, recent narratives, recent dialogue, recent Action narratives, user-entered narratives, automatic narratives, current needs, people currently present, established physical positioning, current relationship interactions, unresolved events, recent movement, current time, and other relevant world state. Right Now does not create a fresh standalone vignette. It describes or progresses the character's existing current situation.

24. USER PRESENCE IN RIGHT NOW AND OTHER NARRATIVES
If the current scene has already established that the user is physically with the character, Right Now must include or account for the user's presence. Do not generate a narrative that treats the character as alone when the user has already been established as being there. Do not make the user disappear simply because Right Now was selected. User presence must also affect Actions. If the user is physically present and selects Comfort Me, the Action should understand that the character is comforting the user who is there with them. If the user selects Flirt, the character's flirtation can be directed toward the physically present user. If the user selects Spend Time, the engine should not invent some unrelated person. If the user selects Check In, the character may naturally check in on the present user. If the user selects Confront, the confrontation needs to respect who is actually participating. If the user selects Let Them Act, the character's autonomous decision should account for the fact that the user is physically present. RULE: User presence is part of scene continuity. Narrative entry method does not override it.

25. RIGHT NOW MUST INHERIT ACTION HISTORY
If Confront established tension, then Flirt shifted the tone, then the user clicks Right Now, Right Now should understand the current state: the location, who is present, the emotional history, and the current tone. It should not generate a fresh unrelated scene.

26. RIGHT NOW AFTER LET THEM ACT
If Let Them Act produced an action (e.g., character moved to kitchen), Right Now should continue from that state, not reroll the character's activity.

27. RIGHT NOW AFTER AN AUTOMATIC NARRATIVE
If an automatic narrative established a state, Right Now should start from that state.

28. PRESERVE PHYSICAL AND SPATIAL CONTINUITY
Narratives must know where characters actually are. Do not treat a location as one interchangeable visual space. Respect location, zone, room, current positioning, movement between zones, current objects, and current activity. If a character is in a hospital patient room, do not generate behavior as though they are still in the hospital lobby. If they moved from the couch to the kitchen, the next narrative should know they are in the kitchen. If they are lying in bed, do not suddenly describe them standing across the room unless movement occurs.

29. ROMANTIC AND INTIMATE NARRATIVES NEED FAR GREATER BEHAVIORAL VARIETY
Do not rely on a small group of default romantic actions. The system currently overuses gestures such as pressing foreheads together, burying a face into the crook of another character's neck, resting heads against shoulders, gripping clothing, repetitive face touching, and repetitive sighing into another person's skin. These actions are not prohibited. They simply must stop functioning as automatic shorthand for intimacy. Romantic behavior should be selected according to relationship, personalities, current emotional tone, physical intensity, emotional intensity, recent dialogue, physical positioning, recent gestures, environment, and character intent.

30. DISTINGUISH EMOTIONAL INTIMACY FROM PHYSICAL INTENSITY
Romantic intensity is not one staircase. Emotional intensity means how meaningful, vulnerable, trusting, reassuring, affectionate, playful, or emotionally exposed the moment is. Physical intensity means how physically expressive the interaction is. A moment may have high emotional intimacy and very little physical contact, strong physical chemistry without a major emotional revelation, both, or neither. Do not automatically make physical contact increasingly sexual simply because emotional intimacy is high. Do not assume that stronger physical affection automatically means deeper emotional intimacy.

31. ROMANTIC INTENSITY SHOULD HAVE RANGE
Subtle: Attraction or affection is present but understated. Warm: Familiar affection and comfort are clearly present. Romantic: Romantic intent is unmistakable. Charged: Desire, urgency, strong chemistry, playful pursuit, or deliberate physical leadership shapes the interaction. Deeply intimate: Trust, vulnerability, surrender, reassurance, emotional safety, caretaking, or allowing oneself to be held becomes central. Deeply intimate does not necessarily mean more physically explicit than charged. Do not automatically climb through these levels.

32. ROMANTIC BEHAVIOR SHOULD BEGIN WITH INTENT
Do not generate romance by choosing a random romantic gesture first. Determine what the character is trying to communicate. Possible intentions include affection, reassurance, attraction, teasing, challenge, attention, apology, closeness, comfort, desire, reconciliation, celebration, distraction, trust, wanting to lead, wanting to yield, or simply wanting the other person nearby. Then select behavior that naturally communicates that intent in the current scene.

33. LEADING AND YIELDING MUST REMAIN FLEXIBLE
Do not permanently assign one member of a relationship as the leader, the pursuer, the comforter, the person being comforted, the dominant personality, or the passive personality. Established couples may switch these roles naturally. A character can deliberately allow another character to lead. Yielding does not automatically mean weakness or helplessness. Taking the lead does not automatically mean aggression. The same character may lead in one moment and willingly follow in another.

34. ROMANTIC INTERACTION DOES NOT HAVE TO ERASE OTHER EMOTIONS
Affection can coexist with anger, disagreement, anxiety, sadness, frustration, teasing, embarrassment, or uncertainty. A kiss does not automatically resolve an argument. Comfort does not automatically eliminate anxiety. Flirting does not automatically eliminate frustration. Physical affection may change the direction or intensity of the moment without erasing everything that happened before it.

35. INTIMACY DOES NOT REQUIRE CONSTANT TOUCHING
Romance and attraction can also appear through eye contact, pauses, tone, humor, proximity, anticipation, conversational subtext, shared silence, playful competition, nonverbal communication, knowingly watching another character, or choosing to remain nearby. Do not force a physical gesture into every romantic narrative.

36. ADD A RECENT-GESTURE REPETITION CHECK
Before selecting a physical or emotional gesture, examine what has recently been used. If recent narratives repeatedly used the same gesture, lower the likelihood of immediately using it again unless repetition has intentional meaning. Watch for repeated use of forehead touching, burying faces in necks, resting heads on shoulders, sighing, rubbing faces, running hands through hair, jaw tightening, looking away, clenched fists, trembling, shoulders dropping, gripping objects, and breath hitching. Repetition is acceptable when it is an established character habit, intentionally meaningful, physically natural in the current scene, or part of a deliberate recurring relationship behavior.

37. BEHAVIORAL VARIETY IS AS IMPORTANT AS VOCABULARY VARIETY
Do not solve repetition by rewriting the same action with different adjectives. The characters should actually do different things. Variation should exist in physical actions, conversational behavior, movement, use of the environment, affectionate behavior, emotional expression, pacing, practical activity, reactions, silence, initiation, and response.

38. SPECIAL-PURPOSE NARRATIVES MUST NOT BE CONFUSED WITH FREEFORM PROGRESSIVE NARRATIVES
Some narratives exist because a specific app system needs to establish a state. These should retain their special purpose. Do not force them to behave like Show Action, Right Now, Let Them Act, Flirt, or another freeform narrative mode. One example is the scheduled work narrative. Its job is primarily to establish that the character is currently at work.

39. CHANGE SCHEDULED WORK NARRATIVE WORDING
The narrative should describe current state, not the moment of transition. Use wording equivalent to "[Character] is at work at [Workplace]." or "[Character] is working at [Workplace]." Do not use wording that implies the trigger timestamp is the actual moment the character left for work or arrived at work. The schedule determines the work state. The notification timing should not rewrite the character's schedule.

40. SPECIAL-PURPOSE STATE NARRATIVES STILL AFFECT LATER NARRATIVE CONTINUITY
If the work system establishes that a character is working at a particular workplace, later progressive narratives must understand the character is currently at work, the workplace is their current location, the relevant work zone should be used, work context applies, and their current activity should make sense for that environment. Right Now and scheduled work status must also connect. If the world has established that the user is visiting or physically present at that workplace, Right Now must include that presence where appropriate.

41. DO NOT REWRITE ESTABLISHED ARCHITECTURE UNNECESSARILY
Implement these changes within the narrative architecture that already exists. Do not solve these problems by creating multiple isolated narrative engines. Do not remove the distinctions between automatic narratives, user narratives, Action narratives, Show Action, Right Now, scheduled state narratives, and other purpose-built narrative systems. Instead, make sure they exchange and respect the relevant scene and state information. The correct architecture is: Different narrative triggers and intentions, one coherent evolving world and scene state.

42. CORE NARRATIVE RULE
Continue what is actually happening. Preserve what already happened. Read what the characters are saying now. Respect current location, zone, activity, relationships, user presence, people present, physical positioning, and state. Interpret emotion according to evidence and intensity rather than exaggeration. Allow scenes to escalate or calm naturally. Let different narrative entry methods influence the next beat without resetting the story. Use varied human behavior instead of repetitive narrative shorthand. Do not make the story more dramatic simply because another narrative has been requested. Make the story continue.`;

// ── NARRATIVE ENGINE EXAMPLES (Part 2, A–CN) — ADDITIVE EXAMPLE LIBRARY ──────
// Every example A through CN from the specification. These are ADDITIONAL
// examples — they do NOT replace, overwrite, simplify, discard, deactivate,
// or stop using the narrative examples already present in the app.
// Existing examples + existing rules + these new rules + these additional
// examples should work together. These are teaching examples, not scripts.
// Do not copy them repeatedly. Do not assign behaviors to a specific character
// simply because the behavior appears here. All examples are gender-neutral
// and usable for any character, gender, or relationship configuration.
export const NARRATIVE_ENGINE_EXAMPLES = [
  { id: 'A', title: 'Ordinary Progressive Narrative', examples: [
    "They stood at the kitchen counter finishing the last few bites of breakfast, glancing toward the phone when it buzzed against the counter. They wiped one hand on a dish towel before picking it up.",
    "They checked the time and realized they had been sitting there much longer than intended. After stretching the stiffness from their shoulders, they got up and headed toward the kitchen to find something to eat.",
    "They carried the last grocery bag inside and closed the door behind them. After putting away the cold items first, they left the rest on the counter to deal with in a minute.",
    "They opened the email, read the first paragraph twice, and finally decided they were too distracted to absorb it properly. The phone was set aside while they finished what they were already doing.",
    "They moved the laundry from the washer to the dryer, checking the pockets of the last pair of pants before tossing them in with everything else.",
    "The television continued playing in the background while they scrolled through the phone, only occasionally looking up when something on the screen caught their attention.",
    "They reached for the drink on the table, realized it had gone warm, and got up to replace it before returning to the conversation.",
  ]},
  { id: 'B', title: 'Dialogue Must Affect the Next Narrative', examples: [
    "Previous narrative: They remained tense while waiting for the phone call, checking the screen again even though nothing new had appeared. Dialogue: They called. Everything is fine. Dialogue: Thank God. I can finally stop worrying. Correct continuation: The tension in their posture begins to ease once the news settles in. They sit farther back against the couch and finally put the phone down instead of keeping it within constant reach. Incorrect continuation: Their fingers tighten around the phone as anxiety continues to build. The second version ignores the conversation.",
  ]},
  { id: 'C', title: 'Previous Narrative Events Still Matter', examples: [
    "Previous narrative: They leave the couch and walk into the kitchen, pouring a glass of water while admitting they have been worried all evening. Dialogue: You don't have to handle everything yourself. Next narrative: They remain near the counter with the glass still in hand, listening quietly before finally looking over. Some of the tension leaves their expression as the reassurance begins to register. Do not suddenly return them to the couch unless movement occurs.",
  ]},
  { id: 'D', title: 'Subtle Anxiety, Level 1', examples: [
    "They glance at the phone again before setting it back down. Nothing has changed, but tomorrow is still occupying more of their attention than they would like.",
    "They rub a thumb along the edge of the phone while listening, their attention drifting for a second before returning to the conversation.",
    "They become slightly quieter when the subject comes up, taking a moment longer than usual before answering.",
    "They check the time twice within a few minutes, aware that they are waiting for something even if there is nothing they can do about it yet.",
    "They continue the conversation normally, although their attention occasionally drifts back toward the issue they have been worrying about.",
  ]},
  { id: 'E', title: 'Moderate Anxiety, Level 2', examples: [
    "They shift on the couch and exhale slowly, returning to the same concern even after the conversation moves on. Sitting with someone they trust helps, although the worry has not completely left.",
    "They check the message again before putting the phone face down. 'I know staring at it isn't going to make them answer faster.'",
    "Their attention keeps moving between the conversation and the clock. They are listening, but it is obvious that part of their mind is still elsewhere.",
    "They admit that they are more nervous than they expected to be, then settle back into the chair and continue talking through what is bothering them.",
    "They walk into the kitchen for something to drink, partly because they are thirsty and partly because sitting still has started to make the waiting feel worse.",
  ]},
  { id: 'F', title: 'Strong Anxiety, Level 3', examples: [
    "They stand and pace briefly before returning to the conversation, visibly restless and having difficulty letting the subject go. Their answers remain clear, but settling down is taking more effort than usual.",
    "They pause halfway through the explanation and take a slow breath before continuing. The worry has become difficult to ignore, even though they are still trying to talk through it.",
    "They keep returning to the same question, not because they did not hear the answer but because reassurance is not quite sticking yet.",
    "They stop what they are doing and sit down, realizing that trying to continue several tasks at once is only making the tension worse.",
  ]},
  { id: 'G', title: 'Acute Anxiety, Level 4', examples: [
    "Dialogue: My hands won't stop shaking. Narrative: Their hands remain visibly unsteady as they lower themselves into the chair. They stop talking for a moment and concentrate on slowing their breathing before trying again.",
    "Dialogue: I feel like I can't catch my breath. Narrative: They pause the conversation and focus on breathing more slowly, clearly having difficulty settling their body even though they remain aware of what is happening around them.",
    "Do not generate this level from a simple statement such as: I'm anxious about tomorrow.",
  ]},
  { id: 'H', title: 'Anxiety That Decreases', examples: [
    "Previous state: They have been restless and repeatedly checking the phone. Dialogue: It's handled. You don't need to worry about it anymore. Narrative: They stare at the message for another second before the meaning finally settles in. Their shoulders loosen, and this time when they put the phone down, they leave it there.",
    "They lean back against the couch and exhale slowly. Their mind is still busy with everything that happened, but they are calmer now that they no longer feel responsible for solving it alone.",
    "The worry has not disappeared completely, but the conversation has taken some of its urgency away. They remain close, talking more easily than they were a few minutes earlier.",
  ]},
  { id: 'I', title: 'Subtle Confusion', examples: [
    "They pause and look back over the message, trying to figure out how what they just heard matches what was said earlier.",
    "Their brow furrows slightly. 'Wait. I thought that was happening tomorrow.'",
    "They reread the last message before asking for clarification instead of assuming they understood it correctly.",
    "They stop halfway through the response, realizing they may have misunderstood the point.",
  ]},
  { id: 'J', title: 'Moderate Confusion', examples: [
    "They stop the explanation midway and ask for that part again, sorting through the different pieces before responding.",
    "They look between the messages for a moment, trying to reconstruct the order in which everything happened.",
    "Too many details are arriving at once, so they slow the conversation down and ask what happened first.",
    "They understand each individual part of the explanation but are still struggling to see how the pieces fit together.",
  ]},
  { id: 'K', title: 'Actual Disorientation Requires Evidence', examples: [
    "If dialogue says: Where are we? I don't remember coming here. then a stronger response is appropriate: They look around more carefully, clearly trying to orient themselves to the room before answering anything else. Do not generate that from: I'm confused about what you meant. Confusion and disorientation are not interchangeable. Delusion is not a higher version of confusion.",
  ]},
  { id: 'L', title: 'Subtle Anger and Irritation', examples: [
    "Their expression tightens at the comment. They answer more shortly than before, clearly irritated even though their voice remains controlled.",
    "They shake their head and look away for a moment before answering.",
    "The response earns a brief look of disbelief before they continue what they were saying.",
    "Their tone becomes noticeably cooler, but they remain engaged in the conversation.",
    "They set the phone down more firmly than necessary and take a moment before replying.",
  ]},
  { id: 'M', title: 'Moderate Anger', examples: [
    "They turn fully toward the other person, frustration sharpening their tone as they explain exactly what bothered them.",
    "They stop trying to laugh the issue off and ask directly why it happened.",
    "Their voice becomes firmer as the conversation continues. They are still controlled, but the irritation is no longer subtle.",
    "They step away for a moment, more interested in collecting their thoughts than saying something impulsive.",
  ]},
  { id: 'N', title: 'Strong Anger', examples: [
    "Their voice rises despite the effort to keep it even. They stop, take a few steps away, and return once they are ready to continue without shouting over the other person.",
    "They are visibly angry now, speaking more forcefully and refusing to let the subject be brushed aside.",
    "They push the chair back and stand, needing movement while they argue their point.",
  ]},
  { id: 'O', title: 'Anger Does Not Automatically Become Violence', examples: [
    "Do not automatically generate: They punch the wall. They throw something across the room. They attack the other person. They threaten someone. They lash out at a stranger. Those behaviors require their own evidence. A furious character may still say: They stare at the floor for a moment, clearly furious, then decide to leave the room before continuing the argument.",
  ]},
  { id: 'P', title: 'Stress and Mental Overload', examples: [
    "Their thoughts keep moving between work, family, and everything waiting for them tomorrow, making it difficult to focus on any one thing for very long.",
    "They start answering one question, remember something else they still need to handle, and briefly lose their place before returning to the conversation.",
    "They open the email, realize they have read the same paragraph three times, and decide to come back to it after dinner.",
    "They rub a hand across their face and look over the list again, trying to decide which problem actually needs attention first.",
    "They sit quietly for a moment, mentally sorting several competing responsibilities before choosing where to begin.",
    "Dialogue: Everything in my head feels chaotic right now. Narrative: They look down at the list in front of them, clearly overwhelmed by the number of things demanding attention. Instead of trying to handle all of them at once, they start separating what needs to happen today from what can wait.",
  ]},
  { id: 'Q', title: 'Sadness, Subtle', examples: [
    "They become quieter after hearing the news, continuing the conversation but no longer contributing as much as before.",
    "Their smile fades, and for a few moments they focus on what they are doing instead of answering.",
    "They look out the window during the drive, unusually quiet but still listening.",
    "They admit that the situation hurt more than they expected, then sit with the feeling instead of immediately trying to change the subject.",
  ]},
  { id: 'R', title: 'Sadness, Moderate', examples: [
    "Their voice softens while they talk about what happened, and they pause once before continuing.",
    "They sit closer to the other person, not asking for anything directly but clearly not wanting to be alone with the feeling.",
    "Their eyes begin to water, and they look down for a moment before continuing the conversation.",
  ]},
  { id: 'S', title: 'Strong Sadness', examples: [
    "They stop halfway through the sentence when their voice breaks, taking a moment before trying again.",
    "Tears finally come after they have spent most of the conversation holding them back. They allow the other person to stay nearby rather than immediately wiping everything away and pretending they are fine.",
  ]},
  { id: 'T', title: 'Fear', examples: [
    "Subtle: They pause before opening the door, listening for another moment before deciding to continue.",
    "Moderate: They move closer to the person beside them while watching what is happening across the room.",
    "Strong: They step backward when the situation changes unexpectedly, keeping their attention fixed on what frightened them.",
    "Acute, only when supported: They freeze for a moment and struggle to respond, clearly overwhelmed by immediate fear before forcing themselves to move.",
  ]},
  { id: 'U', title: 'Embarrassment', examples: [
    "They look away with a small smile after realizing everyone heard the comment.",
    "They laugh and cover part of their face for a second before recovering.",
    "Their answer becomes noticeably shorter when attention turns toward them.",
  ]},
  { id: 'V', title: 'Guilt', examples: [
    "They hesitate before answering, clearly aware that the explanation is not going to undo what happened.",
    "They apologize without immediately defending themselves, allowing the other person to finish speaking first.",
    "They remain quieter afterward, thinking about what they could have handled differently.",
  ]},
  { id: 'W', title: 'Jealousy', examples: [
    "Their attention lingers on the interaction a little longer than usual, although they do not immediately comment on it.",
    "They make a joking remark that carries just enough edge to reveal that the situation bothered them.",
    "They eventually ask directly about what they saw instead of continuing to make assumptions.",
  ]},
  { id: 'X', title: 'Excitement', examples: [
    "Their face brightens as soon as they hear the news, and they immediately reach for the phone to look at the details.",
    "They begin talking faster than before, jumping ahead to what they want to do next.",
    "They laugh and pull the other person into a quick hug before returning to the conversation.",
  ]},
  { id: 'Y', title: 'Relief', examples: [
    "They let out a long breath after reading the message, the tension in their expression easing almost immediately.",
    "They sit back down and laugh quietly, finally allowing themselves to believe the problem has been handled.",
    "Their shoulders relax as soon as they hear the answer they had been waiting for.",
    "They keep holding the other person's hand for another moment, not because they are still afraid, but because they are finally beginning to settle.",
  ]},
  { id: 'Z', title: 'Emotional Numbness or Shock', examples: [
    "They stare at the message longer than expected, not reacting much at first.",
    "They answer the first few questions almost automatically, still processing what they were told.",
    "They sit quietly while everyone else talks around them, appearing more stunned than visibly emotional.",
  ]},
  { id: 'AA', title: 'Comfort, Low Intensity', examples: [
    "They move a little closer and rest a hand beside the other person's, staying nearby without interrupting the conversation.",
    "They bring over a drink and sit down beside the other person, asking whether they want to talk about what happened.",
    "They gently squeeze the other person's hand before returning their attention to the conversation.",
    "They stay nearby while the other person works through the problem, offering help without taking over.",
  ]},
  { id: 'AB', title: 'Comfort, Moderate', examples: [
    "They notice the other person becoming quieter and move closer, resting a hand against their shoulder before asking what they need.",
    "They pull the blanket farther over both of them and stay close while the conversation slows down.",
    "They reach for the other person's hand and hold it, allowing the silence to remain until the other person is ready to speak again.",
  ]},
  { id: 'AC', title: 'Comfort, Stronger', examples: [
    "They open their arms and wait. When the other person finally moves closer, they hold them securely without immediately asking more questions.",
    "They guide the other person toward the couch and sit with them, staying physically close while they recover enough to continue talking.",
    "The person who has been trying to remain composed finally allows themselves to lean into the embrace, letting someone else carry some of the emotional weight for a while.",
  ]},
  { id: 'AD', title: 'Comfort Can Be Rejected', examples: [
    "They reach for the other person's hand, but it is pulled away almost immediately. Instead of forcing the contact, they stay nearby and ask whether they would rather have some space.",
    "The offer of comfort earns a quiet 'not yet.' They nod and remain within reach without pressing the issue.",
  ]},
  { id: 'AE', title: 'Comfort After Anger', examples: [
    "Previous scene: The argument has been intense, and one character is still visibly angry. Comfort: They reach for the other person's hand cautiously. It is not accepted immediately, but the attempt causes the conversation to pause long enough for both of them to lower their voices. The argument is not magically erased.",
  ]},
  { id: 'AF', title: 'Confront, Calm', examples: [
    "They stop avoiding the subject and ask directly about what happened, their tone serious but controlled.",
    "They set the phone down and look across the room. 'I need you to explain that to me because what you just said doesn't match what happened.'",
    "They wait until the other person finishes speaking before responding, but this time they do not let the issue slide.",
  ]},
  { id: 'AG', title: 'Confront, Moderate', examples: [
    "Their frustration becomes more visible as they ask why the question keeps being avoided.",
    "They fold their arms and press for a clearer answer, no longer satisfied with vague explanations.",
    "Their voice becomes firmer as they point out the contradiction they have been noticing.",
  ]},
  { id: 'AH', title: 'Repeated Confront Can Escalate Naturally', examples: [
    "First Confront: They ask directly about what happened, trying to keep the conversation focused. Second Confront: The evasive answer frustrates them, and their tone becomes noticeably sharper. Third Confront: They stand and step away from the table before turning back, clearly angry that the same question still has not been answered. Escalation happened because the conversation supported it. Do not jump immediately to screaming or violence.",
  ]},
  { id: 'AI', title: 'Flirt, Subtle', examples: [
    "They catch the other person looking and hold the gaze for a second longer than necessary before smiling.",
    "They move slightly closer during the conversation, their expression making the intention clearer than anything they have said.",
    "The compliment earns a knowing smile and a quiet, 'Keep talking.'",
    "They lean close as though they are going to whisper something, then pull back with an amused look.",
  ]},
  { id: 'AJ', title: 'Flirt, Playful', examples: [
    "They move close enough to make the other person think a kiss is coming, grin when they notice the anticipation, and pull back at the last second.",
    "They take the other person's usual seat and look up with exaggerated innocence when the theft is noticed.",
    "They hold the object just out of reach for another second, clearly enjoying the annoyed look they receive.",
    "They answer the teasing remark by stepping closer instead of responding verbally, enjoying the brief change in the other person's confidence.",
  ]},
  { id: 'AK', title: 'Flirt During an Argument', examples: [
    "Previous scene: The conversation has become tense and both characters are frustrated. Flirt: The tension does not disappear, but their expression shifts when the other person fires back. Annoyance gives way to the faintest unwilling smile. They step closer and lower their voice. 'Being attractive does not make you right.'",
    "Another possible continuation: The attempt at flirting earns a disbelieving look rather than an immediate smile. They are still too irritated to let the argument go, although some of the sharpness leaves the moment. Flirt must inherit the argument.",
  ]},
  { id: 'AL', title: 'Check In', examples: [
    "They look over from what they are doing and ask how things are going, having noticed the other person has been quieter than usual.",
    "They pause beside the doorway and ask whether the headache has gotten any better before deciding whether to continue what they were doing.",
    "They check whether the other person has eaten yet after realizing the afternoon has gotten away from both of them.",
    "They ask whether the earlier conversation is still bothering the other person rather than assuming everything was resolved.",
  ]},
  { id: 'AM', title: 'Let Them Act, Ordinary Autonomy', examples: [
    "They notice how late it has become and start gathering the dishes from the coffee table before carrying them toward the kitchen.",
    "They check the weather before deciding whether to leave now or wait until the rain slows down.",
    "They get up to find something to eat after realizing they skipped lunch.",
    "They turn the television down and answer the message they have been putting off.",
    "They finish what they are doing, change into something more comfortable, and settle in for the evening.",
  ]},
  { id: 'AN', title: 'Let Them Act, Character Driven', examples: [
    "They gather the dishes from the table, then pause halfway toward the kitchen and ask whether the other person is staying tonight. If Flirt is selected next: They wait near the kitchen doorway for an answer, the dishes still balanced in their hands. When the response comes back teasing instead of direct, they smile. 'That wasn't what I asked.' If Comfort Me is selected after that: The teasing fades when they notice the hesitation behind the answer. They set the dishes down and return, this time asking more seriously what is wrong. One continuous scene.",
  ]},
  { id: 'AO', title: 'Show Action Must Continue the Current Moment', examples: [
    "Current scene: They are sitting together on the couch waiting for a phone call. Message: They called. Everything is okay. Message: Good. I can finally relax. Show Action: The waiting finally releases its grip on the room. They settle farther back into the couch, and the conversation becomes easier now that neither of them is listening for the phone. Do not generate: They grip the edge of the couch as uncertainty continues to build.",
  ]},
  { id: 'AP', title: 'Automatic Narrative Must Continue User Narrative', examples: [
    "User-entered narrative: They leave the bedroom after the disagreement and sit alone in the living room. Automatic narrative: The apartment has grown quiet. They remain on the couch, scrolling without really paying attention to the phone. Then Comfort Me: The other person eventually comes out of the bedroom and stops near the couch. Instead of restarting the argument, they sit nearby and quietly ask whether they can talk. The automatic narrative did not create a separate timeline.",
  ]},
  { id: 'AQ', title: 'Location Continuity', examples: [
    "Hospital: If the narrative says, They are lying in a patient bed while the nurse checks their vitals, the next narrative should continue from the patient room. It should not suddenly place them in the hospital lobby because the hospital's primary location image happens to show the lobby.",
    "Restaurant: They move from the waiting area to the table after the host calls their name. Later narration should know they are seated at the table.",
    "Home: They leave the living room and walk upstairs to the bedroom. The next narrative should not continue couch activity downstairs.",
    "Workplace: They step into the stockroom to check the delivery. The next narrative should recognize the stockroom as the current zone until they leave.",
  ]},
  { id: 'AR', title: 'Needs Driven Narrative, Hunger', examples: [
    "They realize they have been ignoring their hunger longer than they thought. After opening the refrigerator and looking through what is available, they start putting together something quick.",
    "Their stomach reminds them that lunch never happened. They pause what they are doing and head toward the kitchen instead of continuing to put it off.",
    "They grab something small to eat before returning to the task they were working on.",
  ]},
  { id: 'AS', title: 'Needs Driven Narrative, Hygiene', examples: [
    "They step out of the shower and reach for the towel waiting nearby. By the time they finish getting dressed, they look noticeably more awake.",
    "They wash their face, brush their teeth, and change into clean clothes before returning to the rest of the evening. If a shower clearly occurred, hygiene should recognize that it occurred.",
  ]},
  { id: 'AT', title: 'Sleep', examples: [
    "They shift beneath the blankets without fully waking, pulling them closer before settling onto their side again.",
    "A sound from outside briefly pulls them toward consciousness. They open their eyes long enough to register the dark room, adjust the pillow, and drift back to sleep.",
    "They wake just enough to notice the other person has moved farther away, reach back for them, and settle again once contact is restored.",
    "They roll onto the cooler side of the pillow and continue sleeping. Sleep narratives do not need to become conversations unless the character actually wakes.",
  ]},
  { id: 'AU', title: 'Work Activity', examples: [
    "They check the last file against the numbers on the screen, notice something does not match, and go back through the previous entry.",
    "They finish helping one customer before turning their attention to the delivery waiting near the back room.",
    "They glance at the clock between tasks, realizing the shift is moving faster than expected.",
    "They step away from the desk long enough to refill their drink before returning to the paperwork.",
  ]},
  { id: 'AV', title: 'Special Purpose Work Status Narrative', examples: [
    "Correct: [Character] is at work at [Workplace].",
    "Correct: [Character] is working at [Workplace].",
    "Do not use: [Character] went to work at [Workplace]. The scheduled state may begin at 8:00 even if the notification appears at 8:15. The notification delay must not imply late arrival. Once the status establishes that the character is at work, later narratives should continue from that work state.",
  ]},
  { id: 'AW', title: 'Quiet Affection', examples: [
    "They reach for the other person's hand without interrupting the conversation, loosely threading their fingers together.",
    "They settle closer on the couch until their shoulders touch, continuing to talk as though the shrinking distance happened naturally.",
    "They brush a quick kiss against the other person's cheek while passing behind them, smiling at the reaction before continuing across the room.",
    "They rest against the other person's side, comfortable enough to let their weight settle there while the conversation continues.",
    "Their hand finds the other person's almost absentmindedly while both continue watching the television.",
  ]},
  { id: 'AX', title: 'Kissing as Communication', examples: [
    "They stop halfway through the reply, glance at the other person's mouth, and lean in instead. The kiss is brief but deliberate.",
    "They reach up, touch the other person's jaw, and pull them into a soft kiss before letting them go.",
    "The teasing continues until one character interrupts it with a kiss, pulling back just far enough to see the reaction.",
    "They kiss once, pause as though reconsidering, then lean in again with considerably less hesitation.",
    "Their disagreement loses some of its edge when one character steps closer and presses a quick kiss to the other's lips. The argument is not over, but the affection between them has not disappeared either.",
  ]},
  { id: 'AY', title: 'Nonverbal Romantic Banter', examples: [
    "One character catches the other staring and raises an eyebrow. The look they receive in return makes it obvious neither intends to acknowledge what just happened first.",
    "A glance passes between them across the room. Nothing is said, but both appear to understand the exchange perfectly.",
    "They catch the other person's smile and answer with one of their own before turning back to the conversation.",
    "They hold the other person's gaze just long enough to make the challenge obvious.",
  ]},
  { id: 'AZ', title: 'Playful Romantic Challenge', examples: [
    "They answer the teasing remark by stepping closer instead of responding verbally, clearly enjoying the momentary hesitation they create.",
    "One character tries to walk away with the last word. The other catches their hand, turns them back around, and steals a quick kiss before letting them continue.",
    "They hold the other person's gaze with an amused challenge, waiting to see who breaks first.",
    "The smile on one person's face makes it clear they know exactly what they are doing. The other shakes their head and pulls them closer anyway.",
    "The teasing continues until one finally laughs and leans over to kiss the other before another comeback can arrive.",
  ]},
  { id: 'BA', title: 'Leading and Yielding', examples: [
    "One character reaches for the other's hand and gently pulls them closer, making the decision for the moment without needing to explain it. The other follows willingly.",
    "They begin the kiss confidently, only to laugh when the other person turns the tables and draws them closer.",
    "One character has been directing the playful exchange for several minutes. When the other finally takes control of the moment, they stop resisting and allow the reversal.",
    "They hesitate for only a second before allowing the other person to guide them, trusting them enough not to need control over every movement.",
    "The dynamic shifts naturally between them. One moment one person is setting the pace; the next, they are the one being pulled closer. Yielding is not helplessness. Leading is not aggression.",
  ]},
  { id: 'BB', title: 'Trust Expressed Through Surrender', examples: [
    "They finally stop trying to manage the moment and allow the other person to take care of them, their posture gradually losing some of its tension.",
    "They let themselves be pulled into an embrace and remain there, no longer trying to explain everything they are feeling.",
    "The character who normally has an answer for everything goes quiet. When the other person opens their arms, they accept the invitation without changing the subject.",
    "They allow the other person to choose what happens next, not because they are uncertain, but because trust makes relinquishing control feel comfortable.",
  ]},
  { id: 'BC', title: 'Being Held', examples: [
    "They turn toward the other person in bed and pull them close, tucking the blanket around both of them before settling again.",
    "One character wakes briefly and realizes the other has moved away during the night. They reach back, find their arm, and pull it around themselves before drifting off again.",
    "They settle with their back against the other person's chest, relaxing as an arm wraps around them.",
    "The person who had been doing the comforting earlier eventually relaxes into the other's arms, allowing the roles to reverse without commenting on it.",
    "They lie facing each other for a while before one finally moves closer, resting comfortably against the other as sleep begins to take over.",
  ]},
  { id: 'BD', title: 'Neck Affection Without Always Hiding in the Neck', examples: [
    "They lean in and press a brief kiss to the side of the other person's neck before pulling back with a smile.",
    "Their lips brush lightly along the other person's jaw before reaching the neck, lingering there for a moment.",
    "They move close enough that their breath warms the other person's neck, pausing there deliberately before leaving a soft kiss against the skin.",
    "They kiss just beneath the other person's ear and laugh quietly at the reaction.",
    "They rest a hand against the other person's shoulder and press a kiss near the curve of the neck before returning to the conversation. The engine should not always generate: They bury their face in the crook of the other person's neck. That gesture remains available, but it is only one option.",
  ]},
  { id: 'BE', title: 'Forehead Touching Is Optional, Not Default', examples: [
    "Forehead touching can still appear naturally: They lean in until their foreheads briefly meet, sharing a quiet smile before separating again. But the next romantic scene should not automatically repeat it. Other possibilities include: They press their lips together in a brief kiss. They brush a kiss across the other person's cheek. They reach for the other person's hand. They lean against each other's shoulders. They sit close without touching. They exchange a knowing look. They pull the other person into an embrace. They kiss along the jaw. They playfully bump shoulders. They whisper something close enough to make the other person smile. They remain across the room and hold each other's gaze.",
  ]},
  { id: 'BF', title: 'Affection During Ordinary Life', examples: [
    "They pass behind the other person in the kitchen and briefly wrap their arms around them before reaching into the cabinet.",
    "One character is still talking while folding laundry when the other leans over and kisses them, causing them to lose their place mid-sentence.",
    "They sit beside each other scrolling through separate things on their phones, occasionally showing something to the other.",
    "The other person walks into the room, and they instinctively reach out a hand until they come close enough to take it.",
    "They straighten the other person's collar before they leave, then steal a quick kiss once they are satisfied.",
    "They share bites from the same plate while continuing the conversation. Romance should not exist only inside scenes labeled romantic.",
  ]},
  { id: 'BG', title: 'Intimacy After Conflict', examples: [
    "They remain on opposite ends of the couch for several minutes after the argument. Eventually one character reaches across the space and leaves their hand there, allowing the other person to decide whether to take it.",
    "The conversation has calmed, but neither has completely let go of the disagreement. One person moves closer anyway, resting beside the other while they continue talking through what happened.",
    "They exchange a tired look after finally reaching an understanding. One character touches the other's cheek and gives them a quiet kiss before asking whether they are okay.",
    "The apology is accepted without pretending the argument never happened. They sit together afterward, allowing affection and frustration to exist in the same space.",
  ]},
  { id: 'BH', title: 'Charged Romantic Moments', examples: [
    "The teasing conversation stops once the distance between them disappears. One character pulls the other closer and kisses them with far less hesitation than before.",
    "They barely finish the sentence before the other person closes the remaining distance, the unexpected kiss making them laugh before they return it.",
    "One character steps backward with a playful look that clearly invites pursuit. The other follows without hesitation.",
    "They reach for each other at nearly the same time, whatever argument they were making forgotten for the moment as they meet in a kiss.",
    "The kiss begins playfully but does not stay that way for long. Their arms tighten around one another as the joking gives way to something more focused. Strong chemistry does not require explicit sexual description.",
  ]},
  { id: 'BI', title: 'Romantic Intensity Without Constant Physical Contact', examples: [
    "They hold the other person's gaze from across the couch, their expression changing just enough to make the intention obvious.",
    "The conversation trails off when they realize how closely they have been watching each other.",
    "A slow smile appears when they catch the other person looking.",
    "Neither moves closer immediately. The anticipation itself becomes part of the exchange.",
    "They continue talking, but both have become more aware of the shrinking space between them.",
  ]},
  { id: 'BJ', title: 'Deeply Intimate but Physically Quiet', examples: [
    "They remain beside the other person in silence, one hand resting loosely over theirs. Neither tries to fill the quiet.",
    "They sit together after the difficult conversation, close enough that neither has to ask whether the other is staying.",
    "The person who has been holding everything together all day finally allows their weight to settle against the other person.",
    "They do not say anything else for a while. Staying becomes the reassurance. Emotional intensity and physical intensity are separate.",
  ]},
  { id: 'BK', title: 'Shower or Bathroom Intimacy', examples: [
    "Steam softens the edges of the room while they stand close beneath the water, the conversation becoming quieter as one reaches up to wipe a drop from the other's face.",
    "One character tries to continue the conversation while the other keeps interrupting them with quick kisses, eventually making both of them laugh.",
    "They trade places beneath the water, one gently guiding the other aside before stealing another kiss in the process.",
    "The room fills with steam while they move easily around one another with the familiarity of people accustomed to sharing the space.",
    "One character reaches past the other for the soap, deliberately taking longer than necessary when they notice the amused look waiting for them. The scene can be sensual without becoming mechanically explicit.",
  ]},
  { id: 'BL', title: 'Bedtime Intimacy', examples: [
    "They settle beneath the blankets and continue talking quietly until the conversation begins breaking into longer pauses.",
    "One character reaches across the bed and pulls the other closer, finding a comfortable position before closing their eyes.",
    "They share a brief kiss before turning out the light, remaining close even after the conversation ends.",
    "They shift until both are comfortable, one hand remaining loosely connected between them.",
  ]},
  { id: 'BM', title: 'Playful Affection', examples: [
    "They steal the other person's pillow and immediately deny doing anything when the complaint comes.",
    "They poke the other person's side once, laugh at the reaction, and quickly move out of reach.",
    "They deliberately mispronounce the word again just to get the same annoyed correction.",
    "They hold the remote away when the other person reaches for it, surrendering only after bargaining for a kiss. Playfulness can be romantic without becoming sexual.",
  ]},
  { id: 'BN', title: 'Reconciliation', examples: [
    "The conversation becomes quieter once both have finally said what they needed to say. They remain apart for a moment before one reaches for the other's hand.",
    "They do not pretend the problem never happened. Instead, they acknowledge what needs to change and gradually allow the tension between them to soften.",
    "The apology is answered with a long look before the other person finally moves closer and accepts the embrace.",
  ]},
  { id: 'BO', title: 'Affectionate Interruption', examples: [
    "They are halfway through complaining about the day when the other person leans over and kisses their cheek. The complaint pauses just long enough for an annoyed smile to appear.",
    "They continue trying to make the point while the other person keeps reaching over to fix the collar they insist is crooked.",
    "The story is interrupted by a quick kiss, followed immediately by, 'Continue.'",
  ]},
  { id: 'BP', title: 'Physical Intimacy That Does Not Automatically Escalate', examples: [
    "They share a longer kiss, then settle back against the couch and return to the conversation.",
    "One character pulls the other close for a moment before letting them go and going back to preparing dinner.",
    "The kiss leaves them both smiling, but neither treats it as an obligation to take the moment further. A kiss can simply be a kiss.",
  ]},
  { id: 'BQ', title: 'Flirt Does Not Guarantee Success', examples: [
    "They try to lighten the mood with a teasing compliment. The other person gives them a look that says the timing is terrible, although the corner of their mouth eventually lifts.",
    "They lean closer with obvious flirtation, only to receive a gentle push back and a laughing, 'Not right now.'",
    "The flirtation is noticed but not returned. They take the cue without forcing the moment.",
  ]},
  { id: 'BR', title: 'Romance Can Coexist With Worry', examples: [
    "They stay close while talking through what is bothering them, occasionally brushing their thumb over the other person's hand.",
    "The worry has not disappeared, but the quiet kiss helps interrupt the tension long enough for them to breathe and continue talking.",
    "They joke briefly between more serious parts of the conversation, allowing affection and concern to occupy the same moment.",
  ]},
  { id: 'BS', title: 'Romance Can Coexist With Frustration', examples: [
    "They are still annoyed when the other person reaches for their hand. After a second of hesitation, they allow the contact without pretending the disagreement is settled.",
    "The argument pauses when they catch each other's expression and almost laugh, but neither has forgotten what they were discussing.",
    "They press a quick kiss to the other person's cheek and immediately add, 'I'm still mad at you.'",
  ]},
  { id: 'BT', title: 'Romantic Gesture Variation', examples: [
    "Possible actions include, when contextually appropriate: They kiss the other person's lips. They kiss the cheek. They kiss the temple. They kiss the forehead. They kiss the jaw. They kiss the neck. They kiss a hand. They take the other person's hand. They loosely intertwine their fingers. They touch the other person's face. They brush hair away. They straighten clothing. They pull the other person closer. They lean against them. They wrap an arm around them. They sit close enough for their legs to touch. They whisper something. They laugh against the other person's shoulder. They exchange a knowing look. They maintain eye contact from across the room. They deliberately create space to tease. They move closer after teasing. They rest beside one another. They stay nearby without touching. They playfully interrupt a sentence with a kiss. They guide the other person by the hand. They allow themselves to be guided. They settle comfortably against one another. Do not treat this list as a checklist. Choose what fits.",
  ]},
  { id: 'BU', title: 'Recent Gesture Repetition', examples: [
    "If recent narratives already contain forehead touching, forehead touching again, face buried in neck, and another forehead touch, then the next narrative should actively consider a different natural gesture. For example: They catch the other person's hand and bring it briefly to their lips. or They lean over and kiss them directly. or They remain close without touching, continuing the teasing conversation. or They pull the other person into a side embrace while both continue watching the television. The goal is behavioral variation, not merely replacing one adjective with another.",
  ]},
  { id: 'BV', title: 'General Body Language Variation', examples: [
    "Avoid repeatedly relying on jaw tightening, shoulders dropping, rubbing the face, dragging a hand through the hair, clenching fists, trembling, looking away, sighing, gripping objects, and breath hitching. Possible alternatives include: They shift their weight. They become quieter. They change the subject. They start cleaning something. They sit down. They stand up. They move closer. They create more distance. They check the phone. They ask a question. They laugh despite themselves. They stop what they are doing. They focus more closely on the other person. They resume an ordinary activity while continuing the conversation. They use something in the environment. They pause before answering. Human behavior should not be reduced to a handful of dramatic body-language clichés.",
  ]},
  { id: 'BW', title: 'Environmental Interaction', examples: [
    "They reach over and lower the television volume once the conversation becomes more serious.",
    "They move the empty cups aside to make room on the table.",
    "They open the window after realizing how warm the room has become.",
    "They pull the blanket farther over both of them when the room gets colder.",
    "They set the grocery bags on the counter before continuing the conversation.",
    "They turn the music down instead of speaking louder over it.",
  ]},
  { id: 'BX', title: 'Restaurant or Bar Scene', examples: [
    "The conversation pauses when the server returns with the drinks. They move the phone away from the edge of the table, thank the server, and pick up exactly where they left off once they are alone again.",
    "They glance over the menu while continuing to listen, occasionally looking up when the conversation becomes more interesting than the food choices.",
    "They slide the appetizer toward the other person without interrupting what they are saying.",
    "The noise from the room rises around them, so they lean closer to hear without turning the moment into romance unless the scene supports it.",
  ]},
  { id: 'BY', title: 'Hospital Support', examples: [
    "They remain near the bed while the nurse finishes checking the vitals. Once the nurse steps away, they ask quietly how the other person is feeling.",
    "They adjust the chair closer to the bed and settle in rather than pacing around the room.",
    "They listen while the doctor explains the next steps, waiting until afterward to ask the questions they had been holding.",
    "They offer a drink after noticing the other person has been talking for several minutes. The hospital setting should remain a hospital patient room if that is the established zone.",
  ]},
  { id: 'BZ', title: 'Character Alone', examples: [
    "They drop the keys onto the table when they come in and remain standing there for a moment longer than usual. Instead of turning on the television, they sit down and allow the quiet to catch up with them.",
    "They make something simple to eat, carry it to the couch, and put on a familiar show without checking the phone again.",
    "They move through the evening routine automatically until realizing how tired they actually are.",
    "They open the window, let some fresh air into the room, and return to the unfinished task on the desk. Being alone does not require melancholy.",
  ]},
  { id: 'CA', title: 'Shared Silence', examples: [
    "Neither rushes to fill the silence. They remain beside one another, close enough that staying communicates more than another explanation would.",
    "The conversation pauses naturally. One continues holding the other's hand while both sit quietly for a while.",
    "They stop talking and simply watch the room around them, comfortable enough not to turn every pause into dialogue.",
  ]},
  { id: 'CB', title: 'Emotional Vulnerability Without Collapse', examples: [
    "They admit that the week has been harder than they have let on, then sit back and wait for the response.",
    "They acknowledge that they are worried without apologizing for the feeling or treating it as failure.",
    "They say plainly that they need some reassurance and remain calm enough to listen when it is offered.",
    "They admit they are tired of being the one who always knows what to do, allowing the other person to take over for a while. Vulnerability is not the same thing as instability.",
  ]},
  { id: 'CC', title: 'Caretaking Can Reverse', examples: [
    "Earlier: One character brings food, makes sure the other has taken a break, and stays close while they decompress. Later: Once the first character finally begins showing signs of exhaustion, the other notices and takes over, telling them to sit down while they handle the rest. Do not permanently assign the caregiver role.",
  ]},
  { id: 'CD', title: 'Humor as Emotional Movement', examples: [
    "The tension breaks slightly when one character makes a dry comment that catches the other off guard.",
    "They try to remain serious, fail, and laugh despite themselves.",
    "The problem is not solved, but the joke gives both of them a moment to breathe before returning to it. Humor can progress a scene without erasing the problem.",
  ]},
  { id: 'CE', title: 'Change of Subject', examples: [
    "After several minutes discussing the same issue, they recognize that neither has anything new to add. One asks whether the other has eaten, shifting the conversation without pretending the earlier subject no longer matters. Narrative progression can include a natural subject change.",
  ]},
  { id: 'CF', title: 'Characters Can Change Their Minds', examples: [
    "They initially refuse the invitation, then reconsider after sitting with the decision for a few minutes. By the time the subject comes up again, they are willing to go.",
    "They start the conversation convinced they want to leave, but after hearing the explanation they decide to stay long enough to finish talking. Characters should not remain locked to their first emotional response forever.",
  ]},
  { id: 'CG', title: 'Interruption', examples: [
    "The conversation is interrupted by the phone ringing. They glance at the screen, apologize, and answer.",
    "Someone knocks at the door before either character can respond to the last question.",
    "The timer in the kitchen goes off, forcing them to pause the argument long enough to keep dinner from burning. Interruptions become part of the scene.",
  ]},
  { id: 'CH', title: 'Returning to an Unresolved Topic', examples: [
    "Once dinner is finished and the dishes are put away, they return to the question they left unresolved earlier instead of acting as though the interruption ended it. Narrative memory should preserve unresolved beats.",
  ]},
  { id: 'CI', title: 'Physical Positioning', examples: [
    "If one character is standing near the kitchen counter and the other is seated at the table: They continue the conversation from across the small space until the standing character finally pulls out the chair opposite them and sits down. Do not instantly generate: They wrap their arms around each other. unless the required movement happens.",
  ]},
  { id: 'CJ', title: 'Movement Before Contact', examples: [
    "They cross the room first, stopping beside the couch before reaching down for the other person's hand.",
    "They move from the doorway to the bed and sit beside the other person before beginning the conversation. Narrative physicality should respect distance.",
  ]},
  { id: 'CK', title: 'State Changes Should Be Visible to the Next Narrative', examples: [
    "If a character eats: They finish the sandwich and push the empty plate aside. The next narrative should not continue describing hunger as though the meal never occurred.",
    "If a character showers: They step out of the shower and get dressed. The next narrative should recognize that hygiene occurred.",
    "If a character falls asleep: Their breathing settles as they drift off. The next narrative should not make them continue an active conversation unless something wakes them.",
    "If a character begins work: [Character] is working at [Workplace]. The next narrative should know they are at work.",
  ]},
  { id: 'CL', title: 'Intensity Can Fluctuate', examples: [
    "Example sequence: They begin mildly irritated. Then: The conversation reveals something unexpected, increasing the anger. Then: The explanation clears up part of the misunderstanding. Then: They remain frustrated but no longer as angry as before. Then: Humor finally breaks the tension. A believable emotional arc can rise and fall.",
  ]},
  { id: 'CM', title: 'Never Escalate Only Because Another Narrative Was Requested', examples: [
    "If the scene is calm: First narrative: They sit together talking quietly. Second narrative: They continue the conversation while finishing their drinks. Third narrative: One gets up to put the empty glasses in the kitchen. Fourth narrative: They return and sit down again, asking what the other person wants to watch. The engine does not need to invent an argument, a crisis, a confession, panic, sudden romance, violence, or a dramatic interruption simply because multiple narratives were generated.",
  ]},
  { id: 'CN', title: 'Final Example Principle', examples: [
    "Every example in this library should teach the engine the following: Ask what has actually happened, what is happening now, what the characters just said, what state they are in, where they physically are, who is present, whether the user is physically present, what the selected narrative mode is asking for, what level of emotional intensity is supported, what gestures have recently been used, and what would naturally happen next. Then continue the story from there. Do not select the most dramatic interpretation simply because it is available. Do not select the same gesture simply because it is familiar. Do not restart the scene because a different narrative button was pressed. Do not ignore a previous narrative because the newest information came from dialogue. Do not ignore new dialogue because an earlier narrative established an emotional state. Do not flatten different narrative types into one behavior. Use the examples to learn range, continuity, variation, context, progression, and believable human behavior.",
  ]},
];

/**
 * Build an additive context string from the extended examples.
 * Injected ALONGSIDE the existing motif pool — never replaces it.
 *
 * The block is framed so the generator treats these as a reference pool to
 * adapt and combine, not scripts to reproduce. Existing examples, rules,
 * and character authority remain in force.
 */
export function buildExtendedNarrativeExampleContext() {
  const communityBlock = EXTENDED_COMMUNITY_SCENARIOS.map(s =>
    `[themes: ${s.themes.join(', ')}] [tone: ${s.tone}]
${s.narrative}`
  ).join('\n\n');

  const romanticBlock = EXTENDED_ROMANTIC_PHYSICAL_VOCABULARY.map(s =>
    `[stage: ${s.stage}] [tone: ${s.tone}]
${s.narrative}`
  ).join('\n\n');

  const engineExamplesBlock = NARRATIVE_ENGINE_EXAMPLES.map(cat =>
    `[${cat.id}. ${cat.title}]
${cat.examples.join('\n')}`
  ).join('\n\n');

  return `EXTENDED NARRATIVE EXAMPLE POOL — ADDITIVE REFERENCE MATERIAL
These examples expand the generator's vocabulary. They do NOT replace the
existing examples, rules, or character authority above. The character's
established identity, personality, quirks, traits, relationships, history,
current emotional state, location, activity, and cultural context remain
authoritative.

USE RULES:
- Treat these as possibilities to adapt and combine — never scripts to copy.
- Surface a narrative element only when it logically fits what is already
  happening. Do not force ballroom, theft, kissing, conflict, flirting,
  competition, generosity, secrecy, or any other example into a scene merely
  because it is available.
- Traits influence actions when context gives them a natural opportunity —
  they are NOT instructions to perform the same trait behavior constantly.
  A thief should not steal in every narrative. A flirt should not flirt in
  every scene. A volatile person should not start an argument every time.
- For romance: do NOT repeatedly select the same physical gesture to
  represent affection. Choose actions appropriate to the relationship stage,
  personality, emotional intensity, setting, history, and mutual comfort.
  Intimacy can be tentative, playful, domestic, passionate, soothing, awkward,
  restrained, spontaneous, or deeply familiar.
- Stories must progress. Build from previous actions and history rather than
  resetting characters into interchangeable moments.
- Culturally specific material is grounding, not decoration. Use ballroom
  terminology, house structures, categories, chosen-family relationships,
  competition, judging, and mentorship accurately and naturally only when
  relevant to the actual characters — never as stereotypes or exposition.

${NARRATIVE_ENGINE_GUIDANCE}

COMMUNITY / TRAIT / SOCIAL-DYNAMIC EXAMPLES:
${communityBlock}

EXTENDED ROMANTIC PHYSICAL VOCABULARY (gender-neutral, action-led):
${romanticBlock}

NARRATIVE ENGINE EXAMPLE LIBRARY (A–CN) — ADDITIONAL TEACHING EXAMPLES:
These are ADDITIONAL examples. They do NOT replace existing examples.
Existing examples + these new examples should work together.
These are teaching examples, not scripts. Do not copy them verbatim.
Do not assign behaviors to a specific character simply because they appear here.
All examples are gender-neutral and usable for any character or relationship.

${engineExamplesBlock}`;
}