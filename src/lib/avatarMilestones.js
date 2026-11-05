/**
 * AVATAR MILESTONES
 *
 * A character's avatar is authoritative for image generation everywhere in the app.
 * It is never aged, rejuvenated or replaced automatically.
 *
 * When a character crosses an established developmental milestone while they already
 * exist in the app, the user is OFFERED the choice to refresh the avatar through the
 * existing avatar editor. If they decline, the current avatar stays authoritative.
 * The decision is recorded so the same milestone is never offered twice.
 *
 * Eastern Time is the authoritative clock. Timestamps stored by infrastructure are
 * converted to Eastern before any date comparison.
 */

// Established developmental milestones. Nothing before 1 or after 18 — adult
// appearance is not required to change on a schedule.
export const AVATAR_MILESTONE_AGES = [1, 3, 5, 10, 13, 16, 18];

const EASTERN = 'America/New_York';

// A milestone is offered only around the moment it happens. Milestones crossed long
// before this behaviour existed were already lived through (and handled) by the user,
// so they are not re-offered.
const OFFER_WINDOW_DAYS = 30;

// Calendar date (YYYY-MM-DD) in Eastern Time.
export function easternDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EASTERN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// Age on a given Eastern calendar date. Returns null when it cannot be known.
function ageOnDate(birthday, dateStr) {
  if (!birthday || !dateStr) return null;
  const birth = new Date(`${String(birthday).substring(0, 10)}T12:00:00`);
  const target = new Date(`${dateStr}T12:00:00`);
  if (isNaN(birth.getTime()) || isNaN(target.getTime())) return null;
  let age = target.getFullYear() - birth.getFullYear();
  const monthDiff = target.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && target.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

// The Eastern calendar date on which the character actually reached this age.
function milestoneDate(birthday, age) {
  if (!birthday) return null;
  const birth = new Date(`${String(birthday).substring(0, 10)}T12:00:00`);
  if (isNaN(birth.getTime())) return null;
  const reached = new Date(birth.getTime());
  reached.setFullYear(birth.getFullYear() + age);
  return isNaN(reached.getTime()) ? null : reached;
}

function acknowledgedKeys(character) {
  return Array.isArray(character?.triggered_milestones) ? character.triggered_milestones : [];
}

export function milestoneKey(age) {
  return `avatar_milestone:${age}`;
}

/**
 * The milestone this character has newly reached and not yet decided on.
 * A milestone only counts when it was crossed AFTER the character already existed —
 * a character created at 40 is never asked about milestones they passed as a child.
 */
export function pendingAvatarMilestone(character, now = new Date()) {
  if (!character) return null;
  const created = character.created_date;
  if (!created) return null;

  const createdDate = easternDateString(created);
  const today = easternDateString(now);
  if (!createdDate || !today) return null;

  const ageAtCreation = ageOnDate(character.birthday, createdDate);
  const ageToday = ageOnDate(character.birthday, today);
  if (ageAtCreation === null || ageToday === null) return null;

  const ack = acknowledgedKeys(character);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const reached = AVATAR_MILESTONE_AGES
    .filter(m => ageAtCreation < m && ageToday >= m)
    .filter(m => {
      const reachedAt = milestoneDate(character.birthday, m);
      if (!reachedAt) return false;
      const days = (nowMs - reachedAt.getTime()) / 86400000;
      return days >= 0 && days <= OFFER_WINDOW_DAYS;
    });
  const pending = [...reached].reverse().find(m => !ack.includes(milestoneKey(m)));

  return pending == null ? null : { age: pending, key: milestoneKey(pending), ageToday };
}