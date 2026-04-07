/**
 * Check if a location is currently open based on its operating hours
 * @param {object} location - The location object with operating_hours
 * @returns {boolean} true if open, false if closed, null if no hours defined
 */
export function isLocationOpen(location) {
  if (!location?.operating_hours || location.operating_hours.length === 0) {
    return null; // No hours defined = assume always open
  }

  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);

  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);

  if (todayEntries.length > 0) {
    // Hours defined for today — use them
    return todayEntries.some(h => currentTime >= h.open_time && currentTime <= h.close_time);
  }

  if (daySpecific.length > 0 && todayEntries.length === 0) {
    // Hours defined for other days but NOT today — closed today
    return false;
  }

  // Only day-agnostic entries (no day_of_week set) — apply to every day
  if (dayAgnostic.length > 0) {
    return dayAgnostic.some(h => currentTime >= h.open_time && currentTime <= h.close_time);
  }

  return null; // No usable entries
}

/**
 * Get a character's destination when a location they're at closes.
 * Priority: work location → school location → home
 * @param {object} character - The character object
 * @returns {string|null} locationId where character should go
 */
export function getCharacterRedirectLocation(character) {
  // Prefer scheduled work location if they have one
  if (character.current_work_location_id) {
    return character.current_work_location_id;
  }
  // Then try school
  if (character.current_school_location_id) {
    return character.current_school_location_id;
  }
  // Fall back to home
  return character.current_home_location_id || null;
}