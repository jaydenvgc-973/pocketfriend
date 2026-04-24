import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Fetches all character sources for the Scene page using the same
 * multi-query strategy as the Travel page — ensuring Who's Here
 * shows every character the map counts, not just active_created ones.
 */
export function useSceneCharacters(currentUser) {
  const enabled = !!currentUser?.email;
  const enabledById = !!currentUser?.id;

  const { data: activeChars = [] } = useQuery({
    queryKey: ["activeCharacters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({
      created_by: currentUser.email,
      status: "active",
      character_type: "active_created_character"
    }),
    enabled,
    staleTime: 0,
  });

  const { data: backendNpcFictitious = [] } = useQuery({
    queryKey: ["npcCharacters", currentUser?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchNPCsForUser', {});
      return (res?.data?.npcs || []).filter(c => c.character_type === 'npc_fictitious');
    },
    enabled: enabledById,
    staleTime: 0,
  });

  const { data: rlsNpcFictitious = [] } = useQuery({
    queryKey: ["npcFictitiousRls", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { created_by: currentUser.email, character_type: 'npc_fictitious' },
      '-created_date', 300
    ),
    enabled,
    staleTime: 0,
  });

  const { data: familyByCreatedBy = [] } = useQuery({
    queryKey: ["npcFamilyMembers", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { created_by: currentUser.email, character_type: 'npc_family_member' },
      '-created_date', 300
    ),
    enabled,
    staleTime: 0,
  });

  const { data: familyByOwner = [] } = useQuery({
    queryKey: ["npcFamilyMembersByOwner", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { owner_email: currentUser.email, character_type: 'npc_family_member' },
      '-created_date', 300
    ),
    enabled,
    staleTime: 0,
  });

  const characters = useMemo(() => {
    const seenNpc = new Set();
    const npcFictitious = [...backendNpcFictitious, ...rlsNpcFictitious].filter(c => {
      if (seenNpc.has(c.id)) return false;
      seenNpc.add(c.id);
      return true;
    });
    const seenFam = new Set();
    const npcFamily = [...familyByCreatedBy, ...familyByOwner].filter(c => {
      if (seenFam.has(c.id)) return false;
      seenFam.add(c.id);
      return true;
    });
    return [...activeChars, ...npcFictitious, ...npcFamily].filter(c =>
      c.is_test_character !== true &&
      c.diagnostic_only !== true &&
      c.exclude_from_default_scene_queries !== true
    );
  }, [activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner]);

  return characters;
}