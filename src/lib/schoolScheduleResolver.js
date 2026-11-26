/**
 * resolveSchoolSchedule — Canonical school schedule resolution
 * 
 * Resolution order (no invented hours):
 * 1. Character enrollment override times (if available)
 * 2. School location operating hours (from LocationReference for the current day)
 * 3. school_schedule_unresolved (if neither 1 nor 2 provide times)
 * 
 * REQUIRED: caller must pass locationMap so we can look up school location operating hours
 */

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * hasVerifiedSchoolEnrollment — is this character actually a student right now?
 *
 * Enrollment is verified against the school record itself, never assumed from the
 * character's fields alone:
 *   - the education location must genuinely BE a school (a home, workplace or business
 *     recorded as an "education location" is not a school and makes nobody a student),
 *   - a character who also has a job is only a student when the school's own enrollment
 *     log (enrolled_students) lists them. A job plus no enrollment on the school's log
 *     means their obligation is work, not school.
 * A school that keeps no enrollment log is left as it was, so existing students whose
 * school record predates the log are unaffected.
 */
export function hasVerifiedSchoolEnrollment(character, locationMap = {}) {
  if (!character || character.student_status !== 'enrolled' || !character.education_location_id) return false;
  const school = locationMap?.[character.education_location_id] || null;
  const isSchool = !!school && (school.category === 'school' || school.category === 'education' || !!school.school_type);
  if (!isSchool) return false;
  const hasJob = !!(character.current_work_location_id || character.occupation_location_id);
  if (!hasJob) return true;
  const log = Array.isArray(school.enrolled_students) ? school.enrolled_students : [];
  if (log.length === 0) return true;
  return log.some((s) => s && s.character_id === character.id);
}

/**
 * resolveSchoolSchedule(character, dayOfWeek, locationMap)
 * 
 * Returns: { startMin, endMin, source } or { startMin: null, endMin: null, source: 'school_schedule_unresolved' }
 */
export function resolveSchoolSchedule(character, dayOfWeek, locationMap) {
  // Enrollment is verified against the school record, not assumed from the character.
  if (!hasVerifiedSchoolEnrollment(character, locationMap)) {
    return { startMin: null, endMin: null, source: 'not_enrolled' };
  }

  // PRIORITY 1: Enrollment override times on character
  if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
    const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time);
    if (active && active.start_time && active.end_time) {
      const s = toMinutes(active.start_time);
      const e = toMinutes(active.end_time);
      if (s !== null && e !== null) {
        return { startMin: s, endMin: e, source: 'enrollment_override' };
      }
    }
  }

  // PRIORITY 2: School location operating hours (real data from LocationReference)
  if (character.education_location_id && locationMap && locationMap[character.education_location_id]) {
    const schoolLoc = locationMap[character.education_location_id];
    if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
      // Find hours for today OR fall back to day-agnostic hours
      const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
      const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);

      // Use today's hours if available
      if (todayEntries.length > 0) {
        const entry = todayEntries[0]; // Use first entry for today
        const s = toMinutes(entry.open_time);
        const e = toMinutes(entry.close_time);
        if (s !== null && e !== null) {
          return { startMin: s, endMin: e, source: 'school_location_hours' };
        }
      }

      // Fall back to day-agnostic hours
      if (dayAgnosticEntries.length > 0) {
        const entry = dayAgnosticEntries[0]; // Use first day-agnostic entry
        const s = toMinutes(entry.open_time);
        const e = toMinutes(entry.close_time);
        if (s !== null && e !== null) {
          return { startMin: s, endMin: e, source: 'school_location_hours_day_agnostic' };
        }
      }
    }
  }

  // PRIORITY 3: No valid hours found
  return { startMin: null, endMin: null, source: 'school_schedule_unresolved' };
}

export default resolveSchoolSchedule;