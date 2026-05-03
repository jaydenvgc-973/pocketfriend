import { useEffect, useRef } from "react";

/**
 * useChatScroll
 *
 * Handles scroll-to-bottom behavior for Chat and Text (phone) pages.
 *
 * Rules:
 * - On initial message load: jump to bottom once after layout settles (instant, no animation).
 * - On new incoming/outgoing message: smooth scroll to bottom ONLY if user is near the bottom.
 * - If user has scrolled up, never force-scroll them back down.
 *
 * @param {string|null} lastMessageId - ID of the last message in the thread.
 * @param {string} characterId - Current character (used to reset initial-load flag on navigation).
 * @param {boolean} userScrolledAway - True if the user has scrolled up from the bottom.
 * @param {React.RefObject} bottomRef - Ref attached to the sentinel div at the end of the message list.
 */
export function useChatScroll(lastMessageId, characterId, userScrolledAway, bottomRef) {
  const isInitialLoadRef = useRef(true);

  // Reset initial-load flag whenever the user navigates to a different character
  useEffect(() => {
    isInitialLoadRef.current = true;
  }, [characterId]);

  useEffect(() => {
    if (!lastMessageId) return;

    if (isInitialLoadRef.current) {
      // First batch of messages: defer scroll until after framer-motion + image layout settles
      isInitialLoadRef.current = false;
      const timer = setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }, 80);
      return () => clearTimeout(timer);
    }

    // Subsequent messages (new send/receive): smooth scroll only when near bottom
    if (!userScrolledAway) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lastMessageId]); // eslint-disable-line react-hooks/exhaustive-deps
}