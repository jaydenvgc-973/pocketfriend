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

    // Serve from localStorage immediately — prevents empty-flash on first mount
    initialData: () => {
      if (!ownerEmail) return undefined;
      const lfc = lfcRead(ownerEmail, 'locations');
      if (lfc?.data?.length > 0) {
        lastConfirmedCountRef.current = lfc.data.length;
        return lfc.data;
      }
      return undefined;
    },
    initialDataUpdatedAt: () => {
      if (!ownerEmail) return undefined;
      const lfc = lfcRead(ownerEmail, 'locations');
      return lfc?.loaded_at ?? undefined;
    },

    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});

      // ── SUSPECT: backend explicitly signaled a failure ──────────────────────
      if (res?.data?.locations_query_suspect) {
        const cached = lfcRead(ownerEmail, 'locations');
        if (cached?.data?.length > 0) {
          console.warn('[useStableLocationReferences] locations_query_suspect — LKG preserved:', cached.data.length);
          return cached.data;
        }
        throw new Error('Location query suspect and no LKG cache available.');
      }

      if (!res?.data?.success) throw new Error(res?.data?.error || 'fetchAllLocationsForUser failed');
      const locs = res?.data?.locations || [];
      const lastConfirmed = lastConfirmedCountRef.current;

      // ── EMPTY: never replace a valid cache with nothing ─────────────────────
      if (locs.length === 0) {
        const cached = lfcRead(ownerEmail, 'locations');
        if (cached?.data?.length > 0) {
          console.warn('[useStableLocationReferences] Empty fetch — LKG preserved:', cached.data.length);
          return cached.data;
        }
        // Genuinely empty account (no prior cache) — accept
        return locs;
      }

      // ── PARTIAL: incoming < 70% of last confirmed → suspect rate-limit / truncation ──
      // Deletions do NOT trigger this path: one deleted location = 97%+ of prior count.
      if (lastConfirmed > 0 && locs.length < lastConfirmed * 0.7) {
        const cached = lfcRead(ownerEmail, 'locations');
        if (cached?.data?.length > 0) {
          console.warn(`[useStableLocationReferences] Partial fetch (${locs.length} vs confirmed ${lastConfirmed}) — LKG preserved:`, cached.data.length);
          return cached.data;
        }
      }

      // ── CONFIRMED FULL: accept, update LKG, deletions propagate here ────────
      lastConfirmedCountRef.current = locs.length;
      if (ownerEmail) lfcWrite(ownerEmail, 'locations', locs);
      return locs;
    },

    enabled: !!ownerEmail,
    staleTime: 10 * 60 * 1000,   // 10 min — location data is very stable
    gcTime:    30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
    retryDelay: (attempt) => attempt * 2000,
    placeholderData: (prev) => prev,
  });

  return { locationsData, isLoading, isError };
}