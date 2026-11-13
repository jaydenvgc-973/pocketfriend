import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Fetches all character sources for the Scene page using the same
 * multi-query strategy as the Travel page — ensuring Who's Here
 * shows every character the map counts, not just active_created ones.
 * 
 * Returns: { characters, activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner }
 * so Scene can properly track dependencies per-query-result.
 */
export function useSceneCharacters(currentUser) {
  const enabled = !!currentUser?.email;
  const enabledById = !!currentUser?.id;

  const { data: activeChars = [] } = useQuery({
    queryKey: ["activeCharacters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({
      owner_email: currentUser.email,
      status: "active",
      character_type: "active_created_character"
    }),
    enabled,
    staleTime: 0,
  });

  // Also fetches sharedLocationEmployees — admin-owned characters employed at
  // admin-owned Shared locations. These are the canonical admin records (not
  // copies), made visible through legitimate shared-location presence. They
  // are included in the character pool so the presence resolver can show them
  // at those shared locations when they are legitimately present/on shift.
  const { data: backendNpcData = {} } = useQuery({
    queryKey: ["npcCharacters", currentUser?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchNPCsForUser', {});
      return {
        npcFictitious: (res?.data?.npcs || []).filter(c => c.character_type === 'npc_fictitious'),
        sharedLocationEmployees: res?.data?.sharedLocationEmployees || [],
        sharedLocationVisitors: res?.data?.sharedLocationVisitors || [],
      };
    },
    enabled: enabledById,
    staleTime: 0,
  });
  const backendNpcFictitious = backendNpcData?.npcFictitious || [];
  const sharedLocationEmployees = backendNpcData?.sharedLocationEmployees || [];
  const sharedLocationVisitors = backendNpcData?.sharedLocationVisitors || [];

  const { data: rlsNpcFictitious = [] } = useQuery({
    queryKey: ["npcFictitiousRls", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { owner_email: currentUser.email, character_type: 'npc_fictitious' },
      '-created_date', 300
    ),
    enabled,
    staleTime: 0,
  });

  const { data: familyByCreatedBy = [] } = useQuery({
    queryKey: ["npcFamilyMembers", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { owner_email: currentUser.email, character_type: 'npc_family_member' },
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

  // ASSIGNED CHILD-CARE CAREGIVERS
  // The existing child-supervision system (ensureChildCaregiverPresence) assigns a
  // caregiver as this account's own npc_regular Character record (is_sitter = true,
  // sitter_assigned_to_location_id = the home). That caregiver is a legitimate member
  // of the household, so it must be part of the Scene character pool — otherwise
  // presence, Who's Here and scene dialogue cannot see it and an under-16 child is
  // shown and described as alone while supervised.
  // Scoped to caregiver records only: no general npc_regular scan.
  const { data: sceneCaregivers = [] } = useQuery({
    queryKey: ["sceneCaregivers", currentUser?.email],
    queryFn: async () => {
      const rows = await base44.entities.Character.filter(
        { owner_email: currentUser.email, character_type: 'npc_regular' },
        '-created_date', 100
      );
      return (rows || []).filter((c) =>
        c.is_sitter === true || /babysit|caregiver|nanny|sitter/i.test(String(c.occupation || ''))
      );
    },
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
    // sharedLocationEmployees are admin-owned characters from admin-owned
    // Shared locations. Dedupe against the user's own characters (seenNpc +
    // seenFam already cover npc_fictitious and npc_family_member; activeChars
    // are deduped separately). Include them so the Scene presence resolver
    // can show them at those shared locations.
    // Assigned caregivers are real household members — included unless already present.
    const seenCare = new Set([...activeChars, ...npcFictitious, ...npcFamily].map(c => c.id));
    const caregivers = sceneCaregivers.filter(c => {
      if (seenCare.has(c.id)) return false;
      seenCare.add(c.id);
      return true;
    });
    const seenShared = new Set([...activeChars, ...npcFictitious, ...npcFamily, ...caregivers].map(c => c.id));
    const sharedEmployees = sharedLocationEmployees.filter(c => {
      if (seenShared.has(c.id)) return false;
      seenShared.add(c.id);
      return true;
    });
    const sharedVisitors = sharedLocationVisitors.filter(c => {
      if (seenShared.has(c.id)) return false;
      seenShared.add(c.id);
      return true;
    });
    return [...activeChars, ...npcFictitious, ...npcFamily, ...caregivers, ...sharedEmployees, ...sharedVisitors].filter(c =>
      c.is_test_character !== true &&
      c.diagnostic_only !== true &&
      c.exclude_from_default_scene_queries !== true &&
      // A deceased or removed character is never a living scene participant.
      c.life_status !== 'deceased' &&
      c.status !== 'deceased' &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'merged'
    );
  }, [activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner, sceneCaregivers, sharedLocationEmployees, sharedLocationVisitors]);

  // Return all source arrays so Scene can track dependency-per-query, not just final count
  return { characters, activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner, sceneCaregivers, sharedLocationEmployees, sharedLocationVisitors };
}