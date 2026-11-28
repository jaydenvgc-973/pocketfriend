/**
 * governmentVenues.js
 *
 * Identity and context for the Government venues that have official proceedings:
 * City Hall and the Courthouse. This file adds no legal system of its own — it only
 * names the venue, describes the proceeding the user set up, and resolves which
 * participants hold which courtroom roles so the existing Scenes narrative can
 * speak about the case accurately.
 *
 * Official consequences always run through the established systems:
 *   marriage  → commitMarriage (CharacterRelationship + fictional_relationships + family_members)
 *   sentence  → applyJudicialSentence (criminal_record + existing incarceration fields/facility inmates)
 */

import { actualLocationName } from "./courtParticipation";

const normalize = (v) => String(v || '').toLowerCase().replace(/[\s\-&]+/g, '_').replace(/_+/g, '_');

/**
 * Everything one place says about itself: its name and identity first, then the types
 * it carries. For a space inside a property this is the space's own name and business
 * types — never the property's.
 */
function identityOf(place) {
  if (!place) return '';
  const types = [
    ...(Array.isArray(place.subtype) ? place.subtype : [place.subtype]),
    place.business_category,
    place.business_type,
    place.residence_type,
    ...(Array.isArray(place.business_types)
      ? place.business_types.map((t) => `${t?.category || ''} ${t?.type || ''}`)
      : []),
  ].filter(Boolean).map(normalize);
  return `${String(place.venue_identity || '')} ${String(place.name || '')} ${types.join(' ')}`.toLowerCase();
}

function venueTypeFrom(identity) {
  if (identity.includes('city hall') || identity.includes('cityhall') || identity.includes('city_hall')) return 'city_hall';
  if (identity.includes('courthouse') || identity.includes('court house') || identity.includes('court_house')) return 'courthouse';
  return null;
}

/**
 * 'courthouse' | 'city_hall' | null for the destination actually selected.
 *
 * `space` is the residence or workplace the scene is in, when one is selected: it is the
 * destination, so only its own identity decides. A parent location that holds
 * independently functioning venues is never itself a courthouse or City Hall just because
 * one of the places inside it is — being somewhere inside Briarwick City is not being at
 * its City Hall. Its own type list describes what it contains, not what it is.
 *
 * A venue that carries both subtypes (a City Hall that also holds a courthouse) is the
 * place its own name says it is, so its visit opens the right setup.
 */
export function getGovernmentVenueType(location, space = null) {
  if (!location) return null;
  if (space) return venueTypeFrom(identityOf(space));
  if (location.parent_location_type) return null;
  return venueTypeFrom(identityOf(location));
}

/** Actions whose selection opens a setup or confirmation flow instead of a plain scene line. */
export const GOVERNMENT_ACTION_IDS = ['gov_marry', 'gov_sentence', 'gov_contempt', 'court_adjourn'];
export function isGovernmentActionId(id) { return GOVERNMENT_ACTION_IDS.includes(id); }

// ── CITY HALL ────────────────────────────────────────────────────────────────
export const CITY_HALL_PURPOSES = [
  { id: 'civil_marriage', label: 'Civil Marriage Ceremony', emoji: '💍' },
  { id: 'marriage_license', label: 'Marriage License Appointment', emoji: '📄' },
  { id: 'municipal_hearing', label: 'Municipal Hearing', emoji: '🏛️' },
  { id: 'administrative_dispute', label: 'Minor Legal or Administrative Dispute', emoji: '⚖️' },
  { id: 'government_services', label: 'Government Services or Appointment', emoji: '🗂️' },
  { id: 'civic_meeting', label: 'Civic Meeting', emoji: '👥' },
  { id: 'general_visit', label: 'General Visit / Observe', emoji: '🚶' },
];

export function cityHallPurposeLabel(id) {
  return CITY_HALL_PURPOSES.find((p) => p.id === id)?.label || null;
}

