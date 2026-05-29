/**
 * LOCAL-FIRST CACHE — App-Wide Persistent Storage Layer
 *
 * Provides owner-scoped, stale-while-refresh caching backed by localStorage.
 *
 * RULES:
 *  - All keys are always scoped by owner_email. No cross-account bleed. Ever.
 *  - Only valid, non-empty data is written. Failures never overwrite good cache.
 *  - Stale data is still shown immediately while a background refresh runs.
 *  - No created_by logic. No shared pools. No cross-user fallback.
 *
 * STALE THRESHOLDS (by data type):
 *  - characters:   10 min  — relatively stable, expensive to fetch
 *  - settings:     15 min  — rarely changes during a session
 *  - locations:    15 min  — structural, very stable
 *  - messages:      2 min  — frequently updated
 *  - communityEvents: 10 min
 *  - roster:       10 min  — full unified roster snapshot
 *  - generic:       5 min
 */

const STALE_THRESHOLDS = {
  characters:      10 * 60 * 1000,
  settings:        15 * 60 * 1000,
  locations:       15 * 60 * 1000,
  messages:         2 * 60 * 1000,
  communityEvents: 10 * 60 * 1000,
  roster:          10 * 60 * 1000,
  achievements:    10 * 60 * 1000,
  moments:         10 * 60 * 1000,
  unread:           2 * 60 * 1000,
  worldContacts:    5 * 60 * 1000,
  scenes:          15 * 60 * 1000,
  closet:          15 * 60 * 1000,
  relationships:   10 * 60 * 1000,
  profiles:        10 * 60 * 1000,
  generic:          5 * 60 * 1000,
};

const PREFIX = 'lfc:'; // local-first cache namespace

function key(ownerEmail, namespace) {
  return `${PREFIX}${ownerEmail}:${namespace}`;
}

/**
 * Read cached data. Returns { data, loaded_at } or null.
 * Never returns empty arrays or null data as a valid cache entry.
 */
