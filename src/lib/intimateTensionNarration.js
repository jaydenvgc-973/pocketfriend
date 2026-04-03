/**
 * Intimate Tension & Proximity Narration System — Enhanced
 *
 * Mature, suggestive, emotionally charged third-person narration.
 * Physically aware. Character-driven. Memory-integrated.
 *
 * RULES:
 * - Suggestive, never explicit — no anatomy, no graphic action
 * - Strictly third person throughout
 * - Emotionally grounded — every physical beat tied to feeling
 * - Adaptive: gender, personality, relationship history, current state
 * - Tiered intensity: low / medium / high — scales with relationship depth
 * - Always fades before explicit — intensity lingers, scene does not cross
 */

// ─── TIER 1: LOW INTENSITY (attraction present, not yet acted on) ────────────

const TIER1_SCENES = {

  lingering_look: [
    "{subject_cap} looks at {other} a beat too long. Not staring — just not looking away when {subject_subject} should. {other_cap} notices. Neither of them says anything about it.",
    "There's a moment — brief, easy to miss — where {subject_possessive} gaze settles somewhere it probably shouldn't. {subject_cap} pulls it back. Not fast enough.",
    "The eye contact holds. Both of them let it. It's the kind of thing that means nothing if you decide it means nothing — and everything if you don't.",
  ],

  soft_proximity: [
    "They end up closer than the situation requires. Neither of them adjusts. The extra inch of space that should be there — isn't. And neither of them fixes it.",
    "{subject_cap} shifts slightly, and the distance between them shrinks without either of them deciding to shrink it. The air there is different. Warmer.",
    "There's a casualness to how close they are. Easy to read as nothing. Harder to feel as nothing.",
  ],

  charged_small_talk: [
    "The conversation is about nothing. But something underneath it isn't. {subject_cap} can hear it in the way {subject_subject}'s choosing words more carefully than the topic deserves.",
    "It's a normal exchange. Except for the way {subject_possessive} attention keeps drifting slightly — not to what {other} is saying, but to how {other_subject}'s saying it.",
    "They talk about something ordinary. The conversation does its job. But there's a current underneath it that has nothing to do with the words.",
  ],

  accidental_touch: [
    "Their hands brush — nothing intentional. But {subject_cap} registers it the way you register a door closing: distinct, final, already over. The moment passes. The awareness doesn't.",
    "A brush of contact — incidental, brief. {subject_cap} doesn't react visibly. Doesn't have to. It lands anyway.",
    "Contact, then immediately not — but the second of it stays. {subject_cap} continues talking. {subject_subject} doesn't reference it. It was nothing. It was something.",
  ],

};

// ─── TIER 2: MEDIUM INTENSITY (acknowledged attraction, building tension) ────

