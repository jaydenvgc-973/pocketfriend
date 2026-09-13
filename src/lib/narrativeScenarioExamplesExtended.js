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

COMMUNITY / TRAIT / SOCIAL-DYNAMIC EXAMPLES:
${communityBlock}

EXTENDED ROMANTIC PHYSICAL VOCABULARY (gender-neutral, action-led):
${romanticBlock}`;
}