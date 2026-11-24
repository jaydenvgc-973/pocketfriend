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