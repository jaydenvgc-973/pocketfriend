/**
 * OWNERSHIP MIGRATION UTILITIES
 *
 * All ownership is determined exclusively by owner_email.
 * created_by is permanently forbidden — never use it for ownership logic.
 *
 * Source of truth: owner_email == currentUser.email
 */

/**
 * Build a query filter for the current user's records.
 *
 * Usage:
 *   const filter = buildCurrentUserFilter(currentUser);
 *   const myCharacters = await base44.entities.Character.filter(filter);
 */
export function buildCurrentUserFilter(currentUser) {
  if (!currentUser?.email) {
    console.warn('[frontendOwnershipMigration] No current user email available, returning empty filter');
    return {};
  }
  return { owner_email: currentUser.email };
}

/**
 * Build a query filter for a specific user's records (admin use).
 *
 * Usage:
 *   const filter = buildUserFilter(targetUserEmail);
 *   const targetChars = await base44.asServiceRole.entities.Character.filter(filter);
 */
export function buildUserFilter(userEmail) {
  if (!userEmail) throw new Error('userEmail is required');
  return { owner_email: userEmail };
}

/**
 * Validation helper: Check if a record belongs to the current user.
 * Uses owner_email exclusively — no created_by fallback.
 */
export function isRecordOwnedByUser(record, userEmail) {
  if (!record || !userEmail) return false;
  return record.owner_email === userEmail;
}

/**
 * Safe filtering for query results.
 * Removes any records that don't belong to the current user by owner_email.
 */
export function filterQueryResultsForUser(records, userEmail) {
  if (!Array.isArray(records) || !userEmail) return [];
  return records.filter(record => isRecordOwnedByUser(record, userEmail));
}

/**
 * React hook helper: Build ownership filter for current user.
 * Returns null if user is not loaded yet.
 */
export function useOwnershipFilterForCurrentUser(currentUser) {
  if (!currentUser?.email) return null;
  return buildCurrentUserFilter(currentUser);
}