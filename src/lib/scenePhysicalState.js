/**
 * SCENE PHYSICAL STATE — what the people in this scene have actually established about
 * their bodies, their clothing and where they are.
 *
 * This is NOT another state store. It is a pure read of the transcript the scene already
 * has: the character lines and the narrative lines that were already written. Nothing is
 * saved anywhere, so the established condition lives exactly as long as the scene does —
 * a new picture, a new camera angle or a manual refresh cannot reset it, because the
 * transcript it is read from has not changed.
 *
 * What it distinguishes (as the scene itself does):
 *   • COMPLETED / UNDERWAY  "I'm taking my shirt off."  "He pulled his shirt off."
 *   • INTENTION             "I might take it off later."  "I should probably take this off."
 *   • HYPOTHETICAL          "If I took my shirt off…"  "Could you take that off?"
 * Only the first establishes that the change has happened. The rest change nothing.
 */

// The garments a scene can establish, in the words people actually use for them. Order
// matters: the first noun found in a sentence decides which garment was meant, so the more
// specific garment is listed before the general word that can describe it.
const GARMENTS = [
  { key: 'jacket', label: 'jacket', nouns: ['jacket', 'coat', 'blazer', 'cardigan', 'hoodie'] },
  { key: 'shirt', label: 'shirt', nouns: ['shirt', 't-shirt', 'tee', 'tank top', 'blouse', 'sweater', 'sweatshirt', 'button-down', 'polo', 'top'] },
  { key: 'pants', label: 'pants', nouns: ['pants', 'jeans', 'trousers', 'shorts', 'skirt'] },
  { key: 'shoes', label: 'shoes', nouns: ['shoes', 'boots', 'sneakers', 'heels', 'sandals', 'slippers'] },
  { key: 'socks', label: 'socks', nouns: ['socks'] },
  { key: 'hat', label: 'hat', nouns: ['hat', 'cap', 'beanie'] },
];

// A garment leaving the body. The verb and the "off" are usually separated by the garment
// itself ("taking my shirt off", "pulled his jacket off"), so they are matched as one shape
// rather than as a fixed phrase. Present progress counts on purpose: in this scene it is
// the action happening now, not a plan.
const REMOVAL_SHAPE = /\b(tak(?:e|es|ing)|took|pul(?:l|ls|ling)|pulled|peel(?:s|ed|ing)?|strip(?:s|ped|ping)|slip(?:s|ped|ping)|remov(?:e|es|ed|ing)|kick(?:s|ed|ing))\b[^.!?]{0,40}\boff\b/i;

// A garment going back on.
function isRestoration(lower) {
  if (/\bback on\b/.test(lower)) return true;
  if (/\b(got|gets|getting) dressed\b/.test(lower)) return true;
  // "put his shirt on" — but never "put his shirt on the couch", which is not dressing.
  return /\b(put(?:s|ting)?|slipp(?:ed|ing)?)\b[^.!?]{0,30}\bon\b(?!\s+(?:the|a|an|top of)\b)/i.test(lower);
}

function isRemoval(lower) {
  if (REMOVAL_SHAPE.test(lower)) return true;
  // "his shirt is off", "the jacket's gone" — the garment already named in the sentence.
  return /\b(off|gone)\b/.test(lower);
}

// Bare-skin statements that establish the garment is off without naming an action.
const BARE_STATES = [
  { key: 'shirt', words: ['shirtless', 'bare-chested', 'bare chested', 'topless', 'bare torso', 'chest bare'] },
  { key: 'shoes', words: ['barefoot', 'bare foot', 'no shoes'] },
];

// Words that make a sentence a consideration, a plan or a possibility rather than something
// that has happened. A sentence containing any of them never changes the established state.
const NON_COMMITTAL = /\b(might|may|could|maybe|perhaps|probably|should|would|if|unless|wonder|wondering|thinking about|considering|planning to|going to .*\blater\b|not yet|never mind|joking|kidding|just kidding)\b/i;

const POSTURE_RULES = [
  { posture: 'sitting', words: ['sat down', 'sits down', 'sitting', 'took a seat', 'seated', 'plopped down'] },
  { posture: 'standing', words: ['stood up', 'stands up', 'standing', 'got up', 'gets up'] },
  { posture: 'lying down', words: ['lay down', 'laid down', 'lies down', 'lying down', 'reclined', 'stretched out'] },
];

