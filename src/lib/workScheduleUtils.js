/**
/**
 * workScheduleUtils.js
 *
 * Unified schedule utilities for work, school/education, and religion attendance.
 * All three systems use the same logic layer — location hours + character-specific schedule.
 *
 * Two time layers:
 *   1. Location operating_hours  — when the place is open/active
 *   2. Character schedule/shift  — when the character is supposed to be there
 *
 * Both layers reinforce each other. If a location has hours and the character is
 * linked to it, those hours inform attendance expectations.
 */

// ── Parse "HH:MM" → total minutes ──────────────────────────────────────────
function toMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

function isInWindow(currentMinutes, startStr, endStr) {
  const start = toMinutes(startStr);
  const end = toMinutes(endStr);
  if (start == null || end == null) return false;
  if (start <= end) return currentMinutes >= start && currentMinutes < end;
  // Crosses midnight
  return currentMinutes >= start || currentMinutes < end;
}

function getLocalMinutes() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

function getLocalDay() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getDay(); // 0=Sun
}

// ── Location hours helpers ──────────────────────────────────────────────────

/**
 * Returns true if a location is currently "active/open" based on its operating_hours.
 * If no hours defined, returns null (unknown / always-possible).
 */
export function isLocationActiveNow(location) {
  const hours = location?.operating_hours;
  if (!hours || hours.length === 0) return null; // unknown — no hours defined, treat as always open

  const currentMinutes = getLocalMinutes();
  const currentDay = getLocalDay();

  // Split entries into day-specific and day-agnostic (no day_of_week set)
  const daySpecificEntries = hours.filter(w => w.day_of_week != null);
  const dayAgnosticEntries = hours.filter(w => w.day_of_week == null);

  // Check day-specific entries for today
  const todayEntries = daySpecificEntries.filter(w => w.day_of_week === currentDay);

  if (todayEntries.length > 0) {
    // There are hours defined specifically for today — use them
    return todayEntries.some(w => isInWindow(currentMinutes, w.open_time, w.close_time));
  }

  if (daySpecificEntries.length > 0 && todayEntries.length === 0) {
    // Hours defined for other days but NOT for today — location is closed today
    return false;
  }

  // Only day-agnostic entries exist (no day_of_week) — apply to every day
  if (dayAgnosticEntries.length > 0) {
    return dayAgnosticEntries.some(w => isInWindow(currentMinutes, w.open_time, w.close_time));
  }

  return null; // No usable entries — unknown
}

/**
 * Get the character's shift at a specific location from the location's worker_shifts map.
 * Returns { start, end } or null.
 */
export function getCharacterShiftAtLocation(characterId, location) {
  if (!location?.worker_shifts || !characterId) return null;
  const shift = location.worker_shifts[characterId];
  if (!shift?.start || !shift?.end) return null;
  return shift;
}

/**
 * Check if character is currently within their shift at a given location.
 * Respects shift.days if present, defaults to Mon-Fri.
 */
export function isCharacterOnShift(characterId, location) {
  const shift = getCharacterShiftAtLocation(characterId, location);
  if (!shift) return false;
  const currentMinutes = getLocalMinutes();
  const currentDay = getLocalDay();

  // CRITICAL: Only use stored shift.days. If no days are stored, do NOT default to Mon-Fri.
  // A missing days array means the shift applies any day (always-active shift).
  // Defaulting to Mon-Fri would fabricate a schedule for night/weekend workers.
  if (shift.days?.length > 0 && !shift.days.includes(currentDay)) return false;

  return isInWindow(currentMinutes, shift.start, shift.end);
}

// ── Work ───────────────────────────────────────────────────────────────────

/**
 * Determines if a character is currently at work.
 *
 * CRITICAL: If current_activity contains "home", "house", "in bed" → NOT at work
 * "Worship" in activity ≠ work — worship is a separate activity
 *
 * Priority:
 *   1. Check if activity explicitly says they're home → return false
 *   2. If a linked workplace location has shift data for this character → use that
 *   3. Fall back to character's own work_start_time / work_end_time / work_days
 *
 * Accepts optional `workplaceLocation` (LocationReference record) for richer data.
 */
