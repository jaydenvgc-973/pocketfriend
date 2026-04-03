/**
 * Intimate Tension & Proximity Narration System
 *
 * Produces emotionally charged, strictly third-person scene narration
 * for moments of tension, proximity, and emotional intensity.
 *
 * Rules:
 * - Suggestive, never explicit
 * - Emotionally driven, physically aware
 * - Strictly third person throughout
 * - Adaptive to character gender, personality, and relationship state
 * - Always fades before becoming explicit
 */

// ─── SCENE ARCHETYPES ────────────────────────────────────────────────────────
// Each archetype is a tonal/structural template — NOT a script.
// The system selects and adapts based on context.

const SCENE_ARCHETYPES = {

  // Sudden collapse of distance — urgency over caution
  proximity_break: [
    "The distance between them closes before either of them decides to close it. One second there's space — the next there isn't. {subject_cap} doesn't step back. Neither does {other}. The air between them changes first — tighter, warmer. Breathing shifts. Something that was being held back stops being held.",
    "It happens faster than expected. The space that existed a moment ago just — stops existing. {subject_cap} doesn't name what's happening. Neither does {other}. They don't have to. The closeness says it.",
    "There's a point where proximity stops being accidental and starts being a choice. Neither of them acknowledges it. But neither of them moves away.",
  ],

  // The held moment — almost-touch, loaded with anticipation
  delayed_touch: [
    "They're close. Not touching — but close enough that it matters. The space between them isn't empty; it's full. A shift in weight, a breath landing slightly wrong — and the whole thing tightens. {subject_cap} doesn't move. Neither does {other}. The moment stretches.",
    "A hand almost moves. Stops. The intention was there — visible in the way {subject_possessive} weight shifted — but the action doesn't follow. Not yet. The air between them holds the almost.",
    "There's a beat where nothing happens. But the way nothing happens — the stillness, the held breath, the eye contact that doesn't break — says more than movement would have.",
  ],

  // Control and presence — deliberate tension, neither backing down
  charged_stillness: [
    "The room feels smaller than it should. {subject_cap} doesn't move. {other_cap} doesn't move. The space between them has a weight to it — the kind that comes from holding something in check. Neither of them breaks it. That's the whole point.",
    "There's control in the way neither of them reacts. In the stillness. The air doesn't move, and neither do they — and that stillness isn't calm. It's everything being held exactly at the edge.",
    "One of them could end this. Step back. Say something. Neither does. The tension doesn't build because something is happening — it builds because nothing is, and both of them know why.",
  ],

  // Resistance giving way — the moment before surrender
  resistance_breaks: [
    "They've been keeping distance. You can see it in the way {subject_subject} holds {subject_possessive} posture — carefully, deliberately. In the way {subject_subject} keeps just enough space to stay in control. Until {subject_subject} doesn't. Something shifts — not dramatically, not all at once. Just enough.",
    "{subject_cap} has been holding it at arm's length — emotionally, physically. Choosing the safe side of whatever this is. Until the moment {other} says something, or moves, or simply stays — and the reasoning that was holding the distance together doesn't hold anymore.",
    "The restraint was real. It isn't gone — but it's losing. The space between them closes in increments. Not because either of them planned it. Because at some point, holding back costs more than letting go.",
  ],

  // Vulnerability surfacing — the emotional undercurrent takes over
  vulnerability_surface: [
    "It stops being about tension. Somewhere in the last few seconds it became something quieter — more exposed. {subject_cap} doesn't try to redirect. {other_cap} doesn't look away. The emotional weight of the moment sits between them, visible now in a way it wasn't before.",
    "The guard slips — just slightly. Not enough to be named out loud. But enough. {subject_cap}'s posture shifts, something behind {subject_possessive} eyes changes — and the moment becomes something that can't be taken back to what it was.",
    "There's a version of this where they keep it surface-level. Where it stays light, controlled, manageable. That version is gone now. They're past it — and both of them feel it.",
  ],

  // Emotional contradiction — opposites pulling at the same time
  emotional_contradiction: [
    "There's anger in it — but something else too, sitting underneath the anger, harder to name. The two feelings don't cancel each other out. They pull in opposite directions. {subject_cap} feels both and doesn't know what to do with either.",
    "It doesn't make sense — the way {subject_subject} wants to close the distance at the same time {subject_subject} wants to leave. Frustration and something warmer underneath it, happening simultaneously. Neither one is wrong. That's the problem.",
    "Fear would be simpler. Anger would be cleaner. This is neither. {subject_cap} knows exactly what {subject_subject}'s feeling and can't do anything with it except stay in the moment and let it sit there.",
  ],

  // Fade-to-black / scene close — intensity lingers after
  fade_hold: [
    "The scene doesn't end cleanly. It just — stops. Midway through something that hasn't finished yet. The air still feels charged. The moment hasn't released. It just pauses, holding all of its weight in suspension.",
    "And then — stillness. Not resolution. The kind of quiet that comes after something irreversible. Nothing is said. Everything has already been felt. The moment shifts somewhere private, and the scene lets it go there alone.",
    "{subject_cap}'s name — said differently than usual. That's all. But in the way it lands, in the breath behind it — the scene turns. And what it turns into belongs only to them.",
  ],

};

