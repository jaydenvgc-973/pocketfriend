/**
 * jailSceneRules.js — PRISON / JAIL SCENE RULES
 *
 * One place for the rules that apply to a prison or jail scene:
 *   - whether a location is a confinement facility
 *   - whether a person is incarcerated there
 *   - who may be offered as a selectable participant in a given zone
 *   - what each person is required to wear (inmate / officer / nurse / doctor /
 *     social worker / visitor) and the facility-wide attire + population rules
 *
 * Read-only helpers. They never write to a record and never change presence,
 * employment, or uniform configuration — they only describe what already exists.
 */
import { resolveUniform } from './uniformResolver.js';

// Standard attire used when the facility has no matching uniform configured.
// A confined person is never rendered in their own clothes, and staff are never
// rendered in regular clothing.
export const DEFAULT_INMATE_UNIFORM = 'facility-issued prison uniform — plain institutional jumpsuit or matching scrub-style shirt and trousers in a muted neutral color, worn and plain, no lettering, no logos, no prints';
export const DEFAULT_CORRECTIONAL_UNIFORM = 'police-style correctional officer uniform — dark navy duty shirt and trousers with a duty belt, plain without lettering';
export const DEFAULT_NURSE_UNIFORM = 'nurse uniform — plain clinical scrubs in a solid muted color, professional, no lettering';
export const DEFAULT_DOCTOR_UNIFORM = 'doctor uniform — white physician coat over a plain clinical shirt, professional, no lettering';

export function isJailOrPrison(location) {
  if (!location) return false;
  return location.category === 'jail_prison' || location.is_confinement_facility === true;
}

/** A person listed on this facility's inmate roster and not released. */
function isListedInmate(location, characterId) {
  if (!Array.isArray(location?.inmates) || !characterId) return false;
  const entry = location.inmates.find((item) => (typeof item === 'string' ? item === characterId : item?.character_id === characterId));
  if (!entry) return false;
  if (typeof entry === 'string') return true;
  // A released person stays on the roster as a record of their stay, but they are no
  // longer incarcerated: they may visit this facility like anyone else.
  return entry.confinement_status !== 'released';
}

/** Is this person currently incarcerated / confined (anywhere)? */
export function isIncarceratedCharacter(person, location = null) {
  if (!person) return false;
  if (person.is_jailed === true) return true;
  // A background person of this facility has no character record and no jail flag of its
  // own: their role at this place is what they are. An inmate is an inmate.
  if (person.isNpc === true && /inmate|prisoner|detainee/i.test(String(person.role || ''))) return true;
  const status = person.resolved_presence_status;
  if (status === 'incarcerated' || status === 'confined' || status === 'house_arrest') return true;
  if (location && isListedInmate(location, person.id)) return true;
  return false;
}

/** Entrance and Exterior are the outside of the facility — the prison population is not there. */
export function isJailEntranceOrExteriorZone(zoneName) {
  const zone = String(zoneName || '').toLowerCase();
  return zone.includes('entrance') || zone.includes('exterior');
}

/**
 * May this person be offered as a selectable participant in this zone?
 * Incarcerated characters are never offered for a prison/jail Entrance or Exterior.
 */
export function isSelectableParticipantAtZone(person, location, zoneName) {
  if (!person) return false;
  if (!isJailOrPrison(location)) return true;
  if (!isJailEntranceOrExteriorZone(zoneName)) return true;
  return !isIncarceratedCharacter(person, location);
}

/**
 * A job belongs to ONE place. Only someone actually employed by this facility holds a
 * staff role here — a nurse, officer or doctor who works somewhere else and is inside
 * this building is a visitor, and keeps their own clothes and their own reason for being here.
 */
function employedAtFacility(person, location) {
  if (!person?.id || !location) return false;
  // The facility's own per-person records: a job title or a shift defined HERE.
  if (location.worker_job_titles?.[person.id]) return true;
  if (location.worker_shifts?.[person.id]) return true;
  // Their OWN employment record must point at this facility. The location's worker
  // roster array alone never makes someone staff — it can list people whose actual job
  // is elsewhere, and those people are visitors here.
  if (person.occupation_location_id === location.id) return true;
  if (person.current_work_location_id === location.id) return true;
  if ((person.additional_occupation_locations || []).some((a) => a?.location_id === location.id)) return true;
  return false;
}

function facilityJobTitle(person, location) {
  if (!person) return '';
  const fromLocation = location?.worker_job_titles?.[person.id];
  if (fromLocation) return String(fromLocation).toLowerCase().trim();
  // A background person of this place holds no job anywhere else: the role they are here
  // IS the role they hold here (a facility nurse is the nurse, not a civilian visitor).
  if (person.isNpc === true && person.role) return String(person.role).toLowerCase().trim();
  if (!employedAtFacility(person, location)) return '';
  const fromRole = person.role && person.role !== 'Visitor' && person.role !== 'Here now' ? person.role : null;
  if (fromRole) return String(fromRole).toLowerCase().trim();
  if (person.work_details?.job_title) return String(person.work_details.job_title).toLowerCase().trim();
  if (person.occupation) return String(person.occupation).toLowerCase().trim();
  return '';
}