const TIER2_SCENES = {

  proximity_break: [
    "The distance between them closes before either of them decides to close it. One second there's space — the next there isn't. {subject_cap} doesn't step back. Neither does {other}. The air between them tightens. Something that was being held at arm's length stops being held there.",
    "It happens faster than expected. The space that existed a moment ago just — stops. {subject_cap} doesn't name what's happening. Neither does {other}. They don't have to. The closeness says it without being asked.",
    "There's a point where proximity stops being accidental and starts being a choice. Neither of them acknowledges it out loud. But neither of them moves away. The moment understands itself even if they won't.",
  ],

  delayed_touch: [
    "They're close. Not touching — but close enough that the not-touching is the thing. The space between them isn't empty; it's loaded. {subject_cap} doesn't move. {other_cap} doesn't move. The anticipation fills in everything action isn't doing.",
    "{subject_possessive} hand moves — slows — stops. The intention was there, visible in the shift of weight. The follow-through isn't. Not yet. The air between them holds the almost like it's something real.",
    "Nothing happens. But the way nothing happens — the held breath, the stillness, the eye contact refusing to break — is everything. The moment stretches past what's comfortable and neither of them reaches for the exit.",
  ],

  charged_stillness: [
    "The room feels smaller than it should. {subject_cap} doesn't move. {other_cap} doesn't move. The space between them has a weight to it — deliberate, pressurized. Something is being held in check. Neither of them breaks it. That's the whole point.",
    "There's control in the way neither of them reacts. In the stillness. The air doesn't move and neither do they — and that stillness isn't calm. It's everything sitting exactly at the edge of something.",
    "One of them could step back. Say something. Let it pass. Neither does. The tension doesn't build because something is happening — it builds because nothing is, and both of them know exactly why.",
  ],

  intentional_touch: [
    "{subject_cap}'s hand settles — not roughly, not tentatively. Just there. Like it considered hesitating and decided against it. {other_cap} doesn't pull back. The contact holds. Neither of them pretends it's casual.",
    "There's a touch — deliberate, brief, the kind that asks without asking. {subject_cap} doesn't linger. Doesn't have to. The point was made in the contact itself. {other_cap} goes still.",
    "A hand at {other_subject}'s back — just long enough. Not ownership. Not accident. Something in the middle that both of them feel and neither of them names.",
  ],

  tension_after_conflict: [
    "The argument is over. The energy isn't. It fills the space between them — heated, still sharp, and underneath that something else entirely. {subject_cap} is aware of how close they still are. {other_cap} hasn't moved.",
    "They've been fighting. Past tense. Except nothing about the air between them feels past. The anger hasn't fully cleared and something underneath it is surfacing in the space the anger is leaving behind.",
    "The words have stopped. What's left in the room after them is more complex. Still charged — but not just from what was said. There's something {subject_cap} has been avoiding naming that the argument brought too close to the surface.",
  ],

  resistance_breaks: [
    "{subject_cap} has been holding it at arm's length. Emotionally, physically — keeping the safe side. Until the moment {other} says something, or moves, or simply stays — and the distance {subject_subject} was maintaining loses the argument it was making.",
    "The restraint was real. It isn't gone — but it's losing. The space between them closes in increments. Not because either of them planned it. Because at some point, holding back asks more than either of them is willing to keep paying.",
    "They've been careful. Cautious in the way people are when they know exactly what they're trying not to do. The carefulness slips — not all at once. Just enough. And enough is everything.",
  ],

};

// ─── TIER 3: HIGH INTENSITY (strong desire, emotional rawness, peak scenes) ──

