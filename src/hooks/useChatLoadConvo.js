import { useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * useChatLoadConvo
 *
 * Handles: Conversation.filter, Message.filter (50-message window), PendingMessage.filter,
 * conversation creation, and pending message delivery.
 *
 * Exposes loadOlderMessages() for timestamp-based pagination (loads messages
 * strictly older than the oldest currently visible message, using created_date).
 *
 * "Old message" definition: any message whose created_date timestamp is earlier
 * than the oldest timestamp in the current 50-message window. Never based on
 * array position or load order. New messages created in the current session
 * are never classified as old.
 */
export function useChatLoadConvo({
  characterId,
  character,
  chatType,
  currentUser,
  isMountedRef,
  setMessages,
  setConversationId,
  setIsTyping,
  setConvoLoadError,
  setIsLoadingConvo,
  setHasOlderMessages,
  retryKey = 0,
}) {
  const queryClient = useQueryClient();
  const isLoadingConvoRef = useRef(false);
  // Stable refs for pagination — do not cause re-renders
  const convoIdRef = useRef(null);
  const oldestMsgTimestampRef = useRef(null);
  const isLoadingOlderRef = useRef(false);

  useEffect(() => {
    // If character came back null (query done, not found), fail visibly
    if (characterId && currentUser?.email && character === null) {
      setConvoLoadError('error');
      setIsLoadingConvo(false);
      return;
    }
    if (!characterId || !character || !currentUser || !currentUser.email) return;
    // Guard: stale character object from previous navigation
    if (character.id !== characterId) return;
    if (isLoadingConvoRef.current) { isLoadingConvoRef.current = false; }
    isMountedRef.current = true;

    // Reset all state immediately on character switch
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    setConvoLoadError(null);
    if (setHasOlderMessages) setHasOlderMessages(false);
    convoIdRef.current = null;
    oldestMsgTimestampRef.current = null;

    const MSG_LIMIT = 50;

    const loadConvo = async () => {
      isLoadingConvoRef.current = true;
      setIsLoadingConvo(true);
      const t0 = Date.now();
      console.log(`[CHAT_LOAD] loadConvo START charId=${characterId} chatType=${chatType} t=${t0}`);

      try {
        // ── STEP 1: Conversation.filter ──────────────────────────────────────
        console.log(`[CHAT_LOAD] Conversation.filter START t=${Date.now()}`);
        let allConvos;
        try {
          allConvos = await base44.entities.Conversation.filter(
            { owner_email: currentUser.email },
            "-last_message_date",
            100
          );
          console.log(`[CHAT_LOAD] Conversation.filter DONE count=${allConvos.length} t=${Date.now()}`);
        } catch (err) {
          console.error(`[CHAT_LOAD] Conversation.filter ERROR ${err?.message} t=${Date.now()}`);
          throw err;
        }

        const convos = allConvos.filter(c =>
          c.type === chatType &&
          c.character_ids &&
          Array.isArray(c.character_ids) &&
          c.character_ids.includes(characterId)
        );

        let convoId = null;

        if (convos.length > 0) {
          const withMsgs = convos.filter(c => c.last_message_date);
          const withoutMsgs = convos.filter(c => !c.last_message_date);
          withMsgs.sort((a, b) => new Date(b.last_message_date) - new Date(a.last_message_date));
          withoutMsgs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
          const selectedConvo = [...withMsgs, ...withoutMsgs][0];
          convoId = selectedConvo.id;
          console.log(`[CHAT_LOAD] CONVO_SELECTED id=${convoId} candidates=${convos.length} last_msg=${selectedConvo.last_message_date || 'none'} t=${Date.now()}`);

          // ── STEP 2: Message.filter — most recent 50, sorted by timestamp ───
          console.log(`[CHAT_LOAD] Message.filter START convoId=${convoId} limit=${MSG_LIMIT} t=${Date.now()}`);
          let loadedMsgs;
          try {
            loadedMsgs = await base44.entities.Message.filter(
              { conversation_id: convoId },
              "-created_date",
              MSG_LIMIT
            );
            console.log(`[CHAT_LOAD] Message.filter DONE count=${loadedMsgs?.length ?? 0} t=${Date.now()}`);
          } catch (err) {
            console.error(`[CHAT_LOAD] Message.filter ERROR ${err?.message} t=${Date.now()}`);
            throw err;
          }

          convoIdRef.current = convoId;

          if (loadedMsgs && loadedMsgs.length > 0) {
            // Sort chronologically oldest→newest before rendering
            const sorted = [...loadedMsgs].sort((a, b) =>
              new Date(a.created_date || a.timestamp || 0) - new Date(b.created_date || b.timestamp || 0)
            );
            // Pagination cursor = oldest timestamp in current window
            oldestMsgTimestampRef.current = sorted[0]?.created_date || sorted[0]?.timestamp || null;
            // Signal whether there are older messages available
            const hasOlder = loadedMsgs.length >= MSG_LIMIT;
            if (setHasOlderMessages) setHasOlderMessages(hasOlder);

            setMessages(sorted);
            setConversationId(convoId);

            const unread = loadedMsgs.filter(m => m.sender_type === "character" && !m.is_read);
            if (unread.length > 0) {
              unread.forEach(m => {
                base44.entities.Message.update(m.id, { is_read: true }).catch(() => {});
              });
              queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
            }
          } else {
            if (setHasOlderMessages) setHasOlderMessages(false);
            oldestMsgTimestampRef.current = null;
            setConversationId(convoId);
          }
        } else {
          // No conversation found — create one
          console.log(`[CHAT_LOAD] No conversation found — creating new one t=${Date.now()}`);
          const convo = await base44.entities.Conversation.create({
            title: `${chatType} with ${character.name}`,
            type: chatType,
            character_ids: [characterId],
            owner_email: currentUser.email,
          });
          setConversationId(convo.id);
          convoIdRef.current = convo.id;
          convoId = convo.id;
          if (setHasOlderMessages) setHasOlderMessages(false);
          console.log(`[CHAT_LOAD] Conversation CREATED id=${convoId} t=${Date.now()}`);
        }

        // ── STEP 3: PendingMessage.filter ──────────────────────────────────
        console.log(`[CHAT_LOAD] PendingMessage.filter START t=${Date.now()}`);
        let pending;
        try {
          pending = await base44.entities.PendingMessage.filter(
            { character_id: characterId, delivered: false }
          );
          console.log(`[CHAT_LOAD] PendingMessage.filter DONE count=${pending?.length ?? 0} t=${Date.now()}`);
        } catch (err) {
          console.error(`[CHAT_LOAD] PendingMessage.filter ERROR ${err?.message} t=${Date.now()}`);
          throw err;
        }

        if (pending.length > 0 && convoId) {
          for (const pm of pending) {
            const charMsg = await base44.entities.Message.create({
              conversation_id: convoId,
              sender_type: "character",
              character_id: characterId,
              character_name: character.name,
              content: pm.content,
              image_url: pm.image_url || undefined,
              emotional_state: pm.emotional_state || "calm",
              timestamp: new Date().toISOString(),
            });

            setMessages(prev => prev.some(m => m.id === charMsg.id) ? prev : [...prev, charMsg]);
            await base44.entities.PendingMessage.update(pm.id, { delivered: true });
            await base44.entities.Conversation.update(convoId, {
              last_message_preview: pm.content.substring(0, 100),
              last_message_date: new Date().toISOString(),
            });

            await new Promise(r => setTimeout(r, 500));
          }
          queryClient.invalidateQueries({ queryKey: ['pendingMessages'] });
        }

        console.log(`[CHAT_LOAD] loadConvo COMPLETE elapsed=${Date.now() - t0}ms t=${Date.now()}`);
      } catch (err) {
        const isRateLimit = err?.message?.includes('429') || err?.message?.includes('Rate limit') || err?.message?.includes('rate limit');
        console.error(`[CHAT_LOAD] loadConvo FAILED isRateLimit=${isRateLimit} error="${err?.message}" t=${Date.now()}`);
        if (isRateLimit) {
          setConvoLoadError('rate_limited');
        } else {
          setConvoLoadError('error');
        }
      } finally {
        isLoadingConvoRef.current = false;
        setIsLoadingConvo(false);
        console.log(`[CHAT_LOAD] isLoadingConvo=false t=${Date.now()}`);
      }
    };

    const timer = setTimeout(() => loadConvo(), 300);
    return () => {
      clearTimeout(timer);
      isLoadingConvoRef.current = false;
      setIsLoadingConvo(false);
    };
  }, [characterId, character?.id, chatType, currentUser?.email, retryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * loadOlderMessages
   *
   * Fetches messages strictly older than the current oldest visible message.
   * Uses created_date timestamp cursor — never array position or load order.
   * Only fetches if there are known older messages (hasOlderMessages === true).
   * New messages in the current session are never affected by this function.
   */
  const loadOlderMessages = useCallback(async () => {
    const convoId = convoIdRef.current;
    const cursor = oldestMsgTimestampRef.current;
    if (!convoId || !cursor || isLoadingOlderRef.current) return false;

    isLoadingOlderRef.current = true;
    console.log(`[CHAT_LOAD] loadOlderMessages cursor=${cursor} convoId=${convoId}`);
    try {
      // Fetch 50 messages older than the cursor timestamp
      const older = await base44.entities.Message.filter(
        { conversation_id: convoId },
        "-created_date",
        50
      );
      // Filter to only messages strictly before our cursor
      const cursorTime = new Date(cursor).getTime();
      const olderFiltered = older.filter(m => {
        const t = new Date(m.created_date || m.timestamp || 0).getTime();
        return t < cursorTime;
      });

      if (olderFiltered.length === 0) {
        if (setHasOlderMessages) setHasOlderMessages(false);
        return false;
      }

      // Sort chronologically
      olderFiltered.sort((a, b) =>
        new Date(a.created_date || a.timestamp || 0) - new Date(b.created_date || b.timestamp || 0)
      );

      // Update cursor to oldest in this new batch
      oldestMsgTimestampRef.current = olderFiltered[0]?.created_date || olderFiltered[0]?.timestamp || cursor;

      // Signal if more may exist
      if (setHasOlderMessages) setHasOlderMessages(olderFiltered.length >= 50);

      // Prepend older messages to top of feed — do NOT affect current messages
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newOlder = olderFiltered.filter(m => !existingIds.has(m.id));
        return [...newOlder, ...prev];
      });

      return true;
    } catch (err) {
      console.error(`[CHAT_LOAD] loadOlderMessages FAILED error="${err?.message}"`);
      return false;
    } finally {
      isLoadingOlderRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isLoadingConvoRef, loadOlderMessages };
}