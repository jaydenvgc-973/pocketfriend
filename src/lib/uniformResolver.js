/**
 * UNIFORM RESOLVER
 *
 * Resolves which Location-owned uniform applies to a character at a specific location.
 * Uniforms are TEMPORARY context outfits — they never permanently replace closet,
 * rotation, or currently-wearing state.
 *
 * RULES:
 * - Each applicability type is evaluated on its own evidence (no visitor gate)
 * - Location owns the uniform requirement; character's actual data determines fit
 * - Multi-job isolation: only the current Location's employment data is used
 * - location_wide is reachable without a preceding role/job gate
 * - generic_staff applies when the character is established as staff at this Location
 *   even without a specific job-title string
 * - Hospitalized patients are not blocked as visitors when the hospital Location
 *   defines patient clothing (role_status match)
 */

import { isCharacterAtWork } from './workScheduleUtils.js';

// A uniform's own identity decides how it is described when it carries no written
// description. A location that assigns a "Doctor" uniform but leaves the description
// empty must still dress the doctor — the uniform's name is not clothing text.
export const ROLE_ATTIRE = {
  doctor: 'white physician coat over clinical scrubs — professional on-duty doctor attire, no lettering, no logos',
  nurse: 'clinical scrubs in a solid muted color — professional on-duty nurse attire, no lettering, no logos',
};
const DOCTOR_ROLE = /(doctor|physician|surgeon|psychiatr|dentist|radiolog|cardiolog|oncolog|pediatric|obstetric|gynecolog|patholog|neurolog|internist|anesthesiolog)/;
const NURSE_ROLE = /(nurse|nursing|clinician)/;

export function roleFromText(text) {
  const t = String(text || '').toLowerCase();
  if (DOCTOR_ROLE.test(t)) return 'doctor';
  if (NURSE_ROLE.test(t)) return 'nurse';
  return null;
}

/**
 * Is the character actually working at this location right now? Eastern Time is the
 * only time reference — UTC is infrastructure metadata and never decides a shift.
 */
function isOnShiftAt(character, location) {
  const presence = character?.resolved_presence_status || character?.location_status || '';
  const workId = character?.current_work_location_id || character?.occupation_location_id || null;
  if (presence === 'at_work' && (!workId || workId === location?.id)) return true;
  const activity = (character?.current_activity || '').toLowerCase();
  if (/\b(on shift|on duty|working|seeing patients|rounds|surgery|clinic hours)\b/.test(activity)) return true;
  return isCharacterAtWork(character, location);
}

/** The clinical role this character actually holds at this medical facility. */
function medicalRoleAt(character, location) {
  const charId = character?.id;
  const isStaffHere = location?.worker_character_ids?.includes(charId)
    || character?.occupation_location_id === location?.id
    || (character?.additional_occupation_locations || []).some(l => (l.location_id || l.id) === location?.id);
  if (!isStaffHere) return null;
  const title = location?.worker_job_titles?.[charId]
    || (character?.occupation_location_id === location?.id ? character?.work_details?.job_title : null)
    || (character?.additional_occupation_locations || []).find(l => (l.location_id || l.id) === location?.id)?.job_title
    || character?.occupation
    || '';
  return roleFromText(title);
}

// ── CONFINEMENT ATTIRE ────────────────────────────────────────────────────────
// A prison or jail always dresses the people held in it in prison attire. This is not a
// location setting that may be left blank: a facility with no uniforms saved still has
// inmates, and an inmate in their own clothes is wrong. Staff on shift keep their own
// uniform, and visitors keep theirs.
export const DEFAULT_INMATE_UNIFORM = 'facility-issued prison uniform — plain institutional jumpsuit or matching scrub-style shirt and trousers in a muted neutral color, worn and plain, no lettering, no logos, no prints';
export const DEFAULT_CORRECTIONAL_UNIFORM = 'police-style correctional officer uniform — dark navy duty shirt and trousers with a duty belt, plain without lettering';
export const DEFAULT_NURSE_UNIFORM = 'nurse uniform — plain clinical scrubs in a solid muted color, professional, no lettering';
export const DEFAULT_DOCTOR_UNIFORM = 'doctor uniform — white physician coat over a plain clinical shirt, professional, no lettering';

function isConfinementFacility(location) {
  return location?.is_confinement_facility === true || (location?.category || '') === 'jail_prison';
}

