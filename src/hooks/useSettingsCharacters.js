/**
 * useSettingsCharacters
 *
 * Shared hook for all Settings subpages.
 * Fetches: active+family via RLS + npc_fictitious via backend.
 * Returns: resolveSettingsCharacterLists() sections ready for rendering.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { resolveSettingsCharacterLists } from "@/lib/characterEditableListResolver";

export function useSettingsCharacters(currentUser, moduleType) {
  // RLS characters (active, family, etc.)
  const { data: rlsCharacters = [], isLoading: rlsLoading } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () =>
      currentUser?.email
        ? base44.entities.Character.filter({ owner_email: currentUser.email }, "-created_date", 300)
        : [],
    enabled: !!currentUser?.email,
  });

  // NPC fictitious via backend (catches service-created records not visible via RLS)
  const { data: npcFictitiousRaw = [], isLoading: npcLoading } = useQuery({
    queryKey: ["npc-characters", currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const res = await base44.functions.invoke("fetchNPCsForUser", {});
      return res?.data?.npcs || [];
    },
    enabled: !!currentUser?.id,
  });

  // Merge, deduplicate
  const allCharacters = useMemo(() => {
    const seen = new Set();
    return [...rlsCharacters, ...npcFictitiousRaw].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [rlsCharacters, npcFictitiousRaw]);

  // Resolve into grouped sections
  const sections = useMemo(
    () => resolveSettingsCharacterLists(allCharacters, currentUser, moduleType),
    [allCharacters, currentUser?.id, moduleType]
  );

  const isLoading = rlsLoading || npcLoading;

  return { sections, allCharacters, isLoading };
}