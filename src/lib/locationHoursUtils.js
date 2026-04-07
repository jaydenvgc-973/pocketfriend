/**
 * Check if a location is currently open based on its operating hours
 * @param {object} location - The location object with operating_hours
 * @returns {boolean} true if open, false if closed, null if no hours defined
 */
function toMinutesLH(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isInWindowLH(currentMinutes, openStr, closeStr) {
  const open = toMinutesLH(openStr);
  const close = toMinutesLH(closeStr);
  if (open == null || close == null) return false;
  if (open <= close) {
    // Normal window e.g. 09:00–17:00
    return currentMinutes >= open && currentMinutes <= close;
  }
  // Overnight window e.g. 12:00–02:00
  return currentMinutes >= open || currentMinutes <= close;
}

export function isLocationOpen(location, currentTime = new Date()) {
  if (!location?.operating_hours || location.operating_hours.length === 0) {
    return null; // No hours defined = assume always open
  }

  const now = currentTime;
  const dayOfWeek = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);

  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);

  if (todayEntries.length > 0) {
    return todayEntries.some(h => isInWindowLH(currentMinutes, h.open_time, h.close_time));
  }

  if (daySpecific.length > 0 && todayEntries.length === 0) {
    return false; // Hours for other days but not today = closed
  }

  // Day-agnostic entries apply every day
  if (dayAgnostic.length > 0) {
    return dayAgnostic.some(h => isInWindowLH(currentMinutes, h.open_time, h.close_time));
  }

  return null;
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