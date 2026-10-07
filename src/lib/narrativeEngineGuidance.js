/**
 * NARRATIVE ENGINE GUIDANCE — ADDITIVE INTERPRETIVE RULES + EXAMPLE POOL
 *
 * This module is ADDITIVE reference material for the EXISTING narrative pipeline.
 * It does NOT replace, rewrite, override, flatten, or duplicate the existing
 * narrative examples in narrativeScenarioExamples.js, the extended examples in
 * narrativeScenarioExamplesExtended.js, the existing narrative generators, the
 * existing Action system, the existing Right Now system, the existing automatic
 * narrative generation, the existing user-entered narrative behavior, or any
 * existing special-purpose narrative behavior.
 *
 * PURPOSE: give the existing narrative engine additional interpretive guidance so
 * it (a) calibrates emotional intensity instead of exaggerating it, (b) keeps
 * continuity across ALL narrative entry methods (Action, Show Action, Right Now,
 * automatic, user-entered, special-purpose), (c) preserves user presence and
 * physical/spatial continuity, (d) uses greater behavioral + romantic variety, and
 * (e) uses current-state wording for special-purpose work narratives.
 *
 * These are TEACHING examples and RULES, not scripts. The engine should learn
 * range, continuity, variation, context, and believable human behavior from
 * them. It must NOT copy them verbatim, mechanically replay them, force them into
 * unrelated scenes, or assign example behaviors to every character regardless of
 * personality. Character identity, personality, quirks, traits, relationships,
 * history, current emotional state, location, activity, and cultural context
 * remain authoritative.
 *
 * It is a FAILURE if these rules/examples replace the old examples, if a new
 * parallel narrative system is created, if the examples are copied verbatim, if
 * the same examples repeat mechanically, if examples are forced into unrelated
 * situations, if distinct narrative entry methods are flattened into one
 * behavior, if previous story development is ignored, or if user presence is
 * dropped when already established.
 */

// ── EMOTIONAL INTENSITY LADDER ─────────────────────────────────────────────
// Emotions exist across a range. Emotion words are NOT instructions to portray
// their most extreme version. Choose the LOWEST intensity that fully fits the
// evidence. Increase only when actual support exists. Intensity may remain
// stable, rise, decrease, temporarily spike, fluctuate, or resolve.
export const EMOTIONAL_INTENSITY_LADDER = `
EMOTIONAL INTENSITY LADDER — calibrate, do not exaggerate:
Level 1 (Subtle): emotion present but does not dominate behavior; small changes in attention, expression, tone, pacing, or minor physical behavior; normal functioning intact.
Level 2 (Clear/Moderate): emotion clearly influencing behavior — quieter or more talkative, seeking reassurance, visibly tense, distracted, more direct, changed tone or activity; still functional.
Level 3 (Strong): emotion significantly affecting the moment — difficulty settling, temporary disengagement, raised voice, tearfulness, needing space, stronger reassurance, obvious physical tension; still coherent.
Level 4 (Acute): emotion temporarily overwhelming ordinary regulation — REQUIRES direct evidence from dialogue, established behavior, state, or events. Do NOT infer Level 4 from a common emotional word alone.

RULES:
- Begin with the lowest level that fully fits the evidence.
- Do NOT automatically increase intensity because another narrative was requested.
- Anxiety ≠ panic or breakdown. "Anxious/nervous/worried" usually means worried, distracted, restless, seeking reassurance — NOT shaking, frantic breathing, collapse.
- Confusion ≠ delusion. "I'm confused/I don't understand" means not understanding information — NOT hallucinating or losing contact with reality.
- Anger ≠ violence. Annoyed/irritated/frustrated/angry/furious does NOT mean punching walls, destroying property, attacking, threatening. Violence needs separate evidence.
- Mental overload ≠ disorganization. "My head is all over the place" means stress/racing thoughts/distraction — NOT psychosis or cognitive collapse.
- Sadness ≠ uncontrollable sobbing. Fear ≠ panic. Embarrassment ≠ humiliation. Jealousy ≠ possessiveness/aggression. Attraction ≠ sexual escalation. Stress ≠ inability to function. Guilt ≠ self-loathing.
- Emotion does NOT always require visible physical symptoms. Someone can be anxious while sitting normally, angry while speaking calmly, sad without crying, attracted without touching.
- Vulnerability ≠ instability. Do not attach diagnoses or psychological labels.`;

