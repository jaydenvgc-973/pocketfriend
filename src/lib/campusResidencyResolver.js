/**
 * campusResidencyResolver — Canonical authority for campus residency logic.
 *
 * FRONTEND / LIB USAGE: Import this file directly in frontend components and lib files.
 *
 * BACKEND FUNCTION USAGE: Deno functions cannot import local lib files.
 * Backend functions (generateImageAsync, regenerateImageWithReason, simulateActiveCharacterNeeds, etc.)
 * must use ONE of two approaches:
 *
 * Option A — Invoke the shared resolver function (preferred for new code):
 *   const result = await base44.asServiceRole.functions.invoke('campusResidencyGuard', {
 *     mode: 'isExplicitCampusResident',
 *     character_id: charId,
 *     school_location_id: schoolLocId,
 *   });
 *   const isCampusResident = result.is_campus_resident === true;
 *
 * Option B — Inline the guard (existing code in generateImageAsync, regenerateImageWithReason):
 *   The inline logic MUST stay structurally identical to evaluateCampusResidency() in
 *   functions/campusResidencyGuard. Any change to the canonical rule MUST be applied to
 *   all three locations: this file, campusResidencyGuard, and the inlined guards.
 *
 * SINGLE CANONICAL RULE (enforced everywhere):
 *   lives_on_campus must be EXPLICITLY true in the enrollment record.
 *   Missing, null, false, or undefined → NOT a campus resident.
 *   Enrollment alone → NOT a campus resident.
 *
 * SCHOOL TYPE RULE (absolute — cannot be overridden):
 *   Grammar school and high school are NON-RESIDENTIAL school types.
 *   Campus residency is IMPOSSIBLE for high_school, private_school (K-12).
 *   Only college/university/trade_school may ever have campus residents.
 *   This is an architectural constant, not a configurable option.
 *
 * SINGLE SOURCE OF TRUTH answering one question:
 *   "Can this school location be used as the character's home/sleep/image-home location?"
 *
 * ANSWER IS YES only when ALL of:
 *   1. Character has an active enrollment record at that school
 *   2. That enrollment record explicitly has lives_on_campus === true
 *   3. The enrollment is not graduated/dropped
 *
 * ANSWER IS NO when:
 *   - lives_on_campus is false
 *   - lives_on_campus is missing/undefined/null
 *   - Character is merely enrolled as a student (enrollment ≠ residence)
 *   - Character has a separate assigned home and has not selected campus residency
 *   - Presence says "at_home" but location is school without explicit campus residency
 *
 * PERMANENT RULE: Student enrollment does NOT equal campus residence.
 * This resolver is used by:
 *   - generateImageAsync (Layer 4 school ID validation)
 *   - regenerateImageWithReason (school contamination guard)
 *   - imageGenerationContextBuilder (location sanitizer)
 *   - sleep location resolution
 *   - at-home location resolution
 */

// SCHOOL TYPE RESIDENCY RULE — architectural constant, enforced globally.
//
// NON-RESIDENTIAL (campus residency impossible, forced):
//   daycare_preschool, elementary_school, high_school, private_school, language_school, music_school, online_school
//
// RESIDENTIAL (campus residency always on, forced):
//   boarding_school
//
// RESIDENTIAL OR NON-RESIDENTIAL (user's choice preserved):
//   college, university, trade_school, other
//
const NON_RESIDENTIAL_SCHOOL_TYPES = ['daycare_preschool', 'elementary_school', 'high_school', 'private_school', 'language_school', 'music_school', 'online_school'];
const ALWAYS_RESIDENTIAL_SCHOOL_TYPES = ['boarding_school'];
const USER_CHOICE_SCHOOL_TYPES = ['college', 'university', 'trade_school', 'other'];

/**
 * Returns true if this school type can ever support campus residency.
 * Grammar/high school always returns false — no UI, no flag, no override possible.
 *
 * @param {string|null} schoolType - LocationReference.school_type
 * @returns {boolean}
 */
export function isResidentialSchoolType(schoolType) {
  if (!schoolType) return true; // unknown: fall through to lives_on_campus check
  return !NON_RESIDENTIAL_SCHOOL_TYPES.includes(schoolType);
}

/**
 * Returns 'non_residential' | 'always_residential' | 'user_choice'
 * for the given school type.
 *
 * - 'non_residential'     → daycare_preschool, elementary_school, high_school, etc.
 * - 'always_residential'  → boarding_school
 * - 'user_choice'         → college, university, trade_school, other, unknown
 */
