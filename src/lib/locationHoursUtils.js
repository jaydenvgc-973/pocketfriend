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
  
  const todayHours = location.operating_hours.find(h => h.day_of_week === dayOfWeek);
  if (!todayHours) {
    return false; // No hours for today = closed
  }

  return currentTime >= todayHours.open_time && currentTime <= todayHours.close_time;
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