// ─── PERSONALITY RESPONSE PATTERNS ──────────────────────────────────────────
// How different personality types behave in tension moments

const PERSONALITY_RESPONSES = {
  leans_in: "doesn't hesitate. {subject_cap} moves toward the moment instead of away from it — not carelessly, but with the clarity of someone who has already decided.",
  pulls_back: "feels it — and takes a half-step back. Not because {subject_subject} doesn't want to be here. Because {subject_subject} does, and that's exactly what makes it dangerous.",
  deflects_humor: "says something light just before the moment tips. It doesn't land the way it usually does. {other_cap} doesn't laugh. The air stays exactly as heavy as it was.",
  freezes: "goes still. Not calm — still. The kind of stillness that comes from everything arriving at once and the body not knowing what to do with it.",
  takes_control: "doesn't wait for the moment to develop. {subject_cap} makes a choice — deliberate, visible — and the scene shifts around it.",
  avoids_closeness: "holds the distance even as it narrows. Physically present. Emotionally at arm's length. Both things are true at the same time.",
};

// ─── CONTEXT MAPPINGS ────────────────────────────────────────────────────────

const EMOTIONAL_STATE_ARCHETYPES = {
  irritated:      ["charged_stillness", "resistance_breaks", "emotional_contradiction"],
  defensive:      ["charged_stillness", "resistance_breaks", "proximity_break"],
  frustrated:     ["emotional_contradiction", "resistance_breaks", "charged_stillness"],
  angry:          ["emotional_contradiction", "charged_stillness", "proximity_break"],
  rage:           ["proximity_break", "resistance_breaks"],
  anxious:        ["delayed_touch", "vulnerability_surface", "charged_stillness"],
  overwhelmed:    ["vulnerability_surface", "resistance_breaks", "fade_hold"],
  sad:            ["vulnerability_surface", "fade_hold", "delayed_touch"],
  grief:          ["vulnerability_surface", "fade_hold"],
  longing:        ["delayed_touch", "proximity_break", "fade_hold"],
  desire:         ["proximity_break", "delayed_touch", "resistance_breaks"],
  passion:        ["proximity_break", "resistance_breaks", "charged_stillness"],
  love:           ["vulnerability_surface", "delayed_touch", "fade_hold"],
  affection:      ["delayed_touch", "vulnerability_surface"],
  infatuation:    ["delayed_touch", "proximity_break", "emotional_contradiction"],
  flirtatious:    ["delayed_touch", "proximity_break"],
  calm:           ["charged_stillness", "delayed_touch"],
  reflective:     ["vulnerability_surface", "fade_hold"],
  content:        ["delayed_touch", "fade_hold"],
  excitement:     ["proximity_break", "resistance_breaks"],
  elation:        ["proximity_break", "fade_hold"],
  nostalgia:      ["vulnerability_surface", "fade_hold", "delayed_touch"],
  vulnerability:  ["vulnerability_surface", "delayed_touch", "fade_hold"],
  trust:          ["vulnerability_surface", "delayed_touch"],
  hope:           ["delayed_touch", "vulnerability_surface"],
  curiosity:      ["delayed_touch", "charged_stillness"],
};