export function getSchoolResidencyMode(schoolType) {
  if (!schoolType) return 'user_choice';
  if (NON_RESIDENTIAL_SCHOOL_TYPES.includes(schoolType)) return 'non_residential';
  if (ALWAYS_RESIDENTIAL_SCHOOL_TYPES.includes(schoolType)) return 'always_residential';
  return 'user_choice';
}

/**
 * Returns true ONLY when the character is an explicit, active campus resident
 * at the given school location.
 *
 * Requires both:
 *   1. School type supports residential housing (not grammar/high school)
 *   2. enrollment record has lives_on_campus === true (explicit, never inferred)
 *
 * @param {object} charRecord - Full Character DB record
 * @param {string} schoolLocationId - The school LocationReference ID to check
 * @param {object|null} schoolLocationRecord - Optional LocationReference record for school_type check
 * @returns {boolean}
 */
export function isExplicitCampusResident(charRecord, schoolLocationId, schoolLocationRecord) {
  if (!charRecord || !schoolLocationId) return false;

  // School type guard — grammar/high school: never residential
  if (schoolLocationRecord) {
    if (!isResidentialSchoolType(schoolLocationRecord.school_type)) return false;
  }

  const enrollments = charRecord.education_enrollments || [];
  if (enrollments.length === 0) return false;

  const activeEnrollment = enrollments.find(e => {
    // Match enrollment to this school location
    const matchesLocation =
      e.location_id === schoolLocationId ||
      e.in_person_location_id === schoolLocationId;
    if (!matchesLocation) return false;
    // Must be active (not dropped or graduated)
    if (e.status === 'dropped' || e.status === 'graduated') return false;
    return true;
  });

  if (!activeEnrollment) return false;

  // CRITICAL: lives_on_campus must be EXPLICITLY true — not inferred, not defaulted
  return activeEnrollment.lives_on_campus === true;
}

/**
 * School contamination guard for location resolution.
 *
 * When a character's resolved_current_location_id (or any passed locationId)
 * equals their school location, this guard determines whether to accept or reject it.
 *
 * Returns the safe location ID to use — either the school ID (if legitimate) or
 * falls back to the character's actual home.
 *
 * @param {object} charRecord - Full Character DB record
 * @param {string} candidateLocationId - Location ID to validate
 * @returns {{ locationId: string|null, rejected: boolean, reason: string|null }}
 */
export function resolveLocationWithSchoolGuard(charRecord, candidateLocationId) {
  if (!charRecord || !candidateLocationId) {
    return { locationId: candidateLocationId, rejected: false, reason: null };
  }

  const schoolLocId = charRecord.current_school_location_id
    || charRecord.education_location_id
    || null;

  // Not a school location — pass through unchanged
  if (!schoolLocId || candidateLocationId !== schoolLocId) {
    return { locationId: candidateLocationId, rejected: false, reason: null };
  }

  const presenceStatus = charRecord.resolved_presence_status
    || charRecord.location_status
    || '';
  const homeLocId = charRecord.current_home_location_id
    || charRecord.home_location_id
    || null;

  // Guard 1: Character is not present at school → reject
  if (presenceStatus !== 'at_school') {
    return {
      locationId: homeLocId,
      rejected: true,
      reason: `school_id_rejected_presence_is_${presenceStatus || 'unknown'}`,
    };
  }

  // Guard 2: Character is at_school but NOT an explicit campus resident → reject for home use
  // (They're at school for class, not living there)
  const isCampusResident = isExplicitCampusResident(charRecord, schoolLocId);
  if (!isCampusResident) {
    return {
      locationId: homeLocId,
      rejected: true,
      reason: 'school_id_rejected_not_campus_resident',
    };
  }

  // Both guards passed: character is at_school AND explicitly lives on campus
  return { locationId: candidateLocationId, rejected: false, reason: null };
}

/**
 * Sleep location guard.
 * When a character is sleeping/napping, validates whether the school location
 * is a valid sleep location (campus dorm).
 *
 * Returns true only if campus residency is explicit.
 *
 * @param {object} charRecord - Full Character DB record
 * @param {string} sleepLocationId - Where the character is attempting to sleep
 * @returns {boolean} Whether this is a valid sleep location
 */
export function isValidSleepLocation(charRecord, sleepLocationId) {
  if (!charRecord || !sleepLocationId) return false;

  const schoolLocId = charRecord.current_school_location_id
    || charRecord.education_location_id
    || null;

  // Not a school location — always valid for sleep
  if (!schoolLocId || sleepLocationId !== schoolLocId) return true;

  // School location: only valid for sleep if character explicitly lives on campus
  return isExplicitCampusResident(charRecord, schoolLocId);
}