/**
 * Narration Trigger System
 *
 * Provides contextual trigger phrases injected into character system prompts
 * to guide when scene narration should expand, when user input is needed,
 * when actions should be clarified, and how transitions/intensity/holds should feel.
 *
 * All triggers are strictly third-person and must feel natural, immersive, and
 * emotionally aligned. They enhance — never replace — existing narration.
 */

// ─── TRIGGER BANKS ──────────────────────────────────────────────────────────

const SCENE_EXPANSION_TRIGGERS = [
  "Something shifts in the moment—subtle, but enough to change the direction of it.",
  "The space between them feels different now, like something's about to happen.",
  "There's a pause that lingers longer than it should.",
  "The energy changes, even if neither of them says it out loud.",
  "For a second, everything slows.",
  "It doesn't feel like a normal moment anymore.",
  "The silence carries more weight than before.",
  "There's a hesitation — like one of them is deciding something.",
];

const USER_INPUT_TRIGGERS = [
  "They don't move right away — waiting to see what happens next.",
  "The moment hangs there, unfinished.",
  "All attention shifts toward what comes next.",
  "There's an opening here — what happens now isn't decided yet.",
  "They pause, like they're expecting something in return.",
  "Nothing breaks the moment yet — it's still waiting.",
  "The next move isn't clear — but it matters.",
  "It could go either way from here.",
];

const ACTION_CLARIFICATION_TRIGGERS = [
  "It happens fast — almost before either of them processes it.",
  "The shift is immediate, leaving no time to think.",
  "One movement leads into another without pause.",
  "There's no hesitation in the way it unfolds.",
  "The moment changes direction without warning.",
  "It's not planned — it just happens.",
  "The distance between them disappears quicker than expected.",
  "There's no clear start to it — just a sudden change.",
];

const TRANSITION_TRIGGERS = [
  "The moment doesn't stay where it started.",
  "It shifts — quietly, but completely.",
  "What started one way doesn't stay that way.",
  "There's a clear change now — no going back to how it was a second ago.",
  "The tone of the moment settles into something different.",
  "It's not the same situation anymore.",
  "The energy redirects, pulling everything with it.",
];

const INTENSITY_BUILD_TRIGGERS = [
  "The tension doesn't break — it builds.",
  "It's getting harder to ignore now.",
  "The moment sharpens instead of fading.",
  "There's more behind it now than before.",
  "It's not just a passing moment anymore.",
  "The closeness starts to mean something.",
  "There's weight to it now.",
];

const FADE_HOLD_TRIGGERS = [
  "The moment holds there, not quite moving forward.",
  "It doesn't resolve — it just stays.",
  "Even without movement, it doesn't lose intensity.",
  "Nothing interrupts it — not yet.",
  "It lingers longer than expected.",
  "There's no clean ending to it.",
  "It stays with them.",
];

// ─── CONTEXT SIGNALS ─────────────────────────────────────────────────────────
// Maps character/relationship context to which trigger types are most relevant

/**
 * Pick a random item from an array.
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Given a character's emotional state, relationship scores, and optional
 * scene hints, return an array of 2–4 contextually appropriate trigger phrases.
 *
 * @param {object} opts
 * @param {string}  opts.emotional_state    - Current emotional state of character
 * @param {number}  opts.romantic_level     - 0–100
 * @param {number}  opts.friendship_level   - 0–100
 * @param {number}  opts.tension_score      - 0–100 (from RelationshipState)
 * @param {boolean} opts.is_group_scene     - true if multiple characters present
 * @param {string}  opts.scene_context      - freeform hint e.g. "physical", "emotional", "farewell"
 * @returns {string[]}
 */
export function getContextualTriggers({
  emotional_state = "calm",
  romantic_level = 0,
  friendship_level = 50,
  tension_score = 0,
  is_group_scene = false,
  scene_context = "",
} = {}) {
  const triggers = [];
  const ctx = scene_context.toLowerCase();

  // High tension or emotional volatility → scene expansion + action clarification
  if (tension_score >= 60 || ["irritated", "defensive", "frustrated", "angry", "rage", "overwhelmed"].includes(emotional_state)) {
    triggers.push(pick(SCENE_EXPANSION_TRIGGERS));
    triggers.push(pick(ACTION_CLARIFICATION_TRIGGERS));
  }

  // Romantic or physically proximate → intensity build + user input
  if (romantic_level >= 40 || ctx.includes("physical") || ctx.includes("intimate") || ctx.includes("close")) {
    triggers.push(pick(INTENSITY_BUILD_TRIGGERS));
    if (romantic_level >= 60) {
      triggers.push(pick(USER_INPUT_TRIGGERS));
    }
  }

  // Farewell, departure, or fade moments
  if (ctx.includes("farewell") || ctx.includes("fade") || ctx.includes("goodbye") || ctx.includes("end")) {
    triggers.push(pick(FADE_HOLD_TRIGGERS));
  }

  // Reflective or sad states → transition + hold
  if (["reflective", "sad", "grief", "loneliness", "nostalgia", "longing"].includes(emotional_state)) {
    triggers.push(pick(TRANSITION_TRIGGERS));
    triggers.push(pick(FADE_HOLD_TRIGGERS));
  }

  // Excited or joyful → transition trigger to signal scene momentum
  if (["excited", "joyful", "elation", "happiness"].includes(emotional_state)) {
    triggers.push(pick(TRANSITION_TRIGGERS));
  }

  // High friendship + unresolved scene → user input trigger
  if (friendship_level >= 70 && triggers.length === 0) {
    triggers.push(pick(USER_INPUT_TRIGGERS));
  }

  // Always include at least one scene expansion trigger if nothing matched
  if (triggers.length === 0) {
    triggers.push(pick(SCENE_EXPANSION_TRIGGERS));
  }

  // Deduplicate and cap at 4
  return [...new Set(triggers)].slice(0, 4);
}

/**
 * Build the narration trigger block to inject into a character system prompt.
 * Returns a formatted string section, or empty string if not applicable.
 *
 * @param {object} character  - Character entity
 * @param {object} relState   - RelationshipState entity (optional)
 * @returns {string}
 */
export function buildNarrationTriggerBlock(character, relState = null) {
  const opts = {
    emotional_state: character.emotional_state || "calm",
    romantic_level: character.romantic_level ?? relState?.romantic_score ?? 0,
    friendship_level: character.friendship_level ?? relState?.friendship_score ?? 50,
    tension_score: relState?.tension_score ?? 0,
  };

  const triggers = getContextualTriggers(opts);

  if (!triggers.length) return "";

  return `
SCENE NARRATION TRIGGERS (read-only context — use these to guide when to expand narration, signal scene shifts, or invite user input):
${triggers.map(t => `- "${t}"`).join("\n")}

NARRATION RULES:
- Remain strictly in third person when narrating scene context or transitions.
- Use these triggers SPARINGLY — only when the scene genuinely calls for it.
- Blend them into narration naturally; never announce them or list them.
- Match tone to the current emotional state and relationship dynamic.
- Do NOT use triggers in every response — use them when the moment benefits.
- Triggers are for expansion, grounding, or transition — not decoration.
- NEVER break immersion or switch out of the established conversational voice.`;
}