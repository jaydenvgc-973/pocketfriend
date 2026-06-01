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
      // Invalidate the per-character conversation cache (used by Chat page itself).
      queryClient.invalidateQueries({ queryKey: ['conversations', snapshotCharacterId, ownerEmail] });
      traceEvent('thread:read DISPATCH (postLoad)', { caller: 'useChatPostLoadEffects', page: getActiveContext().page, detail: `charId=${snapshotCharacterId}` });
      // Dispatch thread:read so WorldContactsPopup and useWorldContactsUnread can react
      // to green-channel (world_phone) reads with a contactId.
      // channel:'direct' signals this is a red-channel thread — green hooks ignore it.
      window.dispatchEvent(new CustomEvent('thread:read', {
        detail: {
          characterId: snapshotCharacterId,
          channel: 'direct',
        }
      }));
      // After the mark-read writes settle (2.5s), invalidate the shared home unread cache
      // so all Home card badges refresh from one shared query instead of N per-card recounts.
      setTimeout(() => {
        if (!isMounted) return;
        window.dispatchEvent(new CustomEvent('home:refresh_unread'));
      }, 2500);
    })();

    return () => {
      isMounted = false;
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
}