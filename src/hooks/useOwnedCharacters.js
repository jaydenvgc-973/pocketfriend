/**
 * useOwnedCharacters
 *
 * Single shared hook that owns ALL character fetching for this app.
 * Consumed by Home, Travel, and any page that needs the full character universe.
 *
 * Source of truth: owner_email — sole ownership field. created_by is forbidden.
 *
 * BOOTSTRAP GUARD:
 * - On session start, if the in-memory cache is empty or partial, one controlled
 *   recovery fetch fires automatically (max once per BOOTSTRAP_COOLDOWN_MS).
 * - "Partial" = cache has fewer characters than the last known successful count
 *   stored in sessionStorage for this owner_email.
 * - A partial cache is NEVER treated as authoritative. It is kept visible while
 *   recovery runs, but the smaller list never replaces the last known good count.
 * - refetchOnMount/refetchOnWindowFocus remain false — aggressive refetch is the
 *   root cause of rate-limit storms and must stay disabled.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

// Bootstrap cooldown — max one recovery fetch per owner_email per this window
const BOOTSTRAP_COOLDOWN_MS = 8 * 60 * 1000; // 8 minutes

// sessionStorage keys
const ssKey = (email) => `char_bootstrap_${email}`;

function readBootstrapMeta(email) {
  try {
    const raw = sessionStorage.getItem(ssKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeBootstrapMeta(email, count) {
  try {
    sessionStorage.setItem(ssKey(email), JSON.stringify({
      lastFetchAt: Date.now(),
      lastSuccessfulCount: count,
      email,
    }));
  } catch {}
}

function isBootstrapCoolingDown(email) {
  const meta = readBootstrapMeta(email);
  if (!meta?.lastFetchAt) return false;
  return (Date.now() - meta.lastFetchAt) < BOOTSTRAP_COOLDOWN_MS;
}

function isCachePartial(email, currentCount) {
  const meta = readBootstrapMeta(email);
  if (!meta) return false; // no prior record — can't call it partial
  // Partial: current count is suspiciously less than last known good count
  // Allow a tolerance of 1 (user may have deleted a character)
  return currentCount < meta.lastSuccessfulCount - 1;
}

export function useOwnedCharacters(currentUser) {
  const email = currentUser?.email || null;
  const userId = currentUser?.id || null;
  const queryClient = useQueryClient();
  const recoveryFiredRef = useRef(false);

  // ── 1. ALL characters owned by this user (all types, all statuses) ──────────
  const {
    data: rlsCharacters = [],
    isLoading: isLoadingRls,
    isFetching: isFetchingRls,
    refetch: refetchRls,
  } = useQuery({
    queryKey: ["characters", email],
    queryFn: async () => {
      if (!email) return [];
      const chars = await base44.entities.Character.filter(
        { owner_email: email },
        "-created_date",
        300
      );
      const filtered = chars.filter(c => !c.is_test_character && !c.diagnostic_only);
      // Record this successful fetch count — used by bootstrap guard on next session
      writeBootstrapMeta(email, filtered.length);
      return filtered;
    },
    enabled: !!email,
    // 5 min stale time — real-time subscription patches records surgically.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Disabled — aggressive refetch is the root cause of rate-limit storms.
    // Recovery is handled by the bootstrap guard below instead.
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (failureCount >= 3) return false;
      const is429 = error?.message?.includes('429') || error?.status === 429 || error?.response?.status === 429;
      return is429 || failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(3000 * 2 ** attemptIndex, 30000),
    placeholderData: (prev) => prev,
  });

  // ── BOOTSTRAP GUARD ──────────────────────────────────────────────────────────
  // Fires once per session per owner_email when the cache looks empty or partial.
  //
  // Triggers if:
  //   A) RLS query is done loading but returned 0 records (empty cache, first session load)
  //   B) Current count is less than last known successful count (partial/poisoned cache)
  //
  // Never fires if:
  //   - Still loading
  //   - Cooldown is active (within BOOTSTRAP_COOLDOWN_MS of last fetch)
  //   - Already fired this render cycle
  //   - No email (unauthenticated)
  useEffect(() => {
    if (!email || isLoadingRls || isFetchingRls) return;
    if (recoveryFiredRef.current) return;
    if (isBootstrapCoolingDown(email)) return;

    const currentCount = rlsCharacters.length;
    const needsBootstrap = currentCount === 0 || isCachePartial(email, currentCount);

    if (!needsBootstrap) {
      // Cache looks good — update the known-good count if we have data and no prior record
      const meta = readBootstrapMeta(email);
      if (!meta && currentCount > 0) {
        writeBootstrapMeta(email, currentCount);
      }
      return;
    }

    // Mark as fired before the async call — prevents double-fire on StrictMode double-invoke
    recoveryFiredRef.current = true;

    console.log(
      `[useOwnedCharacters] Bootstrap recovery triggered. ` +
      `currentCount=${currentCount} | ` +
      `lastKnown=${readBootstrapMeta(email)?.lastSuccessfulCount ?? 'none'} | ` +
      `email=${email}`
    );

    // One controlled recovery fetch — result writes back through queryFn which updates
    // writeBootstrapMeta with the new authoritative count.
    refetchRls();
  }, [email, isLoadingRls, isFetchingRls, rlsCharacters.length]);

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