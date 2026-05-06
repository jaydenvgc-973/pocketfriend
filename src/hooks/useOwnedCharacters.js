/**
 * useOwnedCharacters
 *
 * Single shared hook that owns ALL character fetching for this app.
 * Consumed by Home, Travel, and any page that needs the full character universe.
 *
 * Source of truth: owner_email — sole ownership field. created_by is forbidden.
 *
 * LAST-KNOWN-GOOD MERGED SNAPSHOT (sessionStorage):
 * - When allCharacters (RLS + NPC merged) is stable and authoritative, we write its
 *   full ID list to sessionStorage as the "last known good merged snapshot".
 * - The queryFn for RLS characters reads this snapshot — NOT the RLS cache slice —
 *   to decide whether a fresh server result is a downgrade. The merged snapshot is the
 *   only correct floor baseline because NPCs may be in backendNpcs, not in rlsCharacters.
 * - If fresh RLS result + current NPC list < snapshot count - 1, the fresh result is
 *   treated as partial and the cached RLS records are preserved via merge.
 *
 * ANCHOR VALIDATION RULE:
 * - Anchors are the continuity anchor characters (e.g. Ethan = primary, Melody = fallback).
 * - Load is valid if AT LEAST ONE anchor is present in the merged universe.
 * - If NONE of the configured anchor IDs appear, the load is treated as incomplete
 *   and recovery is triggered. This replaces the previous ALL-required rule.
 *
 * BOOTSTRAP GUARD:
 * - On session start, if the in-memory cache is empty or partial, one controlled
 *   recovery fetch fires automatically (max once per BOOTSTRAP_COOLDOWN_MS).
 * - refetchOnMount/refetchOnWindowFocus remain false — aggressive refetch is the
 *   root cause of rate-limit storms and must stay disabled.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

// Bootstrap cooldown — max one recovery fetch per owner_email per this window
const BOOTSTRAP_COOLDOWN_MS = 8 * 60 * 1000; // 8 minutes

// ── sessionStorage key helpers ───────────────────────────────────────────────
const ssBootstrapKey = (email) => `char_bootstrap_${email}`;
// Separate key for the merged snapshot — stores the full merged ID list + count
const ssMergedKey = (email) => `char_merged_snapshot_${email}`;

// ── Bootstrap meta (count + cooldown) ────────────────────────────────────────
function readBootstrapMeta(email) {
  try {
    const raw = sessionStorage.getItem(ssBootstrapKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const MIN_AUTHORITATIVE_COUNT = 1;

function writeBootstrapMeta(email, count) {
  try {
    const existing = readBootstrapMeta(email);
    const priorCount = existing?.lastSuccessfulCount ?? null;
    const isSuspect = count <= MIN_AUTHORITATIVE_COUNT && (priorCount === null || priorCount > MIN_AUTHORITATIVE_COUNT);
    if (isSuspect) {
      console.warn(
        `[useOwnedCharacters] Bootstrap: refusing to bless suspect fetch. ` +
        `fetchedCount=${count} priorCount=${priorCount ?? 'none'} — recovery stays eligible.`
      );
      return;
    }
    sessionStorage.setItem(ssBootstrapKey(email), JSON.stringify({
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

// ── Merged snapshot (last known good merged universe) ────────────────────────
// Written when allCharacters (RLS + NPC merged) is authoritative.
// Used by queryFn as the floor baseline for partial-fetch detection.
function readMergedSnapshot(email) {
  try {
    const raw = sessionStorage.getItem(ssMergedKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMergedSnapshot(email, ids, count) {
  try {
    // Never write a snapshot smaller than the existing one — that would lower the floor.
    const existing = readMergedSnapshot(email);
    if (existing && count <= existing.count - 1) {
      console.warn(
        `[useOwnedCharacters] writeMergedSnapshot: refusing to lower floor. ` +
        `newCount=${count} existingCount=${existing.count}`
      );
      return;
    }
    sessionStorage.setItem(ssMergedKey(email), JSON.stringify({
      ids,
      count,
      savedAt: Date.now(),
    }));
  } catch {}
}

/**
 * anchorCharacterIds: ordered array of stable IDs for continuity anchor characters.
 * [0] = primary anchor (e.g. Ethan), [1] = fallback anchor (e.g. Melody).
 *
 * VALIDATION RULE: load is valid if AT LEAST ONE anchor is present in the merged universe.
 * ALL-required was too strict — if one anchor was recently moved/updated it could block
 * an otherwise valid load. ANY = valid. NONE = incomplete.
 */
