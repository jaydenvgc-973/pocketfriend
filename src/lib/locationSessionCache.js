/**
 * locationSessionCache.js
 *
 * MODULE-LEVEL SINGLETON cache for fetchAllLocationsForUser results.
 *
 * WHY THIS EXISTS:
 * The Chat page's locationsSessionCacheRef (a useRef inside the component)
 * was being invalidated on every character switch, causing fetchAllLocationsForUser
 * to re-fire multiple times per second during active chat sessions. This generated
 * 4+ simultaneous 429 errors that starved Conversation.filter and Message.filter,
 * producing the "Chat is temporarily rate limited" screen.
 *
 * A module-level singleton persists across component mounts, unmounts, and
 * character switches for the entire browser session. Location data is stable
 * within a session (locations don't change while chatting), so this is safe.
 *
 * CACHE INVALIDATION:
 * - TTL: 10 minutes (locations are stable during a chat session)
 * - Manual: call invalidateLocationCache() after a location is created/edited
 * - Automatic: expires after TTL regardless
 *
 * RATE LIMIT PROTECTION:
 * - In-flight guard prevents duplicate concurrent fetches
 * - Waiters queue: concurrent callers wait for the in-flight fetch instead of
 *   firing their own, eliminating the "thundering herd" pattern.
 */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let _cache = null;         // { data: [...], fetchedAt: timestamp }
let _inFlight = null;      // Promise<array> when a fetch is in progress
let _waiters = [];         // resolve callbacks queued while fetch is in flight

/**
 * getLocations(fetchFn)
 *
 * Returns cached location data if fresh, otherwise calls fetchFn() exactly once
 * and queues any concurrent callers to receive the same result.
 *
 * @param {() => Promise<Array>} fetchFn  — async function that returns the locations array
 * @returns {Promise<Array>}
 */
export async function getLocations(fetchFn) {
  // Cache hit: return immediately
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }

  // In-flight: join the queue instead of firing another fetch
  if (_inFlight) {
    return new Promise((resolve, reject) => {
      _waiters.push({ resolve, reject });
    });
  }

  // Cache miss: start the fetch and hold a promise for waiters
  _inFlight = (async () => {
    try {
      const data = await fetchFn();
      _cache = { data, fetchedAt: Date.now() };
      // Resolve all queued waiters
      const w = _waiters.splice(0);
      w.forEach(({ resolve }) => resolve(data));
      return data;
    } catch (err) {
      // On error, reject all waiters and clear the in-flight lock
      const w = _waiters.splice(0);
      w.forEach(({ reject }) => reject(err));
      throw err;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/**
 * invalidateLocationCache()
 * Call after creating, editing, or deleting a location so the next
 * fetch gets fresh data.
 */
export function invalidateLocationCache() {
  _cache = null;
  console.log('[locationSessionCache] Cache invalidated');
}

/**
 * getLocationCacheAge()
 * Returns age of cached data in seconds, or null if not cached.
 */
export function getLocationCacheAge() {
  if (!_cache) return null;
  return Math.round((Date.now() - _cache.fetchedAt) / 1000);
}