/**
 * The facility role a person holds at this prison/jail.
 * Returns: 'inmate' | 'correctional_officer' | 'nurse' | 'doctor' | 'social_worker' | 'civilian'
 */
export function resolveFacilityRole(person, location) {
  if (!person || !isJailOrPrison(location)) return null;
  if (isIncarceratedCharacter(person, location)) return 'inmate';

  const title = facilityJobTitle(person, location);
  if (!title) return 'civilian';

  if (/(doctor|physician|surgeon|psychiatrist)/.test(title)) return 'doctor';
  if (/(nurse|nursing|medic|medical|clinician|paramedic)/.test(title)) return 'nurse';
  if (/(correction|corrections officer|guard|officer|sergeant|lieutenant|captain|warden|deputy|bailiff)/.test(title)) return 'correctional_officer';
  if (/(social worker|case worker|case manager|counselor|counsellor|chaplain|therapist)/.test(title)) return 'social_worker';
  return 'civilian';
}

/**
 * The clothing a person must wear in this facility.
 * A uniform configured on the location wins; otherwise the role's standard
 * attire is used. Social workers and other civilians keep regular clothes.
 */
export function resolveFacilityAttire(person, location) {
  const role = resolveFacilityRole(person, location);
  if (!role) return null;

  if (role === 'social_worker' || role === 'civilian') {
    return { role, description: null };
  }

  // A uniform configured on this facility (job title, role/status, or location-wide)
  // is the authority when it exists.
  const characterRecord = person.id ? person : null;
  if (characterRecord) {
    const configured = resolveUniform(characterRecord, location);
    const configuredText = configured?.uniform?.description || configured?.uniform?.name || null;
    if (configuredText) return { role, description: configuredText };
  }

  const fallback = {
    inmate: DEFAULT_INMATE_UNIFORM,
    correctional_officer: DEFAULT_CORRECTIONAL_UNIFORM,
    nurse: DEFAULT_NURSE_UNIFORM,
    doctor: DEFAULT_DOCTOR_UNIFORM,
  }[role] || null;

  return { role, description: fallback };
}

/**
 * Facility-wide attire and population rules, plus the required attire for each
 * named person in the frame. Empty string at any non-facility location.
 */
export function buildJailAttireBlock(participants, location, { shower = false } = {}) {
  if (!isJailOrPrison(location)) return '';

  // A shower is the one place the facility uniform is not worn. Everyone under the water
  // is unclothed, so no uniform is ever drawn onto them, and a guard stays outside the
  // shower row rather than standing in a stall.
  if (shower) {
    return `

FACILITY ATTIRE — SHOWER (prison / jail):
- Everyone in the shower is unclothed: NO uniform, NO clothing, NO towel. The facility uniform does not appear on anyone under the water.
- A correctional officer or staff member stays outside the shower row, in uniform, and is never placed inside a shower stall.
- Visitors keep ordinary clothing and are never in the shower.
- NO TEXT, LETTERING, NUMBERS, OR LOGOS anywhere in the frame.
- Do not reproduce the exact face of any real person from a reference photo; faces come only from the supplied character references.`;
  }

  const peopleLines = [];
  for (const person of participants || []) {
    if (!person || !person.name) continue;
    const attire = resolveFacilityAttire(person, location);
    if (!attire?.description) continue;
    peopleLines.push(`  • ${person.name}: ${attire.description}.`);
  }

  return `

FACILITY ATTIRE — MANDATORY (prison / jail):
- Incarcerated people wear ONLY the facility-issued prison uniform. Never regular clothes, never a personal outfit, never clothing from their own closet.
- Correctional officers and guards wear a uniform — the facility's assigned one, or a police-style correctional uniform. Never regular clothes.
- Nurses and medical staff wear a nurse uniform. Doctors wear a doctor uniform. Never regular clothes.
- Social workers and civilian staff may wear regular clothes.
- Anyone else present is a visitor or civilian and keeps ordinary clothing.
- A visitor is NEVER depicted as an inmate: no prison uniform, no cell, no restraint, no escort, no inmate posture. They stand as someone who came to visit and can walk out on their own.
${peopleLines.length > 0 ? `${peopleLines.join('\n')}\n` : ''}- NO TEXT, LETTERING, NUMBERS, OR LOGOS on any clothing, uniform, patch, badge, or sign anywhere in the frame.
- The prisoner population is visibly diverse: Black, Middle Eastern, Asian, Latino, and white people are all present.
- Do not reproduce the exact face of any real person from a reference photo; faces come only from the supplied character references.`;
}