// ── CROSS-ENTRY-METHOD CONTINUITY ───────────────────────────────────────────
// All progressive narrative entry methods share ONE continuous scene. Narrative
// mode changes the INTENT of the next beat — it does NOT create a new version of
// the scene or reset what happened.
export const CONTINUITY_RULES = `
SHARED SCENE CONTINUITY — all narrative entry methods share one scene:
- A Let Them Act narrative is visible to the next Comfort Me. A Confront narrative is visible to a following Flirt. A Show Action narrative knows what happened in an Action before it. An automatic narrative knows what a user-entered narrative established. Right Now knows what Actions and automatic narratives established before it.
- Previous narratives are REAL scene history. If a narrative said the character stood up, entered a room, sat on a bed, started cooking, kissed someone, became upset, accepted comfort, left a location, or started working — that event happened. The next narrative respects it unless something later changes it.
- BUT previous narrative LANGUAGE must not recursively exaggerate itself. A brief sign of anxiety does NOT mean the next narrative assumes severe anxiety. Reevaluate the character's current emotional state using everything that happened SINCE, not merely the previous paragraph's label.
- DIALOGUE CAN CHANGE DIRECTION. If an earlier narrative established anxiety but later messages show reassurance, relief, humor, or resolution — reduce intensity. If an earlier narrative established calm but new information causes fear/anger/grief — increase intensity. Track emotional DIRECTION, not merely labels. Do not preserve an earlier interpretation just because it appeared in the previous paragraph.
- PROGRESSION ≠ ESCALATION. Continuing the story can include de-escalation, reassurance, resolution, continued disagreement, hesitation, humor, subject change, activity change, moving somewhere, staying put, a decision, changing one's mind, physical affection, withdrawing, accepting/rejecting comfort, ordinary activity, silence, returning to a topic, responding to new info, emotional improvement or worsening, relationship development, environmental interaction. Do not make every narrative more dramatic than the last.
- Do not invent a crisis/confession/panic/romance/violence simply because another narrative was requested. A calm scene can stay calm across multiple narratives.

PHYSICAL + SPATIAL CONTINUITY:
- Characters do NOT teleport when a new narrative mode is selected. Preserve current room, zone, physical distance, posture, movement, object use, current activity.
- If a character walked into the kitchen, the next narrative starts from the kitchen unless they move again. If in a hospital patient room, do not return them to the lobby. If in bed, do not suddenly place them standing elsewhere without movement.
- Respect location, zone, destination, home, work, hospital, prison, business, school distinctions. Do not flatten a location into one generic space.
- Movement before contact: cross the room first, then reach for a hand. Do not instantly generate embrace unless the required movement happens.
- State changes are visible to the next narrative: if they ate, hunger is addressed; if they showered, hygiene occurred; if they fell asleep, they are asleep; if they began work, they are at work.`;

// ── USER PRESENCE ──────────────────────────────────────────────────────────
export const USER_PRESENCE_RULES = `
USER PRESENCE — persists when established:
- If the scene already established the user is physically with the character, that shared presence is part of the current scene until something changes it.
- Do NOT make the user disappear because Right Now was selected, a different Action was selected, an automatic narrative fired, or another narrative was requested.
- If the user and character are sitting together / traveling together / at home together / at a restaurant together / in the same room / doing an activity together / physically interacting — continue from that shared scene.
- Actions must respect presence: Comfort Me comforts the present user; Flirt can direct toward the present user when the relationship supports it; Spend Time does not invent an unrelated person when the user is already there; Check In may check on the present user; Confront respects who is actually participating; Let Them Act accounts for the user being present.
- Remote (text/phone) interaction is different: the user is NOT physically present. Do not describe the user as in the same space.`;