export function isCharacterAtWork(character, workplaceLocation = null) {
  // CRITICAL: If activity says they're home, they're not at work
  const activity = (character?.current_activity || '').toLowerCase();
  const homeKeywords = ['home', 'house', 'apartment', 'in bed', 'bedroom', 'bed'];
  if (homeKeywords.some(k => activity.includes(k))) return false;

  const unemployedKeywords = ['unemployed', 'between jobs', 'crime', 'none'];
  const workType = (character?.work_details?.workplace_type || '').toLowerCase();
  if (unemployedKeywords.some(k => workType.includes(k))) return false;
  if (!character?.work_details?.job_title && !character?.occupation_location_id && !workplaceLocation) {
    // No job info at all — cannot determine schedule. Do not fabricate 9-to-5.
    return false;
  }

  // Layer 1: Location-specific shift (MOST AUTHORITATIVE)
  if (workplaceLocation && character?.id) {
    const onShift = isCharacterOnShift(character.id, workplaceLocation);
    if (onShift) return true;

    // Only block if a shift was explicitly defined for this character but they're not on it.
    // NOTE: worker_character_ids arrays are not reliable (may be empty even when worker_shifts has data).
    // Use worker_shifts presence as the sole authority — do NOT gate on worker_character_ids.
    const definedShift = getCharacterShiftAtLocation(character.id, workplaceLocation);
    if (definedShift && !onShift) {
      // Character has a defined shift here but is not currently on it
      return false;
    }

    // Check if location is even open
    const locationActive = isLocationActiveNow(workplaceLocation);
    if (locationActive === false) {
      // Location is explicitly closed — character cannot be at work
      return false;
    }
    // If locationActive === true or null, continue to Layer 2
  }

  // Layer 2: Character's own work schedule (fallback only if no location shift data)
  // CRITICAL: If no actual schedule is stored, do NOT fabricate 9-to-5.
  // A missing schedule means unknown — not Mon–Fri 9am–5pm.
  const workDays = character?.work_days;
  const workStart = character?.work_start_time;
  const workEnd = character?.work_end_time;

  // No stored schedule — cannot determine if at work. Return false (do not assume).
  if (!workStart || !workEnd) return false;

  const currentMinutes = getLocalMinutes();
  const currentDay = getLocalDay();

  // CRITICAL: Only check days if they are explicitly stored. If work_days is empty/missing,
  // do NOT default to Mon-Fri. A character with stored start/end but no days stored
  // means "we know the hours but not which days" — treat as unknown days (skip day check).
  if (workDays?.length > 0 && !workDays.includes(currentDay)) return false;

  // Is a work day AND within work hours — return true
  return isInWindow(currentMinutes, workStart, workEnd);
}

// ── School / Education (same system as Work) ───────────────────────────────

/**
 * Determines if a character is currently attending school/education.
 *
 * School and Education are the same system. Uses the same two-layer approach:
 *   1. Location's operating_hours (class times / school hours)
 *   2. Character's education_details or current_education_activity
 *
 * Returns { attending: boolean, label: string }
 */
export function isCharacterAtSchool(character, educationLocation = null) {
  if (!character?.current_education_activity || character.current_education_activity === 'none') {
    return { attending: false, label: '' };
  }

  // CRITICAL: Only check attendance if character has an active education location
  // Do NOT infer attendance from time-of-day alone
  if (!educationLocation && !character?.education_location_id) {
    return { attending: false, label: '' };
  }

  const currentMinutes = getLocalMinutes();
  const currentDay = getLocalDay();
  const currentHour = Math.floor(currentMinutes / 60);

  // Layer 1: Education location hours (only if location is explicitly provided or linked)
  if (educationLocation) {
    const locationActive = isLocationActiveNow(educationLocation);
    if (locationActive === true) {
      const courseName = character.education_details?.course_name || character.current_education_activity;
      return { attending: true, label: `at school — ${courseName}` };
    }
    if (locationActive === false) {
      // Location is explicitly closed
      return { attending: false, label: '' };
    }
    // null = no hours defined, fall through to time-of-day check
  }

  // Layer 2: Plausible class-time window (8am–9pm) — ONLY if character has active education_location_id
  if (character?.education_location_id && currentHour >= 8 && currentHour < 21) {
    const courseName = character.education_details?.course_name || character.current_education_activity;
    const label = educationLocation
      ? `at ${educationLocation.name} — ${courseName}`
      : `at school — ${courseName}`;
    return { attending: true, label };
  }

  return { attending: false, label: '' };
}

/**
 * Get a display label for school attendance status — mirrors work status labels.
 * Returns one of: 'in class', 'at school', 'running late to class', 'after school', null
 */
export function getSchoolStatusLabel(character, educationLocation = null) {
  const result = isCharacterAtSchool(character, educationLocation);
  if (result.attending) return 'in class';
  if (character?.current_education_activity && character.current_education_activity !== 'none') {
    const currentHour = Math.floor(getLocalMinutes() / 60);
    if (currentHour >= 15 && currentHour < 22) return 'after school';
  }
  return null;
}

// ── Religious Attendance (location-aware layer on top of religionUtils) ────

/**
 * Determines if a character should currently be at their religious location.
 * Works alongside the existing prayer-time logic in religionUtils.js.
 *
 * Checks:
 *   1. Character's belief level (must be moderate or devout)
 *   2. Religion location's operating_hours (service times, prayer times)
 *   3. Falls back to SERVICE_DAYS logic from religionUtils
 *
 * Returns { attending: boolean, label: string }
 */