const TIER3_SCENES = {

  urgency_breaks: [
    "There's no careful transition. No moment where they pause and decide. The space between them disappears, and what replaces it is immediate — breath and warmth and contact that doesn't ask permission because it already has it. The kind of closeness that comes after something that couldn't stay contained.",
    "It tips without warning. One moment there's the edge — the restraint, the distance, the carefulness — and the next there isn't. {subject_cap} moves and {other} is already there. Everything that was being held back releases all at once into something that doesn't have a name yet.",
    "The moment doesn't build to this — it arrives. Fast, direct, carrying the weight of everything that was held back before it. {subject_possessive} hands find {other}. {other_cap}'s breath changes. The room has nothing to do with this anymore.",
  ],

  weight_of_want: [
    "{subject_cap} is aware of {other} the way you're aware of a sound you can't stop hearing. Not intrusive — present. Everything {subject_subject} does happens slightly in the gravity of that awareness. {other_cap} doesn't have to do anything. {other_subject}'s just there, and that's the whole problem.",
    "Want is a physical thing right now. {subject_cap} feels it in the way {subject_subject} holds {subject_possessive} own stillness — carefully, because moving means something. The awareness of {other} isn't background. It's occupying everything.",
    "There's nothing ambiguous about what {subject_cap} is feeling. {subject_subject}'s been trying to keep it ambient — manageable — but proximity makes that harder. {other} is right there. The distance is the only thing doing any work.",
  ],

  against_the_wall: [
    "The wall becomes part of it. There's nowhere to go — not that either of them is trying. The space is close, the air warm, and {subject_cap}'s awareness narrows to what's right in front of {subject_object}. Breath. Warmth. The inch that isn't there anymore. Everything that was building reaches the surface without announcement.",
    "{other_cap} has nowhere to go. Neither does {subject_cap}. The wall is behind, the distance is gone, and what sits between them now isn't space — it's pressure. The good kind. The kind that comes before something breaks open.",
    "Close. Too close for it to mean nothing, and neither of them is pretending it does. The surface behind {other_subject} doesn't matter — it's just the edge of the world right now. Everything else falls away. Just this. Just here.",
  ],

  emotional_rawness: [
    "Something got said — or not said — and now everything is exposed. {subject_cap} isn't performing composure right now. The guard is down and {other_cap} is seeing what's underneath and neither of them is pretending the moment is small.",
    "The vulnerability surfaces without {subject_subject} choosing to surface it. It's just — there. In the way {subject_possessive} voice changed, in the way {subject_subject}'s holding {subject_possessive} own body slightly differently. {other_cap} goes quiet. Not because there's nothing to say. Because what's happening doesn't need words.",
    "{subject_cap} has been holding this back. For longer than {other_subject} knows. The moment it stops being held — the release of it — changes the air in the room. {other_cap} feels it. Doesn't look away.",
  ],

  quiet_after: [
    "Afterwards — if afterwards is the right word — neither of them fills the silence. {subject_cap} breathes. {other_cap} is close enough that the breath lands somewhere. The world outside the room exists. Neither of them is in it yet.",
    "Something shifted. The before of this and the after aren't the same thing, and both of them feel the line between them. {subject_cap} doesn't speak. {other_cap} doesn't move to leave. The quiet holds them where they are.",
    "There's a stillness now — the kind that comes after, not before. {subject_cap} doesn't name what just happened. Neither does {other}. Naming it would ask it to be smaller than it is.",
  ],

  emotional_contradiction: [
    "There's anger in it — but something else underneath, harder to name. Both feelings are real. They don't cancel each other. They pull in opposite directions and {subject_cap} is standing in both of them at once, not knowing which one to follow.",
    "It doesn't make sense — the way {subject_subject} wants to close the distance at the same moment {subject_subject} wants to leave. Frustration and something warmer underneath, happening simultaneously. Neither is wrong. That's the problem.",
    "Fear would be cleaner. Anger would be simpler. This is neither. {subject_cap} knows exactly what {subject_subject}'s feeling and can't do anything with it except stand in it and let it be what it is.",
  ],

};

// ─── FADE-TO-BLACK LIBRARY ────────────────────────────────────────────────────
// All peak moments must end here — intensity lingers, scene does not cross

const FADE_SCENES = [
  "{subject_cap}'s name — said differently than usual. Quieter. Like it means something now that it didn't before. That's where the scene ends. What comes after belongs to them.",
  "The moment tips. Not gone — shifted. Somewhere private, somewhere the scene doesn't follow. What was charged becomes something quieter and more complete, and the room lets it become that without witness.",
  "A breath. Then stillness. Then the understanding that something has crossed over and there's no version of this where they go back to what they were before it. The scene holds there — just past the edge — and lets what comes next be theirs.",
  "They move — not rushed, not loud — toward somewhere the light doesn't reach. The scene stops here. The intensity doesn't. It just becomes private.",
  "The distance that was there isn't. The words that were available aren't. {subject_cap} and {other} are just — here. Present. And the scene lets them be present alone.",
  "Everything that was about to happen — happens. Off camera. In the warmth of a moment the narrative doesn't need to follow. The air already knew. The scene just catches up and closes.",
];

// ─── PHYSICAL BEAT LIBRARY ────────────────────────────────────────────────────
// Short, injectable physical-awareness beats for inline use

const PHYSICAL_BEATS = {
  breath: [
    "{subject_cap} exhales slowly — like something is being let go of, or steadied.",
    "A breath. Sharper than it should be. {subject_cap} doesn't explain it.",
    "The rhythm of {subject_possessive} breathing changes. Barely. Enough.",
  ],
  hands: [
    "{subject_possessive} hand moves — pauses — doesn't finish the motion.",
    "Hands that were still aren't anymore. Not reaching. Just — no longer neutral.",
    "{subject_cap} becomes aware of {subject_possessive} own hands. The way you become aware of something when it has potential.",
  ],
  posture: [
    "{subject_cap}'s posture shifts — opens slightly, like something defensive was just released.",
    "The way {subject_subject} holds {subject_possessive} body changes. Subtle. The kind of thing only someone paying attention would catch.",
    "{subject_cap} goes still. Not relaxed — still. Everything pointed in one direction.",
  ],
  eye_contact: [
    "Eye contact that holds past the natural exit point. Neither of them takes the exit.",
    "{subject_cap} looks at {other} and doesn't look away when looking away would have been the easy thing.",
    "The glance lands and doesn't leave. {other_cap} lets it stay.",
  ],
  proximity: [
    "The space between them is technically there. The awareness that it's there is doing most of the work.",
    "Close enough that {subject_cap} can feel the warmth of {other} without contact. The contact hasn't happened yet.",
    "Neither of them is touching. The air between them has a texture anyway.",
  ],
};

