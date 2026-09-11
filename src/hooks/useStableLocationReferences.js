/**
 * useStableLocationReferences
 *
 * SINGLE SOURCE OF TRUTH for the location list across Home, Travel, and all pages.
 *
 * Query key:  ["locationReferences", ownerEmail]
 * Cache:      localFirstCache (localStorage) — write-through backup only, never read
 *
 * The backend function `fetchAllLocationsForUser` returns:
 *   - Query 1: all locations owned by the current user (owner_email-scoped)
 *   - Query 2: ALL shared locations (scope='shared'), regardless of owner
 * Combined, these include regular-user-owned Shared locations visible to admins.
 *
 * refetchOnMount: 'always' is REQUIRED because other components
 * (CommunityEventsStrip, Moments, Scene, OccupationLocationPicker) share this
 * exact query key but set staleTime: 10min + refetchOnMount: false. With plain
 * `true`, refetchOnMount only fires if the query is stale AT MOUNT TIME. If the
 * Home page created the query with a 10-minute staleTime, the query is "fresh"
 * when Travel/Locations mounts, and `refetchOnMount: true` is a no-op.  `'always'`
 * forces a refetch on every mount regardless of inherited staleTime, so the
 * latest backend data always replaces any stale cache.
 */

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { lfcWrite, lfcRead } from "@/lib/localFirstCache.js";

/**
 * @param {string|null|undefined} ownerEmail  — from base44.auth.me().email
 * @returns {{ locationsData: Array, isLoading: boolean, isError: boolean }}
 */
export function useStableLocationReferences(ownerEmail) {
  const queryClient = useQueryClient();
  const lastLoggedRef = useRef(null);

  const { data: locationsData = [], isLoading, isError } = useQuery({
    queryKey: ["locationReferences", ownerEmail],

    // Seed from localStorage so shared locations survive hard refresh.
    // Previously, this hook had NO initialData. On hard refresh, the React Query
    // cache was destroyed and locationsData = [] until the refetch completed.
    // If the refetch was slow or failed (rate limit from simultaneous queries),
    // shared locations stayed missing. The lfcWrite below already wrote a backup;
    // this initialData reads it back so the UI renders immediately on refresh.
    initialData: () => {
      if (!ownerEmail) return undefined;
      const lfc = lfcRead(ownerEmail, 'locations');
      return lfc?.data?.length > 0 ? lfc.data : undefined;
    },
    initialDataUpdatedAt: () => {
      if (!ownerEmail) return undefined;
      const lfc = lfcRead(ownerEmail, 'locations');
      return lfc?.loaded_at ?? undefined;
    },

    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});

      if (!res?.data?.success) throw new Error(res?.data?.error || 'fetchAllLocationsForUser failed');
      const locs = res?.data?.locations || [];

      // Instrumentation: log shared-location distribution for diagnostics
      const sharedLocs = locs.filter(l => l.scope === 'shared' || l.location_type === 'shared');
      const sharedByOwner = {};
      sharedLocs.forEach(l => {
        const owner = l.owner_email || 'unknown';
        sharedByOwner[owner] = (sharedByOwner[owner] || 0) + 1;
      });
      console.log(
        `[useStableLocationReferences] queryFn: ${locs.length} locations (${sharedLocs.length} shared)`,
        JSON.stringify(sharedByOwner),
        'summary:', JSON.stringify(res?.data?.summary)
      );

      // Write-through to LFC (backup — now read back as initialData on refresh)
      if (ownerEmail) lfcWrite(ownerEmail, 'locations', locs);
      return locs;
    },

    enabled: !!ownerEmail,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => attempt * 2000,
    placeholderData: (prev) => prev,
  });

  // Cache-change tracker: logs every transition for the locationReferences query.
  // This captures the exact present → missing transition during refresh.
  useEffect(() => {
    if (!ownerEmail) return;
    const queryKey = ["locationReferences", ownerEmail];
    const queryCache = queryClient.getQueryCache();
    const unsubscribe = queryCache.subscribe((event) => {
      const query = event.query;
      if (!query?.queryKey || query.queryKey[0] !== 'locationReferences') return;
      if (query.queryKey[1] !== ownerEmail) return;

      const data = query.state.data;
      if (!Array.isArray(data)) return;

      const sharedLocs = data.filter(l => l.scope === 'shared' || l.location_type === 'shared');
      const sharedByOwner = {};
      sharedLocs.forEach(l => {
        const owner = l.owner_email || 'unknown';
        sharedByOwner[owner] = (sharedByOwner[owner] || 0) + 1;
      });

      const signature = `${data.length}:${sharedLocs.length}:${JSON.stringify(sharedByOwner)}`;
      if (lastLoggedRef.current === signature) return; // dedupe
      lastLoggedRef.current = signature;

      console.log(
        `[useStableLocationReferences] cache event (${event.type}): ${data.length} locations (${sharedLocs.length} shared)`,
        JSON.stringify(sharedByOwner),
        'status:', query.state.status,
        'fetchStatus:', query.state.fetchStatus
      );
    });
    return unsubscribe;
  }, [ownerEmail, queryClient]);

  return { locationsData, isLoading, isError };
}