export function lfcRead(ownerEmail, namespace) {
  if (!ownerEmail || !namespace) return null;
  try {
    const raw = localStorage.getItem(key(ownerEmail, namespace));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.loaded_at) return null;
    // Arrays must have at least one item to be a valid cache entry
    if (Array.isArray(parsed.data) && parsed.data.length === 0) return null;
    if (parsed.data === null || parsed.data === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write data to cache. Only writes if data is valid and non-empty.
 * Empty arrays, null, and undefined are NEVER written.
 */
export function lfcWrite(ownerEmail, namespace, data) {
  if (!ownerEmail || !namespace) return false;
  if (data === null || data === undefined) return false;
  if (Array.isArray(data) && data.length === 0) return false;
  // NOTE: Objects with total=0 (e.g. unread count objects) are VALID writes.
  // They must be written to overwrite stale positive counts.
  // Only arrays with length=0 are blocked above.
  try {
    localStorage.setItem(key(ownerEmail, namespace), JSON.stringify({
      data,
      loaded_at: Date.now(),
    }));
    return true;
  } catch {
    // localStorage quota exceeded — silently skip
    return false;
  }
}

/**
 * Check if a cached entry is stale.
 * Stale = should trigger a background refresh, but still safe to show.
 */
export function lfcIsStale(cached, namespace = 'generic') {
  if (!cached?.loaded_at) return true;
  const threshold = STALE_THRESHOLDS[namespace] ?? STALE_THRESHOLDS.generic;
  return Date.now() - cached.loaded_at > threshold;
}

/**
 * Delete a specific cache entry (e.g. after explicit user action).
 */
export function lfcDelete(ownerEmail, namespace) {
  if (!ownerEmail || !namespace) return;
  try {
    localStorage.removeItem(key(ownerEmail, namespace));
  } catch {}
}

/**
 * Delete ALL cache entries for an owner (e.g. on logout).
 */
export function lfcClearOwner(ownerEmail) {
  if (!ownerEmail) return;
  try {
    const prefix = `${PREFIX}${ownerEmail}:`;
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  } catch {}
}

/**
 * HIGH-LEVEL: stale-while-revalidate fetch.
 *
 * 1. Returns cached data immediately if available (stale or fresh).
 * 2. If cache is stale or missing, fires a background fetch via fetchFn.
 * 3. On successful fetch, writes to cache and calls onFresh(data).
 * 4. onFresh is ONLY called if the fresh data passes the validator.
 * 5. On fetch failure, cached data remains intact and in use.
 *
 * @param {object} opts
 * @param {string}   opts.ownerEmail
 * @param {string}   opts.namespace
 * @param {function} opts.fetchFn       - async function that returns fresh data
 * @param {function} [opts.validator]   - (data) => boolean — default: non-empty array or truthy object
 * @param {function} [opts.onFresh]     - (data) => void — called when fresh data arrives
 * @param {boolean}  [opts.forceRefresh] - skip cache, always fetch
 * @returns {{ data: any|null, fromCache: boolean, stale: boolean }}
 */
export async function lfcFetch({
  ownerEmail,
  namespace,
  fetchFn,
  validator = defaultValidator,
  onFresh = null,
  forceRefresh = false,
}) {
  const cached = forceRefresh ? null : lfcRead(ownerEmail, namespace);
  const isStale = !cached || lfcIsStale(cached, namespace);

  // Serve cache immediately
  const result = {
    data: cached?.data ?? null,
    fromCache: !!cached,
    stale: isStale,
  };

  // If cache is fresh and valid, no server call needed
  if (cached && !isStale) return result;

  // Fire background (or awaited) refresh
  try {
    const fresh = await fetchFn();
    if (validator(fresh)) {
      lfcWrite(ownerEmail, namespace, fresh);
      if (onFresh) onFresh(fresh);
      result.data = fresh;
      result.fromCache = false;
      result.stale = false;
    }
  } catch {
    // Failure: cached data (if any) remains valid and in use
  }

  return result;
}

function defaultValidator(data) {
  if (Array.isArray(data)) return data.length > 0;
  return data !== null && data !== undefined;
}

/**
 * LAST-KNOWN-GOOD PROTECTION: Read with floor guard.
 *
 * Same as lfcRead() but with an extra check: if the cached data is an array
 * and its length is LESS than floorCount, reject it (treat as stale/partial).
 * This prevents a partial server refresh from replacing a larger known-good cache.
 *
 * Use when you know "at minimum X records should exist" (e.g. character roster).
 *
 * @param {string} ownerEmail
 * @param {string} namespace
 * @param {number} floorCount - minimum valid array length (default 1)
 * @returns {{ data: any, loaded_at: number } | null}
 */
export function lfcReadWithFloor(ownerEmail, namespace, floorCount = 1) {
  const cached = lfcRead(ownerEmail, namespace);
  if (!cached) return null;
  if (Array.isArray(cached.data) && cached.data.length < floorCount) {
    console.warn(`[LFC] lfcReadWithFloor: FLOOR GUARD — cached ${namespace} has ${cached.data.length} items (floor=${floorCount}), rejecting partial cache`);
    return null;
  }
  return cached;
}

/**
 * Get a human-readable diagnostic snapshot for a given owner.
 * Used by admin/dev troubleshooting panels.
 */
export function lfcDiagnostics(ownerEmail) {
  if (!ownerEmail) return {};
  const prefix = `${PREFIX}${ownerEmail}:`;
  const result = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      const ns = k.slice(prefix.length);
      try {
        const parsed = JSON.parse(localStorage.getItem(k));
        const count = Array.isArray(parsed?.data) ? parsed.data.length : (parsed?.data ? 1 : 0);
        result[ns] = {
          count,
          loaded_at: parsed?.loaded_at ? new Date(parsed.loaded_at).toISOString() : null,
          age_ms: parsed?.loaded_at ? Date.now() - parsed.loaded_at : null,
          stale: lfcIsStale(parsed, ns),
        };
      } catch {
        result[ns] = { error: 'parse_failure' };
      }
    }
  } catch {}
  return result;
}