// ── ACTION INTENT RULES ─────────────────────────────────────────────────────
// Each Action retains its distinct purpose. Each must BEGIN from the exact scene
// that exists when selected. The selected Action determines the DIRECTION/INTENT
// of the next beat, not the starting conditions.
export const ACTION_INTENT_RULES = `
ACTION INTENTS — distinct purposes, shared scene:
- Comfort Me: reassurance, support, closeness, practical help, emotional support. React to the actual situation. Comfort does NOT require crisis and does NOT instantly erase sadness/anger/anxiety/fear/conflict/grief. It may work, partially work, be rejected, accepted slowly, reduce tension, change the conversation, or simply communicate presence.
- Flirt: introduce/continue flirtation within the current scene. Must NOT reset an argument, location, positioning, emotional state, or existing tension. If arguing before, flirt emerges FROM that argument — may soften tension, create playful tension, be rejected, answered sarcastically, produce a reluctant smile, increase chemistry, or coexist with unresolved disagreement. Selecting Flirt does NOT guarantee success.
- Confront: move toward more direct engagement with an unresolved issue. NOT automatically screaming/violence/threats/aggression. Can be calm, serious, frustrated, emotional, firm, or heated. Repeated Confront can increase tension if the scene supports it, but intensity still follows the ladder.
- Check In: use the current scene to determine what to check on. Do NOT invent a dramatic problem. May check mood, wellbeing, comfort, stress, an unresolved concern, something recently discussed, progress on an activity, or a practical issue.
- Spend Time: hang out and be present within the current scene. Does NOT create a new neutral scene or erase existing tension. If arguing, begins from the argument — may sit together, do something ordinary, cool down, continue talking, or spend time while tension remains.
- Let Them Act: autonomy to choose a reasonable next action based on personality, goals, relationship, location, activity, emotional state, needs, time, dialogue, unresolved events. Does NOT mean "most dramatic thing possible." Can produce an ordinary action. Once generated, it becomes part of the shared scene.
- Show Action: continue what is happening right now. Must NOT restart from the last major event. Read the most recent narrative, everything said after it, every Action after it, state changes, movement, emotional changes. Repeated Show Action progressively continues the same scene unless something causes a transition.
- Do NOT manufacture conditions to justify a selected Action (no invented breakdown for Comfort, no violence for Confront, no illness for Check In, no immediate sex for Flirt, no erased context for Spend Time, no drama for Let Them Act). Use what is already happening.`;

// ── ROMANTIC VARIETY ───────────────────────────────────────────────────────
export const ROMANTIC_VARIETY_RULES = `
ROMANTIC + INTIMATE VARIETY — two independent dimensions:
- Emotional intensity (meaningful, vulnerable, trusting, reassuring, affectionate, playful, emotionally exposed) and Physical intensity (how physically expressive) are SEPARATE. High emotional intimacy does NOT require strong physical contact. Strong physical chemistry does NOT require a major emotional revelation. Do not automatically make physical contact more sexual just because emotional intimacy is high.
- Romantic range (NOT a mandatory staircase): Subtle → Warm → Romantic → Charged → Deeply intimate. A scene can move in any direction. A charged kiss may be followed by ordinary conversation. A deeply intimate moment may involve almost no physical contact. Flirt may fail. Comfort may be rejected. An argument may continue after affection.
- Begin with INTENT, not a random gesture. Possible intentions: affection, reassurance, attraction, teasing, challenge, attention, apology, closeness, comfort, desire, reconciliation, celebration, distraction, trust, wanting to lead, wanting to yield, wanting the other person nearby. Select behavior that communicates that intent in the current scene.
- Leading and yielding remain flexible. Do not permanently assign one member as leader/pursuer/comforter/dominant/passive. Roles can switch. Yielding ≠ weakness. Leading ≠ aggression.
- Romance does NOT have to erase other emotions. Affection can coexist with anger, disagreement, anxiety, sadness, frustration, teasing, embarrassment, uncertainty. A kiss does NOT automatically resolve an argument.
- Intimacy does NOT require constant touching. Romance can appear through eye contact, pauses, tone, humor, proximity, anticipation, conversational subtext, shared silence, playful competition, nonverbal communication, knowingly watching, or choosing to remain nearby.
- RECENT-GESTURE REPETITION CHECK: before selecting a physical/emotional gesture, examine what was recently used. If recent narratives repeatedly used the same gesture, lower the likelihood of using it again unless repetition has intentional meaning. Watch for repeated: forehead touching, face buried in neck, resting head on shoulder, sighing, rubbing faces, running hands through hair, jaw tightening, looking away, clenched fists, trembling, shoulders dropping, gripping objects, breath hitching. Repetition is OK only when it is an established character habit, intentionally meaningful, physically natural, or a deliberate recurring relationship behavior.
- Behavioral variety ≠ vocabulary variety. Do not solve repetition by rewriting the same action with different adjectives. Characters should actually DO different things — different physical actions, conversational behavior, movement, environmental use, affectionate behavior, emotional expression, pacing, practical activity, reactions, silence, initiation, response.
- Existing romantic gestures (forehead touching, resting against someone, face near neck, touching a face, holding someone) remain VALID. The correction is to stop relying on a few as automatic shorthand. Broaden the selection.`;