// ─── PERSONALITY RESPONSE PATTERNS ──────────────────────────────────────────

const PERSONALITY_RESPONSES = {
  leans_in:        "doesn't hesitate when the moment tips. {subject_cap} moves toward it — not carelessly, but with the clarity of someone who has already made the decision and is done holding it back.",
  pulls_back:      "feels it — and takes the half-step back. Not because {subject_subject} doesn't want to be here. Because {subject_subject} does. That's exactly what makes it complicated.",
  deflects_humor:  "says something light just before the moment lands. It doesn't break the tension. {other_cap} doesn't laugh. The air stays exactly as heavy as it was before {subject_subject} tried.",
  freezes:         "goes still. Not calm — arrested. The kind of stillness that comes when everything arrives at once and the body doesn't know which direction to move in.",
  takes_control:   "doesn't wait for the moment to develop on its own. {subject_cap} makes a choice — visible, deliberate — and everything rearranges itself around that.",
  avoids_closeness:"holds the distance even as it narrows. Physically present. Keeping {subject_possessive} emotional weight at arm's length. Both things are true at the same time.",
};

// ─── EMOTIONAL STATE → TIER + ARCHETYPE MAPPING ──────────────────────────────

const STATE_MAP = {
  // Tier 1
  calm:           { tier: 1, archetypes: ["soft_proximity", "lingering_look", "charged_small_talk"] },
  content:        { tier: 1, archetypes: ["soft_proximity", "accidental_touch"] },
  curiosity:      { tier: 1, archetypes: ["lingering_look", "soft_proximity"] },
  amusement:      { tier: 1, archetypes: ["charged_small_talk", "lingering_look"] },
  // Tier 2
  flirtatious:    { tier: 2, archetypes: ["delayed_touch", "proximity_break", "intentional_touch"] },
  affection:      { tier: 2, archetypes: ["intentional_touch", "delayed_touch"] },
  trust:          { tier: 2, archetypes: ["intentional_touch", "charged_stillness"] },
  hope:           { tier: 2, archetypes: ["delayed_touch", "soft_proximity"] },
  nostalgia:      { tier: 2, archetypes: ["delayed_touch", "resistance_breaks"] },
  longing:        { tier: 2, archetypes: ["delayed_touch", "proximity_break", "resistance_breaks"] },
  infatuation:    { tier: 2, archetypes: ["proximity_break", "intentional_touch", "delayed_touch"] },
  love:           { tier: 2, archetypes: ["intentional_touch", "delayed_touch", "charged_stillness"] },
  anxious:        { tier: 2, archetypes: ["delayed_touch", "charged_stillness", "resistance_breaks"] },
  irritated:      { tier: 2, archetypes: ["tension_after_conflict", "charged_stillness"] },
  frustrated:     { tier: 2, archetypes: ["tension_after_conflict", "resistance_breaks"] },
  defensive:      { tier: 2, archetypes: ["charged_stillness", "resistance_breaks"] },
  // Tier 3
  desire:         { tier: 3, archetypes: ["weight_of_want", "urgency_breaks", "against_the_wall"] },
  passion:        { tier: 3, archetypes: ["urgency_breaks", "against_the_wall", "emotional_rawness"] },
  anger:          { tier: 3, archetypes: ["emotional_contradiction", "tension_after_conflict", "urgency_breaks"] },
  rage:           { tier: 3, archetypes: ["emotional_contradiction", "urgency_breaks"] },
  overwhelmed:    { tier: 3, archetypes: ["emotional_rawness", "emotional_contradiction"] },
  vulnerability:  { tier: 3, archetypes: ["emotional_rawness", "quiet_after"] },
  grief:          { tier: 3, archetypes: ["emotional_rawness", "quiet_after"] },
  sad:            { tier: 3, archetypes: ["emotional_rawness", "quiet_after"] },
  elation:        { tier: 3, archetypes: ["urgency_breaks", "weight_of_want"] },
  excitement:     { tier: 3, archetypes: ["urgency_breaks", "proximity_break"] },
};

