import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to calculate unread message counts for World Contacts conversations.
 * Returns global unread count and per-contact unread counts.
 *
 * Initial load fires immediately on mount.
 * Subscription-triggered reloads are debounced 4 seconds to prevent
 * N×2 API calls per active message event (rate-limit risk reduction).
 */
export function useWorldContactsUnread(characterId, contacts = []) {
  const [unreadByContact, setUnreadByContact] = useState({});
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    if (!characterId || contacts.length === 0) {
      setUnreadByContact({});
      setGlobalUnreadCount(0);
      return;
    }

    // Load unread counts for all contacts
    const loadUnreadCounts = async () => {
      const newCounts = {};
      let total = 0;

      for (const contact of contacts) {
        const convoTitle = `npc_chat__${characterId}__${contact.person_name}`;
        try {
          const convos = await base44.entities.Conversation.filter(
            { type: 'npc', character_ids: [characterId] },
            '-updated_date',
            50
          );
          const convo = convos.find(c => c.title === convoTitle);

          if (convo) {
            const msgs = await base44.entities.Message.filter(
              { conversation_id: convo.id, sender_type: 'character', is_read: false }
            );
            newCounts[contact.person_name] = msgs.length;
            total += msgs.length;
          } else {
            newCounts[contact.person_name] = 0;
          }
        } catch {
          newCounts[contact.person_name] = 0;
        }
      }

      setUnreadByContact(newCounts);
      setGlobalUnreadCount(total);
    };

    // Initial load fires immediately
    loadUnreadCounts();

    // Subscription re-runs are debounced to prevent storm on active chat
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type === 'create' || event.type === 'update') {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          loadUnreadCounts();
        }, 4000);
      }
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [characterId, contacts]);

  return {
    unreadByContact,
    globalUnreadCount
  };
}