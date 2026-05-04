import { useEffect } from "react";

/**
 * useChatScrollTracking
 *
 * Attaches a scroll listener to the chat container element identified by
 * [data-chat-container="true"] and updates the caller's userScrolledAway state.
 *
 * Rules:
 * - No dependency on characterId or conversationId — DOM selector is stable.
 * - Only reads DOM geometry; never touches entities or backend functions.
 * - Cleanup removes the event listener on unmount.
 *
 * @param {function} setUserScrolledAway - React state setter from pages/Chat
 */
export function useChatScrollTracking(setUserScrolledAway) {
  useEffect(() => {
    const container = document.querySelector('[data-chat-container="true"]');
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      setUserScrolledAway(!isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}