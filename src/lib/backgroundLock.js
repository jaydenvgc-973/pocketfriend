/**
 * BACKGROUND LOCK
 * These fields represent a character's permanent past.
 * They can ONLY be modified by explicit user action — never by the system.
 */

export const BACKGROUND_LOCKED_FIELDS = [
  'background_story',
  'backstory',
  'family_history',
  'background',
  'birth_year',
  'birthday',
  'criminal_record',
  'education',
  'family_members',
  'departed_characters',
];

/**
 * Strip any background-locked fields from a system-generated update object.
 * Returns the sanitized update and a list of blocked fields.
 */
export function sanitizeSystemUpdate(updateObj) {
  const blocked = [];
  const safe = { ...updateObj };

  for (const field of BACKGROUND_LOCKED_FIELDS) {
    if (field in safe) {
      blocked.push(field);
      delete safe[field];
    }
  }

  return { safe, blocked };
}

/**
 * Check if an update object attempts to modify background-locked fields.
 * Returns true if any locked field is present.
 */
export function hasBackgroundViolation(updateObj) {
  return BACKGROUND_LOCKED_FIELDS.some(f => f in updateObj);
}