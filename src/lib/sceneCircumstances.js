/**
 * sceneCircumstances
 *
 * Turns the information the app ALREADY holds into the standing reality of a scene:
 * why each person is in this place, and what that place is to them.
 *
 * Employment, job title, residence, school enrollment, shifts and class hours all come
 * from existing character + location records (Eastern Time). Nothing new is created and
 * nothing is invented:
 *   - employed HERE and on shift  → working here
 *   - employed HERE off shift     → their workplace, not their workday
 *   - enrolled HERE, class in     → student here
 *   - lives HERE                  → home (a campus residence is still a home)
 *   - employed or enrolled ELSEWHERE → their job/school stays there; they are a visitor here
 *
 * Used by both Scenes dialogue pathways (user-present and observed).
 */
import { isCharacterAtWork, isCharacterOnShift, isCharacterAtSchool, isLocationActiveNow } from '@/lib/workScheduleUtils';

const nameOf = (p) => p?.name || p?.display_name || null;

function jobTitleAt(person, location) {
  return location?.worker_job_titles?.[person?.id]
    || person?.work_details?.job_title
    || person?.occupation
    || null;
}

/**
 * Employment at THIS place comes from the character's own employment record or a shift
 * defined here — never from the location's worker roster array, which lists people whose
 * actual job is somewhere else. A job belongs to one place only.
 */
function worksHere(person, location) {
  if (!person?.id || !location) return false;
  if (person.occupation_location_id === location.id) return true;
  if (person.current_work_location_id === location.id) return true;
  if ((person.additional_occupation_locations || []).some((a) => a?.location_id === location.id)) return true;
  if (location.worker_shifts?.[person.id]) return true;
  return false;
}

/**
 * On shift HERE — decided only by an established schedule, never by a stored presence
 * status. A finished shift can never be presented as the character still working.
 */
function onShiftHere(person, location, onShiftIds) {
  if (onShiftIds?.has?.(person.id)) return true;
  if (person.sceneRole === 'on-shift employee') return true;
  if (location?.worker_shifts?.[person?.id] && isCharacterOnShift(person.id, location)) return true;
  const occupationLinkedHere = person?.occupation_location_id === location?.id
    || (person?.additional_occupation_locations || []).some((a) => a?.location_id === location?.id);
  // Only a character whose own employment record points at THIS place is judged by
  // their own hours — a job elsewhere never makes this place their shift.
  if (occupationLinkedHere) return isCharacterAtWork(person, location);
  return false;
}

function studiesHere(person, location) {
  if (!person || !location) return false;
  if (person.student_status && person.student_status !== 'enrolled') return false;
  if (person.education_location_id === location.id) return true;
  if ((person.education_enrollments || []).some((e) => e && (e.location_id === location.id || e.institution_location_id === location.id))) return true;
  return false;
}

/** Class is in session here, using the school's own hours and the existing attendance check. */
function classInSession(person, location) {
  if (isCharacterAtSchool(person, location).attending) return true;
  const open = isLocationActiveNow(location); // null = no hours established
  if (open !== null) return open === true;
  return person?.resolved_presence_status === 'at_school';
}

function livesHere(person, location, homeResidentIds) {
  if (!person || !location) return false;
  if (homeResidentIds?.has?.(person.id)) return true;
  if (person.is_home_resident === true || person.sceneRole === 'home resident') return true;
  return !!person.current_home_location_id && person.current_home_location_id === location.id;
}

/** Their job or school is somewhere else — said plainly, so this place is never confused with it. */
function elsewhereFacts(person, location, locationsById) {
  const bits = [];
  const workplaceId = person?.occupation_location_id || null;
  const workplaceName = person?.occupation_location_name
    || (workplaceId ? locationsById?.[workplaceId]?.name : null)
    || null;
  const job = person?.work_details?.job_title || person?.occupation || null;

  const employedElsewhere = !!workplaceId && workplaceId !== location?.id;
  if (employedElsewhere) {
    const wpLoc = locationsById?.[workplaceId] || null;
    const shiftNow = wpLoc ? isCharacterOnShift(person.id, wpLoc) : null;
    const shiftLine = shiftNow === true
      ? 'Their shift there is in progress right now, so they are here on a break from it.'
      : shiftNow === false ? 'They are not on a shift there at this moment.' : '';
    bits.push(`${nameOf(person)} WORKS AT ${workplaceName || 'another place'}${job ? ` as ${job}` : ''} — not here. ${shiftLine} They are NOT employed here and do not act as staff, take orders, or serve anyone here.`);
  }

  const schoolId = person?.education_location_id || null;
  const enrolledElsewhere = person?.student_status === 'enrolled' && schoolId && schoolId !== location?.id;
  if (enrolledElsewhere) {
    bits.push(`${nameOf(person)} IS ENROLLED AT ${person.education_location_name || 'another school'} — not here. This place is not their school, and being inside it does not make them a student here.`);
  }

  return bits;
}

/**
 * One person's established standing in this place.
 * @returns {string|null} a sentence describing why they are here
 */