export function useOwnedCharacters(currentUser, expectedDefaultCharacterId = null, anchorCharacterIds = []) {
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

      // ── FLOOR GUARD: read the MERGED snapshot (not the RLS cache slice) ──────
      // The RLS cache is only one half of allCharacters (NPCs come from backendNpcs).
      // Using the RLS cache as the floor would allow partial NPC-less results to pass.
      // The merged snapshot is the only correct baseline.
      const mergedSnapshot = readMergedSnapshot(email);
      const snapshotIds = new Set(mergedSnapshot?.ids || []);
      const snapshotCount = mergedSnapshot?.count || 0;

      // Also read current NPC cache so we can project what merged will look like
      // after this RLS result is combined, without waiting for an effect cycle.
      const currentNpcs = queryClient.getQueryData(["npc-characters", userId]) || [];

      // Sort oldest-first: partial/rate-limited results return foundational characters
      // (Ethan, Melody) rather than the newest-created (Shiloh).
      const fresh = await base44.entities.Character.filter(
        { owner_email: email },
        "created_date",
        300
      );
      const freshFiltered = fresh.filter(c => !c.is_test_character && !c.diagnostic_only);

      // Project what the merged universe will look like after this RLS result + current NPCs
      const projectedMergedCount = (() => {
        const seen = new Set(freshFiltered.map(c => c.id));
        let count = freshFiltered.length;
        for (const npc of currentNpcs) {
          if (!seen.has(npc.id)) count++;
        }
        return count;
      })();

      // ── PARTIAL DETECTION ─────────────────────────────────────────────────────
      // A fresh result is suspicious if the projected merged count would be smaller
      // than the last known good merged snapshot count (beyond 1-char tolerance).
      if (snapshotCount > 0 && projectedMergedCount < snapshotCount - 1) {
        console.warn(
          `[useOwnedCharacters] Floor guard triggered: ` +
          `projectedMerged=${projectedMergedCount} < snapshotCount=${snapshotCount}. ` +
          `Treating fresh RLS result as partial. Merging into snapshot baseline.`
        );

        // Read current RLS cache to use as base for the merge
        const cachedRls = queryClient.getQueryData(["characters", email]) || [];

        // Merge strategy: keep all snapshot IDs that are in the cached RLS list,
        // patch with fresh updates by id, add genuinely new records.
        const freshById = new Map(freshFiltered.map(c => [c.id, c]));
        const cachedById = new Map(cachedRls.map(c => [c.id, c]));

        // Start with all IDs that were in the last known good snapshot AND are in RLS scope
        // (snapshot may include NPCs which are not in the RLS result — skip those here,
        // they will be merged in allCharacters from backendNpcs as normal).
        const mergedRls = [];
        const seen = new Set();

        // 1. All cached RLS records, patched with fresh data if available
        for (const cached of cachedRls) {
          if (seen.has(cached.id)) continue;
          seen.add(cached.id);
          mergedRls.push(freshById.get(cached.id) || cached);
        }
        // 2. Any truly new records in fresh that weren't in cache
        for (const c of freshFiltered) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            mergedRls.push(c);
          }
        }
        return mergedRls;
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

  // ── Merge + dedupe by id ─────────────────────────────────────────────────────
  const allCharacters = (() => {
    const seen = new Set();
    return [...rlsCharacters, ...backendNpcs].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  // ── BOOTSTRAP GUARD + MERGED SNAPSHOT WRITER ─────────────────────────────────
  // Runs after both queries stabilize. Evaluates the MERGED universe.
  // On authoritative result: writes merged snapshot + bootstrap meta.
  // On suspect result: does NOT bless — recovery fires if cooldown allows.
  //
  // ANCHOR RULE (revised): load is valid if AT LEAST ONE configured anchor is present.
  // ALL-required was too strict. ANY anchor present = account is loading real characters.
  // NONE present (when anchors are configured) = partial/poisoned result.
  useEffect(() => {
    if (!email) return;
    if (isLoadingRls || isLoadingNpc) return;
    if (isFetchingRls || isFetchingNpc) return;
    if (recoveryFiredRef.current) return;

    const mergedCount = allCharacters.length;
    const meta = readBootstrapMeta(email);
    const priorCount = meta?.lastSuccessfulCount ?? null;

    const isPartialVsPrior = priorCount !== null && mergedCount < priorCount - 1;
    const isSuspectFirstFetch = priorCount === null && mergedCount <= MIN_AUTHORITATIVE_COUNT;
    const isEmpty = mergedCount === 0;

    // Default character check
    const isDefaultCharacterMissing = !!expectedDefaultCharacterId &&
      !allCharacters.some(c => c.id === expectedDefaultCharacterId);
    if (isDefaultCharacterMissing) {
      console.warn(
        `[useOwnedCharacters] Default character id=${expectedDefaultCharacterId} NOT in list (count=${mergedCount}).`
      );
    }

    // ANCHOR CHECK — ANY present = valid. NONE present (when anchors configured) = incomplete.
    const validAnchors = (anchorCharacterIds || []).filter(id => !!id);
    const anyAnchorPresent = validAnchors.length === 0 ||
      validAnchors.some(id => allCharacters.some(c => c.id === id));
    const isAnchorMissing = validAnchors.length > 0 && !anyAnchorPresent;

    if (isAnchorMissing) {
      const presentIds = allCharacters.map(c => c.id);
      console.warn(
        `[useOwnedCharacters] NO anchor present in merged list. ` +
        `anchorIds=${validAnchors.join(',')} | mergedCount=${mergedCount} | ` +
        `presentIds=${presentIds.slice(0, 5).join(',')}${presentIds.length > 5 ? '…' : ''} | Treating as incomplete.`
      );
    }

    const needsRecovery = isEmpty || isPartialVsPrior || isSuspectFirstFetch || isDefaultCharacterMissing || isAnchorMissing;

    if (!needsRecovery) {
      // Authoritative — write both the bootstrap meta and the merged snapshot
      writeBootstrapMeta(email, mergedCount);
      writeMergedSnapshot(
        email,
        allCharacters.map(c => c.id),
        mergedCount
      );
      return;
    }

    if (isBootstrapCoolingDown(email)) {
      console.log(
        `[useOwnedCharacters] Partial cache — cooldown active. ` +
        `mergedCount=${mergedCount} priorCount=${priorCount ?? 'none'}`
      );
      return;
    }

    recoveryFiredRef.current = true;

    console.warn(
      `[useOwnedCharacters] Bootstrap recovery triggered. ` +
      `mergedCount=${mergedCount} | priorCount=${priorCount ?? 'none'} | ` +
      `isEmpty=${isEmpty} | isPartialVsPrior=${isPartialVsPrior} | isSuspectFirstFetch=${isSuspectFirstFetch} | ` +
      `isDefaultCharacterMissing=${isDefaultCharacterMissing} | isAnchorMissing=${isAnchorMissing} | ` +
      `anchorsConfigured=${validAnchors.length} | anyAnchorPresent=${anyAnchorPresent} | email=${email}`
    );

    try {
      const existing = readBootstrapMeta(email);
      sessionStorage.setItem(ssBootstrapKey(email), JSON.stringify({
        ...(existing || {}),
        lastFetchAt: Date.now(),
        email,
      }));
    } catch {}

    refetchRls();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, isLoadingRls, isLoadingNpc, isFetchingRls, isFetchingNpc, allCharacters.length, expectedDefaultCharacterId, JSON.stringify(anchorCharacterIds)]);

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

  const travelCompanions = [...activeCreated, ...npcFictitious, ...npcFamilyMembers];

  const isInitialLoading = (isLoadingRls && !rlsCharacters.length) || (isLoadingNpc && !backendNpcs.length);
  const isRefreshing = (isFetchingRls || isFetchingNpc) && !isInitialLoading;

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