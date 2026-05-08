/**
 * useOwnedCharacters
 *
 * Single shared hook that owns ALL character fetching for this app.
 * Source of truth: owner_email. created_by is permanently forbidden.
 *
 * ════════════════════════════════════════════════════════════════════
 * LEGACY BACKWARD COMPATIBILITY — PERMANENT PROTECTION
 * ════════════════════════════════════════════════════════════════════
 * Legacy characters (created before newer schema fields were introduced)
 * MUST remain visible at all times. A missing field is never grounds
 * for exclusion. Rules:
 *
 * - Missing character_type → safe fallback to 'active_created_character'
 *   if profile data is present, else 'npc_fictitious'. NEVER exclude.
 * - Missing is_test_character → treat as false (keep character visible)
 * - Missing diagnostic_only  → treat as false (keep character visible)
 * - Missing owner_user_id    → acceptable; owner_email is the source of truth
 * - Missing newer metadata   → apply fallback; mark as needing compat repair
 *
 * If a character was previously visible, it must remain visible across:
 * refreshes, schema changes, migrations, cache resets, optimization
 * passes, diagnostic runs, anchor logic, and partial queries.
 *
 * ════════════════════════════════════════════════════════════════════
 * LAST-KNOWN-GOOD PROTECTION — THREE LAYERS
 * ════════════════════════════════════════════════════════════════════
 *
 * LAYER 1 — RLS snapshot (written synchronously inside queryFn)
 *   The moment the RLS fetch returns > 1 record, we write the ID list
 *   and count to sessionStorage BEFORE returning from queryFn.
 *   This ensures the floor exists before any effect cycle runs.
 *   Subsequent fetches read this snapshot and refuse to return a
 *   smaller list — instead they merge fresh updates into the baseline.
 *
 * LAYER 2 — Floor guard inside queryFn
 *   Before returning a fresh result, queryFn reads the stored RLS
 *   snapshot count. If fresh < snapshot - 1 (beyond 1-deletion
 *   tolerance), the result is treated as partial and merged into the
 *   existing cache rather than replacing it.
 *   No effect cycle needed — this fires synchronously on every fetch.
 *
 * LAYER 3 — Bootstrap guard (effect, fires after stabilization)
 *   After both queries finish loading, evaluates the merged universe.
 *   If the result is partial vs the prior authoritative count, or if
 *   anchor characters are absent, triggers one controlled recovery.
 *   ANCHOR RULE: valid if AT LEAST ONE configured anchor is present.
 *
 * ════════════════════════════════════════════════════════════════════
 * WHY SYNCHRONOUS SNAPSHOT WRITE IS CRITICAL
 * ════════════════════════════════════════════════════════════════════
 * Effects (useEffect) run after React renders the component.
 * A second fetch can fire and complete between queryFn returning and
 * the effect running — creating a window where the snapshot doesn't
 * exist yet and the floor guard passes a partial second result.
 * Writing inside queryFn closes this window completely.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

const BOOTSTRAP_COOLDOWN_MS = 8 * 60 * 1000; // 8 minutes
const MIN_AUTHORITATIVE_COUNT = 2; // A single record is never authoritative for a multi-char account

// ── sessionStorage key helpers ────────────────────────────────────────────────
const ssBootstrapKey = (email) => `char_bootstrap_${email}`;
const ssRlsSnapshotKey = (email) => `char_rls_snapshot_${email}`;

// ── RLS snapshot (written synchronously in queryFn) ───────────────────────────
function readRlsSnapshot(email) {
  try {
    const raw = sessionStorage.getItem(ssRlsSnapshotKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Write the RLS snapshot ONLY if it would increase the stored count.
 * Never lowers the floor — the floor only grows.
 * Called synchronously inside queryFn, before React renders.
 */
function writeRlsSnapshotIfGrows(email, ids, count) {
  try {
    if (count < MIN_AUTHORITATIVE_COUNT) return; // too small to establish a floor
    const existing = readRlsSnapshot(email);
    if (existing && count <= existing.count - 1) return; // would lower floor — refuse
    sessionStorage.setItem(ssRlsSnapshotKey(email), JSON.stringify({
      ids, count, savedAt: Date.now(),
    }));
  } catch {}
}

