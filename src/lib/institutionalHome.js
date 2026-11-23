/**
 * institutionalHome.js — INSTITUTIONAL HOME
 *
 * A character whose HOME is an institution IS that institution's person:
 *
 *   HOME = jail / prison        → inmate
 *   HOME = hospital             → patient
 *   HOME = residential school   → student
 *
 * The authoritative HOME assignment is what establishes it. No criminal history, medical
 * record, enrollment or declared major is required first, and nothing here fabricates one.
 *
 * This module owns no new status system. It reads the existing location record and returns
 * the SAME canonical fields the rest of Pocketfriend already uses:
 *   inmate  → is_jailed, incarceration_*, resolved_* (incarcerated)
 *   patient → resolved_presence_status 'hospitalized', resolved_* (medical)
 *   student → student_status, current_school_location_id / education_location_id
 *
 * Leaving the institution (a legitimate change of HOME) ends the derived state again.
 */

// The school types that never house residents. A school of any other type can.
export const NON_RESIDENTIAL_SCHOOL_TYPES = [
  'daycare_preschool', 'elementary_school', 'high_school', 'private_school',
  'language_school', 'music_school', 'online_school',
];

const HOME_DERIVED_JAIL = 'institutional_home';
const HOME_DERIVED_PATIENT = 'institutional_home_patient';

/** A jail or prison — the same test the confinement systems use. */
export function isCorrectionalLocation(location) {
  if (!location) return false;
  return location.category === 'jail_prison' || location.is_confinement_facility === true;
}

/** A hospital or clinic that holds patients. */
export function isHospitalLocation(location) {
  if (!location) return false;
  if (location.generic_type === 'hospital') return true;
  const subtypes = Array.isArray(location.subtype) ? location.subtype : [location.subtype].filter(Boolean);
  if (subtypes.some((s) => /hospital|clinic|medical_center/i.test(String(s)))) return true;
  return location.category === 'medical';
}

/** A school with residential facilities (dorms, campus apartments). */
export function isResidentialSchoolLocation(location) {
  if (!location) return false;
  if (!['school', 'education'].includes(location.category)) return false;
  if (location.school_type && NON_RESIDENTIAL_SCHOOL_TYPES.includes(location.school_type)) return false;
  const subtypes = Array.isArray(location.subtype) ? location.subtype : [location.subtype].filter(Boolean);
  const residentialSubtype = subtypes.some((s) =>
    /university|college|boarding|trade_school|residential/i.test(String(s)));
  const hasHousing = (location.residential_units || []).length > 0
    || (location.resident_character_ids || []).length > 0;
  return residentialSubtype || hasHousing;
}

/** 'inmate' | 'patient' | 'student' | null — what this HOME location makes its resident. */
export function institutionalKindOfLocation(location) {
  if (!location) return null;
  if (isCorrectionalLocation(location)) return 'inmate';
  if (isHospitalLocation(location)) return 'patient';
  if (isResidentialSchoolLocation(location)) return 'student';
  return null;
}

const STATUS_LABEL = { inmate: 'Inmate', patient: 'Patient', student: 'Student' };

/**
 * The character's institutional standing, read from their authoritative HOME assignment
 * and, as a fallback, from the circumstance fields already on their record. A character
 * sentenced away from home keeps their standing even before HOME is updated.
 */