// ── COURTHOUSE ───────────────────────────────────────────────────────────────
export const COURT_CASE_TYPES = [
  { id: 'criminal', label: 'Criminal Case' },
  { id: 'civil', label: 'Civil Case' },
  { id: 'family', label: 'Family Court Matter' },
  { id: 'municipal', label: 'Municipal Court Matter' },
  { id: 'sentencing', label: 'Sentencing Hearing' },
  { id: 'other', label: 'Other Judicial Proceeding' },
];

export function courtCaseTypeLabel(id) {
  return COURT_CASE_TYPES.find((c) => c.id === id)?.label || 'Judicial Proceeding';
}

// Each role states when it applies. Witnesses and jurors are always optional and never
// required to conduct a case; the necessary roles are filled by temporary NPCs when the
// user leaves them unassigned.
// ownAccountOnly: the role carries legal consequences, so only a character this account
// owns may hold it. excludeIncarcerated: current custody disqualifies the role (jury
// service), regardless of a past record. excludeHospitalized: an active hospitalization
// disqualifies every role except defendant — a defendant may still appear remotely.
// Witnesses keep no custody exclusion: a person in custody may testify remotely without
// being released. Work and school never exclude anyone: a shift or a class is not an
// availability restriction.
const COURT_ROLES = [
  { key: 'judge', label: 'Judge', necessary: true, multiple: false, excludeHospitalized: true },
  { key: 'defendant', label: 'Defendant', necessary: true, multiple: false, ownAccountOnly: true },
  { key: 'plaintiff', label: 'Plaintiff / Complainant', necessary: false, multiple: false, ownAccountOnly: true, excludeHospitalized: true, caseTypes: ['civil', 'family', 'municipal', 'other'] },
  { key: 'prosecutor', label: 'Prosecuting Attorney', necessary: false, multiple: false, excludeHospitalized: true, caseTypes: ['criminal', 'municipal', 'sentencing'] },
  { key: 'defense_attorney', label: 'Defense Attorney', necessary: false, multiple: false, excludeHospitalized: true, caseTypes: ['criminal', 'civil', 'family', 'municipal', 'sentencing', 'other'] },
  { key: 'plaintiff_attorney', label: "Plaintiff's Attorney", necessary: false, multiple: false, excludeHospitalized: true, caseTypes: ['civil', 'family'] },
  { key: 'witnesses', label: 'Witnesses', necessary: false, multiple: true, optional: true, excludeHospitalized: true },
  { key: 'jurors', label: 'Jurors', necessary: false, multiple: true, optional: true, excludeIncarcerated: true, excludeHospitalized: true },
];

export function getCourtRolesForCaseType(caseType) {
  return COURT_ROLES.filter((r) => !r.caseTypes || r.caseTypes.includes(caseType));
}

// Temporary people of the courthouse. They fill only the roles a proceeding genuinely
// needs, they keep their assigned role for the whole case, and they are never written
// into the user's permanent character directory.
const TEMP_ROLE_PEOPLE = {
  judge: { name: 'Judge A. Whitmore', role: 'Judge' },
  defendant: { name: 'J. Doe', role: 'Defendant' },
  plaintiff: { name: 'K. Roe', role: 'Plaintiff' },
  prosecutor: { name: 'R. Hale', role: 'Prosecuting Attorney' },
  defense_attorney: { name: 'M. Osei', role: 'Defense Attorney' },
  plaintiff_attorney: { name: 'L. Barrow', role: "Plaintiff's Attorney" },
};

/** Which roles this case type needs filled for the proceeding to make sense. */
function necessaryRolesFor(caseType) {
  if (caseType === 'criminal' || caseType === 'sentencing') return ['judge', 'defendant', 'prosecutor', 'defense_attorney'];
  if (caseType === 'civil' || caseType === 'family') return ['judge', 'defendant', 'plaintiff'];
  if (caseType === 'municipal') return ['judge', 'defendant'];
  return ['judge', 'defendant'];
}

