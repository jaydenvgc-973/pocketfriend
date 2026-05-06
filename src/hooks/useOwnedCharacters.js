/**
 * useOwnedCharacters
 *
 * Single shared hook that owns ALL character fetching for this app.
 * Consumed by Home, Travel, and any page that needs the full character universe.
 *
 * Source of truth: owner_email — sole ownership field. created_by is forbidden.
 *
 * LAST-KNOWN-GOOD PROTECTION SYSTEM:
 *
 * Three layers prevent a partial refresh from collapsing the Home list:
 *
 * Layer 1 — Merged snapshot (sessionStorage: char_merged_snapshot_<email>)
 *   Written whenever allCharacters stabilizes to a count larger than the prior snapshot.
 *   Stores the full merged ID list. Used by queryFn as the authoritative floor baseline.
 *   Never lowered — only grows.
 *
 * Layer 2 — queryFn floor guard
 *   Before returning a fresh RLS result, the queryFn projects the merged count
 *   (fresh RLS + current NPC cache) and compares it to the merged snapshot count.
 *   If the projected count is suspiciously smaller (> 1-char tolerance), the fresh
 *   result is merged into the existing RLS cache instead of replacing it.
 *   Secondary floor: also checks current RLS cache length (handles no-snapshot case).
 *
 * Layer 3 — Bootstrap guard
 *   After both queries stabilize, evaluates the merged universe against the snapshot
 *   and anchor presence. Triggers one controlled recovery fetch if the result is partial.
 *   recoveryFiredRef resets between sessions via the email dependency.
 *
 * ANCHOR VALIDATION RULE (ANY, not ALL):
 *   Load is valid if AT LEAST ONE configured anchor ID is present.
 *   NONE present (when anchors are configured) = incomplete load → recovery.
 *
 * SNAPSHOT WRITER:
 *   Separate effect — writes the merged snapshot whenever allCharacters grows beyond
 *   the current snapshot. Does not wait for the bootstrap guard to pass.
 *   This ensures the floor is established on the FIRST successful load, before any
 *   background invalidation can trigger a partial refetch.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

const BOOTSTRAP_COOLDOWN_MS = 8 * 60 * 1000; // 8 minutes

// ── sessionStorage helpers ────────────────────────────────────────────────────
const ssBootstrapKey  = (email) => `char_bootstrap_${email}`;
const ssMergedKey     = (email) => `char_merged_snapshot_${email}`;

function readBootstrapMeta(email) {
  try {
    const raw = sessionStorage.getItem(ssBootstrapKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const MIN_AUTHORITATIVE_COUNT = 1;

function writeBootstrapMeta(email, count) {
  try {
    const existing = readBootstrapMeta(email);
    const priorCount = existing?.lastSuccessfulCount ?? null;
    const isSuspect = count <= MIN_AUTHORITATIVE_COUNT &&
      (priorCount === null || priorCount > MIN_AUTHORITATIVE_COUNT);
    if (isSuspect) {
      console.warn(`[useOwnedCharacters] Bootstrap: refusing to bless suspect fetch. count=${count} prior=${priorCount ?? 'none'}`);
      return;
    }
    sessionStorage.setItem(ssBootstrapKey(email), JSON.stringify({
      lastFetchAt: Date.now(), lastSuccessfulCount: count, email,
    }));
  } catch {}
}

function isBootstrapCoolingDown(email) {
  const meta = readBootstrapMeta(email);
  if (!meta?.lastFetchAt) return false;
  return (Date.now() - meta.lastFetchAt) < BOOTSTRAP_COOLDOWN_MS;
}

// ── Merged snapshot ───────────────────────────────────────────────────────────
function readMergedSnapshot(email) {
  try {
    const raw = sessionStorage.getItem(ssMergedKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Write merged snapshot ONLY if it would grow the stored count (never lower the floor).
 * Called from two places:
 *   1. The dedicated snapshot-writer effect (fires on any allCharacters growth)
 *   2. The bootstrap guard effect (after full validation passes)
 */
function writeMergedSnapshot(email, ids, count) {
  try {
    const existing = readMergedSnapshot(email);
    if (existing && count <= existing.count - 1) {
      // Refuse to lower the floor
      return;
    }
    sessionStorage.setItem(ssMergedKey(email), JSON.stringify({
      ids, count, savedAt: Date.now(),
    }));
  } catch {}
}