// ── RIGHT NOW ──────────────────────────────────────────────────────────────
export const RIGHT_NOW_RULES = `
RIGHT NOW — describe the actual current moment, not a fresh vignette:
- Use the same continuity awareness as every other narrative method: current location, zone, activity, work/school/sleep/travel/hospital/home/business state, emotional state + supported intensity, recent narratives, recent dialogue, recent Action narratives, user-entered narratives, automatic narratives, current needs, people present, user presence, established physical positioning, relationship interactions, unresolved events, current time.
- Do NOT create a fresh standalone vignette. Continue/represent the character's EXISTING current situation.
- If the scene established the user is physically with the character, Right Now includes/accounts for the user. Do not make the character suddenly alone.
- Right Now inherits Action history: if Confront then Flirt happened, Right Now knows the argument recently shifted toward flirtation and may still be unresolved.
- After Let Them Act produced movement (e.g., character went to the kitchen), Right Now continues from there — does not reroll activity.
- After an automatic narrative established a state (e.g., folding laundry in bedroom), Right Now continues from there.
- After a special-purpose work status established the character is at work, Right Now knows they are at work and continues from that work state (and includes the user if the world established the user is visiting/present at that workplace).`;

// ── SPECIAL-PURPOSE WORK NARRATIVE WORDING ──────────────────────────────────
export const WORK_NARRATIVE_WORDING = `
SPECIAL-PURPOSE WORK STATUS WORDING:
- The scheduled work narrative establishes CURRENT STATE, not the moment of transition.
- Use present-state wording: "[Character] is at work at [Workplace]." or "[Character] is working at [Workplace]."
- Do NOT use transition wording that implies the notification timestamp is the moment the character left for or arrived at work: avoid "[Character] went to work at...", "[Character] headed to work...", "[Character] left for work...". The schedule determines the work state; a delayed notification does NOT imply late arrival.
- Once the work status establishes the character is at work, later progressive narratives (including Right Now) understand the character is currently at work, the workplace is their current location, the relevant work zone applies, work context applies, and their activity should make sense for that environment.`;

