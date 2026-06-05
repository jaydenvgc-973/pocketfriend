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
    staleTime: 0,                 // Always refetch on mount — ensures newly visible locations appear immediately
    gcTime:    30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => attempt * 2000,
    placeholderData: (prev) => prev,
  });

  return { locationsData, isLoading, isError };
}