import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Fetches unread count for character-to-character (NPC/World Contacts) conversations.
 * Scoped strictly to the current user via owner_email.
 * Only counts messages in conversations of type "npc" where is_read == false.
 * Refreshes on a 60-second interval and whenever invalidated.
 */
export function useWorldContactsUnread(currentUserEmail) {
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef(null);

  const fetchUnread = async () => {
    if (!currentUserEmail) return;
    try {
      // Get all NPC conversations (character-to-character) for this user
      const convos = await base44.entities.Conversation.filter(
        { type: "npc" },
        "-updated_date",
        100
      ).catch(() => []);

      if (!convos || convos.length === 0) {
        setUnreadCount(0);
        return;
      }

      // Count unread messages across all NPC conversations
      // Messages created by characters (not user) that haven't been read
      let total = 0;
      for (const convo of convos) {
        const unreadMsgs = await base44.entities.Message.filter({
          conversation_id: convo.id,
          sender_type: "character",
          is_read: false,
        }, null, 50).catch(() => []);
        total += (unreadMsgs || []).length;
      }

      setUnreadCount(total);
    } catch {
      // Silently fail — badge just won't update
    }
  };

  useEffect(() => {
    if (!currentUserEmail) return;

    fetchUnread();

    // Poll every 60 seconds — not aggressive, keeps badge accurate
    intervalRef.current = setInterval(fetchUnread, 60000);

    // Subscribe to new message events to catch background-generated messages
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type === "create" && event.data?.sender_type === "character" && !event.data?.is_read) {
        // Re-fetch to get accurate count (we don't know if it's an NPC convo without checking)
        fetchUnread();
      } else if (event.type === "update" && event.data?.is_read === true) {
        // A message was marked read — decrement or re-fetch
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    });

    return () => {
      clearInterval(intervalRef.current);
      unsubscribe();
    };
  }, [currentUserEmail]);

  const markConversationRead = async (conversationId) => {
    if (!conversationId) return;
    try {
      const unreadMsgs = await base44.entities.Message.filter({
        conversation_id: conversationId,
        sender_type: "character",
        is_read: false,
      }, null, 100).catch(() => []);

      if (unreadMsgs?.length > 0) {
        await Promise.all(
          unreadMsgs.map(m => base44.entities.Message.update(m.id, { is_read: true }).catch(() => {}))
        );
        setUnreadCount(prev => Math.max(0, prev - unreadMsgs.length));
      }
    } catch { /* silent */ }
  };

  return { unreadCount, markConversationRead, refetch: fetchUnread };
}