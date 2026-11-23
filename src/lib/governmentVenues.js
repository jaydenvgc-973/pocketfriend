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

const normalize = (v) => String(v || '').toLowerCase().replace(/[\s\-&]+/g, '_').replace(/_+/g, '_');

/** 'courthouse' | 'city_hall' | null — from the venue's own subtype, identity or name. */
export function getGovernmentVenueType(location) {
  if (!location) return null;
  const subtypes = (Array.isArray(location.subtype) ? location.subtype : [location.subtype])
    .filter(Boolean)
    .map(normalize);
  if (subtypes.includes('courthouse')) return 'courthouse';
  if (subtypes.includes('city_hall')) return 'city_hall';

  const identity = String(location.venue_identity || '').toLowerCase();
  const name = String(location.name || '').toLowerCase();
  const haystack = `${identity} ${name}`;
  if (haystack.includes('courthouse') || haystack.includes('court house')) return 'courthouse';
  if (haystack.includes('city hall') || haystack.includes('cityhall')) return 'city_hall';
  return null;
}

/** Actions whose selection opens a setup or confirmation flow instead of a plain scene line. */
export const GOVERNMENT_ACTION_IDS = ['gov_marry', 'gov_sentence', 'gov_contempt'];
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
const COURT_ROLES = [
  { key: 'judge', label: 'Judge', necessary: true, multiple: false },
  { key: 'defendant', label: 'Defendant', necessary: true, multiple: false },
  { key: 'plaintiff', label: 'Plaintiff / Complainant', necessary: false, multiple: false, caseTypes: ['civil', 'family', 'municipal', 'other'] },
  { key: 'prosecutor', label: 'Prosecuting Attorney', necessary: false, multiple: false, caseTypes: ['criminal', 'municipal', 'sentencing'] },
  { key: 'defense_attorney', label: 'Defense Attorney', necessary: false, multiple: false, caseTypes: ['criminal', 'civil', 'family', 'municipal', 'sentencing', 'other'] },
  { key: 'plaintiff_attorney', label: "Plaintiff's Attorney", necessary: false, multiple: false, caseTypes: ['civil', 'family'] },
  { key: 'witnesses', label: 'Witnesses', necessary: false, multiple: true, optional: true },
  { key: 'jurors', label: 'Jurors', necessary: false, multiple: true, optional: true },
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
export function resolveCourtParticipants(courtCase, characters = [], { attendingIds = null } = {}) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const allowed = attendingIds ? new Set(attendingIds) : null;
  const canAttend = (id) => !!id && (!allowed || allowed.has(id));
  const roles = courtCase?.roles || {};
  const caseType = courtCase?.case_type || 'other';
  const necessary = necessaryRolesFor(caseType);
  const assignments = [];
  const tempNpcs = [];

  for (const def of COURT_ROLES) {
    const value = roles[def.key];
    if (def.multiple) {
      const ids = Array.isArray(value) ? value.filter(Boolean) : [];
      ids.forEach((id) => {
        const c = byId.get(id);
        if (c && canAttend(id)) assignments.push({ roleKey: def.key, roleLabel: def.label, characterId: id, name: c.name });
      });
      continue;
    }
    if (value && byId.get(value) && canAttend(value)) {
      assignments.push({ roleKey: def.key, roleLabel: def.label, characterId: value, name: byId.get(value).name });
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
export function buildCourtCaseContext(courtCase, { userPresent = true, userName = null } = {}) {
  if (!courtCase) return '';
  const lines = [];
  lines.push('════════════════════════════════════');
  lines.push('COURT PROCEEDING — ESTABLISHED CASE (AUTHORITATIVE)');
  lines.push('════════════════════════════════════');
  lines.push(`Case type: ${courtCaseTypeLabel(courtCase.case_type)}`);
  if (courtCase.description) lines.push(`The case is about: ${courtCase.description}`);
  if (courtCase.assignments?.length) {
    lines.push('Courtroom roles — these are fixed for this proceeding and must not change:');
    courtCase.assignments.forEach((a) => {
      lines.push(`• ${a.roleLabel}: ${a.name}${a.temporary ? ' (a person of this court, not a member of the household)' : ''}`);
    });
    lines.push('Everyone listed above is physically in the courtroom right now, in the role shown. Attendance is settled — it never has to be established again in this scene.');
  }
  lines.push(`• ${userPresent ? `${userName || 'The user'} is present in the courtroom, attending this proceeding.` : `${userName || 'The user'} is NOT in the courtroom — this is being watched, not attended. Never place them in the room.`}`);
  lines.push('');
  lines.push('PRESENCE IS NOT SPEAKING:');
  lines.push('• A juror listens to testimony, a witness waits to be called, a defendant may stay silent while an attorney speaks, and the judge may simply listen. That is full participation.');
  lines.push('• Never have everyone present speak at once, and never treat someone who has not spoken as absent from the room.');
  lines.push('');
  lines.push('RULES:');
  lines.push('• Everyone keeps the role listed above for the whole proceeding. A witness never becomes the prosecutor; a juror never becomes the judge; the judge stays the judge.');
  lines.push('• Speak about the actual case described above. Never substitute a different trial, charge, or dispute.');
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