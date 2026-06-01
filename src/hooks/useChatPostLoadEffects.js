import { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { traceRequest, traceEvent } from "@/lib/chatLoadTrace";
import { getActiveContext } from "@/lib/simulationGate";

/**
 * useChatPostLoadEffects
 *
 * Handles one post-load side effect after a conversation is loaded:
 * 1. Mark thread read — fires markThreadRead backend function when a thread opens,
 *    then dispatches thread:read so CharacterCard badge clears immediately.
 *
 * PRIORITY ARCHITECTURE:
 * generateCatchupNarrative has been removed from this hook.
 * It must NOT run automatically when Chat opens — that is a page-open AI call
 * that the user did not trigger. Chat open is not a user action.
 *
 * Catchup narrative is triggered inside sendMessage (Chat page) on the user's
 * first send after a 30+ minute gap. This ensures:
 *   1. Chat opens and messages load with zero AI calls.
 *   2. The user can read their conversation immediately.
 *   3. Narrative context is only fetched if the user chooses to reply.
 *   4. No speculative LLM work competes with Chat load or response generation.
 *
 * Ownership: scoped to the authenticated characterId/conversationId pair.
 * owner_email enforcement is handled server-side by markThreadRead.
 */
export function useChatPostLoadEffects({
  conversationId,
  characterId,
  ownerEmail,
  queryClient,
}) {
  useEffect(() => {
    if (!conversationId || !characterId) return;

    const snapshotCharacterId = characterId;
    let isMounted = true;

    (async () => {
      const ctx = getActiveContext();
      traceRequest('markThreadRead', { caller: 'useChatPostLoadEffects', page: ctx.page, status: 'ALLOWED', detail: `convoId=${conversationId} charId=${snapshotCharacterId}` });
      try {
        const result = await base44.functions.invoke('markThreadRead', {
          conversationId,
          characterId: snapshotCharacterId,
        });
        console.log('[markThreadRead call]', {
          conversationId,
          characterId: snapshotCharacterId,
          result: result?.data,
        });
      } catch (err) {
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
      queryClient.invalidateQueries({ queryKey: ['conversations', snapshotCharacterId, ownerEmail] });
      traceEvent('thread:read DISPATCH (postLoad)', { caller: 'useChatPostLoadEffects', page: getActiveContext().page, detail: `charId=${snapshotCharacterId}` });
      // NOTE: Chat/Text opens a direct (red) thread, not a world_phone (green) thread.
      // Dispatching thread:read with no contactId previously caused useWorldContactsUnread
      // to zero ALL green-channel contacts as a fallback — wiping unread badges for every
      // character even though the user only opened one direct chat thread.
      // Fix: do not pass contactId here (it's a direct/text thread, not a world_phone contact).
      // useWorldContactsUnread only responds to contactId being present to do surgical clear;
      // without it the handler now SKIPS the zero-all fallback for direct/text channels.
      window.dispatchEvent(new CustomEvent('thread:read', {
        detail: {
          characterId: snapshotCharacterId,
          channel: 'direct', // signals this is a red-channel thread, not green
        }
      }));
    })();

    return () => {
      isMounted = false;
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
}