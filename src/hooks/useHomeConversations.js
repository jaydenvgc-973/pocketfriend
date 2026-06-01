/**
 * useHomeConversations
 *
 * Single shared hook that fetches ALL conversations for the current user once,
 * at the Home page level. Individual CharacterCards consume a pre-filtered slice
 * instead of each running their own Conversation.filter query.
 *
 * ARCHITECTURE RULE:
 * - ONE Conversation.filter per session (owner_email scoped, all characters at once)
 * - Result cached in React Query with 5-minute staleTime
 * - Each card receives its slice via getConversationsForCharacter(characterId)
 * - Zero per-card Conversation.filter calls
 *
 * This eliminates the N-per-card Conversation.filter storm that was the root cause
 * of the simultaneous API request overload on Home page load.
 */

import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useMemo } from 'react';

export function useHomeConversations(ownerEmail) {
  const { data: allConversations = [], isLoading, isFetching } = useQuery({
    queryKey: ['home_conversations', ownerEmail],
    queryFn: async () => {
      if (!ownerEmail) return [];
      // ONE query for all conversations owned by this user — not per-character.
      // Limit 500: covers accounts with many characters × many threads.
      return base44.entities.Conversation.filter(
        { owner_email: ownerEmail },
        '-updated_date',
        500
      );
    },
    enabled: !!ownerEmail,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  // Build a lookup map: characterId → conversations[] for O(1) per-card access.
  // A conversation belongs to a character if character_ids includes that character's id.
  const conversationsByCharacterId = useMemo(() => {
    const map = new Map();
    for (const convo of allConversations) {
      const ids = convo.character_ids || [];
      for (const cid of ids) {
        if (!map.has(cid)) map.set(cid, []);
        map.get(cid).push(convo);
      }
    }
    return map;
  }, [allConversations]);

  const getConversationsForCharacter = (characterId) => {
    return conversationsByCharacterId.get(characterId) || [];
  };

  return {
    allConversations,
    getConversationsForCharacter,
    isLoading,
    isFetching,
  };
}