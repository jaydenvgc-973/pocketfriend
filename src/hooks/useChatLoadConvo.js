import { useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { activateChatSafeMode } from "@/lib/simulationGate";

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
  // Tracks whether we've already shown messages for the current character.
  // Used to decide whether a 429 failure blocks the screen or just warns.
  const hasShownMessagesRef = useRef(false);

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
    hasShownMessagesRef.current = false;

    const loadConvo = async () => {
      isLoadingConvoRef.current = true;
      loadingForCharacterIdRef.current = characterId; // stamp which character this load is for
      setIsLoadingConvo(true);
      const t0 = Date.now();
      console.log(`[CHAT_LOAD] loadConvo START charId=${characterId} chatType=${chatType} t=${t0}`);

      // PART 3 FIX: Proactively activate chat-safe mode on every chat load.
      // Background simulations, presence checks, and scheduled tasks fire on a shared
      // rate-limit budget. A chat open is always user-facing priority — activate safe
      // mode for 20s to throttle background work and ensure the chat load gets through.
      // The 20s window is short enough that background tasks resume promptly after load.
      activateChatSafeMode(20000);

      // Helper: check if a 429 error
      const is429 = (err) =>
        err?.message?.includes('429') ||
        err?.message?.includes('Rate limit') ||
        err?.message?.includes('rate limit');

      // Helper: retry once after 8s on 429.
      // On first 429 detection: immediately activate chat-safe mode (45s) to pause
      // nonessential background work before the retry attempt.
      const retryAfter8s = async (fn, label = '') => {
        try {
          return await fn();
        } catch (err) {
          if (is429(err)) {
            console.warn(`[CHAT_LOAD] 429${label ? ' (' + label + ')' : ''} — activating chat-safe mode + retrying in 8s t=${Date.now()}`);
            activateChatSafeMode(45000); // pause background work immediately
            await new Promise(r => setTimeout(r, 8000));
            return await fn(); // throws if still failing
          }
          throw err;
        }
      };

      try {
        // ── STEP 1: Find the conversation for this character ─────────────────
        console.log(`[CHAT_LOAD] Conversation.filter START t=${Date.now()}`);
        // Scope query to this specific character + type — avoids fetching all 200 conversations
        // on every character open. Server filters, not client-side.
        let convos;
        try {
          convos = await retryAfter8s(() =>
            base44.entities.Conversation.filter(
              { owner_email: currentUser.email, type: chatType, character_ids: characterId },
              "-last_message_date",
              20
            )
          , 'Conversation.filter');
          console.log(`[CHAT_LOAD] Conversation.filter DONE count=${convos.length} t=${Date.now()}`);
        } catch (err) {
          // If Conversation.filter fully fails (both attempts) and we have NO messages yet,
          // show the rate-limit screen. If we somehow have cached state, preserve it.
          if (is429(err)) {
            console.error(`[CHAT_LOAD] Conversation.filter EXHAUSTED after retry t=${Date.now()}`);
            if (!hasShownMessagesRef.current) {
              setConvoLoadError('rate_limited');
            } else {
              console.warn(`[CHAT_LOAD] 429 on Conversation.filter but messages already shown — suppressing screen`);
              setConvoLoadError('rate_limited_soft');
            }
            return;
          }
          throw err;
        }

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
          console.log(`[CHAT_LOAD] Message.filter START convoId=${convoId} window=${MSG_WINDOW} t=${Date.now()}`);
          let loadedMsgs;
          try {
            loadedMsgs = await retryAfter8s(() =>
              base44.entities.Message.filter(
                { conversation_id: convoId },
                "-created_date",
                MSG_WINDOW
              )
            , 'Message.filter');
            console.log(`[CHAT_LOAD] Message.filter DONE count=${loadedMsgs?.length ?? 0} t=${Date.now()}`);
          } catch (err) {
            if (is429(err)) {
              // Message.filter exhausted — we know the convoId so set it and show a soft warning.
              // Do NOT wipe the screen. The user can still send messages once recovered.
              console.error(`[CHAT_LOAD] Message.filter EXHAUSTED after retry — showing soft warning t=${Date.now()}`);
              convoIdRef.current = convoId;
              setConversationId(convoId);
              setConvoLoadError('rate_limited_soft');
              return; // skip to finally — no full-page block
            }
            throw err;
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
            hasShownMessagesRef.current = true;
            // Clear any lingering soft error once messages load successfully
            setConvoLoadError(null);

            const unread = loadedMsgs.filter(m => m.sender_type === "character" && !m.is_read);
            if (unread.length > 0) {
              unread.forEach(m => {
                base44.entities.Message.update(m.id, { is_read: true }).catch(err => console.warn('[LoadConvo] inline is_read update failed for msg', m.id, err?.message));
              });
              queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
            }
          } else {
            if (setHasOlderMessages) setHasOlderMessages(false);
            oldestMsgTimestampRef.current = null;
            setConversationId(convoId);
            setConvoLoadError(null);
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
          setConvoLoadError(null);
          console.log(`[CHAT_LOAD] Conversation CREATED id=${convoId} t=${Date.now()}`);
        }

        // ── STEP 3: Deliver any pending messages queued during offline/away ──
        // PendingMessage failure is non-fatal — silently skip if 429 exhausted.
        console.log(`[CHAT_LOAD] PendingMessage.filter START t=${Date.now()}`);
        let pending = [];
        try {
          // PendingMessage is non-essential on load — skip retry entirely on 429.
          // Attempting a retry here just burns more quota that Conversation/Message need.
          pending = await base44.entities.PendingMessage.filter(
            { character_id: characterId, delivered: false }
          );
          console.log(`[CHAT_LOAD] PendingMessage.filter DONE count=${pending?.length ?? 0} t=${Date.now()}`);
        } catch (err) {
          // Non-fatal: pending message delivery skipped on 429 — will retry next load
          console.warn(`[CHAT_LOAD] PendingMessage.filter failed (non-fatal) — skipping pending delivery error="${err?.message}" t=${Date.now()}`);
          pending = [];
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
        const rateLimited = is429(err);
        console.error(`[CHAT_LOAD] loadConvo FAILED isRateLimit=${rateLimited} error="${err?.message}" t=${Date.now()}`);
        // Only show full-page error screen if NO messages have been shown yet.
        // If messages are already visible, preserve them and show a soft non-blocking warning.
        if (rateLimited) {
          if (hasShownMessagesRef.current) {
            console.warn(`[CHAT_LOAD] 429 outer catch but messages already shown — suppressing full-page screen`);
            setConvoLoadError('rate_limited_soft');
          } else {
            setConvoLoadError('rate_limited');
          }
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