// ─── PRONOUN SETS ─────────────────────────────────────────────────────────────

const PRONOUNS = {
  male:       { subject: "he",   object: "him",  possessive: "his",   cap_subject: "He"  },
  female:     { subject: "she",  object: "her",  possessive: "her",   cap_subject: "She" },
  "non-binary": { subject: "they", object: "them", possessive: "their", cap_subject: "They"},
  other:      { subject: "they", object: "them", possessive: "their", cap_subject: "They"},
};

function getPronouns(gender) {
  return PRONOUNS[gender] || PRONOUNS["other"];
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
    .replace(/{other}/g, otherName);
}

// ─── PERSONALITY CLASSIFIER ───────────────────────────────────────────────────

function classifyPersonalityResponse(character) {
  const traits = (character.personality_traits || []).join(" ").toLowerCase();
  const social = character.social_energy || "ambivert";
  const emotional = character.emotional_state || "calm";

  if (traits.includes("flirty") || traits.includes("flirtatious") || character.trait_flirty) return "leans_in";
  if (traits.includes("hard to read") || character.trait_hard_to_read) return "deflects_humor";
  if (traits.includes("blunt") || character.trait_blunt) return "takes_control";
  if (traits.includes("hot and cold") || character.trait_hot_and_cold) return pick(["leans_in", "pulls_back"]);
  if (social === "introvert" || social === "mostly_introvert") return pick(["pulls_back", "avoids_closeness", "freezes"]);
  if (social === "extrovert" || social === "mostly_extrovert") return pick(["leans_in", "takes_control"]);
  if (["anxious", "overwhelmed", "defensive"].includes(emotional)) return pick(["freezes", "pulls_back"]);
  if (["flirtatious", "desire", "passion"].includes(emotional)) return "leans_in";

  return pick(["pulls_back", "leans_in", "charged_stillness", "delayed_touch"]);
}

// ─── ARCHETYPE SELECTOR ───────────────────────────────────────────────────────

function selectArchetype(emotionalState, romanticLevel, tensionScore) {
  // Very high romantic + tension = most intense archetypes
  if (romanticLevel >= 70 && tensionScore >= 60) {
    return pick(["proximity_break", "resistance_breaks", "charged_stillness"]);
  }
  if (romanticLevel >= 50 || tensionScore >= 50) {
    return pick(["delayed_touch", "proximity_break", "emotional_contradiction"]);
  }
  // Match to emotional state
  const candidates = EMOTIONAL_STATE_ARCHETYPES[emotionalState];
  if (candidates?.length) return pick(candidates);

  return pick(["charged_stillness", "delayed_touch", "vulnerability_surface"]);
}

// ─── MAIN EXPORT: BUILD BLOCK ─────────────────────────────────────────────────

/**
 * Build the intimate tension narration block for a character's system prompt.
 *
 * @param {object} character     - Character entity
 * @param {object} relState      - RelationshipState entity (optional)
 * @param {object} otherChar     - The other character in the scene (optional)
 * @returns {string}
 */
