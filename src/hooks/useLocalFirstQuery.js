/**
 * useLocalFirstQuery — Stale-While-Refresh React Hook
 *
 * Drop-in replacement for useQuery patterns where resilience matters.
 * Behavior:
 *   1. Immediately returns localStorage cache if available (zero wait).
 *   2. Fires a background server fetch.
 *   3. Updates UI only when valid fresh data arrives.
 *   4. On failure: cached data stays, error is surfaced without wiping state.
 *   5. Never shows empty state if valid cache exists.
 *
 * All cache keys are owner_email scoped. No cross-account bleed.
 * No created_by logic.
 *
 * Usage:
 *   const { data, isLoading, isFetching, isFromCache, isStale, refetch } =
 *     useLocalFirstQuery({
 *       ownerEmail: user?.email,
 *       namespace: 'characters',
 *       fetchFn: () => base44.entities.Character.filter({ owner_email: email }),
 *       validator: (d) => Array.isArray(d) && d.length > 0,
 *       enabled: !!user?.email,
 *     });
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { lfcRead, lfcWrite, lfcIsStale } from '@/lib/localFirstCache.js';

// Re-export for convenience — callers can import everything from this hook
export { lfcRead, lfcWrite, lfcIsStale } from '@/lib/localFirstCache.js';

const DEFAULT_VALIDATOR = (data) => {
  if (Array.isArray(data)) return data.length > 0;
  return data !== null && data !== undefined;
};

/**
 * @param {object} opts
 * @param {string}   opts.ownerEmail       — required for cache scoping
 * @param {string}   opts.namespace        — cache namespace (e.g. 'characters', 'settings')
 * @param {function} opts.fetchFn          — async () => data
 * @param {function} [opts.validator]      — (data) => boolean
 * @param {any}      [opts.initialData]    — fallback before cache or server
 * @param {boolean}  [opts.enabled]        — default true
 * @param {boolean}  [opts.forceRefresh]   — always fetch, ignore cache age
 * @param {function} [opts.onFresh]        — (data) => void — called when fresh data arrives
 */
export function useLocalFirstQuery({
  ownerEmail,
  namespace,
  fetchFn,
  validator = DEFAULT_VALIDATOR,
  initialData = null,
  enabled = true,
  forceRefresh = false,
  onFresh = null,
}) {
  const [data, setData] = useState(() => {
    // Hydrate from cache synchronously on mount — no loading flash
    if (!ownerEmail || !namespace) return initialData;
    const cached = lfcRead(ownerEmail, namespace);
    return cached?.data ?? initialData;
  });

  const [isLoading, setIsLoading] = useState(() => {
    // isLoading is only true when we have NOTHING to show (no cache, no initialData)
    if (!ownerEmail || !namespace) return !!enabled;
    const cached = lfcRead(ownerEmail, namespace);
    return !cached && enabled;
  });

  const [isFetching, setIsFetching] = useState(false);
  const [isFromCache, setIsFromCache] = useState(() => {
    if (!ownerEmail || !namespace) return false;
    return !!lfcRead(ownerEmail, namespace);
  });
  const [isStale, setIsStale] = useState(() => {
    if (!ownerEmail || !namespace) return true;
    const cached = lfcRead(ownerEmail, namespace);
    return !cached || lfcIsStale(cached, namespace);
  });
  const [error, setError] = useState(null);
  const [fetchCount, setFetchCount] = useState(0);

  const fetchFnRef = useRef(fetchFn);
  const validatorRef = useRef(validator);
  const onFreshRef = useRef(onFresh);
  fetchFnRef.current = fetchFn;
  validatorRef.current = validator;
  onFreshRef.current = onFresh;

  const doFetch = useCallback(async () => {
    if (!ownerEmail || !namespace || !enabled) return;

    const cached = forceRefresh ? null : lfcRead(ownerEmail, namespace);
    const stale = !cached || lfcIsStale(cached, namespace);

    // If cache is valid and fresh, serve it without hitting the server
    if (cached && !stale) {
      setData(cached.data);
      setIsFromCache(true);
      setIsStale(false);
      setIsLoading(false);
      return;
    }

    // Show cache immediately while we fetch fresh data
    if (cached) {
      setData(cached.data);
      setIsFromCache(true);
      setIsStale(true);
      setIsLoading(false);
    }

    setIsFetching(true);
    setError(null);

    try {
      const fresh = await fetchFnRef.current();
      if (validatorRef.current(fresh)) {
        lfcWrite(ownerEmail, namespace, fresh);
        setData(fresh);
        setIsFromCache(false);
        setIsStale(false);
        setError(null);
        if (onFreshRef.current) onFreshRef.current(fresh);
      }
      // If validator rejects: keep cached data, don't update state
    } catch (err) {
      // On failure: keep cached data as-is, surface error without wiping
      setError(err?.message || 'Failed to load');
      // Do NOT clear data — cached data remains visible
    } finally {
      setIsFetching(false);
      setIsLoading(false);
    }
  }, [ownerEmail, namespace, enabled, forceRefresh]);

  // Run on mount and when dependencies change
  useEffect(() => {
    if (!enabled) return;
    doFetch();
  }, [doFetch, enabled, fetchCount]);

  const refetch = useCallback(() => {
    setFetchCount(c => c + 1);
  }, []);

  const forceRefetchNow = useCallback(async () => {
    if (!ownerEmail || !namespace || !enabled) return;
    setIsFetching(true);
    setError(null);
    try {
      const fresh = await fetchFnRef.current();
      if (validatorRef.current(fresh)) {
        lfcWrite(ownerEmail, namespace, fresh);
        setData(fresh);
        setIsFromCache(false);
        setIsStale(false);
        if (onFreshRef.current) onFreshRef.current(fresh);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load');
    } finally {
      setIsFetching(false);
    }
  }, [ownerEmail, namespace, enabled]);

  return {
    data: data ?? initialData,
    isLoading,
    isFetching,
    isFromCache,
    isStale,
    error,
    refetch,
    forceRefetch: forceRefetchNow,
  };
}