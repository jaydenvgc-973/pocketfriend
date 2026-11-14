import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Novel focus-character candidates.
 *
 * connectedIds — every character with an established connection to the central
 * character (relationship, memory, family, conversation, scene, gathering room).
 * crossAccountCharacters — connected characters belonging to other accounts.
 *
 * Read-only: the backend derives both from existing records and writes nothing.
 */
export default function useNovelCharacterCandidates(characterId, enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ["novel-character-candidates", characterId],
    queryFn: async () => {
      const res = await base44.functions.invoke("fetchNovelCharacterCandidates", { character_id: characterId });
      return res?.data || { connected_ids: [], cross_account_characters: [] };
    },
    enabled: !!characterId && enabled,
    staleTime: 60_000,
  });

  return {
    connectedIds: new Set(data?.connected_ids || []),
    crossAccountCharacters: data?.cross_account_characters || [],
    isLoading,
  };
}