// ── ADDITIONAL EXAMPLE POOL (teaching examples — not scripts) ───────────────
// A curated, gender-neutral, character-agnostic reference pool. The engine
// learns range/continuity/variation from these. It must NOT copy them verbatim
// or assign a behavior to every character just because it appears here.
export const ADDITIONAL_NARRATIVE_EXAMPLES = {
  ordinary_progressive: [
    "They stood at the kitchen counter finishing the last few bites of breakfast, glancing toward the phone when it buzzed. They wiped one hand on a dish towel before picking it up.",
    "They checked the time and realized they had been sitting there much longer than intended. After stretching the stiffness from their shoulders, they got up and headed toward the kitchen.",
    "They moved the laundry from the washer to the dryer, checking the pockets of the last pair of pants before tossing them in.",
    "The television continued playing in the background while they scrolled through the phone, only occasionally looking up when something on the screen caught their attention.",
  ],
  dialogue_changes_direction: [
    "The tension in their posture begins to ease once the news settles in. They sit farther back against the couch and finally put the phone down instead of keeping it within constant reach.",
    "They remain near the counter with the glass still in hand, listening quietly before finally looking over. Some of the tension leaves their expression as the reassurance begins to register.",
  ],
  anxiety_subtle: [
    "They glance at the phone again before setting it back down. Nothing has changed, but tomorrow is still occupying more of their attention than they would like.",
    "They become slightly quieter when the subject comes up, taking a moment longer than usual before answering.",
  ],
  anxiety_moderate: [
    "They shift on the couch and exhale slowly, returning to the same concern even after the conversation moves on. Sitting with someone they trust helps, although the worry has not completely left.",
    "Their attention keeps moving between the conversation and the clock. They are listening, but it is obvious that part of their mind is still elsewhere.",
  ],
  anxiety_decreases: [
    "They stare at the message for another second before the meaning finally settles in. Their shoulders loosen, and this time when they put the phone down, they leave it there.",
    "The worry has not disappeared completely, but the conversation has taken some of its urgency away. They remain close, talking more easily than they were a few minutes earlier.",
  ],
  confusion_subtle: [
    "They pause and look back over the message, trying to figure out how what they just heard matches what was said earlier.",
    "Their brow furrows slightly. 'Wait. I thought that was happening tomorrow.'",
  ],
  anger_subtle: [
    "Their expression tightens at the comment. They answer more shortly than before, clearly irritated even though their voice remains controlled.",
    "Their tone becomes noticeably cooler, but they remain engaged in the conversation.",
  ],
  anger_moderate: [
    "They turn fully toward the other person, frustration sharpening their tone as they explain exactly what bothered them.",
    "They step away for a moment, more interested in collecting their thoughts than saying something impulsive.",
  ],
  anger_strong: [
    "Their voice rises despite the effort to keep it even. They stop, take a few steps away, and return once they are ready to continue without shouting.",
    "They are visibly angry now, speaking more forcefully and refusing to let the subject be brushed aside.",
  ],
  anger_not_violence: [
    "They stare at the floor for a moment, clearly furious, then decide to leave the room before continuing the argument.",
  ],
  stress_overload: [
    "Their thoughts keep moving between work, family, and everything waiting for them tomorrow, making it difficult to focus on any one thing for very long.",
    "They open the email, realize they have read the same paragraph three times, and decide to come back to it after dinner.",
  ],
  sadness_subtle: [
    "They become quieter after hearing the news, continuing the conversation but no longer contributing as much as before.",
    "They admit that the situation hurt more than they expected, then sit with the feeling instead of immediately trying to change the subject.",
  ],
  comfort_low: [
    "They move a little closer and rest a hand beside the other person's, staying nearby without interrupting the conversation.",
    "They bring over a drink and sit down beside the other person, asking whether they want to talk about what happened.",
  ],
  comfort_can_be_rejected: [
    "They reach for the other person's hand, but it is pulled away almost immediately. Instead of forcing the contact, they stay nearby and ask whether they would rather have some space.",
  ],
  comfort_after_anger: [
    "They reach for the other person's hand cautiously. It is not accepted immediately, but the attempt causes the conversation to pause long enough for both of them to lower their voices.",
  ],
  confront_calm: [
    "They stop avoiding the subject and ask directly about what happened, their tone serious but controlled.",
    "They wait until the other person finishes speaking before responding, but this time they do not let the issue slide.",
  ],
  confront_repeated_escalates: [
    "First: they ask directly, trying to keep the conversation focused. Second: the evasive answer frustrates them, and their tone becomes noticeably sharper. Third: they stand and step away before turning back, clearly angry the same question still has not been answered.",
  ],
  flirt_subtle: [
    "They catch the other person looking and hold the gaze for a second longer than necessary before smiling.",
    "They move slightly closer during the conversation, their expression making the intention clearer than anything they have said.",
  ],
  flirt_during_argument: [
    "The tension does not disappear, but their expression shifts when the other person fires back. Annoyance gives way to the faintest unwilling smile. They step closer and lower their voice. 'Being attractive does not make you right.'",
  ],
  flirt_can_fail: [
    "They try to lighten the mood with a teasing compliment. The other person gives them a look that says the timing is terrible, although the corner of their mouth eventually lifts.",
  ],
  check_in: [
    "They look over from what they are doing and ask how things are going, having noticed the other person has been quieter than usual.",
    "They ask whether the earlier conversation is still bothering the other person rather than assuming everything was resolved.",
  ],
  let_them_act_ordinary: [
    "They notice how late it has become and start gathering the dishes from the coffee table before carrying them toward the kitchen.",
    "They get up to find something to eat after realizing they skipped lunch.",
  ],
  show_action_continues: [
    "The waiting finally releases its grip on the room. They settle farther back into the couch, and the conversation becomes easier now that neither of them is listening for the phone.",
  ],
  romantic_quiet_affection: [
    "They reach for the other person's hand without interrupting the conversation, loosely threading their fingers together.",
    "They settle closer on the couch until their shoulders touch, continuing to talk as though the shrinking distance happened naturally.",
  ],
  romantic_kissing_communication: [
    "They stop halfway through the reply, glance at the other person's mouth, and lean in instead. The kiss is brief but deliberate.",
  ],
  romantic_no_constant_touch: [
    "They hold the other person's gaze from across the couch, their expression changing just enough to make the intention obvious.",
    "Neither moves closer immediately. The anticipation itself becomes part of the exchange.",
  ],
  romantic_intimate_quiet: [
    "They remain beside the other person in silence, one hand resting loosely over theirs. Neither tries to fill the quiet.",
    "The person who has been holding everything together all day finally allows their weight to settle against the other person.",
  ],
  romantic_after_conflict: [
    "They remain on opposite ends of the couch for several minutes after the argument. Eventually one reaches across the space and leaves their hand there, allowing the other person to decide whether to take it.",
  ],
  romantic_reconciliation: [
    "The conversation becomes quieter once both have finally said what they needed to say. They remain apart for a moment before one reaches for the other's hand.",
  ],
  location_continuity: [
    "They move from the waiting area to the table after the host calls their name. Later narration knows they are seated at the table.",
    "They leave the living room and walk upstairs to the bedroom. The next narrative does not continue couch activity downstairs.",
  ],
  environmental_interaction: [
    "They reach over and lower the television volume once the conversation becomes more serious.",
    "They pull the blanket farther over both of them when the room gets colder.",
  ],
  character_alone: [
    "They drop the keys onto the table when they come in and remain standing there for a moment longer than usual. Instead of turning on the television, they sit down and allow the quiet to catch up with them.",
  ],
  shared_silence: [
    "Neither rushes to fill the silence. They remain beside one another, close enough that staying communicates more than another explanation would.",
  ],
  state_change_visible: [
    "They finish the sandwich and push the empty plate aside. The next narrative does not continue describing hunger as though the meal never occurred.",
    "They step out of the shower and get dressed. The next narrative recognizes that hygiene occurred.",
  ],
  work_status_narrative: [
    "[Character] is at work at [Workplace].",
    "[Character] is working at [Workplace].",
  ],
};

