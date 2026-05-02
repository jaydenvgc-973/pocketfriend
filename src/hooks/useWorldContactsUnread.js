import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to calculate unread message counts for World Contacts conversations.
 * Returns global unread count and per-contact unread counts.
 * Subscribes to real-time Message updates for live badge updates.
 */
export function useWorldContactsUnread(characterId, contacts = []) {
  const [unreadByContact, setUnreadByContact] = useState({});
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);

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
          // Find conversation for this contact
          const convos = await base44.entities.Conversation.filter(
            { type: 'npc', character_ids: [characterId] },
            '-updated_date',
            50
          );
          const convo = convos.find(c => c.title === convoTitle);

          if (convo) {
            // Count unread incoming messages in this conversation
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

    loadUnreadCounts();

    // Subscribe to real-time Message updates to refresh counts
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      // Recount on any message create/update
      if (event.type === 'create' || event.type === 'update') {
        loadUnreadCounts();
      }
    });

    return () => unsubscribe();
  }, [characterId, contacts]);

  return {
    unreadByContact,
    globalUnreadCount
  };
}