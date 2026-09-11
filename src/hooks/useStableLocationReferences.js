/**
 * useStableLocationReferences
 *
 * SINGLE SOURCE OF TRUTH for the location list across Home, Travel, and all pages.
 *
 * Deletion-safe LKG (Last-Known-Good) stabilization rules — applied at the query layer:
 *
 *   SUSPECT fetch  → backend signaled failure → preserve LKG cache, never wipe
 *   EMPTY fetch    → 0 locations returned, cache exists → preserve LKG cache
 *   PARTIAL fetch  → incoming < 70% of last confirmed count → preserve LKG cache
 *   FULL fetch     → incoming ≥ 70% of last confirmed → accept, update LKG
 *                    (explicit user deletions propagate here because they produce a
 *                     confirmed full result: e.g. 35/36 = 97%, well above threshold)
 *
 * Query key:  ["locationReferences", ownerEmail]
 * Cache:      localFirstCache (localStorage) — no second cache system
 * Scope:      owner_email only — never crosses accounts
 *
 * The render-layer (LivePresenceMap) has a thin additional guard that only blocks
 * empty props — it does NOT merge/accumulate. All LKG logic lives here.
 */

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { lfcRead, lfcWrite } from "@/lib/localFirstCache.js";

/**
 * @param {string|null|undefined} ownerEmail  — from base44.auth.me().email
 * @returns {{ locationsData: Array, isLoading: boolean, isError: boolean }}
 */
export function useStableLocationReferences(ownerEmail) {
  const lastConfirmedCountRef = useRef(0);

  const { data: locationsData = [], isLoading, isError } = useQuery({
    queryKey: ["locationReferences", ownerEmail],



    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});

      if (!res?.data?.success) throw new Error(res?.data?.error || 'fetchAllLocationsForUser failed');
      const locs = res?.data?.locations || [];
      
      // Always accept fresh data — no caching tricks, no filtering
      if (ownerEmail) lfcWrite(ownerEmail, 'locations', locs);
      console.log(`[useStableLocationReferences] Fetched ${locs.length} locations`);
      return locs;
    },

    enabled: !!ownerEmail,
    staleTime: 0,                 // Always stale — ensures newly visible locations appear immediately
    gcTime:    30 * 60 * 1000,
    // 'always' is REQUIRED: other components (CommunityEventsStrip, Moments, Scene)
    // share this exact query key but set staleTime: 10min + refetchOnMount: false.
    // With plain `true`, refetchOnMount only fires if the query is stale AT MOUNT TIME.
    // If the Home page created the query with a 10-minute staleTime, the query is
    // "fresh" when Travel/Locations mounts, and `refetchOnMount: true` is a no-op —
    // the stale cache (which may predate a backend fix that added shared locations)
    // is shown indefinitely via placeholderData(prev=>prev). `refetchOnMount: 'always'`
    // forces a refetch on every mount regardless of inherited staleTime, so the
    // latest backend data — including regular-user-owned Shared locations —
    // always replaces any stale cache.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => attempt * 2000,
    placeholderData: (prev) => prev,
  });

  return { locationsData, isLoading, isError };
}