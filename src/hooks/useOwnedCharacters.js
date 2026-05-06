/**
 * useOwnedCharacters
 *
 * Single shared hook that owns ALL character fetching for this app.
 * Consumed by Home, Travel, and any page that needs the full character universe.
 *
 * Source of truth: owner_email — sole ownership field. created_by is forbidden.
 *
 * Query keys are IDENTICAL to what Home used previously so the cache is shared
 * across page navigations — no re-fetch when switching Home ↔ Travel.
 *
 * placeholderData: (prev) => prev ensures the list NEVER flashes [] during background refetch.
 * isLoading (spinner) vs isFetching (background) are exposed separately.
 */

import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export function useOwnedCharacters(currentUser) {
  const email = currentUser?.email || null;
  const userId = currentUser?.id || null;

  // ── 1. ALL characters owned by this user (all types, all statuses) ──────────
  // Same key + fn as Home so the cache is shared — no double-fetch on nav.
  const {
    data: rlsCharacters = [],
    isLoading: isLoadingRls,
    isFetching: isFetchingRls,
  } = useQuery({
    queryKey: ["characters", email],
    queryFn: async () => {
      if (!email) return [];
      const chars = await base44.entities.Character.filter(
        { owner_email: email },
        "-created_date",
        300
      );
      return chars.filter(c => !c.is_test_character && !c.diagnostic_only);
    },
    enabled: !!email,
    staleTime: 5 * 60 * 1000,    // 5 min — reduce refetch frequency; realtime subscribe invalidates on mutations
    gcTime: 15 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    // Retry up to 3 times with exponential backoff, including on 429s
    retry: (failureCount, error) => {
      if (failureCount >= 3) return false;
      const is429 = error?.message?.includes('429') || error?.status === 429 || error?.response?.status === 429;
      return is429 || failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(3000 * 2 ** attemptIndex, 30000),
    // Keep previous data while refetching — prevents [] flash on background refetch
    placeholderData: (prev) => prev,
  });

  // ── 2. NPC fictitious via service-role backend ───────────────────────────────
  // Same key + fn as Home so the cache is shared.
  const {
    data: backendNpcs = [],
    isLoading: isLoadingNpc,
    isFetching: isFetchingNpc,
  } = useQuery({
    queryKey: ["npc-characters", userId],
    queryFn: async () => {
      if (!userId) return [];
      const res = await base44.functions.invoke("fetchNPCsForUser", {});
      return res?.data?.npcs || [];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (failureCount >= 3) return false;
      const is429 = error?.message?.includes('429') || error?.status === 429 || error?.response?.status === 429;
      return is429 || failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(3000 * 2 ** attemptIndex, 30000),
    placeholderData: (prev) => prev,
  });

  // ── Merge + dedupe by id ─────────────────────────────────────────────────────
  // rlsCharacters is the primary source. backendNpcs fills in service-role NPCs
  // that may not be visible through RLS.
  const allCharacters = (() => {
    const seen = new Set();
    return [...rlsCharacters, ...backendNpcs].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  // ── Derived character lists by type ─────────────────────────────────────────
  const activeCreated = allCharacters.filter(
    c => c.character_type === "active_created_character" && c.status !== "deleted"
  );
  const npcFictitious = allCharacters.filter(
    c => c.character_type === "npc_fictitious"
  );
  const npcFamilyMembers = allCharacters.filter(
    c => c.character_type === "npc_family_member"
  );
  const npcRegular = allCharacters.filter(
    c => c.character_type === "npc_regular"
  );

  // Travel "companions" — everything except npc_regular (which can't travel with user)
  const travelCompanions = [...activeCreated, ...npcFictitious, ...npcFamilyMembers];

  const isInitialLoading = (isLoadingRls && !rlsCharacters.length) || (isLoadingNpc && !backendNpcs.length);
  const isRefreshing = (isFetchingRls || isFetchingNpc) && !isInitialLoading;

  return {
    // Full merged universe
    allCharacters,
    // Typed slices
    activeCreated,
    npcFictitious,
    npcFamilyMembers,
    npcRegular,
    // Travel convenience
    travelCompanions,
    // Loading states
    isInitialLoading,
    isRefreshing,
    // Raw for legacy callers that need the unfiltered RLS set
    rlsCharacters,
    backendNpcs,
  };
}