export function useOwnedCharacters(
  currentUser,
  expectedDefaultCharacterId = null,
  anchorCharacterIds = []
) {
  const email  = currentUser?.email || null;
  const userId = currentUser?.id    || null;
  const queryClient = useQueryClient();
  const recoveryFiredRef = useRef(false);

  // Reset recoveryFiredRef when email changes (new session / account switch)
  const prevEmailRef = useRef(null);
  if (prevEmailRef.current !== email) {
    prevEmailRef.current = email;
    recoveryFiredRef.current = false;
  }

  // ── 1. RLS characters ────────────────────────────────────────────────────────
  const {
    data: rlsCharacters = [],
    isLoading: isLoadingRls,
    isFetching: isFetchingRls,
    refetch: refetchRls,
  } = useQuery({
    queryKey: ["characters", email],
    queryFn: async () => {
      if (!email) return [];

      // ── FLOOR GUARD ──────────────────────────────────────────────────────────
      // Read the merged snapshot (authoritative floor) and the current NPC cache.
      // We project what the merged universe will look like after this RLS result
      // is combined with the current NPC cache, before any effect can run.
      const mergedSnapshot  = readMergedSnapshot(email);
      const snapshotCount   = mergedSnapshot?.count || 0;
      const currentNpcs     = queryClient.getQueryData(["npc-characters", userId]) || [];
      const currentRlsCache = queryClient.getQueryData(["characters", email]) || [];

      // Oldest-first: partial/rate-limited results return foundational characters
      // (Ethan, Melody) rather than the newest-created one (Shiloh).
      const fresh = await base44.entities.Character.filter(
        { owner_email: email },
        "created_date",
        300
      );
      const freshFiltered = fresh.filter(c => !c.is_test_character && !c.diagnostic_only);

      // Project merged count after combining fresh RLS with current NPC cache
      const projectedMergedCount = (() => {
        const seen = new Set(freshFiltered.map(c => c.id));
        let count = freshFiltered.length;
        for (const npc of currentNpcs) {
          if (!seen.has(npc.id)) count++;
        }
        return count;
      })();

      // PRIMARY floor: compare projected merged count against the stored snapshot.
      // SECONDARY floor: compare fresh RLS count against current RLS cache length.
      // Either floor triggers the merge guard. This handles the no-snapshot case
      // (first load of session) where snapshotCount may be 0 but the RLS cache
      // already has a good list from the initial successful fetch.
      const primaryFloorBreach  = snapshotCount > 0 && projectedMergedCount < snapshotCount - 1;
      const secondaryFloorBreach = currentRlsCache.length > 1 && freshFiltered.length < currentRlsCache.length - 1;

      if (primaryFloorBreach || secondaryFloorBreach) {
        const reason = primaryFloorBreach
          ? `projected merged (${projectedMergedCount}) < snapshot (${snapshotCount})`
          : `fresh RLS (${freshFiltered.length}) < cached RLS (${currentRlsCache.length})`;

        console.warn(
          `[useOwnedCharacters] Floor guard triggered: ${reason}. ` +
          `Merging fresh updates into existing cache instead of replacing.`
        );

        // Merge: keep all cached RLS records, patch with fresh data where available,
        // add genuinely new records. This preserves Ethan/Melody even if the fresh
        // result returned only Shiloh.
        const freshById = new Map(freshFiltered.map(c => [c.id, c]));
        const seen = new Set();
        const merged = [];

        for (const cached of currentRlsCache) {
          if (seen.has(cached.id)) continue;
          seen.add(cached.id);
          merged.push(freshById.get(cached.id) || cached);
        }
        for (const c of freshFiltered) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            merged.push(c);
          }
        }
        return merged;
      }

      return freshFiltered;
    },
    enabled: !!email,
    staleTime: 5 * 60 * 1000,
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

  // ── Merge + dedupe ────────────────────────────────────────────────────────────
  const allCharacters = (() => {
    const seen = new Set();
    return [...rlsCharacters, ...backendNpcs].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  // ── SNAPSHOT WRITER ───────────────────────────────────────────────────────────
  // Runs whenever allCharacters grows. Does NOT wait for the bootstrap guard.
  // This establishes the floor on the very first successful load so that any
  // subsequent background invalidation is blocked by the queryFn floor guard.
  // Skipped while either query is still loading or fetching (unstable state).
  useEffect(() => {
    if (!email) return;
    if (isLoadingRls || isLoadingNpc || isFetchingRls || isFetchingNpc) return;
    const count = allCharacters.length;
    if (count <= MIN_AUTHORITATIVE_COUNT) return; // too small to be authoritative
    const existing = readMergedSnapshot(email);
    if (!existing || count > existing.count) {
      writeMergedSnapshot(email, allCharacters.map(c => c.id), count);
      console.log(`[useOwnedCharacters] Snapshot updated: count=${count} email=${email}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, allCharacters.length, isLoadingRls, isLoadingNpc, isFetchingRls, isFetchingNpc]);

  // ── BOOTSTRAP GUARD ───────────────────────────────────────────────────────────
  // Evaluates the full merged universe after both queries stabilize.
  // Triggers one controlled recovery fetch if the result is partial/suspect.
  // ANCHOR RULE: valid if AT LEAST ONE configured anchor is present.
  useEffect(() => {
    if (!email) return;
    if (isLoadingRls || isLoadingNpc) return;
    if (isFetchingRls || isFetchingNpc) return;
    if (recoveryFiredRef.current) return;

    const mergedCount = allCharacters.length;
    const meta        = readBootstrapMeta(email);
    const priorCount  = meta?.lastSuccessfulCount ?? null;

    const isPartialVsPrior    = priorCount !== null && mergedCount < priorCount - 1;
    const isSuspectFirstFetch = priorCount === null && mergedCount <= MIN_AUTHORITATIVE_COUNT;
    const isEmpty             = mergedCount === 0;

    const isDefaultCharacterMissing = !!expectedDefaultCharacterId &&
      !allCharacters.some(c => c.id === expectedDefaultCharacterId);

    // ANY anchor present = valid load. NONE present = incomplete.
    const validAnchors     = (anchorCharacterIds || []).filter(id => !!id);
    const anyAnchorPresent = validAnchors.length === 0 ||
      validAnchors.some(id => allCharacters.some(c => c.id === id));
    const isAnchorMissing  = validAnchors.length > 0 && !anyAnchorPresent;

    if (isAnchorMissing) {
      console.warn(
        `[useOwnedCharacters] NO anchor present. ` +
        `anchors=${validAnchors.join(',')} | mergedCount=${mergedCount}`
      );
    }
    if (isDefaultCharacterMissing) {
      console.warn(
        `[useOwnedCharacters] Default character ${expectedDefaultCharacterId} missing. count=${mergedCount}`
      );
    }

    const needsRecovery = isEmpty || isPartialVsPrior || isSuspectFirstFetch ||
      isDefaultCharacterMissing || isAnchorMissing;

    if (!needsRecovery) {
      writeBootstrapMeta(email, mergedCount);
      // Snapshot is also written by the snapshot-writer effect above — no duplication.
      return;
    }

    if (isBootstrapCoolingDown(email)) {
      console.log(`[useOwnedCharacters] Partial cache — cooldown active. merged=${mergedCount} prior=${priorCount ?? 'none'}`);
      return;
    }

    recoveryFiredRef.current = true;

    console.warn(
      `[useOwnedCharacters] Recovery triggered. ` +
      `merged=${mergedCount} | prior=${priorCount ?? 'none'} | ` +
      `isEmpty=${isEmpty} | partial=${isPartialVsPrior} | suspectFirst=${isSuspectFirstFetch} | ` +
      `defaultMissing=${isDefaultCharacterMissing} | anchorMissing=${isAnchorMissing} | ` +
      `anchorsConfigured=${validAnchors.length} | anyAnchorPresent=${anyAnchorPresent}`
    );

    // Stamp cooldown before firing so rapid re-mounts don't stack
    try {
      const existing = readBootstrapMeta(email);
      sessionStorage.setItem(ssBootstrapKey(email), JSON.stringify({
        ...(existing || {}), lastFetchAt: Date.now(), email,
      }));
    } catch {}

    refetchRls();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, isLoadingRls, isLoadingNpc, isFetchingRls, isFetchingNpc, allCharacters.length,
      expectedDefaultCharacterId, JSON.stringify(anchorCharacterIds)]);

  // ── Derived slices ────────────────────────────────────────────────────────────
  const activeCreated = allCharacters.filter(
    c => c.character_type === "active_created_character" && c.status !== "deleted"
  );
  const npcFictitious   = allCharacters.filter(c => c.character_type === "npc_fictitious");
  const npcFamilyMembers = allCharacters.filter(c => c.character_type === "npc_family_member");
  const npcRegular      = allCharacters.filter(c => c.character_type === "npc_regular");
  const travelCompanions = [...activeCreated, ...npcFictitious, ...npcFamilyMembers];

  const isInitialLoading = (isLoadingRls && !rlsCharacters.length) || (isLoadingNpc && !backendNpcs.length);
  const isRefreshing     = (isFetchingRls || isFetchingNpc) && !isInitialLoading;

  return {
    allCharacters,
    activeCreated,
    npcFictitious,
    npcFamilyMembers,
    npcRegular,
    travelCompanions,
    isInitialLoading,
    isRefreshing,
    rlsCharacters,
    backendNpcs,
  };
}