/** Every character the setup selected for a courtroom role, by their authoritative ID. */
export function courtAttendanceIds(courtCase) {
  const roles = courtCase?.roles || {};
  const caseType = courtCase?.case_type || 'other';
  const ids = [];
  for (const def of getCourtRolesForCaseType(caseType)) {
    const value = roles[def.key];
    if (def.multiple) (Array.isArray(value) ? value : []).filter(Boolean).forEach((id) => ids.push(id));
    else if (value) ids.push(value);
  }
  return [...new Set(ids)];
}

/** City Hall: the people whose physical attendance the visit requires (couple + witnesses). */
export function cityHallAttendanceIds(plan) {
  const m = plan?.marriage;
  if (!m) return [];
  return [...new Set([m.spouse_a_id, m.spouse_b_id, ...(m.witness_ids || [])].filter(Boolean))];
}

/** The officiant who conducts a civil ceremony — a person of City Hall, not of the household. */
export function cityHallOfficiantNpc(plan) {
  if (plan?.purpose !== 'civil_marriage') return null;
  return { id: 'npc_cityhall_officiant', name: 'City Clerk A. Rowe', role: 'Officiant', npcType: 'staff', isNpc: true };
}

/**
 * Resolve the case's people: the established characters the user chose for each role,
 * and a temporary NPC for each necessary role left unassigned. Optional roles
 * (witnesses, jurors, attorneys that are not required) stay empty when not chosen.
 *
 * `attendingIds` is the attendance authority: when it is supplied, only characters who
 * were actually established as present hold their role. A selected character who could
 * not legitimately attend is not shown in the room, and a necessary role left without an
 * attendee is held by the court's own temporary person.
 */
export function resolveCourtParticipants(courtCase, characters = [], { attendingIds = null, remoteById = null } = {}) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const allowed = attendingIds ? new Set(attendingIds) : null;
  // A remote participant holds their own role without being in the room: custody and
  // hospital are physical facts, not a reason to lose the role they were given.
  const remote = remoteById instanceof Map ? remoteById : new Map(Object.entries(remoteById || {}));
  const canAttend = (id) => !!id && (!allowed || allowed.has(id) || remote.has(id));
  const roles = courtCase?.roles || {};
  const caseType = courtCase?.case_type || 'other';
  const necessary = necessaryRolesFor(caseType);
  const assignments = [];
  const tempNpcs = [];

  const assignmentFor = (def, character) => {
    const info = remote.get(character.id);
    return {
      roleKey: def.key,
      roleLabel: def.label,
      characterId: character.id,
      name: character.name,
      remote: !!info,
      remote_location_name: info ? (info.location_name || actualLocationName(character)) : null,
    };
  };

  for (const def of COURT_ROLES) {
    const value = roles[def.key];
    if (def.multiple) {
      const ids = Array.isArray(value) ? value.filter(Boolean) : [];
      ids.forEach((id) => {
        const c = byId.get(id);
        if (c && canAttend(id)) assignments.push(assignmentFor(def, c));
      });
      continue;
    }
    if (value && byId.get(value) && canAttend(value)) {
      assignments.push(assignmentFor(def, byId.get(value)));
      continue;
    }
    // A necessary role nobody is attending for is held by a temporary person of the court.
    if (def.necessary && necessary.includes(def.key)) {
      const person = TEMP_ROLE_PEOPLE[def.key];
      if (person) {
        tempNpcs.push({
          id: `npc_court_${def.key}_${courtCase?.case_id || 'case'}`,
          name: person.name,
          role: person.role,
          npcType: 'staff',
          isNpc: true,
        });
        assignments.push({ roleKey: def.key, roleLabel: def.label, characterId: null, name: person.name, temporary: true });
      }
    }
  }
  const attendanceIds = [...new Set(assignments.map((a) => a.characterId).filter(Boolean))];
  return { assignments, tempNpcs, attendanceIds };
}