function hasWord(text, word) {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function findGarment(sentence) {
  for (const garment of GARMENTS) {
    if (garment.nouns.some((n) => hasWord(sentence, n))) return garment;
  }
  return null;
}

/**
 * Whose body a sentence is about. A person's own line belongs to them unless they named
 * somebody else; a narrated sentence belongs to the person it names.
 */
function resolveSubject(sentence, speaker, people) {
  const named = people.filter((p) => p?.name && hasWord(sentence, p.name));
  if (named.length === 1 && named[0].id !== speaker?.id) return named[0];
  if (/\b(i|i'm|im|i’ve|my|me|myself)\b/i.test(sentence) && speaker) return speaker;
  if (named.length === 1) return named[0];
  return speaker || null;
}

/**
 * Read the scene's transcript and return the established physical state of each person.
 *
 * @param {Array} messages  The scene's own messages (character lines, narrative, stage, activity).
 * @param {Array} people    The people the picture will contain ({ id, name }).
 * @returns {Object}        { [personId]: { removed: [garmentKey], posture } }
 */
export function deriveScenePhysicalState(messages, people = []) {
  const state = {};
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.content === 'string' && m.content.trim());
  if (list.length === 0 || people.length === 0) return state;

  // A person who was already unclothed in their own established reference (a bare torso in
  // the avatar) needs no scene statement to stay that way; only statements are read here.

  for (const message of list) {
    // An activity line is the strip's own wording, never something a person said.
    if (message.sender === 'activity') continue;
    const speaker = message.characterId
      ? people.find((p) => p.id === message.characterId)
      : (message.senderName ? people.find((p) => p.name && p.name.toLowerCase() === String(message.senderName).toLowerCase()) : null);

    const sentences = message.content.split(/(?<=[.!?…])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      if (NON_COMMITTAL.test(sentence)) continue;
      // A question never establishes a change: it asks about one.
      if (/\?\s*$/.test(sentence)) continue;

      // A narrated sentence that names nobody ("He pulled his shirt back on.") belongs to the
      // one person this scene has already established a condition for — never to everyone.
      const person = resolveSubject(sentence, speaker, people)
        || (() => {
          const established = people.filter((p) => state[p.id]?.removed?.length);
          return established.length === 1 ? established[0] : null;
        })();
      if (!person?.id) continue;
      const entry = state[person.id] || { removed: [], posture: null };

      const lower = sentence.toLowerCase();

      for (const bare of BARE_STATES) {
        if (bare.words.some((w) => hasWord(lower, w))) {
          if (!entry.removed.includes(bare.key)) entry.removed.push(bare.key);
        }
      }

      const garment = findGarment(sentence);
      if (garment) {
        if (isRestoration(lower)) entry.removed = entry.removed.filter((k) => k !== garment.key);
        else if (isRemoval(lower) && !entry.removed.includes(garment.key)) entry.removed.push(garment.key);
      }

      for (const rule of POSTURE_RULES) {
        if (rule.words.some((w) => lower.includes(w))) entry.posture = rule.posture;
      }

      if (entry.removed.length > 0 || entry.posture) state[person.id] = entry;
    }
  }

  return state;
}

function labelFor(key) {
  const garment = GARMENTS.find((g) => g.key === key);
  return garment ? garment.label : key;
}

/**
 * The prompt block that carries the established state into the picture.
 *
 * It is stated AFTER the outfit lock on purpose: the outfit is the person's established
 * wardrobe and stays exactly as it is — the scene has temporarily taken one garment off
 * them, and that is what the picture must show. The wardrobe itself is never changed.
 */
export function buildPhysicalContinuityBlock(state, people = []) {
  const entries = Object.entries(state || {}).filter(([, v]) => v && (v.removed?.length || v.posture));
  if (entries.length === 0) return '';

  const lines = entries
    .map(([id, v]) => {
      const person = people.find((p) => p.id === id);
      const name = person?.name;
      if (!name) return null;
      const parts = [];
      if (v.removed?.length) {
        const garments = v.removed.map(labelFor).join(' and ');
        parts.push(`the scene has already established that ${name}'s ${garments} ${v.removed.length === 1 ? 'is' : 'are'} OFF and still off — ${name} is depicted WITHOUT ${v.removed.length === 1 ? 'it' : 'them'} in this picture`);
        parts.push(`⛔ Do NOT draw a ${garments} on ${name} here. The avatar photo, the saved outfit and any earlier picture of this scene show ${name} dressed — those are OUT OF DATE for this garment and must not be copied.`);
        parts.push(`✅ Only that garment is off: everything else ${name} wears stays exactly as their established outfit describes it. Removing it did not replace the outfit and created no new clothing.`);
      }
      if (v.posture) parts.push(`${name} is ${v.posture} in this moment`);
      return `• ${name.toUpperCase()} — ${parts.join(' ')}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return '';

  return `\n═══════════════════════════════════════════════════════════\n` +
    `ESTABLISHED PHYSICAL STATE — THIS SCENE HAS ALREADY HAPPENED\n` +
    `═══════════════════════════════════════════════════════════\n` +
    `These facts were established by what the people in this scene said and by what was narrated. They are current, they are still in effect, and this picture must agree with them.\n` +
    `${lines.join('\n')}\n` +
    `⛔ A new picture is NOT a new scene: generating this image again, changing the camera angle, moving to another part of the room, choosing another activity, or continuing the conversation does NOT undo any of the above.\n` +
    `⛔ Never restore a garment the scene has taken off simply because the person's reference photos or saved outfit show them wearing it.\n` +
    `✅ An established state changes only when the scene itself changes it — for example when the person puts the garment back on.\n` +
    `═══════════════════════════════════════════════════════════\n`;
}