export function isCharacterAtReligiousLocation(character, religionLocation = null) {
  if (!character?.religion || character.religion === 'None') return { attending: false, label: '' };
  if (character.belief_level === 'in_name_only') return { attending: false, label: '' };

  // Layer 1: Location hours if a religion location is linked
  if (religionLocation) {
    const locationActive = isLocationActiveNow(religionLocation);
    if (locationActive === true) {
      const label = `at ${religionLocation.name}`;
      return { attending: true, label };
    }
    if (locationActive === false) return { attending: false, label: '' };
  }

  // Layer 2: Time-of-day plausibility for service attendance
  const currentDay = getLocalDay();
  const currentHour = Math.floor(getLocalMinutes() / 60);

  // Christianity: Sunday services (9am-1pm)
  if (character.religion === 'Christianity' && currentDay === 0 && currentHour >= 9 && currentHour < 13) {
    const label = religionLocation ? `at ${religionLocation.name}` : 'at church';
    return { attending: character.belief_level === 'devout', label };
  }
  // Islam: Friday Jumu'ah (11:30am-1:30pm)
  if (character.religion === 'Islam' && currentDay === 5 && currentHour >= 11 && currentHour < 14) {
    const label = religionLocation ? `at ${religionLocation.name}` : 'at mosque';
    return { attending: character.belief_level === 'devout', label };
  }
  // Judaism: Saturday Shabbat (9am-12pm)
  if (character.religion === 'Judaism' && currentDay === 6 && currentHour >= 9 && currentHour < 12) {
    const label = religionLocation ? `at ${religionLocation.name}` : 'at synagogue';
    return { attending: character.belief_level === 'devout', label };
  }

  return { attending: false, label: '' };
}

// ── Gym ────────────────────────────────────────────────────────────────────

/**
 * Check if a character is likely at the gym based on location hours.
 */
export function isCharacterAtGym(character, gymLocation = null) {
  if (!gymLocation) return false;
  if (!gymLocation.gym_members?.includes(character?.id)) return false;
  const locationActive = isLocationActiveNow(gymLocation);
  return locationActive === true;
}

// ── Shared-space helpers for autonomy + character cards ────────────────────

/**
 * Given a character and an array of all linked locations for this user,
 * find the best current location for that character.
 *
 * Returns { location, role, status } or null.
 * role: 'worker' | 'student' | 'worshipper' | 'resident' | 'gym_member' | 'visitor'
 * status: 'at_work' | 'at_school' | 'at_worship' | 'at_gym' | 'at_home' | null
 */
export function resolveCharacterCurrentLocation(character, allLocations) {
  if (!character || !allLocations) return null;

  // 1. Work location
  if (character.occupation_location_id) {
    const loc = allLocations.find(l => l.id === character.occupation_location_id);
    if (loc) {
      const onShift = isCharacterOnShift(character.id, loc);
      const locationOpen = isLocationActiveNow(loc);
      const charAtWork = isCharacterAtWork(character, loc);
      if (onShift || charAtWork) {
        return { location: loc, role: 'worker', status: 'at_work' };
      }
    }
  }

  // Also check additional_occupation_locations
  if (character.additional_occupation_locations?.length > 0) {
    for (const extra of character.additional_occupation_locations) {
      const loc = allLocations.find(l => l.id === extra.location_id);
      if (loc) {
        const charAtWork = isCharacterAtWork(character, loc);
        if (charAtWork) return { location: loc, role: 'worker', status: 'at_work' };
      }
    }
  }

  // 2. Education/school location
  if (character.education_location_id) {
    const loc = allLocations.find(l => l.id === character.education_location_id);
    if (loc) {
      const result = isCharacterAtSchool(character, loc);
      if (result.attending) return { location: loc, role: 'student', status: 'at_school' };
    }
  }

  // Also check additional_education_locations
  if (character.additional_education_locations?.length > 0) {
    for (const extra of character.additional_education_locations) {
      const loc = allLocations.find(l => l.id === extra.location_id);
      if (loc) {
        const result = isCharacterAtSchool(character, loc);
        if (result.attending) return { location: loc, role: 'student', status: 'at_school' };
      }
    }
  }

  // 3. Religion location
  const religionLocation = allLocations.find(l => l.category === 'religion' && !l.is_default_generic);
  if (religionLocation) {
    const result = isCharacterAtReligiousLocation(character, religionLocation);
    if (result.attending) return { location: religionLocation, role: 'worshipper', status: 'at_worship' };
  }

  // 4. Gym
  const gymLocation = allLocations.find(l => l.category === 'gym' && l.gym_members?.includes(character.id));
  if (gymLocation) {
    const atGym = isCharacterAtGym(character, gymLocation);
    if (atGym) return { location: gymLocation, role: 'gym_member', status: 'at_gym' };
  }

  // 5. Home
  const homeLocation = allLocations.find(l =>
    (l.category === 'home' || l.category === 'generic') &&
    l.resident_character_ids?.includes(character.id)
  );
  if (homeLocation) return { location: homeLocation, role: 'resident', status: 'at_home' };

  return null;
}