export function describePersonHere({ person, location, onShiftAtLocationIds = null, homeResidentIds = null, locationsById = null }) {
  const name = nameOf(person);
  if (!name || !location) return null;

  const status = person.resolved_presence_status || '';
  const jobTitle = jobTitleAt(person, location);
  const text = [];

  const employedHere = worksHere(person, location);
  const onShift = employedHere && onShiftHere(person, location, onShiftAtLocationIds);
  const enrolledHere = studiesHere(person, location);
  const classNow = enrolledHere && classInSession(person, location);
  const residentHere = livesHere(person, location, homeResidentIds);

  if (status === 'hospitalized') {
    text.push(`${name} is a PATIENT here, receiving care.`);
  } else if (['incarcerated', 'confined', 'house_arrest'].includes(status)) {
    text.push(`${name} is CONFINED here.`);
  } else if (residentHere && !onShift && !classNow) {
    // A campus residence is still a home. Living on school property does not mean
    // attending class while at home.
    text.push(`${name} LIVES HERE — this is home.${enrolledHere
      ? ` They are also a student at ${person.education_location_name || 'this school'}, but at home the day is theirs: relaxing, eating, studying, sleeping or spending time with people — never sitting in a class that is not in session.`
      : ' Being home is not an event or an arrival; it is where their ordinary day happens.'}`);
  } else if (employedHere) {
    text.push(`${name} WORKS HERE${jobTitle ? ` as ${jobTitle}` : ''}. ${onShift
      ? 'They are on shift right now: they know the job, the routine, the coworkers and their own responsibilities here. They did not stop by, wander in, or come to hang out — this is their workday.'
      : 'This is their workplace, but no scheduled shift is running now: they are off the clock and are here for their own reasons. Being here does not put them back on duty.'}`);
  } else if (enrolledHere) {
    const activity = person.current_education_activity && person.current_education_activity !== 'none'
      ? `, currently: ${person.current_education_activity}`
      : '';
    text.push(`${name} IS A STUDENT HERE${person.education_location_name ? ` (enrolled at ${person.education_location_name})` : ''}${activity}. ${classNow
      ? 'Class time is happening now: classes, coursework, professors, classmates and assignments are their normal reality. This is not a hangout and they did not come here to kill time.'
      : 'They are on campus outside scheduled class hours, so studying, socializing or free time here is legitimate — and they still know they are a student here, not someone attending class right now.'}`);
  } else if (residentHere) {
    text.push(`${name} LIVES HERE.`);
  } else {
    const elsewhere = elsewhereFacts(person, location, locationsById);
    if (elsewhere.length > 0) text.push(...elsewhere);
    text.push(`${name} is here as a visitor${elsewhere.length > 0 ? '' : ' — no job, enrollment or residence ties them to this place'}.`);
  }

  const activity = String(person.current_activity || '').trim();
  if (activity && !/^(home|idle|none)$/i.test(activity)) {
    text.push(` Right now: ${activity}.`);
  }

  return text.join('');
}

/**
 * The scene-wide block: who is here, why, and how that must shape what they say.
 */
export function buildSceneCircumstances({ location, participants = [], backgroundPeople = [], onShiftAtLocationIds = null, homeResidentIds = null, locationsById = null }) {
  if (!location) return '';

  const seen = new Set();
  const lines = [];
  for (const person of participants) {
    if (!person?.id || seen.has(person.id)) continue;
    if (person.isUser === true) continue;
    // Background people of the place have no canonical record — they are handled below
    // by the role they hold here, never as an established character.
    if (person.isNpc === true || String(person.id).startsWith('npc_')) continue;
    seen.add(person.id);
    const described = describePersonHere({ person, location, onShiftAtLocationIds, homeResidentIds, locationsById });
    if (described) lines.push(`- ${described}`);
  }

  const background = (backgroundPeople || []).filter((b) => b?.name && b?.role);
  if (lines.length === 0 && background.length === 0) return '';

  const backgroundLine = background.length > 0
    ? `\n- The other people here hold the roles this place actually gives them: ${background.map((b) => `${b.name} (${String(b.role).toLowerCase()})`).join(', ')}. They speak and behave from that role — a bartender works the bar, a teacher teaches the room, a receptionist handles check-in — and they are never confused with, or stood in for by, the established people above.`
    : '';

  return `=== WHO IS HERE, AND WHY (ALREADY TRUE — NEVER REDISCOVERED) ===
${lines.join('\n')}${backgroundLine}

HOW THIS SHAPES WHAT THEY SAY:
- These facts are their lived reality, not news. Nobody announces their job, school or schedule in every line — it simply shows in what they notice, do, and care about.
- A job and a school belong to ONE place. Being scheduled to work never makes any other place their workplace, and being inside a school during class hours never makes anyone enrolled there. Visiting a business or a campus does not create employment or enrollment.
- Current location and current activity outweigh every schedule. Someone who stepped out from work is not working wherever they happen to be; someone whose shift has ended is not still on duty just because they remained at their workplace.
- A person can be an employee without working right now, a student without being in class, and a campus resident without attending anything. Do not extend one identity across the whole day.
- Nobody's reason for being here changes because this scene opened. Nobody just arrived, just got here, decided to stop by, or came to check the place out: they were already doing what they are doing.
- What already happened to them stays true. A test already taken has been taken; a shift already finished is over; an event stated as past is past and is never treated as still to come.
- Only someone described above as a visitor speaks like a visitor. A person who works, studies or lives here never speaks like an uninformed guest in their own workplace, school or home.
===`;
}