import { useEffect } from "react";
import { base44 } from "@/api/base44Client";

/**
 * useChatPostLoadEffects
 *
 * Handles two post-load side effects after a conversation is loaded:
 * 1. Mark thread read — fires markThreadRead backend function if unread messages exist,
 *    then applies is_read=true to all character messages in local state.
 * 2. Catchup narrative — if the user has been away 30+ minutes, defers 3s then
 *    calls generateCatchupNarrative and stores the result for prompt injection.
 *
 * Ownership: scoped entirely to the authenticated characterId/conversationId pair.
 * Does not read owner_email — that is enforced server-side by markThreadRead and
 * generateCatchupNarrative backend functions.
 */
export function useChatPostLoadEffects({
  conversationId,
  characterId,
  messages,
  queryClient,
  catchupTimerRef,
  isMountedRef,
  setCatchupNarrativeText,
}) {
  useEffect(() => {
    if (!conversationId || !characterId) return;

    const snapshotCharacterId = characterId;
    let isMounted = true;

    (async () => {
      // ── MARK THREAD READ ─────────────────────────────────────────────────────
      // Only fire the backend function if there are actually unread character messages.
      // Skipping this call when nothing is unread eliminates a redundant request on every open.
      const hasUnread = messages.some(m => m.sender_type === "character" && !m.is_read);
      if (hasUnread) {
        try {
          await base44.functions.invoke('markThreadRead', { conversationId, characterId: snapshotCharacterId });
        } catch (err) {
          // markThreadRead failure is non-fatal — inline is_read marks were already applied by useChatLoadConvo.
          // Log visibly so 429s are detectable during debugging.
          const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
          if (is429) {
            console.warn('[PostLoadEffects] 429 on markThreadRead — inline marks already applied, continuing');
            window.__chatRateLimited = true;
            setTimeout(() => { window.__chatRateLimited = false; }, 60000);
          } else {
            console.warn('[PostLoadEffects] markThreadRead failed (non-fatal):', err?.message);
          }
        }
        if (!isMounted || snapshotCharacterId !== characterId) return;
        queryClient.invalidateQueries({ queryKey: ['conversations', snapshotCharacterId] });
      }

      // ── CATCHUP NARRATIVE ────────────────────────────────────────────────────
      // Deferred 3s to avoid competing with initial message render and markThreadRead.
      // Only fires if user has been away 30+ minutes and is still on the same character.
      if (isMounted && snapshotCharacterId === characterId && messages.length > 0) {
        const lastUserMsg = [...messages].reverse().find(m => m.sender_type === 'user');
        if (lastUserMsg) {
          const lastTime = new Date(lastUserMsg.timestamp || lastUserMsg.created_date);
          if ((new Date() - lastTime) / 60000 >= 30) {
            catchupTimerRef.current = setTimeout(() => {
              if (!isMounted || snapshotCharacterId !== characterId) return;
              base44.functions.invoke('generateCatchupNarrative', {
                characterId: snapshotCharacterId,
                conversationId,
                lastUserMessageTime: lastUserMsg.timestamp || lastUserMsg.created_date,
              })
                .then(r => {
                  if (!isMounted || snapshotCharacterId !== characterId) return;
                  if (r?.data?.success && r?.data?.catchupText) setCatchupNarrativeText(r.data.catchupText);
                })
                .catch(err => {
                  const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
                  if (is429) {
                    console.warn('[PostLoadEffects] 429 on generateCatchupNarrative — setting rate-limit flag');
                    window.__chatRateLimited = true;
                    setTimeout(() => { window.__chatRateLimited = false; }, 60000);
                  } else {
                    console.warn('[PostLoadEffects] generateCatchupNarrative failed:', err?.message);
                  }
                });
            }, 3000);
          }
        }
      }
    })();

    return () => {
      isMounted = false;
      if (catchupTimerRef.current) {
        clearTimeout(catchupTimerRef.current);
        catchupTimerRef.current = null;
      }
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
}