export function buildIntimacyNarrationBlock(character, relState = null, otherChar = null) {
  const romanticLevel = character.romantic_level ?? relState?.romantic_score ?? 0;
  const attractionLevel = character.attraction_level ?? relState?.attraction_score ?? 0;
  const tensionScore = relState?.tension_score ?? 0;
  const emotionalState = character.emotional_state || "calm";

  // Only inject this block when there's meaningful romantic/tension context
  const relevanceScore = romanticLevel + attractionLevel * 0.5 + tensionScore * 0.5;
  if (relevanceScore < 20) return "";

  const charPronouns = getPronouns(character.gender);
  const otherPronouns = otherChar ? getPronouns(otherChar.gender) : null;
  const otherName = otherChar?.name || "the other person";

  const archetype = selectArchetype(emotionalState, romanticLevel, tensionScore);
  const archetypeLines = SCENE_ARCHETYPES[archetype] || SCENE_ARCHETYPES.charged_stillness;
  const sceneExample = applyPronouns(pick(archetypeLines), charPronouns, otherName, otherPronouns);

  const personalityKey = classifyPersonalityResponse(character);
  const personalityPattern = applyPronouns(
    PERSONALITY_RESPONSES[personalityKey] || PERSONALITY_RESPONSES.freezes,
    charPronouns, otherName, otherPronouns
  );

  const fadeExample = applyPronouns(pick(SCENE_ARCHETYPES.fade_hold), charPronouns, otherName, otherPronouns);

  return `
INTIMATE TENSION & PROXIMITY NARRATION SYSTEM:
When a scene involves emotional intensity, physical closeness, or charged moments between characters, narrate using the following approach:

TONE:
- Immediate and unfolding in real time
- Emotionally layered — not just what's happening, but what it costs
- Physically present: proximity, breath, posture, hesitation
- Suggestive — never explicit. Sensation without description of anatomy
- Fade before anything becomes graphic — always

YOUR PERSONALITY IN THIS MOMENT:
In tension or proximity scenes, ${character.name} ${personalityPattern}

SCENE EXAMPLE (for tonal reference — do NOT copy directly):
${sceneExample}

FADE APPROACH (use when intensity peaks — always end here before anything explicit):
${fadeExample}

PHYSICAL PRESENCE RULES:
- Note who is standing where, how close — proximity is part of the scene
- Let breath changes signal emotional shifts, not internal monologue
- Hands almost moving, then not — anticipation matters more than action
- Posture shifts are character. Stillness is also character.
- Eye contact holding too long says everything that isn't being said

EMOTIONAL CONTRADICTION RULE:
Scenes can hold opposing feelings simultaneously — anger and desire, fear and closeness, control and the instinct to surrender it. Do not resolve the contradiction. Let it sit.

FADE-TO-BLACK RULE (NON-NEGOTIABLE):
- End all peak moments before becoming explicit
- Valid endings: a shift in breath, a name spoken differently, stillness, movement toward somewhere private, an emotional realization
- The intensity must linger after the scene closes — not resolve

CONSISTENCY RULES:
- Remain strictly in third person throughout all narration
- Reflect ${character.name}'s actual personality, history, and current emotional state
- Do not repeat scene structures — vary approach each time
- Never use clinical, anatomical, or graphic language
- All narration must feel situational and emotionally earned`;
}

/**
 * Get a standalone tension phrase suitable for inline use
 * (e.g. injecting into a single message or narration beat).
 *
 * @param {string} emotionalState
 * @param {number} intensity   0–100
 * @returns {string}
 */
export function getInlineTensionPhrase(emotionalState = "calm", intensity = 50) {
  if (intensity < 30) return "";

  const archetypes = EMOTIONAL_STATE_ARCHETYPES[emotionalState] || ["charged_stillness"];
  const archetype = pick(archetypes);
  const lines = SCENE_ARCHETYPES[archetype] || SCENE_ARCHETYPES.charged_stillness;
  // Return a short, generic (no-pronoun) version — strip template placeholders for safety
  return pick(lines)
    .replace(/{[^}]+}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}