/**
 * MEDIA GRID LAST-KNOWN-GOOD CACHE
 *
 * localStorage-backed cache for character and location dropdowns.
 * Rules:
 *  - Keys are always scoped by owner_email — never cross-account bleed.
 *  - Only writes when data is COMPLETE and VALID (never empty, never partial).
 *  - Failed or partial server reads never overwrite good cache.
 *  - Stale threshold: 10 minutes — after that, refresh silently in background
 *    but still show cached data immediately while refresh runs.
 *  - No created_by logic anywhere.
 */

const STALE_MS = 10 * 60 * 1000; // 10 minutes

function cacheKey(email, type) {
  return `mg_cache:${email}:${type}`;
}

/**
 * Read cache. Returns { records, complete, loaded_at } or null if no valid cache.
 * Never returns a partial or failed result as valid.
 */
export function readCache(email, type) {
  if (!email) return null;
  try {
    const raw = localStorage.getItem(cacheKey(email, type));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Reject if not explicitly marked complete
    if (!parsed?.complete) return null;
    // Reject if records is not an array with at least one entry
    if (!Array.isArray(parsed.records) || parsed.records.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check if cache is stale (older than STALE_MS).
 * Stale cache is still shown — just triggers a background refresh.
 */
export function isCacheStale(cached) {
  if (!cached?.loaded_at) return true;
  return Date.now() - cached.loaded_at > STALE_MS;
}

/**
 * Write cache. Only called when data is confirmed complete and valid.
 * Validation rules:
 *  - characters: must have at least one record; must include the user entity or characters
 *  - locations: must have at least one record
 *  - empty arrays are NEVER written as complete
 */
export function writeCache(email, type, records) {
  if (!email) return;
  if (!Array.isArray(records) || records.length === 0) {
    // Empty result — do NOT overwrite existing good cache
    return;
  }
  try {
    const entry = {
      complete: true,
      loaded_at: Date.now(),
      records,
    };
    localStorage.setItem(cacheKey(email, type), JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded or unavailable — silently skip
  }
}

/**
 * Validate a character roster result before writing cache.
 * A valid roster must have at least one record.
 * A roster containing ONLY the user entity is valid IF the account truly has no characters —
 * but since we can't confirm that here, we accept it as valid (the server returned it).
 */
export function isValidCharacterRoster(roster) {
  return Array.isArray(roster) && roster.length > 0;
}

/**
 * Validate a location list result before writing cache.
 */
export function isValidLocationList(locations) {
  return Array.isArray(locations) && locations.length > 0;
}