export function resolveInstitutionalStatus(character, homeLocation) {
  if (!character) return { kind: null, label: null, isInmate: false, isPatient: false, isStudent: false };
  const kind = institutionalKindOfLocation(homeLocation);

  const isInmate = character.is_jailed === true
    || ['incarcerated', 'confined'].includes(character.resolved_presence_status)
    || kind === 'inmate';
  const isPatient = character.resolved_presence_status === 'hospitalized' || kind === 'patient';
  const isStudent = (character.student_status && character.student_status !== 'not_student')
    || kind === 'student';

  const resolvedKind = isInmate ? 'inmate' : isPatient ? 'patient' : isStudent ? 'student' : null;
  return {
    kind: resolvedKind,
    label: resolvedKind ? STATUS_LABEL[resolvedKind] : null,
    isInmate,
    isPatient,
    isStudent,
  };
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * The canonical fields that keep the character's status aligned with their HOME.
 * Returns an empty object when nothing needs to change, so callers can write it
 * unconditionally alongside the HOME assignment.
 *
 * Court-sentenced custody (source reason 'judicial_sentence') is never cleared here:
 * that sentence ends through the existing release pipeline, not by editing HOME.
 */
export function institutionalHomeSyncFields(character, homeLocation) {
  if (!character) return {};
  const kind = institutionalKindOfLocation(homeLocation);
  const fields = {};
  const sameHome = homeLocation?.id && character.current_home_location_id === homeLocation.id;

  if (kind === 'inmate') {
    if (!(character.is_jailed === true && character.incarceration_facility_id === homeLocation.id)) {
      Object.assign(fields, {
        is_jailed: true,
        incarceration_facility_id: homeLocation.id,
        incarceration_facility_name: homeLocation.name,
        incarceration_status: character.incarceration_status && character.incarceration_status !== 'released'
          ? character.incarceration_status
          : 'serving',
        jailed_at: character.jailed_at || nowISO(),
        house_arrest_active: false,
        house_arrest_location_id: null,
        house_arrest_end_date: null,
        resolved_current_location_id: homeLocation.id,
        resolved_current_location_name: homeLocation.name,
        resolved_location_type: 'incarcerated',
        resolved_presence_status: 'incarcerated',
        resolved_source_reason: HOME_DERIVED_JAIL,
        resolved_last_updated_at: nowISO(),
      });
    }
    return fields;
  }

  if (kind === 'patient') {
    const alreadyThere = character.resolved_presence_status === 'hospitalized'
      && character.resolved_current_location_id === homeLocation.id;
    if (!alreadyThere) {
      Object.assign(fields, {
        resolved_current_location_id: homeLocation.id,
        resolved_current_location_name: homeLocation.name,
        resolved_location_type: 'medical',
        resolved_presence_status: 'hospitalized',
        resolved_source_reason: HOME_DERIVED_PATIENT,
        resolved_last_updated_at: nowISO(),
      });
    }
    // A hospital HOME is not custody — only a HOME-derived jail state is ended here.
    if (character.is_jailed === true && character.resolved_source_reason === HOME_DERIVED_JAIL) {
      Object.assign(fields, { is_jailed: false, incarceration_facility_id: null, incarceration_status: 'released' });
    }
    return fields;
  }

  if (kind === 'student') {
    if (!character.student_status || character.student_status === 'not_student') {
      fields.student_status = 'enrolled';
    }
    if (!character.current_school_location_id) fields.current_school_location_id = homeLocation.id;
    if (!character.education_location_id) fields.education_location_id = homeLocation.id;
    if (character.is_jailed === true && character.resolved_source_reason === HOME_DERIVED_JAIL) {
      Object.assign(fields, { is_jailed: false, incarceration_facility_id: null, incarceration_status: 'released' });
    }
    return fields;
  }

  // An ordinary home. Only a state that HOME itself established is ended by leaving it.
  if (sameHome) return {};
  if (character.resolved_source_reason === HOME_DERIVED_JAIL) {
    Object.assign(fields, {
      is_jailed: false,
      incarceration_facility_id: null,
      incarceration_status: 'released',
      resolved_current_location_id: homeLocation?.id || null,
      resolved_current_location_name: homeLocation?.name || null,
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'institutional_home_released',
      resolved_last_updated_at: nowISO(),
    });
  } else if (character.resolved_source_reason === HOME_DERIVED_PATIENT) {
    Object.assign(fields, {
      resolved_current_location_id: homeLocation?.id || null,
      resolved_current_location_name: homeLocation?.name || null,
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'institutional_home_released',
      resolved_last_updated_at: nowISO(),
    });
  }
  return fields;
}