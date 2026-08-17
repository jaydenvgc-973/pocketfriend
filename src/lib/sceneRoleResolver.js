/**
 * SHARED SCENE ROLE CLASSIFIER
 *
 * Single source of truth for role classification in Scene image generation
 * and Who's Here dropdown. Consumes the authoritative resolved_presence_status
 * from the travel presence resolver (resolveTravelPresenceEntities).
 *
 * PRIORITY (authoritative states override employment):
 *   1. hospitalized → patient
 *   2. incarcerated / confined / house_arrest → inmate
 *   3. employed at THIS exact location + actually on shift here → employee
 *   4. home resident at this location → home resident
 *   5. otherwise physically present → visitor
 *
 * A generic work schedule for ANOTHER location never counts as employment here.
 * Hospitalization and incarceration always override employment.
 */

export const PATIENT_STATUSES = ['hospitalized'];
export const INMATE_STATUSES = ['incarcerated', 'confined', 'house_arrest'];

/**
 * Classify a single person into their authoritative Scene role.
 *
 * @param {Object} person - must carry resolved_presence_status (from resolver or DB)
 * @param {Object} opts
 * @param {Set} opts.onShiftAtLocationIds - IDs of characters employed + on-shift at THIS location
 * @param {Set} opts.homeResidentIds - IDs of characters who are home residents here
 * @returns {string|null} 'patient' | 'inmate' | 'on-shift employee' | 'home resident' | 'visitor' | null
 */
export function resolveSceneRole(person, opts = {}) {
  if (!person) return null;
  const { onShiftAtLocationIds = new Set(), homeResidentIds = new Set() } = opts;

  // 1. Active hospitalization overrides everything
  if (PATIENT_STATUSES.includes(person.resolved_presence_status)) return 'patient';

  // 2. Active incarceration / confinement
  if (INMATE_STATUSES.includes(person.resolved_presence_status)) return 'inmate';

  // 3. Employed at this exact location + on shift
  if (onShiftAtLocationIds.has(person.id)) return 'on-shift employee';

  // 4. Home resident
  if (homeResidentIds.has(person.id)) return 'home resident';

  // 5. Otherwise present → visitor
  return 'visitor';
}

/**
 * Check whether a character is actually employed at a specific location
 * (not merely having a generic work schedule somewhere).
 *
 * Employment at this location requires ONE of:
 *   - A shift defined in location.worker_shifts[characterId]
 *   - occupation_location_id === location.id
 *   - additional_occupation_locations includes location.id
 *
 * This prevents a character employed elsewhere from being classified as
 * an employee at a location they merely happen to be visiting.
 */
export function isEmployedAtLocation(character, location) {
  if (!character || !location) return false;

  // Shift defined at this location
  if (location.worker_shifts?.[character.id]) return true;

  // Occupation linked to this location
  if (character.occupation_location_id === location.id) return true;

  // Additional occupation locations
  if (character.additional_occupation_locations?.some(a => a.location_id === location.id)) return true;

  // Location record lists this character as a worker here.
  // This is the same employment signal Who's Here already recognizes via
  // worker_character_ids. Without this check, a character employed via
  // worker_character_ids (but without occupation_location_id or worker_shifts
  // on their own record) is lost to image-generation role classification and
  // falls through to visitor — even when Who's Here shows them as staff.
  // worker_character_ids establishes employment at this location; it does NOT
  // establish that the character is currently on shift. On-shift determination
  // still requires isCharacterAtWork (the existing authoritative check).
  if (location.worker_character_ids?.includes(character.id)) return true;

  return false;
}