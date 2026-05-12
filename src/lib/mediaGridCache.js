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
 *
 * Load statuses exposed to UI:
 *   'loading'       — fetch in progress, no cache available yet
 *   'cache'         — showing last-known-good cache (server refresh may be running)
 *   'fresh'         — server data loaded and confirmed complete
 *   'user_only'     — server returned data but only the user entity was found (suspicious)
 *   'empty_warned'  — server confirmed empty AND no prior cache — truly empty account
 *   'error'         — both cache and server failed; user must retry
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
    if (!parsed?.complete) return null;
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
 * Empty arrays are NEVER written as complete cache.
 */
export function writeCache(email, type, records) {
  if (!email) return;
  if (!Array.isArray(records) || records.length === 0) return;
  try {
    localStorage.setItem(cacheKey(email, type), JSON.stringify({
      complete: true,
      loaded_at: Date.now(),
      records,
    }));
  } catch {
    // localStorage quota exceeded — silently skip
  }
}

/**
 * Validate a character roster result before writing cache.
 *
 * Returns:
 *   { valid: true }                          — roster is complete, safe to cache and display
 *   { valid: false, reason: 'empty' }        — empty array, do not cache
 *   { valid: false, reason: 'user_only' }    — only the user entity returned; may be incomplete
 *                                              (do NOT overwrite existing cache; warn in UI)
 *
 * "user_only" is NOT treated as a confirmed empty account. The server may have returned a
 * partial result due to rate-limiting, filtering, or a query error. The existing cache must
 * be preserved and a warning must be shown rather than silently showing only the user.
 */
export function validateCharacterRoster(roster) {
  if (!Array.isArray(roster) || roster.length === 0) {
    return { valid: false, reason: 'empty' };
  }
  const nonUserEntries = roster.filter(c => !c.is_user);
  if (nonUserEntries.length === 0) {
    // Only the user entity — this is suspicious unless the account truly has no characters.
    // We cannot confirm that here, so we treat it as potentially incomplete.
    return { valid: false, reason: 'user_only' };
  }
  return { valid: true };
}

/**
 * Validate a location list result before writing cache.
 */
export function isValidLocationList(locations) {
  return Array.isArray(locations) && locations.length > 0;
}