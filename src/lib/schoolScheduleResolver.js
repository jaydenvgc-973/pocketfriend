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
 * hasVerifiedSchoolEnrollment — does this character have an academic obligation?
 *
 * Academic obligation comes from enrollment records, never from a building:
 *   - the education location must genuinely BE a school (a home, workplace or business
 *     recorded as an "education location" is not a school and makes nobody a student),
 *   - when the school keeps its own student log (enrolled_students), that log is the
 *     authority. A character the log does not list is not enrolled there — an employee,
 *     a resident with an undeclared major, or a visitor. Employment at a school and
 *     living at a school are separate relationships and neither enrolls anybody.
 * A school that keeps no enrollment log is left as it was, so existing students whose
 * school record predates the log are unaffected.
 */
export function hasVerifiedSchoolEnrollment(character, locationMap = {}) {
  if (!character || character.student_status !== 'enrolled' || !character.education_location_id) return false;
  const school = locationMap?.[character.education_location_id] || null;
  const isSchool = !!school && (school.category === 'school' || school.category === 'education' || !!school.school_type);
  if (!isSchool) return false;
  const log = Array.isArray(school.enrolled_students) ? school.enrolled_students : [];
  if (log.length === 0) return true;
  return log.some((s) => s && s.character_id === character.id);
}

/**
 * A college or university keeps an individual academic schedule per enrollment:
 * each student's own class days and hours, stored on their enrollment record in the
 * school's student log. Those hours are the student's academic obligation — the
 * institution's operating hours are never substituted for them.
 */
const INDIVIDUAL_SCHEDULE_SCHOOL_TYPES = ['college', 'university'];

export function usesIndividualAcademicSchedule(school) {
  if (!school) return false;
  // The location's existing venue types are kept in `subtype`; `school_type` is the
  // other existing field the same distinction can be recorded in. Either one qualifies —
  // never both required, and no other venue type does.
  const venueTypes = [
    ...(Array.isArray(school.subtype) ? school.subtype : []),
    school.school_type,
  ].map((t) => String(t || '').toLowerCase());
  return venueTypes.some((t) => INDIVIDUAL_SCHEDULE_SCHOOL_TYPES.includes(t));
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

  const schoolLoc = character.education_location_id && locationMap
    ? locationMap[character.education_location_id]
    : null;

  // UNIVERSITY / COLLEGE — the student's own enrollment schedule decides, and nothing
  // else may stand in for it. A day the student's schedule does not list, a schedule that
  // is empty, or an enrollment with no schedule at all means NO class that day. The
  // institution's operating hours are not an academic schedule.
  if (usesIndividualAcademicSchedule(schoolLoc)) {
    // The student's own enrollment record for THIS school carries the class days/hours.
    const enrollments = Array.isArray(character.education_enrollments) ? character.education_enrollments : [];
    const entry = enrollments.find((e) => e && e.status === 'active'
      && (e.location_id === schoolLoc.id || e.in_person_location_id === schoolLoc.id)) || null;
    if (!entry) return { startMin: null, endMin: null, source: 'no_enrollment_record' };
    const schedule = Array.isArray(entry.academic_schedule) ? entry.academic_schedule : [];
    const today = schedule.find((d) => d && d.day_of_week === dayOfWeek && d.start_time && d.end_time);
    if (!today) return { startMin: null, endMin: null, source: 'no_class_scheduled' };
    const dayStart = toMinutes(today.start_time);
    const dayEnd = toMinutes(today.end_time);
    if (dayStart === null || dayEnd === null) {
      return { startMin: null, endMin: null, source: 'no_class_scheduled' };
    }
    return { startMin: dayStart, endMin: dayEnd, source: 'individual_academic_schedule' };
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
  if (schoolLoc) {
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