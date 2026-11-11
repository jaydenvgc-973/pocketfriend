/**
 * sceneCircumstances
 *
 * Turns the information the app ALREADY holds into the standing reality of a scene:
 * why each person is in this place, and what that place is to them.
 *
 * Employment, job title, residence, school enrollment and the current activity all
 * come from existing character + location records. Nothing new is created, nothing
 * is invented: a person who works here is described as working here, a person who
 * studies here is described as a student here, and only someone who is genuinely
 * just visiting is described as a visitor.
 *
 * Used by both Scenes dialogue pathways (user-present and observed).
 */
import { isEmployedAtLocation } from '@/lib/sceneRoleResolver';

const nameOf = (p) => p?.name || p?.display_name || null;

function jobTitleAt(person, location) {
  return location?.worker_job_titles?.[person?.id]
    || person?.work_details?.job_title
    || person?.occupation
    || null;
}

function worksHere(person, location, onShiftIds) {
  if (!person?.id || !location) return false;
  if (onShiftIds?.has?.(person.id)) return true;
  if (person.sceneRole === 'on-shift employee') return true;
  return isEmployedAtLocation(person, location);
}

function studiesHere(person, location) {
  if (!person || !location) return false;
  if (person.student_status && person.student_status !== 'enrolled') return false;
  if (person.education_location_id === location.id) return true;
  if ((person.education_enrollments || []).some((e) => e && (e.location_id === location.id || e.institution_location_id === location.id))) return true;
  return false;
}

function livesHere(person, location, homeResidentIds) {
  if (!person || !location) return false;
  if (homeResidentIds?.has?.(person.id)) return true;
  if (person.is_home_resident === true || person.sceneRole === 'home resident') return true;
  return !!person.current_home_location_id && person.current_home_location_id === location.id;
}

/**
 * One person's established standing in this place.
 * @returns {string|null} a sentence describing why they are here
 */
export function describePersonHere({ person, location, onShiftAtLocationIds = null, homeResidentIds = null }) {
  const name = nameOf(person);
  if (!name || !location) return null;

  const status = person.resolved_presence_status || '';
  const jobTitle = jobTitleAt(person, location);
  const text = [];

  if (status === 'hospitalized') {
    text.push(`${name} is a PATIENT here, receiving care.`);
  } else if (['incarcerated', 'confined', 'house_arrest'].includes(status)) {
    text.push(`${name} is CONFINED here.`);
  } else if (worksHere(person, location, onShiftAtLocationIds)) {
    const onShift = onShiftAtLocationIds?.has?.(person.id)
      || person.sceneRole === 'on-shift employee'
      || status === 'at_work';
    text.push(`${name} WORKS HERE${jobTitle ? ` as ${jobTitle}` : ''}. ${onShift
      ? 'They are on shift right now: they know the job, the routine, the coworkers and their own responsibilities here. They did not stop by, wander in, or come to hang out — this is their workday.'
      : 'This is their workplace, though this is not a scheduled shift — their reason for being here is their own, and it is never that they are discovering the place.'}`);
  } else if (studiesHere(person, location)) {
    const inClass = status === 'at_school' || person.sceneRole === 'student' || person.sceneRole === 'on-shift student';
    const activity = person.current_education_activity && person.current_education_activity !== 'none'
      ? `, currently: ${person.current_education_activity}`
      : '';
    text.push(`${name} IS A STUDENT HERE${person.education_location_name ? ` (enrolled at ${person.education_location_name})` : ''}${activity}. ${inClass
      ? 'They are here for their education right now: classes, coursework, professors, classmates and assignments are their normal reality. This is not a hangout and they did not come here to kill time.'
      : 'They are on campus outside a scheduled class, so studying, socializing or free time here is legitimate — and they still know they are a student here.'}`);
  } else if (livesHere(person, location, homeResidentIds)) {
    text.push(`${name} LIVES HERE.`);
  } else if (status === 'visiting' || status === 'at_location' || !status) {
    text.push(`${name} is here as a visitor.`);
  } else {
    // Presence is established but their link to this place is not in reach here —
    // never downgrade them to a casual guest on a missing field.
    text.push(`${name} is here for an already established reason (${status.replace(/_/g, ' ')}) — not a casual drop-in, and they did not just arrive.`);
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
export function buildSceneCircumstances({ location, participants = [], backgroundPeople = [], onShiftAtLocationIds = null, homeResidentIds = null }) {
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
    const described = describePersonHere({ person, location, onShiftAtLocationIds, homeResidentIds });
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
- Nobody's reason for being here changes because this scene opened. Nobody just arrived, just got here, decided to stop by, or came to check the place out: they were already doing what they are doing.
- What already happened to them stays true. A test already taken has been taken; a shift already finished is over; an event stated as past is past and is never treated as still to come.
- Only someone described above as a visitor speaks like a visitor. A person who works or studies here never speaks like an uninformed guest in their own workplace or school.
===`;
}