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

// MIN_AUTHORITATIVE_COUNT: a fetch that returns <= this value is treated as suspect
// unless there is an existing known-good record that also shows <= this value.
// This prevents a partial/poisoned fetch from becoming the new baseline.
const MIN_AUTHORITATIVE_COUNT = 1;

function writeBootstrapMeta(email, count) {
  try {
    const existing = readBootstrapMeta(email);
    // COMPLETENESS GUARD: only update the count if this fetch looks authoritative.
    // A fetch of <= MIN_AUTHORITATIVE_COUNT is suspect unless:
    //   (a) a prior known-good count also shows <= MIN_AUTHORITATIVE_COUNT (account truly tiny), OR
    //   (b) count > MIN_AUTHORITATIVE_COUNT (clearly not a partial result)
    const priorCount = existing?.lastSuccessfulCount ?? null;
    const isSuspect = count <= MIN_AUTHORITATIVE_COUNT && (priorCount === null || priorCount > MIN_AUTHORITATIVE_COUNT);
    if (isSuspect) {
      console.warn(
        `[useOwnedCharacters] Bootstrap: refusing to bless suspect fetch. ` +
        `fetchedCount=${count} priorCount=${priorCount ?? 'none'} — recovery stays eligible.`
      );
      return; // do NOT write — keep prior metadata intact
    }
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
      return chars.filter(c => !c.is_test_character && !c.diagnostic_only);
      // NOTE: writeBootstrapMeta is intentionally NOT called here.
      // It is called in the bootstrap useEffect after allCharacters (merged) is evaluated,
      // so the stored count reflects the full universe (RLS + backendNpcs), not just this slice.
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

  // ── Merge + dedupe by id ─────────────────────────────────────────────────────
  // MUST be declared before the bootstrap useEffect so allCharacters.length is available.
  const allCharacters = (() => {
    const seen = new Set();
    return [...rlsCharacters, ...backendNpcs].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  // ── BOOTSTRAP GUARD ──────────────────────────────────────────────────────────
  // Evaluates the MERGED allCharacters count (RLS + backendNpcs) — not just the RLS slice —
  // so NPCs are counted correctly and a partial RLS result combined with NPCs can still pass.
  //
  // Triggers recovery if:
  //   A) Merged list is empty after loading completes
  //   B) Merged count is suspiciously smaller than the last known-good count
  //   C) Merged count is <= MIN_AUTHORITATIVE_COUNT and no prior baseline exists (suspect first fetch)
  //
  // On good result: writes the merged count as the new authoritative baseline.
  // On suspect result: does NOT write — keeps recovery eligible for the next mount.
  useEffect(() => {
    if (!email) return;
    // Wait for both queries to finish their initial load before evaluating
    if (isLoadingRls || isLoadingNpc) return;
    // Don't evaluate while a refetch is in-flight — wait for stable data
    if (isFetchingRls || isFetchingNpc) return;

    if (recoveryFiredRef.current) return;

    // Use the fully merged count — this is the actual visible universe
    const mergedCount = allCharacters.length;
    const meta = readBootstrapMeta(email);
    const priorCount = meta?.lastSuccessfulCount ?? null;

    // Determine if this looks like a partial/poisoned cache
    const isPartialVsPrior = priorCount !== null && mergedCount < priorCount - 1;
    const isSuspectFirstFetch = priorCount === null && mergedCount <= MIN_AUTHORITATIVE_COUNT;
    const isEmpty = mergedCount === 0;

    const needsRecovery = isEmpty || isPartialVsPrior || isSuspectFirstFetch;

    if (!needsRecovery) {
      // Cache looks complete — record the authoritative merged count
      // writeBootstrapMeta's internal guard will refuse if the count is still suspect
      writeBootstrapMeta(email, mergedCount);
      return;
    }

    // Cache is partial or suspect — trigger one controlled recovery fetch if not cooling down
    if (isBootstrapCoolingDown(email)) {
      console.log(
        `[useOwnedCharacters] Bootstrap: partial cache detected but cooldown active. ` +
        `mergedCount=${mergedCount} priorCount=${priorCount ?? 'none'}`
      );
      return;
    }

    // Mark as fired — prevents double-fire on StrictMode double-invoke
    recoveryFiredRef.current = true;

    console.warn(
      `[useOwnedCharacters] Bootstrap recovery triggered. ` +
      `mergedCount=${mergedCount} | priorCount=${priorCount ?? 'none'} | ` +
      `isEmpty=${isEmpty} | isPartialVsPrior=${isPartialVsPrior} | isSuspectFirstFetch=${isSuspectFirstFetch} | ` +
      `email=${email}`
    );

    // Stamp a cooldown timestamp NOW (before fetch) so rapid re-mounts don't pile up
    try {
      const existing = readBootstrapMeta(email);
      sessionStorage.setItem(ssKey(email), JSON.stringify({
        ...(existing || {}),
        lastFetchAt: Date.now(),
        email,
        // Deliberately do NOT update lastSuccessfulCount here — the fetch hasn't run yet
      }));
    } catch {}

    refetchRls();
  }, [email, isLoadingRls, isLoadingNpc, isFetchingRls, isFetchingNpc, allCharacters.length]);

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