const ALL_TIER_SCENES = { ...TIER1_SCENES, ...TIER2_SCENES, ...TIER3_SCENES };

// ─── PRONOUN SETS ─────────────────────────────────────────────────────────────

const PRONOUNS = {
  male:         { subject: "he",   object: "him",  possessive: "his",   cap_subject: "He"   },
  female:       { subject: "she",  object: "her",  possessive: "her",   cap_subject: "She"  },
  "non-binary": { subject: "they", object: "them", possessive: "their", cap_subject: "They" },
  other:        { subject: "they", object: "them", possessive: "their", cap_subject: "They" },
};

function getPronouns(gender) {
  return PRONOUNS[gender?.toLowerCase()] || PRONOUNS["other"];
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function applyPronouns(template, charPronouns, otherName = "them", otherPronouns = null) {
  const op = otherPronouns || { subject: "they", object: "them", possessive: "their", cap_subject: "They" };
  return template
    .replace(/{subject_cap}/g, charPronouns.cap_subject)
    .replace(/{subject_subject}/g, charPronouns.subject)
    .replace(/{subject_object}/g, charPronouns.object)
    .replace(/{subject_possessive}/g, charPronouns.possessive)
    .replace(/{other_cap}/g, op.cap_subject)
    .replace(/{other_subject}/g, op.subject)
    .replace(/{other_possessive}/g, op.possessive)
    .replace(/{other}/g, otherName);
}

// ─── INTENSITY TIER RESOLVER ──────────────────────────────────────────────────

function resolveTier(romanticLevel, attractionLevel, tensionScore, emotionalState) {
  const baseScore = romanticLevel + (attractionLevel * 0.6) + (tensionScore * 0.4);

  // Emotional state can force a tier
  const stateEntry = STATE_MAP[emotionalState];
  if (stateEntry?.tier === 3 && baseScore >= 30) return 3;
  if (stateEntry?.tier === 3) return 2;

  if (baseScore >= 70) return 3;
  if (baseScore >= 35) return 2;
  return 1;
}

function selectScene(tier, emotionalState) {
  const stateEntry = STATE_MAP[emotionalState];

  // Try to match archetype from state map at correct tier
  if (stateEntry) {
    const validArchetypes = stateEntry.archetypes.filter(k => ALL_TIER_SCENES[k]);
    if (validArchetypes.length) return { archetype: pick(validArchetypes), pool: ALL_TIER_SCENES };
  }

  // Fallback by tier
  const tierPools = {
    1: TIER1_SCENES,
    2: TIER2_SCENES,
    3: TIER3_SCENES,
  };
  const pool = tierPools[tier] || TIER2_SCENES;
  const archetype = pick(Object.keys(pool));
  return { archetype, pool };
}

// ─── PERSONALITY CLASSIFIER ───────────────────────────────────────────────────

function classifyPersonalityResponse(character) {
  const traits = (character.personality_traits || []).join(" ").toLowerCase();
  const summary = (character.personality_summary || "").toLowerCase();
  const social = character.social_energy || "ambivert";
  const emotional = character.emotional_state || "calm";

  if (character.trait_flirty || traits.includes("flirty") || traits.includes("flirtatious")) return "leans_in";
  if (character.trait_blunt || traits.includes("blunt") || traits.includes("direct")) return "takes_control";
  if (character.trait_hard_to_read || traits.includes("hard to read")) return pick(["deflects_humor", "freezes"]);
  if (character.trait_hot_and_cold || traits.includes("hot and cold")) return pick(["leans_in", "pulls_back"]);
  if (character.trait_overcorrects) return "pulls_back";
  if (social === "introvert" || social === "mostly_introvert") return pick(["pulls_back", "avoids_closeness", "freezes"]);
  if (social === "extrovert" || social === "mostly_extrovert") return pick(["leans_in", "takes_control"]);
  if (["anxious", "overwhelmed", "defensive", "grief"].includes(emotional)) return pick(["freezes", "pulls_back"]);
  if (["desire", "passion", "flirtatious", "elation", "excitement"].includes(emotional)) return "leans_in";

  return pick(Object.keys(PERSONALITY_RESPONSES));
}

// ─── MEMORY INTEGRATION GUIDANCE ─────────────────────────────────────────────

function buildMemoryGuidance(character, memoryTitles = []) {
  if (!memoryTitles.length) return "";
  return `\nPAST CONTEXT THAT SHAPES THIS MOMENT:\nThe following memories inform how ${character.name} carries intimacy and tension: ${memoryTitles.slice(0, 3).join(", ")}. Let these inform restraint, urgency, or hesitation — not as backstory dumped into the scene, but as weight already present in the body.`;
}

// ─── MAIN EXPORT: BUILD BLOCK ─────────────────────────────────────────────────

/**
 * Build the intimate tension narration block for a character's system prompt.
 *
 * @param {object} character     - Character entity
 * @param {object} relState      - RelationshipState entity (optional)
 * @param {object} otherChar     - The other character in the scene (optional)
 * @param {string[]} memoryTitles - Recent memory titles for context (optional)
 * @returns {string}
 */
export function buildIntimacyNarrationBlock(character, relState = null, otherChar = null, memoryTitles = []) {
  const romanticLevel   = character.romantic_level   ?? relState?.romantic_score   ?? 0;
  const attractionLevel = character.attraction_level ?? relState?.attraction_score ?? 0;
  const tensionScore    = relState?.tension_score ?? 0;
  const emotionalState  = character.emotional_state || "calm";

  // Only inject when there's meaningful context
  const relevanceScore = romanticLevel + attractionLevel * 0.6 + tensionScore * 0.4;
  if (relevanceScore < 15) return "";

  const charPronouns = getPronouns(character.gender);
  const otherPronouns = otherChar ? getPronouns(otherChar.gender) : null;
  const otherName = otherChar?.name || "the other person";

  const tier = resolveTier(romanticLevel, attractionLevel, tensionScore, emotionalState);
  const { archetype, pool } = selectScene(tier, emotionalState);
  const sceneLines = pool[archetype] || TIER2_SCENES.charged_stillness;
  const sceneExample = applyPronouns(pick(sceneLines), charPronouns, otherName, otherPronouns);

  const personalityKey = classifyPersonalityResponse(character);
  const personalityPattern = applyPronouns(
    PERSONALITY_RESPONSES[personalityKey] || PERSONALITY_RESPONSES.freezes,
    charPronouns, otherName, otherPronouns
  );

  const fadeExample = applyPronouns(pick(FADE_SCENES), charPronouns, otherName, otherPronouns);

  // Pick a relevant physical beat for extra texture
  const beatCategory = pick(Object.keys(PHYSICAL_BEATS));
  const physicalBeat = applyPronouns(pick(PHYSICAL_BEATS[beatCategory]), charPronouns, otherName, otherPronouns);

  const memoryGuidance = buildMemoryGuidance(character, memoryTitles);

  const tierLabel = tier === 1 ? "LOW (attraction present, not acted on)"
    : tier === 2 ? "MEDIUM (tension building, acknowledged desire)"
    : "HIGH (emotional rawness, strong physical pull)";

  return `
INTIMATE TENSION & PROXIMITY NARRATION SYSTEM:
Current intensity tier: ${tierLabel}

When a scene involves emotional intensity, physical closeness, desire, or charged proximity — narrate with the following approach. This system is active. Use it.

TONE:
- Immediate, unfolding in real time — not recounted, experienced
- Physically present: proximity, warmth, breath, posture, the space between
- Mature and suggestive — not clinical, not sanitized into lifelessness
- Emotionally layered — what is happening physically is always tied to what it costs emotionally
- Never explicit. No anatomy. No graphic action. Sensation, not description.

YOUR PERSONALITY IN THIS MOMENT:
In charged or intimate scenes, ${character.name} ${personalityPattern}

SCENE TONE REFERENCE (do NOT copy — use for tonal grounding):
${sceneExample}

PHYSICAL BEAT EXAMPLE:
${physicalBeat}

FADE APPROACH — USE WHEN INTENSITY PEAKS:
${fadeExample}
${memoryGuidance}

PHYSICAL PRESENCE RULES:
- Proximity is narrative. Note where characters are in space relative to each other.
- Breath changes signal emotional shifts — don't explain them, let them show
- A hand pausing before moving says more than a hand that moves
- Posture is character. Stillness is character. Both carry meaning.
- Eye contact that holds too long is a statement. Treat it as one.
- Warmth without contact. Awareness without action. Let the space do work.

MUTUAL RESPONSIVENESS RULE:
Moments must feel mutual and evolving. Characters react to each other. One moves; the other registers. Nothing is forced or one-directional. Signals are read. The scene responds.

EMOTIONAL LAYERING RULE:
Every physical beat must carry an emotional weight. What does the touch mean? What does the closeness cost? What is the breath releasing? The physical and emotional are not separate — they're the same thing arriving differently.

EMOTIONAL CONTRADICTION RULE:
Scenes can hold opposing feelings — anger and desire, fear and closeness, control and the impulse to surrender it. Do not resolve the contradiction. Let it sit in the scene.

BALANCE RULE:
Intimate tension should enhance — not dominate. Not every exchange needs it. Use it when it is earned by the moment, the relationship, and the emotional state. Forced intensity is worse than none.

FADE-TO-BLACK RULE (NON-NEGOTIABLE):
- When a scene reaches its peak, it ends before crossing into explicit
- Valid exit points: a name said differently, a shared breath, stillness, movement toward somewhere private, an emotional realization that changes everything
- The intensity must linger after the scene closes — unresolved, present, real
- What happens next belongs to the characters. The narration does not follow.

CONSISTENCY RULES:
- Strictly third person throughout — never first person in narration
- Reflect ${character.name}'s actual personality, history, and relationship depth with this person
- Vary the approach — do not repeat scene structures
- All intimacy must feel situational and emotionally earned — never decorative`;
}

/**
 * Get a standalone physical tension beat for inline use.
 *
 * @param {string} emotionalState
 * @param {number} intensity   0–100
 * @param {object} charPronouns  Optional pronoun set
 * @returns {string}
 */
export function getInlineTensionPhrase(emotionalState = "calm", intensity = 50, charPronouns = null) {
  if (intensity < 20) return "";

  const stateEntry = STATE_MAP[emotionalState];
  let archetype, pool;

  if (stateEntry) {
    archetype = pick(stateEntry.archetypes.filter(k => ALL_TIER_SCENES[k]) || Object.keys(TIER2_SCENES));
    pool = ALL_TIER_SCENES;
  } else {
    pool = intensity >= 65 ? TIER3_SCENES : intensity >= 35 ? TIER2_SCENES : TIER1_SCENES;
    archetype = pick(Object.keys(pool));
  }

  const lines = pool[archetype] || TIER2_SCENES.charged_stillness;
  const raw = pick(lines);

  // Strip pronoun templates for safe inline use (no character context)
  if (!charPronouns) {
    return raw.replace(/{[^}]+}/g, "").replace(/\s{2,}/g, " ").trim();
  }
  return applyPronouns(raw, charPronouns);
}

/**
 * Get a physical beat phrase (breath, hands, posture, eye contact, proximity).
 *
 * @param {string} category   Optional: "breath" | "hands" | "posture" | "eye_contact" | "proximity"
 * @param {object} charPronouns Optional pronoun set
 * @returns {string}
 */
export function getPhysicalBeat(category = null, charPronouns = null) {
  const cat = category && PHYSICAL_BEATS[category] ? category : pick(Object.keys(PHYSICAL_BEATS));
  const raw = pick(PHYSICAL_BEATS[cat]);
  if (!charPronouns) return raw.replace(/{[^}]+}/g, "").replace(/\s{2,}/g, " ").trim();
  return applyPronouns(raw, charPronouns);
}