/** The courtroom as the narrative must see it: who holds which role, and what is being tried. */
export function buildCourtCaseContext(courtCase, { userPresent = true, userName = null, venueName = null } = {}) {
  if (!courtCase) return '';
  const venue = venueName || courtCase.location_name || 'the courthouse';
  const lines = [];
  lines.push('════════════════════════════════════');
  lines.push('COURT PROCEEDING — ESTABLISHED CASE (AUTHORITATIVE)');
  lines.push('════════════════════════════════════');
  lines.push(`Case type: ${courtCaseTypeLabel(courtCase.case_type)}`);
  if (courtCase.description) lines.push(`The case is about: ${courtCase.description}`);
  const assignments = courtCase.assignments || [];
  const remoteAssignments = assignments.filter((a) => a.remote);
  const inRoom = assignments.filter((a) => !a.remote);
  if (assignments.length) {
    lines.push('Courtroom roles — these are fixed for this proceeding and must not change:');
    assignments.forEach((a) => {
      const temp = a.temporary ? ' (a person of this court, not a member of the household)' : '';
      lines.push(a.remote
        ? `• ${a.roleLabel}: ${a.name}${temp} — taking part REMOTELY from ${a.remote_location_name || 'their own location'}. Not in the courtroom.`
        : `• ${a.roleLabel}: ${a.name}${temp}`);
    });
    lines.push('Each person knows their own role and why they are here: a defendant knows they are the defendant, a witness knows they were called to testify, a juror knows they sit on the jury, a judge knows they are presiding, an attorney knows which party they represent.');
    lines.push('Attendance is settled — it never has to be established again in this scene.');
  }
  if (inRoom.length) {
    lines.push('');
    lines.push('WHERE THEY ARE RIGHT NOW (authoritative):');
    lines.push(`• ${inRoom.map((a) => a.name).join(', ')} ${inRoom.length === 1 ? 'is' : 'are'} physically at ${venue}, in the courtroom. They are NOT at work, at school, at home, in a hospital room or in a cell while this proceeding is running.`);
    lines.push('• Their employment, enrollment, household, treatment and any custody remain exactly as they were. Attending court never deletes, rewrites, suspends or restarts a shift or a class: a person who came from a shift may return to that same shift afterwards.');
  }
  if (remoteAssignments.length) {
    lines.push('');
    lines.push('REMOTE PARTICIPATION (authoritative):');
    remoteAssignments.forEach((a) => {
      lines.push(`• ${a.name} (${a.roleLabel}) is at ${a.remote_location_name || 'their own location'} and takes part by remote link. They are never described as standing in the courtroom, and their treatment, custody and sentence are unchanged by taking part.`);
    });
    lines.push('• A remote participant hears and is heard in the room, but is never in a picture of the room and is never placed in two places at once.');
  }
  lines.push('');
  lines.push(`• ${userPresent ? `${userName || 'The user'} is present in the courtroom, attending this proceeding.` : `${userName || 'The user'} is NOT in the courtroom — this is being watched, not attended. Never place them in the room.`}`);
  // ── JUDICIAL DIRECTION ──
  // The judge leads through ordinary dialogue, and that dialogue is what the existing
  // Continue Scene / narrative continuation reads. This is procedural direction handed
  // to the established narrative engine — never a scripted sequence, a mandatory step
  // list, or a second trial engine.
  const judge = assignments.find((a) => a.roleKey === 'judge');
  const hasJury = assignments.some((a) => a.roleKey === 'jurors');
  const hasAttorneys = assignments.some((a) => ['prosecutor', 'defense_attorney', 'plaintiff_attorney'].includes(a.roleKey));
  const hasWitnesses = assignments.some((a) => a.roleKey === 'witnesses');
  if (judge) {
    lines.push('');
    lines.push('JUDICIAL DIRECTION — THE JUDGE LEADS:');
    lines.push(`• ${judge.name} presides over this ${courtCaseTypeLabel(courtCase.case_type).toLowerCase()}. When the scene continues without a specific instruction from the user, ${judge.name} speaks first and gives the next natural direction for where this proceeding actually stands.`);
    lines.push('• A direction is answered by the person it is addressed to: the prosecution by the prosecuting attorney, the defense by the defense attorney, the plaintiff\'s side by the plaintiff\'s attorney, a witness by that witness, the defendant by the defendant themselves, the jury by an assigned juror.');
    lines.push('• Directions are plain and concrete, so the next stage is clear: "Counsel for the prosecution, you may present your opening statement." "Call your next witness." "Does the defense wish to cross-examine?" "Members of the jury, have you reached a verdict?"');
    lines.push('• In one beat, the judge\'s direction and the answer of the person addressed are enough. Everyone else present listens and reacts without speaking unless they are directly addressed.');
    lines.push('• Only the judge calls the court to order, rules on objections and procedure, instructs the jury, and pronounces sentence. An attorney never rules or sentences; a defendant never rules.');
    lines.push('• Every continuation continues this same proceeding from what has just happened — the last direction, who was addressed, what each person already said, which witnesses already testified, what evidence is already in. Never restart the case, never repeat an opening already given, never jump to an unrelated stage.');
    if (hasJury) {
      lines.push('• A jury is seated. Deliberations and findings belong to those jurors alone: the judge asks whether they have reached a verdict and receives their findings, and never invents a verdict for them.');
    } else {
      lines.push('• No jury is seated in this proceeding. The judge hears the case and decides the findings. Never invent jurors, jury deliberations or a jury verdict, and never ask for one.');
    }
    if (!hasAttorneys) lines.push('• No attorney is assigned. The judge and the parties themselves conduct the matter directly.');
    if (!hasWitnesses) lines.push('• No witness has been called. Testimony only enters the case if someone is actually called and speaks.');
    if (courtCase.case_type === 'sentencing') {
      lines.push('• This is a sentencing hearing: statements and recommendations are heard, then the judge pronounces sentence. It is not a trial and does not restart the case.');
    } else if (courtCase.case_type === 'civil' || courtCase.case_type === 'family') {
      lines.push('• This is a civil matter: arguments and evidence are heard and the judge issues the ruling. Criminal trial stages and sentencing do not apply.');
    } else if (courtCase.case_type === 'criminal' || courtCase.case_type === 'municipal') {
      lines.push('• This is a criminal matter: the judge directs openings, evidence, witnesses, objections and the findings, in whatever order this case actually needs.');
    }
    lines.push('• The courtroom activities (present evidence, call a witness, cross-examine, object, request a ruling, deliver findings, sentence, adjourn) stay available to the user. Choosing one continues this same proceeding — it never replaces or contradicts the judge\'s direction.');
  }
  lines.push('');
  lines.push('WHO HAS THE FLOOR — EXAMINATION ORDER:');
  lines.push('• Examination follows the courtroom order: an attorney calls a witness and asks, that witness answers, the opposing attorney may cross-examine, the calling attorney may redirect, and the judge excuses the witness. One witness testifies at a time.');
  lines.push('• While a witness is answering, that witness is the only person who answers. Other witnesses, jurors, spectators and the defendant never answer on their behalf and never add their own account of the same events.');
  lines.push('• An objection stops the answer: the witness waits, the judge rules — sustained (the question or answer is excluded, and the attorney rephrases or moves on) or overruled (the examination continues) — and only then does the exchange resume. A sustained objection is never followed by an answer to the challenged question.');
  lines.push('• Attorneys object only when there is a real procedural ground — leading, hearsay, relevance, speculation, lack of foundation, asked and answered, argumentative, compound. Not every question is objected to, and not every objection is sustained.');
  lines.push('• Opening statements and closing arguments are not evidence. An allegation made by an attorney establishes nothing by itself, and only what is actually admitted or testified to belongs in the case.');
  lines.push('');
  lines.push('DISRUPTION, CONTEMPT AND PERJURY:');
  lines.push('• People may still speak out of turn — a defendant reacting to testimony, a spectator calling out, a witness turning argumentative. That is an interruption, not permission for everyone present to join in: the judge restores order and the proceeding resumes with whoever actually had the floor.');
  lines.push('• A contempt warning is not a conviction and creates no charge, custody or record. Inconsistent, uncertain or mistaken testimony is not perjury, and one attorney calling a witness a liar proves nothing by itself.');
  lines.push('');
  lines.push('PRESENCE IS NOT SPEAKING:');
  lines.push('• A juror listens to testimony, a witness waits to be called, a defendant may stay silent while an attorney speaks, and the judge may simply listen. That is full participation.');
  lines.push('• Never have everyone present speak at once, and never treat someone who has not spoken as absent from the room.');
  lines.push('');
  lines.push('RULES:');
  lines.push('• Everyone keeps the role listed above for the whole proceeding. A witness never becomes the prosecutor; a juror never becomes the judge; the judge stays the judge.');
  lines.push('• Speak about the actual case described above. Never substitute a different trial, charge, or dispute.');
  lines.push('• This is one continuing proceeding. Every continuation builds on what has already happened in this room — it never restarts the case, never repeats its opening, and never drifts into a different case.');
  lines.push('• Testimony comes only from what a person actually knows: their own memories and lived experience. Someone who did not witness an event does not gain firsthand knowledge by being called as a witness. Accounts may be incomplete, mistaken or in conflict, and are shown that way.');
  lines.push('• The case description is the court\'s framing of the matter, not personal knowledge. Nobody acquires private facts from it: the judge and attorneys understand the procedure, not another person\'s secrets, and jurors weigh only what is presented in the room.');
  lines.push('• Starting or attending a case decides nothing. Only the explicitly selected Sentencing action produces a sentence, and only after the user confirms it.');
  lines.push('• An acquittal, dismissal, adjournment, civil ruling or settlement is a valid outcome and never becomes a conviction.');
  lines.push('• Sentencing, contempt and custody are consequences of the case, not of anyone being present in the building.');
  lines.push('════════════════════════════════════');
  return lines.join('\n');
}

