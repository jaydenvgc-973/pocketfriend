import { useEffect, useRef } from "react";

/**
 * useChatScroll
 *
 * Handles scroll-to-bottom behavior for Chat and Text (phone) pages.
 *
 * ROOT CAUSE OF PREVIOUS BUG:
 * The old hook used [lastMessageId, messagesCount] as the dependency for the initial scroll.
 * When a character switch occurred:
 *   1. characterId changes → reset flags (correct)
 *   2. messages clear → messagesCount=0, lastMessageId=null → effect exits early (correct)
 *   3. BUT: on the first re-render when messagesCount goes 0→N, the isInitialLoadRef.current
 *      was already set to false by a partial render cycle, so the condition check failed.
 *
 * FIX: Track the characterId that was in effect when the scroll fired. On character change,
 * reset both flags. The initial scroll effect depends on [characterId, lastMessageId] —
 * the characterId change resets the guard, and lastMessageId arriving triggers the scroll.
 * messagesCount is no longer needed as a trigger.
 *
 * @param {string|null} lastMessageId - ID of the last message in the thread.
 * @param {string} characterId - Current character (used to reset initial-load flag on navigation).
 * @param {boolean} userScrolledAway - True if the user has scrolled up from the bottom.
 * @param {React.RefObject} bottomRef - Ref attached to the sentinel div at the end of the message list.
 * @param {number} messagesCount - Kept for API compatibility but no longer used as scroll trigger.
 */
export function useChatScroll(lastMessageId, characterId, userScrolledAway, bottomRef, messagesCount) {
  // Tracks the characterId for which we've already done the initial scroll.
  // Resets when characterId changes, ensuring each new character gets a fresh bottom scroll.
  const scrolledForCharacterRef = useRef(null);

  // Initial scroll: fires when messages first arrive for a given character.
  // Two-pass strategy:
  //   Pass 1 at 300ms — covers most cases after framer-motion initial render.
  //   Pass 2 at 800ms — catches lazy image/content height changes that delay the true bottom.
  // Both passes are instant (no smooth animation) so the user never sees a slow drift.
  // Dependency on characterId ensures a reset when switching characters.
  useEffect(() => {
    if (!lastMessageId || !characterId) return;
    // Already scrolled for this character's initial load — don't fire again
    if (scrolledForCharacterRef.current === characterId) return;

    // Mark this character as having received its initial scroll
    scrolledForCharacterRef.current = characterId;

    const t1 = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }, 300);
    const t2 = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [characterId, lastMessageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subsequent new messages: smooth scroll only when user is near bottom.
  // Only fires AFTER the initial scroll for this character has already run.
  useEffect(() => {
    if (!lastMessageId || !characterId) return;
    if (scrolledForCharacterRef.current !== characterId) return; // initial scroll not yet done
    if (userScrolledAway) return;

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]); // eslint-disable-line react-hooks/exhaustive-deps
}