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
 * resolveSchoolSchedule(character, dayOfWeek, locationMap)
 * 
 * Returns: { startMin, endMin, source } or { startMin: null, endMin: null, source: 'school_schedule_unresolved' }
 */
export function resolveSchoolSchedule(character, dayOfWeek, locationMap) {
  if (!character || character.student_status !== 'enrolled') {
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