// ── BUILDER — additive context string for the existing pipeline ────────────
// Injected ALONGSIDE the existing example pools, progression rules, and motif
// pools. Never replaces them. Existing examples, rules, and character authority
// remain in force.
export function buildNarrativeEngineGuidanceContext({ includeExamples = true } = {}) {
  const exampleBlock = includeExamples
    ? `\n\nADDITIONAL TEACHING EXAMPLE POOL (learn range/continuity/variation — never copy verbatim, never force into unrelated scenes, never assign to every character):\n${
        Object.entries(ADDITIONAL_NARRATIVE_EXAMPLES).map(([cat, arr]) =>
          `[${cat}]\n${arr.map(e => `  - ${e}`).join('\n')}`
        ).join('\n\n')
      }`
    : '';

  return `NARRATIVE ENGINE GUIDANCE — ADDITIVE INTERPRETIVE RULES
These rules ADD to the existing narrative rules, examples, and character
authority already in force. They do NOT replace them.

${EMOTIONAL_INTENSITY_LADDER}

${CONTINUITY_RULES}

${USER_PRESENCE_RULES}

${ACTION_INTENT_RULES}

${ROMANTIC_VARIETY_RULES}

${RIGHT_NOW_RULES}

${WORK_NARRATIVE_WORDING}${exampleBlock}`;
}