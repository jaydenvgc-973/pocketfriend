/**
 * useOwnedCharacters
 *
 * Single shared hook that owns ALL character fetching for this app.
 * Source of truth: owner_email. created_by is permanently forbidden.
 *
 * AUTHORITATIVE RESULT POLICY:
 * A successful current authoritative query result is accepted as current
 * truth. Historical roster size, cached Character objects, and anchor
 * absence do not override a successful current fetch. Legitimate roster
 * reductions (deletion, reclassification, account changes) are accepted
 * without count-based recovery or stale-state injection.
 *
 * CLASSIFICATION AUTHORITY:
 * Persisted Character.character_type is the sole classification authority.
 * Runtime code does not manufacture or substitute a different type.
 * Derived slices (activeCreated, npcFictitious, etc.) filter by the
 * persisted character_type value directly — no inference, no fallback.
 *
 * LEGACY BACKWARD COMPATIBILITY:
 * Missing is_test_character / diagnostic_only → treat as false (keep visible).
 * Missing owner_user_id → acceptable; owner_email is the source of truth.
 * Terminal lifecycle states (deleted, soft_deleted, merged) are excluded
 * from the live roster. moved_away is NOT terminal — Home shows those characters.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { lfcRead, lfcWrite } from "@/lib/localFirstCache.js";

// ─────────────────────────────────────────────────────────────────────────────

export function useOwnedCharacters(
  currentUser,
  expectedDefaultCharacterId = null,
  anchorCharacterIds = []
) {
  const email  = currentUser?.email || null;
  const userId = currentUser?.id    || null;
  const queryClient = useQueryClient();

  // ── 1. RLS characters (all types, all statuses, owner_email scoped) ──────────
  const {
    data: rlsCharacters = [],
    isLoading: isLoadingRls,
    isFetching: isFetchingRls,
  } = useQuery({
    queryKey: ["characters", email],
    // Seed React Query cache from localStorage before first server call.
    // This ensures the UI renders immediately on mount without waiting for the server.
    initialData: () => {
      if (!email) return undefined;
      const lfc = lfcRead(email, 'characters');
      return lfc?.data?.length > 0 ? lfc.data : undefined;
    },
    initialDataUpdatedAt: () => {
      if (!email) return undefined;
      const lfc = lfcRead(email, 'characters');
      return lfc?.loaded_at ?? undefined;
    },
    queryFn: async () => {
      if (!email) return [];

      const fresh = await base44.entities.Character.filter(
        { owner_email: email },
        "created_date", // ascending — oldest first
        300
      );
      // LEGACY COMPATIBILITY: is_test_character and diagnostic_only may be absent on
      // older records — treat undefined as false. Never exclude a character because
      // a newer metadata field is missing. Explicit true is required to exclude.
      // NOTE: Terminal lifecycle states (deleted, soft_deleted, merged) are NOT
      // filtered here. The shared authoritative fetch returns all owned records so
      // consumers can inspect/manage terminal records where legitimate. Live-
      // operational slices (activeCreated, npcFictitious, etc.) apply their own
      // lifecycle exclusion — retrievable record ≠ eligible for a live surface.
      const freshFiltered = fresh.filter(c =>
        c.is_test_character !== true &&
        c.diagnostic_only !== true
      );

      // Persist to localStorage so next page load is instant
      if (freshFiltered.length > 0) lfcWrite(email, 'characters', freshFiltered);
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
  // RATE LIMIT PROTECTION: staleTime is 15 minutes to reduce re-fetch frequency.
  // refetchOnMount=false prevents duplicate invocations on component remounts.
  // Also returns sharedLocationEmployees — admin-owned characters employed at
  // admin-owned Shared locations, made visible to visiting users through
  // legitimate shared-location presence. Ownership never changes; these are the
  // canonical admin records, not copies.
  const {
    data: backendNpcData,
    isLoading: isLoadingNpc,
    isFetching: isFetchingNpc,
  } = useQuery({
    queryKey: ["npc-characters", userId],
    initialData: () => {
      if (!email) return undefined;
      const lfc = lfcRead(email, 'npc-characters');
      return lfc?.data?.length > 0 ? lfc.data : undefined;
    },
    initialDataUpdatedAt: () => {
      if (!email) return undefined;
      const lfc = lfcRead(email, 'npc-characters');
      return lfc?.loaded_at ?? undefined;
    },
    queryFn: async () => {
      if (!userId) return [];
      const res = await base44.functions.invoke("fetchNPCsForUser", {});
      const npcs = res?.data?.npcs || [];
      if (npcs.length > 0 && email) lfcWrite(email, 'npc-characters', npcs);
      return res?.data || { npcs, sharedLocationEmployees: [] };
    },
    enabled: !!userId,
    staleTime: 15 * 60 * 1000,  // 15 min — NPCs don't change frequently
    gcTime: 60 * 60 * 1000,     // 1 hour cache — prevents re-fetch on every recovery
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (failureCount >= 2) return false;
      const is429 = error?.message?.includes('429') || error?.status === 429 || error?.response?.status === 429;
      return is429 || failureCount < 1;
    },
    retryDelay: (attemptIndex) => Math.min(5000 * 2 ** attemptIndex, 30000),
    placeholderData: (prev) => prev,
  });

  // Derive arrays from the query result — backward-compatible with consumers
  // that expect backendNpcs as an array.
  const backendNpcs = Array.isArray(backendNpcData) ? backendNpcData : (backendNpcData?.npcs || []);
  const sharedLocationEmployees = Array.isArray(backendNpcData) ? [] : (backendNpcData?.sharedLocationEmployees || []);

  // ── Merge + dedupe by id ─────────────────────────────────────────────────────
  // sharedLocationEmployees are admin-owned characters from admin-owned Shared
  // locations. They are included here so the presence resolver can show them at
  // those shared locations. They are NOT owned by this user — ownership is
  // preserved completely. They are only visible through legitimate shared-
  // location presence (resolved by resolveTravelPresenceEntities →
  // getPresenceAtLocation, which checks resolved_current_location_id match).
  const allCharacters = (() => {
    const seen = new Set();
    return [...rlsCharacters, ...backendNpcs, ...sharedLocationEmployees].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  // NOTE: The Snapshot Floor / Bootstrap Guard recovery effect has been removed.
  // A successful current authoritative query result is accepted as current truth.
  // Historical roster size, cached Character objects, and anchor-absence no longer
  // override a successful current fetch. Legitimate roster reductions (deletion,
  // reclassification, account changes) are accepted without count-based recovery.
  // Stale default_character_id is handled by the consumer (Home), not by a refetch loop.

  // ── Real-time character cache sync — active on every page using this hook ────
  // Moves the Character.subscribe logic here from pages/Home/index so it remains
  // active on Home, Travel, Map, and any other page that mounts useOwnedCharacters.
  // On update: patches both ["characters", email] (list) AND ["character", id] (singular).
  // The singular patch covers Chat and Profile if they have that key loaded.
  // On delete: surgically removes from the list. On create: debounce-invalidates the list.
  useEffect(() => {
    if (!email) return;
    const charCreateTimerRef = { current: null };

    const unsubscribe = base44.entities.Character.subscribe((event) => {
      if (!event.data) return;

      if (event.type === 'update') {
        // Patch the list cache — covers Home Cards, Travel, Map
        queryClient.setQueryData(['characters', email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          const idx = prev.findIndex(c => c.id === event.data.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...prev[idx], ...event.data };
          return next;
        });
        // Also patch the singular cache key — covers Chat and Profile when mounted
        // No-op if that key is not currently in the React Query cache.
        queryClient.setQueryData(['character', event.data.id], (prev) => {
          if (!prev) return prev;
          return { ...prev, ...event.data };
        });

      } else if (event.type === 'delete') {
        queryClient.setQueryData(['characters', email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          const exists = prev.some(c => c.id === event.data.id);
          if (!exists) return prev;
          return prev.filter(c => c.id !== event.data.id);
        });

      } else if (event.type === 'create') {
        if (charCreateTimerRef.current) clearTimeout(charCreateTimerRef.current);
        charCreateTimerRef.current = setTimeout(() => {
          charCreateTimerRef.current = null;
          queryClient.invalidateQueries({ queryKey: ['characters', email] });
        }, 10000);
      }
    });

    return () => {
      unsubscribe();
      if (charCreateTimerRef.current) clearTimeout(charCreateTimerRef.current);
    };
  }, [email, queryClient]);

  // ── Derived slices ────────────────────────────────────────────────────────────
  // Persisted character_type is the sole classification authority.
  // Runtime code does not manufacture or substitute a different type.
  // If character_type is absent, the character remains in allCharacters but
  // does not appear in a type-specific slice — it is not reclassified.
  //
  // LIVE-OPERATIONAL LIFECYCLE EXCLUSION: These slices represent live gameplay
  // participants. Terminal lifecycle states (deleted, soft_deleted, merged) are
  // excluded here so they do not function as active gameplay characters. The
  // broad allCharacters universe retains them for inspection/management.
  // moved_away is NOT terminal — it remains in live slices.
  const _isTerminal = (c) => c.status === "deleted" || c.status === "soft_deleted" || c.status === "merged";
  const activeCreated    = allCharacters.filter(c => c.character_type === "active_created_character" && !_isTerminal(c));
  const npcFictitious    = allCharacters.filter(c => c.character_type === "npc_fictitious" && !_isTerminal(c));
  const npcFamilyMembers = allCharacters.filter(c => c.character_type === "npc_family_member" && !_isTerminal(c));
  const npcRegular       = allCharacters.filter(c => c.character_type === "npc_regular" && !_isTerminal(c));
  const travelCompanions = [...activeCreated, ...npcFictitious, ...npcFamilyMembers];

  // ── 3. Prefetch CharacterFinancial for all characters ────────────────────────
  // TWO-PASS STRATEGY:
  //   Pass 1 (owner_email scoped): Catches records written with owner_email set.
  //   Pass 2 (character_id targeted): Catches NPC/service-created records where
  //     owner_email is null/missing on the CharacterFinancial record. These are
  //     valid records created by backfill/automation but invisible to the RLS-scoped
  //     owner_email query.
  // No records are created or modified here — read-only resolution.
  //
  // KEY STABILITY: Use a sorted ID fingerprint instead of allCharacters.length.
  // allCharacters.length stays stable when characters are updated (patch events),
  // but the sorted IDs change only when characters are actually added or removed.
  // This prevents financial re-fetches on every automation write to a character.
  const characterIdFingerprint = [...allCharacters.map(c => c.id)].sort().join(',');
  const { data: financialIndex = {} } = useQuery({
    queryKey: ["characterFinancialIndex", email, characterIdFingerprint],
    queryFn: async () => {
      if (!email) return {};
      // RATE LIMIT PROTECTION: this query fires two CharacterFinancial.filter calls.
      // It is gated by characterIdFingerprint — only re-runs when the character ID set
      // actually changes (add/delete), not on field updates (automation writes).

      // Pass 1: owner_email-scoped fetch (covers active_created_character and NPCs with owner_email set)
      const financialRecords = await base44.entities.CharacterFinancial.filter(
        { owner_email: email },
        null,
        300
      );
      const byCharacterId = {};
      for (const record of financialRecords) {
        if (record.character_id) byCharacterId[record.character_id] = record;
      }

      // Pass 2: Fetch CharacterFinancial records that have owner_email: null (service/automation-created NPCs).
      // These are missed by the owner_email-scoped pass 1. Since CharacterFinancial has no RLS,
      // we query with is_npc: true to get all NPC financial records, then match by character_id.
      const npcCharacterIds = new Set(
        allCharacters
          .filter(c => {
            const t = c.character_type;
            return (t === 'npc_fictitious' || t === 'npc_family_member' || t === 'npc_regular');
          })
          .map(c => c.id)
          .filter(id => id && !byCharacterId[id]) // only those not found in pass 1
      );

      if (npcCharacterIds.size > 0) {
        try {
          // Query all NPC financial records (no owner_email filter) — no RLS on this entity
          const npcFinancials = await base44.entities.CharacterFinancial.filter(
            { is_npc: true },
            null,
            300
          );
          for (const record of npcFinancials) {
            if (record.character_id && npcCharacterIds.has(record.character_id) && !byCharacterId[record.character_id]) {
              byCharacterId[record.character_id] = record;
            }
          }
        } catch {
          // Pass 2 miss is non-fatal — pass 1 records are still returned
        }
      }

      return byCharacterId;
    },
    enabled: !!email && allCharacters.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  // isInitialLoading is true ONLY when we have nothing to show at all.
  // If we already have characters (from localStorage initialData or a prior fetch),
  // we never show the full-page loading spinner — data is usable immediately.
  const isInitialLoading = (isLoadingRls && !rlsCharacters.length) && (isLoadingNpc && !backendNpcs.length);
  const isRefreshing     = (isFetchingRls || isFetchingNpc) && !isInitialLoading;

  // isFinancialLoading: true while the financialIndex query has not yet returned data.
  // Used by CharacterCard to distinguish "still loading" from "confirmed missing".
  const { isFetching: isFetchingFinancial, isLoading: isLoadingFinancial } = useQuery({
    queryKey: ["characterFinancialIndex", email, characterIdFingerprint],
    enabled: false, // already managed above — just read the state
  });
  const isFinancialLoading = isLoadingFinancial || isFetchingFinancial;

  return {
    allCharacters,
    activeCreated,
    npcFictitious,
    npcFamilyMembers,
    npcRegular,
    travelCompanions,
    isInitialLoading,
    isRefreshing,
    isFinancialLoading,
    rlsCharacters,
    backendNpcs,
    financialIndex,
  };
}