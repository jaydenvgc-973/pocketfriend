/**
 * vickServiceCache.js
 *
 * MODULE-LEVEL stable cache for the Vick Servicio npc_world_service record.
 *
 * WHY THIS EXISTS:
 * VickServiceCard was re-running a 4-path async lookup on every mount/unmount
 * (i.e., every page navigation). This caused the card to flicker between:
 *   - "Setting up..." skeleton (isLoading = true)
 *   - Fully loaded "Available" card (found = true)
 * ...every time the user navigated Chat → Home → Travel → Home.
 *
 * This cache lives at module scope (outside React) so it persists across all
 * route transitions for the lifetime of the browser session. Once Vick is
 * resolved, subsequent page mounts receive the cached record instantly with
 * zero async delay — eliminating the flicker entirely.
 *
 * RULES:
 * - Only a confirmed npc_world_service record is cached.
 * - The cache is never cleared on navigation, refresh of individual components,
 *   or query invalidation from unrelated character systems.
 * - The cache is only replaced if a fresher record is found (by checking
 *   updated_date). Stale lookups never overwrite a known-good record.
 * - If the cache is empty on mount, the full multi-path lookup runs once.
 *   Subsequent mounts skip the lookup entirely.
 */

let _cachedVick = null;
let _cachedOwnerEmail = null;
let _pendingPromise = null; // deduplicate simultaneous mounts

/**
 * Returns true if `c` is a Vick Servicio / npc_world_service record.
 */
export function isVickRecord(c) {
  if (!c) return false;
  if (c.character_type === 'npc_world_service') return true;
  if (c.is_world_service === true) return true;
  if (c.diagnostic_only === true) return true;
  const names = [c.name, c.display_name, c.primary_name].filter(Boolean).map(n => n.toLowerCase());
  return names.some(n => n.includes('vick servicio'));
}

/**
 * Resolve Vick's record using a stable module-level cache.
 *
 * - First call for a given ownerEmail: runs multi-path lookup and caches.
 * - Subsequent calls (same ownerEmail): returns cached record immediately.
 * - Simultaneous calls during the first lookup share one pending Promise.
 *
 * @param {string} ownerEmail
 * @param {Function} resolveFn - async () => Character | null  (injected by caller)
 * @returns {Promise<Character|null>}
 */
export async function getOrResolveVick(ownerEmail, resolveFn) {
  // Cache hit — return instantly, no re-fetch, no flicker
  if (_cachedVick && _cachedOwnerEmail === ownerEmail) {
    return _cachedVick;
  }

  // Different owner (account switch) — clear cache and re-resolve
  if (_cachedOwnerEmail && _cachedOwnerEmail !== ownerEmail) {
    _cachedVick = null;
    _cachedOwnerEmail = null;
    _pendingPromise = null;
  }

  // Deduplicate: if another mount is already fetching, share the same promise
  if (_pendingPromise) {
    return _pendingPromise;
  }

  _pendingPromise = resolveFn().then(found => {
    if (found) {
      _cachedVick = found;
      _cachedOwnerEmail = ownerEmail;
    }
    _pendingPromise = null;
    return found;
  }).catch(err => {
    _pendingPromise = null;
    console.warn('[vickServiceCache] Resolution failed:', err?.message);
    return null;
  });

  return _pendingPromise;
}

/**
 * Update the cached record in-place when a fresher version is available
 * (e.g., after ensureVickServicio runs and writes new fields).
 * Only replaces if the new record is actually newer or the cache is empty.
 */
export function updateVickCache(record) {
  if (!record || !isVickRecord(record)) return;
  if (!_cachedVick) {
    _cachedVick = record;
    return;
  }
  // Replace only if newer
  const cachedTs = _cachedVick.updated_date ? new Date(_cachedVick.updated_date).getTime() : 0;
  const newTs = record.updated_date ? new Date(record.updated_date).getTime() : 0;
  if (newTs >= cachedTs) {
    _cachedVick = record;
  }
}

/**
 * Peek at the current cached Vick record without triggering any fetch.
 * Returns null if not yet resolved.
 */
export function getCachedVick() {
  return _cachedVick;
}