// ── Bootstrap meta ────────────────────────────────────────────────────────────
function readBootstrapMeta(email) {
  try {
    const raw = sessionStorage.getItem(ssBootstrapKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeBootstrapMeta(email, count) {
  try {
    const existing = readBootstrapMeta(email);
    const priorCount = existing?.lastSuccessfulCount ?? null;
    // Never bless a suspiciously small count as the new authoritative baseline
    if (count < MIN_AUTHORITATIVE_COUNT && (priorCount === null || priorCount >= MIN_AUTHORITATIVE_COUNT)) {
      console.warn(`[useOwnedCharacters] Refusing to bless suspect count=${count} (prior=${priorCount ?? 'none'})`);
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

// ─────────────────────────────────────────────────────────────────────────────

export function useOwnedCharacters(
  currentUser,
  expectedDefaultCharacterId = null,
  anchorCharacterIds = []
) {
  const email  = currentUser?.email || null;
  const userId = currentUser?.id    || null;
  const queryClient = useQueryClient();
  const recoveryFiredRef = useRef(false);

  // Reset recoveryFiredRef when email changes (account switch / new session)
  // Also reset when anchors transition from empty → populated: the first pass ran
  // without anchor knowledge (settings still loading), so it must re-evaluate now
  // that real anchor IDs are available.
  const prevEmailRef = useRef(null);
  const prevAnchorKeyRef = useRef('[]');
  const anchorKey = JSON.stringify((anchorCharacterIds || []).filter(Boolean).sort());

  if (prevEmailRef.current !== email) {
    prevEmailRef.current = email;
    recoveryFiredRef.current = false;
    prevAnchorKeyRef.current = '[]';
  } else if (prevAnchorKeyRef.current === '[]' && anchorKey !== '[]') {
    // Anchors just became populated — prior recovery ran without them, must re-arm
    recoveryFiredRef.current = false;
    prevAnchorKeyRef.current = anchorKey;
  } else {
    prevAnchorKeyRef.current = anchorKey;
  }

  // ── 1. RLS characters (all types, all statuses, owner_email scoped) ──────────
  const {
    data: rlsCharacters = [],
    isLoading: isLoadingRls,
    isFetching: isFetchingRls,
    refetch: refetchRls,
  } = useQuery({
    queryKey: ["characters", email],
    queryFn: async () => {
      if (!email) return [];

      // Read the stored RLS snapshot (written by prior successful fetches).
      // This is the authoritative floor — never lowered, never cleared mid-session.
      const snapshot = readRlsSnapshot(email);
      const snapshotCount = snapshot?.count || 0;

      // Read current RLS cache as a secondary fallback floor
      // (handles the case where a prior fetch populated the cache but snapshot
      //  wasn't written yet — e.g. snapshot cleared by browser, cache still warm)
      const cachedRls = queryClient.getQueryData(["characters", email]) || [];

      // OLDEST-FIRST: ensures partial/rate-limited results return foundational
      // characters (Ethan, Melody) rather than the newest-created one (Shiloh).
      const fresh = await base44.entities.Character.filter(
        { owner_email: email },
        "created_date", // ascending — oldest first
        300
      );
      // LEGACY COMPATIBILITY: is_test_character and diagnostic_only may be absent on
      // older records — treat undefined as false. Never exclude a character because
      // a newer metadata field is missing. Explicit true is required to exclude.
      const freshFiltered = fresh.filter(c => c.is_test_character !== true && c.diagnostic_only !== true);

      // ── SNAPSHOT WRITE (synchronous, inside queryFn) ──────────────────────
      // Write the snapshot NOW if this fetch is authoritative (count grows).
      // This must happen before we return, so the floor is established before
      // any subsequent fetch or effect cycle runs.
      writeRlsSnapshotIfGrows(email, freshFiltered.map(c => c.id), freshFiltered.length);

      // ── FLOOR GUARD ────────────────────────────────────────────────────────
      // PRIMARY: compare fresh count against the stored snapshot count.
      // SECONDARY: compare fresh count against current RLS cache length.
      // If either floor is breached, merge instead of replace.
      const primaryBreach   = snapshotCount >= MIN_AUTHORITATIVE_COUNT &&
                              freshFiltered.length < snapshotCount - 1;
      const secondaryBreach = cachedRls.length >= MIN_AUTHORITATIVE_COUNT &&
                              freshFiltered.length < cachedRls.length - 1;

      if (primaryBreach || secondaryBreach) {
        const reason = primaryBreach
          ? `fresh(${freshFiltered.length}) < snapshot(${snapshotCount})`
          : `fresh(${freshFiltered.length}) < cache(${cachedRls.length})`;

        console.warn(
          `[useOwnedCharacters] Floor guard: ${reason}. ` +
          `Merging fresh updates into baseline instead of replacing.`
        );

        // Use whichever baseline is larger (snapshot IDs if available, else cache)
        const baseline = (snapshotCount >= cachedRls.length) ? (snapshot?.ids || []).map(id => {
          // Try to get fresh data for this id; fall back to cached
          const freshMatch = freshFiltered.find(c => c.id === id);
          const cacheMatch = cachedRls.find(c => c.id === id);
          return freshMatch || cacheMatch || null;
        }).filter(Boolean) : cachedRls;

        const freshById = new Map(freshFiltered.map(c => [c.id, c]));
        const seen = new Set();
        const merged = [];

        // Patch baseline records with fresh data where available
        for (const record of baseline) {
          if (!record?.id || seen.has(record.id)) continue;
          seen.add(record.id);
          merged.push(freshById.get(record.id) || record);
        }
        // Add any genuinely new records not in baseline
        for (const c of freshFiltered) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            merged.push(c);
          }
        }

        // Update snapshot with the merged (larger) result
        writeRlsSnapshotIfGrows(email, merged.map(c => c.id), merged.length);
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
  // RATE LIMIT PROTECTION: staleTime is 15 minutes (up from 10) to reduce
  // re-fetch frequency. refetchOnMount=false prevents duplicate invocations
  // when the component remounts during anchor-missing recovery cycles.
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
    staleTime: 15 * 60 * 1000,  // 15 min — NPCs don't change frequently
    gcTime: 60 * 60 * 1000,     // 1 hour cache — prevents re-fetch on every recovery
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (failureCount >= 2) return false; // Reduced from 3 to 2 — fail faster on 429
      const is429 = error?.message?.includes('429') || error?.status === 429 || error?.response?.status === 429;
      return is429 || failureCount < 1;
    },
    retryDelay: (attemptIndex) => Math.min(5000 * 2 ** attemptIndex, 30000), // Longer backoff
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

  // ── BOOTSTRAP GUARD ───────────────────────────────────────────────────────────
  // Runs after both queries stabilize. Checks the merged universe against:
  //   A) Prior authoritative count (bootstrap meta)
  //   B) Anchor presence (ANY anchor present = valid; NONE = incomplete)
  //   C) Default character presence
  // Triggers one controlled recovery fetch if the result is partial.
  useEffect(() => {
    if (!email) return;
    if (isLoadingRls || isLoadingNpc) return;
    if (isFetchingRls || isFetchingNpc) return;
    if (recoveryFiredRef.current) return;

    const mergedCount = allCharacters.length;
    const meta        = readBootstrapMeta(email);
    const priorCount  = meta?.lastSuccessfulCount ?? null;

    const isPartialVsPrior    = priorCount !== null && mergedCount < priorCount - 1;
    const isSuspectFirstFetch = priorCount === null && mergedCount < MIN_AUTHORITATIVE_COUNT;
    const isEmpty             = mergedCount === 0;

    const isDefaultMissing = !!expectedDefaultCharacterId &&
      !allCharacters.some(c => c.id === expectedDefaultCharacterId);

    // ANCHOR RULE: ANY present = valid. NONE present (when configured) = incomplete.
    const validAnchors    = (anchorCharacterIds || []).filter(id => !!id);
    const anyAnchorPresent = validAnchors.length === 0 ||
      validAnchors.some(id => allCharacters.some(c => c.id === id));
    const isAnchorMissing = validAnchors.length > 0 && !anyAnchorPresent;

    if (isAnchorMissing) {
      console.warn(
        `[useOwnedCharacters] NO anchor in merged list. ` +
        `anchors=[${validAnchors.join(',')}] | mergedCount=${mergedCount}`
      );
    }

    const needsRecovery = isEmpty || isPartialVsPrior || isSuspectFirstFetch ||
      isDefaultMissing || isAnchorMissing;

    if (!needsRecovery) {
      writeBootstrapMeta(email, mergedCount);
      return;
    }

    // ANCHOR ABSENCE overrides cooldown — an anchor missing is always a hard failure.
    // The cooldown exists to prevent rapid re-fetch storms, but if the anchor characters
    // (the continuity-critical records) are confirmed absent, we MUST attempt recovery
    // regardless of when the last fetch ran. Cooldown still applies to all other
    // partial-load conditions (count drop, default missing, etc.).
    const cooldownExempt = isAnchorMissing;

    if (!cooldownExempt && isBootstrapCoolingDown(email)) {
      console.log(`[useOwnedCharacters] Partial — cooldown active. merged=${mergedCount} prior=${priorCount ?? 'none'}`);
      return;
    }

    if (cooldownExempt) {
      console.warn(`[useOwnedCharacters] Anchor absent — bypassing cooldown to force recovery. merged=${mergedCount}`);
    }

    recoveryFiredRef.current = true;

    console.warn(
      `[useOwnedCharacters] Recovery triggered. ` +
      `merged=${mergedCount} | prior=${priorCount ?? 'none'} | ` +
      `isEmpty=${isEmpty} | partial=${isPartialVsPrior} | suspectFirst=${isSuspectFirstFetch} | ` +
      `defaultMissing=${isDefaultMissing} | anchorMissing=${isAnchorMissing}`
    );

    // Stamp cooldown before firing so rapid re-mounts don't stack
    try {
      const existing = readBootstrapMeta(email);
      sessionStorage.setItem(ssBootstrapKey(email), JSON.stringify({
        ...(existing || {}), lastFetchAt: Date.now(), email,
      }));
    } catch {}

    // RATE LIMIT PROTECTION: Anchor-missing recovery bypasses the cooldown, which
    // is correct behavior — but it fires immediately on first load because anchors
    // come from UserSettings (which loads slightly after characters). Adding a
    // 2-second stabilization delay prevents the recovery from firing during the
    // normal settings-load window, while still catching genuine anchor absences.
    //
    // ANCHOR ALREADY IN MERGED LIST CHECK: anchors may be NPCs returned via
    // backendNpcs (not visible via owner_email RLS filter). In that case,
    // "anchor missing from RLS" is a false alarm — the anchor IS present in the
    // merged allCharacters list. Re-evaluate against the full merged list, not
    // just the RLS slice. If any anchor is in allCharacters (regardless of which
    // query returned it), treat as valid and skip the recovery refetch.
    const anyAnchorInMerged = validAnchors.some(id => allCharacters.some(c => c.id === id));
    if (isAnchorMissing && anyAnchorInMerged) {
      console.log(`[useOwnedCharacters] Anchor found in merged list (via NPC or RLS) — skipping recovery refetch.`);
      writeBootstrapMeta(email, mergedCount);
      return;
    }

    // Only anchor-missing gets the 2s delay — isEmpty fires immediately.
    const recoveryDelay = (isAnchorMissing && !isEmpty) ? 2000 : 0;
    setTimeout(() => {
      refetchRls();
    }, recoveryDelay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, isLoadingRls, isLoadingNpc, isFetchingRls, isFetchingNpc, allCharacters.length,
      expectedDefaultCharacterId, JSON.stringify(anchorCharacterIds), backendNpcs.length]);

  // ── Derived slices ────────────────────────────────────────────────────────────
  // LEGACY COMPATIBILITY: character_type may be null/missing on older records.
  // A character without character_type that has profile data must not be excluded.
  // Legacy resolution: if character_type is missing, infer from profile completeness.
  // NEVER exclude a character solely because character_type is absent.
  const resolveTypeLegacy = (c) => {
    if (c.character_type) return c.character_type;
    // Legacy fallback: character with personality/schedule/needs data = active_created_character
    const hasProfile = c.backstory || c.personality_summary || c.personality_traits?.length > 0;
    const hasSchedule = c.wake_up_time || c.sleep_start_time;
    const hasNeeds = c.hunger_value !== undefined;
    if (hasProfile && (hasSchedule || hasNeeds)) return 'active_created_character';
    if (c.fictional_relationships?.length > 0 && !c.is_family_member) return 'npc_fictitious';
    if (c.is_family_member) return 'npc_family_member';
    // If we still cannot determine type, default to active_created_character for user-visible characters.
    // This preserves legacy characters that predate the character_type field.
    return 'active_created_character';
  };

  const activeCreated    = allCharacters.filter(c => resolveTypeLegacy(c) === "active_created_character" && c.status !== "deleted");
  const npcFictitious    = allCharacters.filter(c => resolveTypeLegacy(c) === "npc_fictitious");
  const npcFamilyMembers = allCharacters.filter(c => resolveTypeLegacy(c) === "npc_family_member");
  const npcRegular       = allCharacters.filter(c => resolveTypeLegacy(c) === "npc_regular");
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