/** Is this person held in this facility? Their own records decide — never a guess. */
function isConfinedAt(character, location) {
  const id = character?.id;
  if (!id || !location?.id) return false;
  if (isInLocationArray(location.inmates, id)) return true;
  const presence = character.resolved_presence_status || '';
  const atThisFacility = character.resolved_current_location_id === location.id
    || character.incarceration_facility_id === location.id;
  if (character.is_jailed === true && atThisFacility) return true;
  if ((presence === 'incarcerated' || presence === 'confined') && atThisFacility) return true;
  // A prison that is this person's own home is their confinement, not an address. A
  // worker who lives on site is staff, not an inmate.
  if (character.current_home_location_id === location.id
      && !(location.worker_character_ids || []).includes(id)) return true;
  return false;
}

/** The prison attire a confined person wears at this facility, or null. */
function confinementAttire(character, location) {
  if (!isConfinementFacility(location) || !isConfinedAt(character, location)) return null;
  const attire = location.correctional_attire || {};
  const written = String(attire.uniform_description || '').trim();
  const color = String(attire.uniform_color || '').trim();
  const description = written
    ? (color && !written.toLowerCase().includes(color.toLowerCase()) ? `${written} in ${color}` : written)
    : DEFAULT_INMATE_UNIFORM;
  return {
    uniform: {
      name: 'Inmate uniform',
      description,
      image_url: attire.uniform_image_url || undefined,
      applicability: 'role_status',
      role_status: 'inmates',
    },
    applicability: 'role_status',
    reason: 'confined_inmate',
    source: 'confinement_default',
  };
}

// ── PATIENT ATTIRE ────────────────────────────────────────────────────────────
// A hospital dresses the people admitted to it. Like confinement attire, this is not a
// setting that may be left blank: a hospital with no uniforms saved still has patients,
// and a patient in their own street clothes is wrong. On-shift clinical staff keep their
// role attire, and visitors keep their own.
export const DEFAULT_PATIENT_GOWN = 'hospital patient gown — loose short-sleeved hospital gown in a pale washed blue, open at the back with ties, worn plainly with no lettering, no logos, no prints';

/** Is this person admitted to this medical facility? Their own records decide. */
function isPatientAt(character, location) {
  if ((location?.category || '') !== 'medical') return false;
  const presence = character?.resolved_presence_status || '';
  if (presence !== 'hospitalized') return false;
  // A record without a resolved location id is treated as being at the facility it is
  // being resolved against — a legacy record is never left undressed for missing a field.
  return !character?.resolved_current_location_id || character.resolved_current_location_id === location.id;
}

/** The gown a patient wears here when the facility never configured patient attire. */
function patientGownAttire(character, location) {
  if (!isPatientAt(character, location)) return null;
  return {
    uniform: {
      name: 'Patient gown',
      description: DEFAULT_PATIENT_GOWN,
      applicability: 'role_status',
      role_status: 'hospitalized',
    },
    applicability: 'role_status',
    reason: 'hospitalized_patient',
    source: 'medical_patient_default',
  };
}

/**
 * Check whether a character is a member of a Location array.
 * Handles both arrays of strings (character IDs) and arrays of objects
 * with a `character_id` field.
 */
function isInLocationArray(arr, characterId) {
  if (!Array.isArray(arr) || !characterId) return false;
  return arr.some(item => {
    if (typeof item === 'string') return item === characterId;
    return item?.character_id === characterId;
  });
}

/**
 * Resolve which uniform (if any) applies to a character at a specific location.
 *
 * The characterRoleAtLocation parameter is accepted for backward compatibility
 * but is not used — applicability is resolved from the character's actual existing
 * data at the current Location.
 *
 * @param {Object} character - Full character record
 * @param {Object} location - Location record
 * @param {string} [characterRoleAtLocation] - Ignored (backward compat)
 * @returns {{
 *   uniform: Object|null,
 *   applicability: string|null,
 *   reason: string|null,
 *   source: string
 * }}
 */
