import { useEffect, useRef } from "react";

/**
 * useChatScroll
 *
 * Handles scroll-to-bottom behavior for Chat and Text (phone) pages.
 *
 * Rules:
 * - On initial message load: jump instantly to bottom after layout settles (deferred 150ms).
 * - On new incoming/outgoing message: smooth scroll to bottom ONLY if user is near the bottom.
 * - If user has scrolled up, never force-scroll them back down.
 *
 * @param {string|null} lastMessageId - ID of the last message in the thread.
 * @param {string} characterId - Current character (used to reset initial-load flag on navigation).
 * @param {boolean} userScrolledAway - True if the user has scrolled up from the bottom.
 * @param {React.RefObject} bottomRef - Ref attached to the sentinel div at the end of the message list.
 * @param {number} messagesCount - Total messages count; used to detect first-render after character switch.
 */
export function useChatScroll(lastMessageId, characterId, userScrolledAway, bottomRef, messagesCount) {
  const isInitialLoadRef = useRef(true);
  const hasDoneInitialScrollRef = useRef(false);

  // Reset initial-load flag whenever the user navigates to a different character
  useEffect(() => {
    isInitialLoadRef.current = true;
    hasDoneInitialScrollRef.current = false;
  }, [characterId]);

  // Initial scroll: fires when first batch of messages arrives after character load.
  // Two-pass strategy:
  //   Pass 1 at 300ms — covers most cases after framer-motion initial render.
  //   Pass 2 at 750ms — catches lazy image/content height changes that delay the true bottom.
  // Both passes are instant (no smooth animation) so the user never sees a slow drift.
  useEffect(() => {
    if (!lastMessageId) return;
    if (!isInitialLoadRef.current) return;
    if (hasDoneInitialScrollRef.current) return;

    isInitialLoadRef.current = false;
    hasDoneInitialScrollRef.current = true;

    const t1 = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }, 300);
    const t2 = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }, 750);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [lastMessageId, messagesCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subsequent new messages: smooth scroll only when user is near bottom
  useEffect(() => {
    if (!lastMessageId) return;
    if (!hasDoneInitialScrollRef.current) return; // initial scroll hasn't fired yet
    if (userScrolledAway) return;

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]); // eslint-disable-line react-hooks/exhaustive-deps
}