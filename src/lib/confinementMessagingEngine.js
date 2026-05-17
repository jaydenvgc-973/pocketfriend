/**
 * Confinement Messaging Engine
 * 
 * Detects when a character is confined (jailed/imprisoned/incarcerated) and
 * enforces messaging hours (9 AM - 9 PM local app time).
 * 
 * Global rules:
 * - Confined characters can only receive/respond between 9 AM - 9 PM
 * - Character messages show "Confinement text app" label
 * - Attempts to message outside hours show a notice instead of response
 */

/**
 * Check if a character is currently confined/incarcerated
 * 
 * Uses existing character state fields:
 * - is_jailed: boolean flag
 * - incarceration_status: enum value
 * - jail_release_date: future date means currently jailed
 * - house_arrest_active: alternative confinement
 * - resolved_presence_status: 'incarcerated', 'house_arrest', 'confined'
 */
export function isCharacterConfined(character) {
  if (!character) return false;

  // Direct jail flag
  if (character.is_jailed === true) return true;

  // Incarceration status
  const validIncarcerationStatuses = ['pretrial', 'sentenced', 'serving', 'solitary', 'work_release', 'transferred'];
  if (character.incarceration_status && validIncarcerationStatuses.includes(character.incarceration_status)) {
    // Only confined if not already released
    if (character.jail_release_date) {
      const releaseDate = new Date(character.jail_release_date);
      if (releaseDate > new Date()) return true; // future release = currently jailed
    } else if (character.incarceration_status !== 'released' && character.incarceration_status !== 'paroled') {
      return true;
    }
  }

  // House arrest
  if (character.house_arrest_active === true) return true;

  // Resolved presence status
  if (character.resolved_presence_status === 'incarcerated' || character.resolved_presence_status === 'house_arrest') return true;

  // Resolved location type
  if (character.resolved_location_type === 'incarcerated' || character.resolved_location_type === 'house_arrest') return true;

  return false;
}

/**
 * Check if current time is within allowed messaging hours (9 AM - 9 PM)
 * Always uses EST (America/New_York) — the app's standard timezone.
 */
export function isWithinMessagingHours() {
  // Get current hour in EST/EDT (America/New_York handles daylight saving automatically)
  const nowEST = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const estHour = parseInt(nowEST, 10); // 0-23
  // 9 AM (9) through 8:59 PM (20:59) = hours 9-20 inclusive
  return estHour >= 9 && estHour < 21;
}

/**
 * Get the confinement messaging notice text (for blocked after-hours responses)
 */
export function getConfinementNotice() {
  return 'Currently confined and will only be able to respond between 9:00 a.m. and 9:00 p.m.';
}

/**
 * Get the confinement label text (for message bubbles)
 */
export function getConfinementLabel() {
  return 'Confinement text app';
}

/**
 * Check if a character response is allowed at this moment
 * 
 * Returns { allowed: boolean, reason?: string }
 */
export function canCharacterRespond(character) {
  if (!isCharacterConfined(character)) {
    return { allowed: true };
  }

  if (!isWithinMessagingHours()) {
    return {
      allowed: false,
      reason: getConfinementNotice(),
    };
  }

  return { allowed: true };
}