export function resolveUniform(character, location, characterRoleAtLocation) {
  if (!character || !location) {
    return { uniform: null, applicability: null, reason: null, source: 'none' };
  }

  // A prison or jail dresses the people held in it, whatever its uniform list says. Checked
  // before any configured uniform so an inmate is never left in their own clothes just
  // because the facility never had uniforms saved on it.
  const confinement = confinementAttire(character, location);
  if (confinement) return confinement;

  const uniforms = location.uniforms || {};
  if (Object.keys(uniforms).length === 0) {
    // A medical facility with nothing configured still dresses its on-shift clinical
    // staff in role attire — "no location-specific uniform" is not "no attire".
    if ((location.category || '') === 'medical') {
      const role = medicalRoleAt(character, location);
      if (role && isOnShiftAt(character, location)) {
        return {
          uniform: { description: ROLE_ATTIRE[role], name: `${role} attire` },
          applicability: 'role_attire',
          reason: `${role}_on_shift`,
          source: `medical_${role}`,
          role,
        };
      }
    }
    const gown = patientGownAttire(character, location);
    if (gown) return gown;
    return { uniform: null, applicability: null, reason: null, source: 'none' };
  }

  const charId = character.id;
  const presence = character.resolved_presence_status || character.location_status || '';
  const isMedical = (location.category || '') === 'medical';
  // At a medical facility, employment attire applies only while actually on shift —
  // an off-duty doctor visiting the hospital is not dressed for work.
  const onShiftHere = isMedical ? isOnShiftAt(character, location) : true;

  // Vacation Mode suppresses employment-based uniform activation (manual
  // assignment, job title, generic staff). Legitimate non-employment role
  // requirements (inmate, patient, gym member, religious member, resident)
  // remain governed by their existing authority.
  const _vacationMode = character.vacation_mode === true;

  // 1. Manual assignment — employment uniform, suppressed during Vacation Mode
  if (!_vacationMode) {
    const manualKey = location.worker_manual_uniforms && location.worker_manual_uniforms[charId];
    if (manualKey && uniforms[manualKey]) {
      return { uniform: uniforms[manualKey], applicability: 'manual_assignment', reason: 'manual_assignment', source: 'manual_assignment' };
    }
  }

  // 2. Job title — employment, suppressed during Vacation Mode
  let jobTitle = null;
  if (!_vacationMode) {
    if (location.worker_job_titles && location.worker_job_titles[charId]) {
      jobTitle = location.worker_job_titles[charId];
    }
    if (!jobTitle && character.occupation_location_id === location.id && character.work_details?.job_title) {
      jobTitle = character.work_details.job_title;
    }
    if (!jobTitle && Array.isArray(character.additional_occupation_locations)) {
      for (const loc of character.additional_occupation_locations) {
        if ((loc.location_id || loc.id) === location.id && loc.job_title) {
          jobTitle = loc.job_title;
          break;
        }
      }
    }
  }
  if (jobTitle && onShiftHere) {
    const normalizedTitle = jobTitle.toLowerCase().trim();
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'job_title' &&
          (u.job_title || '').toLowerCase().trim() === normalizedTitle) {
        return { uniform: u, applicability: 'job_title', reason: 'job_title', source: 'job_title' };
      }
    }
  }

  // 3. Role/status — character's actual status string at THIS Location matches.
  // Uses raw data values (presence status, student status, Location membership
  // array field names) — no manufactured vocabulary.
  const statusStrings = [];
  if (presence) statusStrings.push(presence);
  // School obligations suspended during Vacation Mode — skip student status.
  if (!_vacationMode && character.student_status && character.student_status !== 'not_student' &&
      (character.current_school_location_id === location.id ||
       character.education_location_id === location.id)) {
    statusStrings.push(character.student_status);
  }
  if (!_vacationMode && isInLocationArray(location.enrolled_students, charId)) statusStrings.push('enrolled_students');
  if (isInLocationArray(location.inmates, charId)) statusStrings.push('inmates');
  if (location.gym_members && location.gym_members.includes(charId)) statusStrings.push('gym_members');
  if (isInLocationArray(location.religious_members, charId)) statusStrings.push('religious_members');
  if (isInLocationArray(location.residents, charId)) statusStrings.push('residents');
  // Employment status suppressed during Vacation Mode.
  if (!_vacationMode && location.worker_character_ids && location.worker_character_ids.includes(charId)) statusStrings.push('worker_character_ids');

  if (statusStrings.length > 0) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'role_status' && u.role_status) {
        const uniformRoleStatus = u.role_status.toLowerCase().trim();
        if (statusStrings.some(s => s.toLowerCase().trim() === uniformRoleStatus)) {
          return { uniform: u, applicability: 'role_status', reason: 'role_status', source: 'role_status' };
        }
      }
    }
  }

  // 3.5 Medical role attire — a doctor (or nurse) who is ON SHIFT at a medical facility
  // always reads as their clinical role. Runs before the facility-wide uniform so a
  // hospital's patient gown can never be worn by working staff, and before the closet so
  // a personal outfit can never replace work attire. Off shift, normal clothing applies.
  if (isMedical && onShiftHere) {
    const role = medicalRoleAt(character, location);
    if (role) {
      const assigned = Object.values(uniforms).find(u =>
        (u?.applicability === 'job_title' && roleFromText(u.job_title) === role) ||
        (u?.applicability === 'role_status' && roleFromText(u.role_status) === role) ||
        roleFromText(u?.name) === role
      ) || Object.values(uniforms).find(u => u?.applicability === 'generic_staff');
      return {
        uniform: assigned || { description: ROLE_ATTIRE[role], name: `${role} attire` },
        applicability: 'role_attire',
        reason: `${role}_on_shift`,
        source: `medical_${role}`,
        role,
      };
    }
  }

  // 4. Generic staff — established worker at THIS Location, no job title required
  // Employment inference — suppressed during Vacation Mode.
  const isStaff = !_vacationMode && onShiftHere && (
    (location.worker_character_ids && location.worker_character_ids.includes(charId)) ||
    character.occupation_location_id === location.id ||
    (Array.isArray(character.additional_occupation_locations) &&
      character.additional_occupation_locations.some(loc =>
        (loc.location_id || loc.id) === location.id
      ))
  );
  if (isStaff) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'generic_staff') {
        return { uniform: u, applicability: 'generic_staff', reason: 'generic_staff', source: 'generic_staff' };
      }
    }
  }

  // 5. Zone — character's current zone matches
  const zone = (character.current_zone || character.current_activity || '').toLowerCase();
  if (zone) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'zone' && u.zone && zone.includes(u.zone.toLowerCase())) {
        return { uniform: u, applicability: 'zone', reason: 'zone', source: 'zone' };
      }
    }
  }

  // 6. Location-wide — no preceding gate, always applies if defined.
  // At a medical facility the facility-wide item (typically patient attire) applies only
  // to people actually established there — never to an off-duty doctor visiting.
  const establishedHere = !isMedical || isStaff || presence === 'hospitalized'
    || isInLocationArray(location.inmates, charId)
    || isInLocationArray(location.enrolled_students, charId)
    || isInLocationArray(location.residents, charId)
    || isInLocationArray(location.religious_members, charId)
    || (location.gym_members || []).includes(charId);
  if (establishedHere) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'location_wide') {
        return { uniform: u, applicability: 'location_wide', reason: 'location_wide', source: 'location_wide' };
      }
    }
  }

  // A hospitalized patient at a medical facility reads as a patient even when the facility
  // never configured patient attire. On-shift clinical staff already returned above, so a
  // gown can never be drawn onto a doctor or nurse working here.
  const patientGown = patientGownAttire(character, location);
  if (patientGown) return patientGown;

  return { uniform: null, applicability: null, reason: null, source: 'none' };
}

