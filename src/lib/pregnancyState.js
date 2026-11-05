/**
 * PREGNANCY STATE — persistent appearance continuity
 *
 * Pregnancy is a body STATE, not a per-prompt detail. Once recorded it must keep
 * affecting every generated image until birth, and it must progress with time
 * without the user restating it.
 *
 * WHERE IT LIVES: the character's existing `current_life_event` field — the app's
 * own "what is happening in this person's life right now" slot, which is already
 * injected into chat prompts and shown on the profile. No schema change, no new
 * engine, no parallel store.
 *
 * FORMAT the app writes (human-readable AND parseable):
 *   "Pregnant — began 2026-06-01; due 2027-03-08"
 *
 * The stage is always DERIVED from the began date at read time, so the same stored
 * record describes 5 months pregnant today and 6 months pregnant next month.
 *
 * Eastern Time is the authoritative clock.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function easternDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function addDaysToDateString(dateStr, days) {
  const base = new Date(`${dateStr}T12:00:00`);
  if (isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + days);
  return easternDateString(base);
}

/** The stored life-event text for a pregnancy that began on `beganDateStr`. */
export function buildPregnancyLifeEvent(beganDateStr, dueDateStr) {
  const began = beganDateStr || easternDateString();
  const due = dueDateStr || addDaysToDateString(began, 280);
  return `Pregnant — began ${began}; due ${due}`;
}

/** The stored life-event text once the baby is born — no longer parses as active. */
export function buildPostBirthLifeEvent(childName, birthDateStr) {
  const when = birthDateStr || easternDateString();
  return childName
    ? `New parent — gave birth to ${childName} on ${when}`
    : `New parent — gave birth on ${when}`;
}

/**
 * Read pregnancy state out of a stored life-event string.
 * Returns null when the character is not pregnant (never was, or has given birth).
 */
export function parsePregnancy(lifeEvent) {
  if (typeof lifeEvent !== 'string' || !lifeEvent) return null;
  if (!/pregnan/i.test(lifeEvent)) return null;
  // A completed pregnancy is not an active state.
  if (/\b(gave birth|has given birth|no longer pregnant|baby was born|gave birth to)\b/i.test(lifeEvent)) return null;

  const beganMatch = lifeEvent.match(/began\s+(\d{4}-\d{2}-\d{2})/i);
  const dueMatch = lifeEvent.match(/due\s+(\d{4}-\d{2}-\d{2})/i);
  const beganAt = beganMatch ? new Date(`${beganMatch[1]}T12:00:00`) : null;
  return {
    beganDateStr: beganMatch ? beganMatch[1] : null,
    beganAt: beganAt && !isNaN(beganAt.getTime()) ? beganAt : null,
    dueDate: dueMatch ? dueMatch[1] : null,
  };
}

// What the bump actually looks like at this point. Continuous, never on/off.
function stageVisual(weeks) {
  if (weeks == null) {
    return 'she is visibly pregnant — a clear rounded bump — but the exact stage is not recorded, so keep it moderate rather than extreme';
  }
  if (weeks <= 13) return 'the abdomen is barely changed — at most a slight fullness, no prominent bump yet';
  if (weeks <= 19) return 'a small but genuinely visible rounded bump low on the abdomen';
  if (weeks <= 27) return 'a clearly rounded, forward-set bump — the abdomen projects ahead of her waistline and shows through clothing';
  if (weeks <= 33) return 'a large, high-carried bump that dominates her midsection; her lower back curves to balance it';
  if (weeks <= 39) return 'a very large, low-carried bump: her whole midsection projects far forward, the bump sits low and is unmistakable even under loose clothing';
  return 'full-term: an extremely large, low-set bump — she is visibly at the very end of pregnancy';
}

/**
 * Derived pregnancy profile for a character. Returns null when not pregnant.
 * weeks/months are computed from the recorded began date, so the stage advances
 * on its own as real time passes.
 */
export function pregnancyProfile(character, now = new Date()) {
  if (!character) return null;
  const state = parsePregnancy(character.current_life_event);
  if (!state) return null;

  let weeks = null;
  if (state.beganAt) {
    weeks = Math.floor((now.getTime() - state.beganAt.getTime()) / WEEK_MS);
    weeks = Math.max(0, Math.min(42, weeks));
  }
  const months = weeks == null ? null : Math.min(9, Math.max(1, Math.round(weeks / 4.345)));
  const trimester = weeks == null ? null : (weeks <= 13 ? 1 : weeks <= 27 ? 2 : 3);

  return {
    beganDateStr: state.beganDateStr,
    dueDate: state.dueDate,
    weeks,
    months,
    trimester,
    visual: stageVisual(weeks),
  };
}

/**
 * The image-generation instruction for a pregnant character.
 * Injected into EVERY prompt for as long as the state is active — the user never
 * has to mention the pregnancy again.
 */
export function pregnancyPromptLine(character, now = new Date()) {
  const p = pregnancyProfile(character, now);
  if (!p) return '';
  const name = character?.name || 'this character';
  const stage = p.weeks != null
    ? `about ${p.weeks} weeks (${p.months} month${p.months === 1 ? '' : 's'}), trimester ${p.trimester}`
    : 'pregnant';
  return [
    `PREGNANCY STATE — PERSISTENT BODY STATE (NOT A COSTUME):`,
    `- ${name} is currently pregnant — ${stage}.`,
    `- Visible stage: ${p.visual}.`,
    `- The bump must be unmistakably present, and this stage must look visibly different from an earlier stage of the same pregnancy — a later stage is larger, lower and heavier, never the same size.`,
    `- Do NOT render her flat-stomached or slimmer than this stage, and do NOT advance her beyond it.`,
    `- Her face, hair, complexion and identity are unchanged — they come from her reference images, exactly as before the pregnancy.`,
  ].join('\n');
}

/** Short human label for UI. */
export function pregnancyLabel(character, now = new Date()) {
  const p = pregnancyProfile(character, now);
  if (!p) return null;
  if (p.weeks == null) return 'Pregnant';
  return `${p.months} month${p.months === 1 ? '' : 's'} pregnant · week ${p.weeks}`;
}