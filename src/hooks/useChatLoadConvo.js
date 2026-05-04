import { useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * useChatLoadConvo
 *
 * Handles: Conversation.filter, Message.filter (initial visible render window),
 * PendingMessage.filter, conversation creation, and pending message delivery.
 *
 * STORAGE vs RENDER WINDOW DISTINCTION:
 * - All messages remain stored in the database. Nothing is deleted.
 * - Only the initial visible render window is limited to avoid UI overload.
 * - Older messages outside the render window remain stored, retrievable via
 *   the "Load older messages" pagination button, and accessible in the
 *   Media Gallery and Life Journal/Archive systems.
 * - New messages sent or received in the current session are NEVER excluded
 *   from the visible feed — they are always appended to the front end of state.
 *
 * MSG_WINDOW: Number of most recent messages shown on initial load.
 * Increase if conversations feel thin. Decrease only if perf degrades.
 *
 * Pagination: loadOlderMessages() uses server-side $lt cursor on created_date
 * (confirmed supported by Base44 MongoDB-compatible query layer).
 */

const MSG_WINDOW = 200; // Initial visible render window — NOT a delete or archive limit
const PAGINATION_PAGE = 100; // Messages per "load older" page

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
  // Tracks the characterId that initiated the currently-running load.
  // If characterId changes mid-load, the old load's setState calls are dropped.
  const loadingForCharacterIdRef = useRef(null);
  // Stable refs for pagination — updated on load, never cause re-renders
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

    // Reset all visible state immediately on character switch
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    setConvoLoadError(null);
    if (setHasOlderMessages) setHasOlderMessages(false);
    convoIdRef.current = null;
    oldestMsgTimestampRef.current = null;

    const loadConvo = async () => {
      isLoadingConvoRef.current = true;
      loadingForCharacterIdRef.current = characterId; // stamp which character this load is for
      setIsLoadingConvo(true);
      const t0 = Date.now();
      console.log(`[CHAT_LOAD] loadConvo START charId=${characterId} chatType=${chatType} t=${t0}`);

      try {
        // ── STEP 1: Find the conversation for this character ─────────────────
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
          const is429 = err?.message?.includes('429') || err?.message?.includes('Rate limit') || err?.message?.includes('rate limit');
          if (is429) {
            // Transient platform-wide rate limit — retry once after 3s before surfacing error screen.
            // This prevents unrelated scheduled automation 429s from killing the chat load.
            console.warn(`[CHAT_LOAD] Conversation.filter 429 — retrying once in 3s t=${Date.now()}`);
            await new Promise(r => setTimeout(r, 3000));
            allConvos = await base44.entities.Conversation.filter(
              { owner_email: currentUser.email },
              "-last_message_date",
              100
            );
            console.log(`[CHAT_LOAD] Conversation.filter RETRY DONE count=${allConvos.length} t=${Date.now()}`);
          } else {
            console.error(`[CHAT_LOAD] Conversation.filter ERROR ${err?.message} t=${Date.now()}`);
            throw err;
          }
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

          // ── STEP 2: Load most recent MSG_WINDOW messages for initial render ──
          // IMPORTANT: This controls the initial visible render window only.
          // All other messages remain stored in the database.
          // They are accessible via pagination, Media Gallery, and Life Journal.
          console.log(`[CHAT_LOAD] Message.filter START convoId=${convoId} window=${MSG_WINDOW} t=${Date.now()}`);
          let loadedMsgs;
          try {
            loadedMsgs = await base44.entities.Message.filter(
              { conversation_id: convoId },
              "-created_date",
              MSG_WINDOW
            );
            console.log(`[CHAT_LOAD] Message.filter DONE count=${loadedMsgs?.length ?? 0} t=${Date.now()}`);
          } catch (err) {
            const is429 = err?.message?.includes('429') || err?.message?.includes('Rate limit') || err?.message?.includes('rate limit');
            if (is429) {
              // Transient 429 on message load — retry once after 3s before surfacing error screen.
              console.warn(`[CHAT_LOAD] Message.filter 429 — retrying once in 3s t=${Date.now()}`);
              await new Promise(r => setTimeout(r, 3000));
              loadedMsgs = await base44.entities.Message.filter(
                { conversation_id: convoId },
                "-created_date",
                MSG_WINDOW
              );
              console.log(`[CHAT_LOAD] Message.filter RETRY DONE count=${loadedMsgs?.length ?? 0} t=${Date.now()}`);
            } else {
              console.error(`[CHAT_LOAD] Message.filter ERROR ${err?.message} t=${Date.now()}`);
              throw err;
            }
          }

          convoIdRef.current = convoId;

          if (loadedMsgs && loadedMsgs.length > 0) {
            // Sort chronologically oldest→newest for correct render order
            const sorted = [...loadedMsgs].sort((a, b) =>
              new Date(a.created_date || a.timestamp || 0) - new Date(b.created_date || b.timestamp || 0)
            );

            // STALE LOAD GUARD: if user switched characters while this load was in flight, discard
            if (loadingForCharacterIdRef.current !== characterId) {
              console.warn(`[CHAT_LOAD] Stale load result for charId=${characterId} — active charId=${loadingForCharacterIdRef.current}. Discarding.`);
              return;
            }

            // Pagination cursor = oldest timestamp currently in the visible window
            oldestMsgTimestampRef.current = sorted[0]?.created_date || sorted[0]?.timestamp || null;

            // Signal UI to show "Load older messages" button only if we hit the window ceiling
            const hasOlder = loadedMsgs.length >= MSG_WINDOW;
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

        // ── STEP 3: Deliver any pending messages queued during offline/away ──
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

        if (pending.length > 0 && convoId && loadingForCharacterIdRef.current === characterId) {
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
   * Fetches the next page of stored messages that are older than the oldest
   * currently visible message. Uses a server-side $lt cursor on created_date
   * (Base44 supports MongoDB comparison operators confirmed).
   *
   * STORAGE CONTRACT:
   * - Does NOT delete, archive, or modify any messages.
   * - Only prepends previously-stored messages into the visible render window.
   * - New messages in the current session are never touched by this function.
   * - The cursor is based on created_date timestamp, not array position.
   */
  const loadOlderMessages = useCallback(async () => {
    const convoId = convoIdRef.current;
    const cursor = oldestMsgTimestampRef.current;
    if (!convoId || !cursor || isLoadingOlderRef.current) return false;

    isLoadingOlderRef.current = true;
    console.log(`[CHAT_LOAD] loadOlderMessages START cursor=${cursor} convoId=${convoId}`);

    try {
      // Server-side $lt cursor — only fetches messages strictly before the cursor timestamp
      // $lt is confirmed supported by Base44's MongoDB-compatible query layer
      const older = await base44.entities.Message.filter(
        { conversation_id: convoId, created_date: { $lt: cursor } },
        "-created_date",
        PAGINATION_PAGE
      );

      if (!older || older.length === 0) {
        if (setHasOlderMessages) setHasOlderMessages(false);
        console.log(`[CHAT_LOAD] loadOlderMessages: no more stored messages`);
        return false;
      }

      // Sort chronologically for correct prepend order
      const sorted = [...older].sort((a, b) =>
        new Date(a.created_date || a.timestamp || 0) - new Date(b.created_date || b.timestamp || 0)
      );

      // Advance cursor to the oldest message in this new page
      oldestMsgTimestampRef.current = sorted[0]?.created_date || sorted[0]?.timestamp || cursor;

      // Signal if there may be even older messages stored
      if (setHasOlderMessages) setHasOlderMessages(older.length >= PAGINATION_PAGE);

      console.log(`[CHAT_LOAD] loadOlderMessages DONE fetched=${older.length} newCursor=${oldestMsgTimestampRef.current}`);

      // Prepend stored older messages to top of visible feed — deduplicate by id
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newOnes = sorted.filter(m => !existingIds.has(m.id));
        return [...newOnes, ...prev];
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