/**
 * Build outfit context from a resolved uniform.
 * Returns a structure matching resolveCharacterOutfit format for seamless integration.
 *
 * @param {Object} resolvedUniform - Output of resolveUniform()
 * @returns {Object|null} Outfit context or null if no uniform
 */
export function buildUniformOutfitContext(resolvedUniform) {
  if (!resolvedUniform || !resolvedUniform.uniform) return null;

  const { uniform, applicability, reason, source, role } = resolvedUniform;

  // The uniform's name is not clothing text. When the location left the description
  // empty, the uniform's own identity supplies wearable attire.
  const resolvedRole = role || roleFromText(`${uniform.name || ''} ${uniform.job_title || ''} ${uniform.role_status || ''}`);
  const name = (uniform.name || '').trim();
  const GARMENT = /(coat|gown|apron|scrubs|suit|dress|uniform|shirt|pants|trousers|jacket|robe|vest|outfit|attire|clothing)/i;
  const description = (uniform.description || '').trim()
    || (resolvedRole ? ROLE_ATTIRE[resolvedRole] : null)
    || (name ? (GARMENT.test(name) ? name : `${name} uniform`) : 'uniform');

  return {
    outfit: uniform,
    category: 'uniform',
    reason: reason || applicability,
    description,
    source: `uniform:${source}`,
  };
}