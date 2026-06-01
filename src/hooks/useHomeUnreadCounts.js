/**
 * useHomeUnreadCounts
 *
 * Shared unread badge resolver for the Home page.
 *
 * ARCHITECTURE:
 * - Takes the full pre-fetched conversation list (from useHomeConversations)
 * - Identifies all unread-eligible conversation IDs across ALL characters at once
 * - Runs ONE batched fetchUnreadMessagesForConversations call (not per-card)
 * - Returns a Map: characterId → { red_chat, red_text, green }
 *
 * CharacterCard reads its slice from this map instead of fetching independently.
 *
 * This is the fix for the N×M Message.filter storm:
 * Instead of 8 cards × 5 convos = 40 simultaneous Message.filter calls,
 * we run ONE set of Message.filter calls for all unique conversation IDs,
 * then distribute results to each card.
 *
 * Rate limiting notes:
 * - fetchUnreadMessagesForConversations runs Promise.all internally — still concurrent.
 * - We limit to 100 conversations total across all characters to cap the batch size.
 * - Results cached in React Query with 5-minute staleTime.
 * - Refetch is triggered by the 'home:refresh_unread' custom event (dispatched after thread:read settle).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import {
  classifyConversationChannel,
  fetchUnreadMessagesForConversations,
  resolveUnreadBadgeCounts,
} from '@/lib/canonicalUnreadResolver';

const MAX_CONVOS_TO_CHECK = 100;

export function useHomeUnreadCounts(ownerEmail, allConversations = []) {
  const queryClient = useQueryClient();

  // Derive the sorted stable key from conversation IDs so the query only re-runs
  // when the conversation set actually changes (not on object reference churn).
  const eligibleConvos = allConversations
    .filter(c => classifyConversationChannel(c) !== null)
    .slice(0, MAX_CONVOS_TO_CHECK);

  const convoIdKey = eligibleConvos.map(c => c.id).sort().join(',');

  const { data: unreadMap = new Map() } = useQuery({
    queryKey: ['home_unread_counts', ownerEmail, convoIdKey],
    queryFn: async () => {
      if (!ownerEmail || eligibleConvos.length === 0) return new Map();

      const convoIds = eligibleConvos.map(c => c.id);

      // ONE batched call for all conversation IDs — replaces N per-card calls.
      const perConvoMessages = await fetchUnreadMessagesForConversations(convoIds, base44);

      // Build result map: characterId → badge counts
      // Each conversation can have multiple character_ids — attribute unread to each character.
      const resultMap = new Map();

      // Group conversations by character for efficient resolution
      const convosByChar = new Map();
      for (const convo of eligibleConvos) {
        for (const cid of (convo.character_ids || [])) {
          if (!convosByChar.has(cid)) convosByChar.set(cid, []);
          convosByChar.get(cid).push(convo);
        }
      }

      for (const [characterId, charConvos] of convosByChar) {
        const { red_chat, red_text, green } = resolveUnreadBadgeCounts(
          charConvos,
          perConvoMessages,
          characterId
        );
        resultMap.set(characterId, { red_chat, red_text, green });
      }

      return resultMap;
    },
    enabled: !!ownerEmail && eligibleConvos.length > 0,
    // 60s staleTime: green dots must clear promptly after WorldContactsPopup marks messages read.
    // The prior 5-minute staleTime caused green dots to persist long after opening World Contacts.
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  // Listen for 'home:refresh_unread' — dispatched by thread:read settle timers
  // so the shared cache refreshes once after mark-read completes.
  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['home_unread_counts', ownerEmail] });
    };
    window.addEventListener('home:refresh_unread', handleRefresh);
    return () => window.removeEventListener('home:refresh_unread', handleRefresh);
  }, [ownerEmail, queryClient]);

  const getUnreadForCharacter = (characterId) => {
    return unreadMap.get(characterId) || { red_chat: 0, red_text: 0, green: 0 };
  };

  return { unreadMap, getUnreadForCharacter };
}