/** City Hall as the narrative must see it: why these people are here. */
export function buildCityHallContext(plan, { userPresent = true, userName = null } = {}) {
  if (!plan) return '';
  const purpose = cityHallPurposeLabel(plan.purpose);
  const lines = [];
  lines.push('════════════════════════════════════');
  lines.push('CITY HALL — PURPOSE OF THIS VISIT (AUTHORITATIVE)');
  lines.push('════════════════════════════════════');
  lines.push(`Purpose: ${purpose || 'General visit'}`);
  if (plan.purpose === 'civil_marriage' && plan.marriage?.spouse_a_name && plan.marriage?.spouse_b_name) {
    lines.push(`Civil marriage ceremony for ${plan.marriage.spouse_a_name} and ${plan.marriage.spouse_b_name}.`);
    if (plan.marriage.witness_names?.length) lines.push(`Witnesses: ${plan.marriage.witness_names.join(', ')}.`);
    if (plan.officiant_npc) lines.push(`Officiant: ${plan.officiant_npc.name}, conducting the ceremony for City Hall.`);
    lines.push('The couple, the witnesses and the officiant are all physically present in the room right now. They do not all speak at once.');
    lines.push('The ceremony is the event of this visit. Nothing about being in the building marries anyone by itself — the ceremony must actually take place.');
  }
  lines.push(`• ${userPresent ? `${userName || 'The user'} is present at City Hall.` : `${userName || 'The user'} is NOT present — this is being watched, not attended. Never place them in the building.`}`);
  lines.push('• Marriage is not exclusive to City Hall: it is one activity here, and a general visit is a complete visit on its own.');
  lines.push('════════════════════════════════════');
  return lines.join('\n');
}