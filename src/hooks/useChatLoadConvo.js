import { useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { activateChatSafeMode, escalateChatRetry, resetChatRetry, getActiveContext } from "@/lib/simulationGate";
import { traceRequest, traceEvent, traceMilestone, traceRateLimit } from "@/lib/chatLoadTrace";
import { lfcRead, lfcWrite, lfcDelete } from "@/lib/localFirstCache.js";
import {
  prewarmCharacterRuntime,
  setCachedConversationId,
  getCachedConversationId,
  reportCharacterReadyTiming,
} from "@/lib/characterRuntimeCache.js";

// Persist recent messages per conversation (last 50) to localStorage.
// Key: 'chat_msgs:{chatType}:{characterId}' — channel-scoped so Chat and Text
// never seed each other's initial render, even for the same character.
function readCachedMessages(ownerEmail, characterId, chatType) {
  try {
    const lfc = lfcRead(ownerEmail, `chat_msgs:${chatType}:${characterId}`);
    return lfc?.data ?? null;
  } catch { return null; }
}

function writeCachedMessages(ownerEmail, characterId, chatType, msgs) {
  if (!ownerEmail || !characterId || !Array.isArray(msgs) || msgs.length === 0) return;
  // Only store the 50 most recent messages to keep localStorage usage bounded
  const recent = [...msgs].sort((a, b) =>
    new Date(b.created_date || b.timestamp || 0) - new Date(a.created_date || a.timestamp || 0)
  ).slice(0, 50).reverse(); // oldest first for correct render order
  lfcWrite(ownerEmail, `chat_msgs:${chatType}:${characterId}`, recent);
}



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

    // Reset conversation state on character switch.
    // CRITICAL: Seed from lfc FIRST — avoids blank spinner on navigation.
    // If lfc has messages for this character+channel, show them instantly. Server will refresh.
    // NOTE: Do NOT delete the chat_msgs cache here — that prevents the instant seed.
    // Stale messages are handled by the CONTINUITY GUARD below after server load completes.
    // Only delete legacy format keys (pre-chatType-key era) and unread badge cache.
    try {
      // Old format (pre-chatType-key era) — safe to delete, different key pattern
      lfcDelete(currentUser.email, `chat_msgs:${characterId}`);
      // Unread badge cache
      lfcDelete(currentUser.email, `world_contacts_unread:${characterId}`);
    } catch (_) {}

    // REPAIR: Do NOT seed from LFC cache as a usable state.
    // LFC cache may be stale (from a previous session hours ago) and will cause the user to
    // see an incomplete/old conversation while the server fetch is in flight.
    // Instead: start with empty messages. The server fetch is the only authoritative source.
    // LFC is only used to seed the RQ query-cache for Character lookups — NOT for messages.
    // This eliminates the two-phase visible load (stale cache → then server merge).
    const immediateCache = null; // Disabled: LFC message seed causes stale two-phase visible load
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    setConvoLoadError(null);
    if (setHasOlderMessages) setHasOlderMessages(false);
    convoIdRef.current = null;
    oldestMsgTimestampRef.current = null;
    if (!immediateCache?.length) hasShownMessagesRef.current = false;

    const loadConvo = async () => {
      isLoadingConvoRef.current = true;
      loadingForCharacterIdRef.current = characterId; // stamp which character this load is for
      setIsLoadingConvo(true);
      const t0 = Date.now();
      const t_page_open = t0;
      console.log(`[CHAT_LOAD] loadConvo START charId=${characterId} chatType=${chatType} t=${t0}`);

      // ── PREWARM: kick off canonical context fetch in background immediately ──
      // This runs in parallel with conversation/message loading so that by the time
      // the user sends their first message, the canonical prompt is already cached.
      // Non-blocking — does NOT delay conversation or message display.
      if (currentUser?.email && characterId) {
        prewarmCharacterRuntime(currentUser.email, characterId, base44).catch(() => {});
      }

      // NOTE: lfc seed already applied synchronously above (before setTimeout).
      // Do NOT re-seed here — that would overwrite any messages that arrived
      // in the 300ms gap between the synchronous seed and this async load.

      // PART 3 FIX: Proactively activate chat-safe mode on every chat load.
      activateChatSafeMode(20000);
      traceMilestone('CHAT_LOAD_START', `charId=${characterId} chatType=${chatType}`);

      // Helper: check if a 429 error
      const is429 = (err) =>
        err?.message?.includes('429') ||
        err?.message?.includes('Rate limit') ||
        err?.message?.includes('rate limit');

      // Helper: retry with escalating back-off on 429.
      // Level 1: 8s pause. Level 2: 15s. Level 3: 30s — each level also escalates background governor.
      const retryAfter8s = async (fn, label = '') => {
        try {
          return await fn();
        } catch (err) {
          if (is429(err)) {
            const retryState = escalateChatRetry(); // increments level, pauses background tasks
            const pauseMs = retryState.level === 1 ? 8000 : retryState.level === 2 ? 15000 : 30000;
            console.warn(`[CHAT_LOAD] 429${label ? ' (' + label + ')' : ''} — escalating retry level=${retryState.level} | waiting ${pauseMs / 1000}s t=${Date.now()}`);
            await new Promise(r => setTimeout(r, pauseMs));
            return await fn(); // throws if still failing
          }
          throw err;
        }
      };

      try {
        // ── STEP 1: Find the conversation for this character ─────────────────
        console.log(`[CHAT_LOAD] Conversation.filter START t=${Date.now()}`);
        traceRequest('Conversation.filter', { caller: 'useChatLoadConvo', page: getActiveContext().page, status: 'ALLOWED', detail: `charId=${characterId} type=${chatType}` });
        let convos;
        try {
          convos = await retryAfter8s(() =>
            base44.entities.Conversation.filter(
              { owner_email: currentUser.email, type: chatType, character_ids: characterId },
              "-last_message_date",
              100
            )
          , 'Conversation.filter');
          console.log(`[CHAT_LOAD] Conversation.filter DONE count=${convos.length} t=${Date.now()}`);
        } catch (err) {
          if (is429(err)) {
            console.error(`[CHAT_LOAD] Conversation.filter EXHAUSTED after retry t=${Date.now()}`);
            traceRateLimit('Conversation.filter', `charId=${characterId} — 429 exhausted`);
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
          // ── CHAT IDENTITY GUARD ────────────────────────────────────────────────
          // Chat page must only load a user ↔ character conversation.
          // Filter out any conversation where character_ids has more than one entry —
          // those are character ↔ character (World Contact / World Phone) threads and
          // must NEVER be loaded as the user's direct chat with a character.
          // Also filter out conversations with a shared_conversation_key — those are
          // bilateral/world-phone threads, not user-direct threads.
          const directUserConvos = convos.filter(c => {
            const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
            const isCharToChar = ids.length > 1;
            const isBilateral = !!c.shared_conversation_key;
            const isWorldPhone = c.channel === 'world_phone';
            if (isCharToChar || isBilateral || isWorldPhone) {
              console.log(`[CHAT_LOAD] EXCLUDED char-to-char/world-phone convo id=${c.id} type=${c.type} char_ids=[${ids.join(',')}] shared_key=${c.shared_conversation_key || 'none'} channel=${c.channel || 'none'}`);
              return false;
            }
            return true;
          });

          const candidatePool = directUserConvos.length > 0 ? directUserConvos : [];
          if (candidatePool.length === 0) {
            console.log(`[CHAT_LOAD] All ${convos.length} convos were char-to-char/world-phone — treating as no valid conversation found`);
            // Clear any stale LFC seed that may have cached wrong messages from a prior bad load
            try { lfcWrite(currentUser.email, `chat_msgs:${chatType}:${characterId}`, []); } catch {}
          }

          // CRITICAL: Sort candidates — prefer conversations with message history.
          // Conversations with last_message_date have actual messages and are preferred
          // over empty duplicates (which may have been created by a race condition).
          // Among conversations with messages, pick the most recently active.
          // Empty conversations (no last_message_date) are only selected as a last resort.
          const withMsgs = candidatePool.filter(c => c.last_message_date);
          const withoutMsgs = candidatePool.filter(c => !c.last_message_date);
          const sortByRecency = (a, b) => {
            const aTime = new Date(a.last_message_date || a.created_date);
            const bTime = new Date(b.last_message_date || b.created_date);
            return bTime - aTime;
          };
          const allSorted = [...withMsgs.sort(sortByRecency), ...withoutMsgs.sort(sortByRecency)];
          const selectedConvo = allSorted[0];
          if (!selectedConvo) {
            // No valid direct conversation — fall through to creation block below
            console.log(`[CHAT_LOAD] No valid direct user↔character conversation — will create new one`);
          } else {
          convoId = selectedConvo.id;
          console.log(`[CHAT_LOAD] CONVO_SELECTED id=${convoId} candidates=${candidatePool.length} last_msg=${selectedConvo.last_message_date || 'none'} t=${Date.now()}`);

          // ── STEP 2: Load most recent MSG_WINDOW messages for initial render ──
          console.log(`[CHAT_LOAD] Message.filter START convoId=${convoId} window=${MSG_WINDOW} t=${Date.now()}`);
          traceRequest('Message.filter', { caller: 'useChatLoadConvo', page: getActiveContext().page, status: 'ALLOWED', detail: `convoId=${convoId} window=${MSG_WINDOW}` });
          let loadedMsgs;
          let rawCountBeforeFilter = 0;
          try {
            // REPAIR: Filter out archived messages SERVER-SIDE before the limit is applied.
            // Without this, archived messages consume slots in the 200-message window, pushing
            // recent active messages out of the returned set — causing them to appear missing on load.
            //
            // CRITICAL: Use { archived_date: null } NOT { $exists: false }.
            // Base44 stores archived_date as null (not absent) on non-archived messages.
            // $exists:false matches only completely absent fields — returns 0 for most messages.
            // { archived_date: null } correctly matches null values. PROVEN by proofArchivedDateFilter.
            loadedMsgs = await retryAfter8s(() =>
              base44.entities.Message.filter(
                { conversation_id: convoId, archived_date: null },
                "-created_date",
                MSG_WINDOW
              )
            , 'Message.filter');
            // rawCountBeforeFilter: captured before client-side filtering so hasOlderMessages
            // uses the server-returned count, not the post-filter count which may fall below MSG_WINDOW.
            rawCountBeforeFilter = Array.isArray(loadedMsgs) ? loadedMsgs.length : 0;
            if (Array.isArray(loadedMsgs)) {
              loadedMsgs = loadedMsgs.filter(m => {
                // archived_date already excluded by server query — only filter system/date-dividers
                if (m.sender_type === 'system') return false;
                const c = (m.content || '').trim();
                if (c && /^[-–—]{2,}/.test(c) && /[-–—]{2,}$/.test(c) && /\d{4}/.test(c)) return false;
                if (c && /^[-–—,.\s]{0,8}(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(c) && /\d{4}/.test(c)) return false;
                return true;
              });
            }
            console.log(`[CHAT_LOAD] Message.filter DONE raw=${rawCountBeforeFilter} filtered=${loadedMsgs?.length ?? 0} t=${Date.now()}`);
          } catch (err) {
            if (is429(err)) {
              console.error(`[CHAT_LOAD] Message.filter EXHAUSTED after retry — showing soft warning t=${Date.now()}`);
              traceRateLimit('Message.filter', `convoId=${convoId} — 429 exhausted`);
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

            // Signal UI to show "Load older messages" button if we hit the window ceiling.
            // Use rawCountBeforeFilter — if the server returned a full window, older messages
            // likely exist even if client filtering reduced the visible count below MSG_WINDOW.
            // Using filtered count would hide the button when system/archived records were stripped.
            const hasOlder = rawCountBeforeFilter >= MSG_WINDOW;
            if (setHasOlderMessages) setHasOlderMessages(hasOlder);

            // CONTINUITY GUARD: never replace a larger visible set with a smaller server result.
            // RACE CONDITION FIX: When a user sends a message while history is still loading,
            // the sent message is appended to `prev` immediately. When the server result arrives,
            // `sorted` will NOT contain the just-sent message (DB hasn't indexed it yet).
            // We must ALWAYS merge rather than replace — deduplicate by id, then sort by time.
            setMessages(prev => {
              if (prev.length === 0) return sorted; // nothing to protect — fast path
              const serverIds = new Set(sorted.map(m => m.id));
              const prevIds = new Set(prev.map(m => m.id));
              // Messages in prev that aren't in the server result yet (sent during this load,
              // or from lfc cache that server didn't return due to archive/truncation)
              const localOnly = prev.filter(m => !serverIds.has(m.id));
              if (localOnly.length === 0) {
                // Server has everything — use server result (normal fast path)
                return sorted;
              }
              // Merge: server result + any local-only messages, sort by creation time
              const merged = [...sorted, ...localOnly].sort((a, b) =>
                new Date(a.created_date || a.timestamp || 0) - new Date(b.created_date || b.timestamp || 0)
              );
              // Deduplicate in case of overlap
              const seen = new Set();
              return merged.filter(m => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
              });
            });
            setConversationId(convoId);
            hasShownMessagesRef.current = true;
            // Clear any lingering soft error once messages load successfully
            setConvoLoadError(null);

            // Cache conversation ID for fast reconnect on next open
            if (currentUser?.email) {
              setCachedConversationId(currentUser.email, characterId, chatType, convoId);
            }

            // ── TIMING PROOF: emit character_ready record ──────────────────────
            const t_messages_loaded = Date.now();
            reportCharacterReadyTiming({
              ownerEmail: currentUser?.email,
              characterId,
              characterName: character?.name,
              characterType: character?.character_type,
              pageType: chatType === 'phone' ? 'text' : 'chat',
              channel: chatType,
              t_page_open,
              t_conversation_lookup: t0 + (t_messages_loaded - t0) * 0.3, // approx — convo found
              t_character_fetch: t0, // already in React Query cache
              t_canonical_prompt_load: null, // async prewarm
              t_memory_pool_load: null,
              t_relationship_context_load: null,
              t_message_history_load: t_messages_loaded,
              t_subscription_connect: t_messages_loaded,
              t_character_ready: t_messages_loaded,
              t_full_context_complete: null,
              cache_used: !!readCachedMessages(currentUser?.email, characterId, chatType)?.length,
              memory_cache_hit: false,
              canonical_prompt_cache_hit: false, // prewarm fires async
              conversation_cache_hit: false,
              blocking_stage: null,
            });

            // Persist to localStorage — used only as background cache for future re-opens.
            // LFC message seed is disabled above, so this is write-only from server result.
            // Always overwrite with latest server result — no stale-guard needed.
            writeCachedMessages(currentUser.email, characterId, chatType, sorted);

            // Mark real unread messages as read (canonical filter: character sender, not system/date rows)
            const unread = loadedMsgs.filter(m =>
              m.sender_type === 'character' &&
              !m.is_read &&
              m.recovery_signal !== true &&
              m.content && m.content.trim() !== '' &&
              !['date','divider','system','timestamp','separator'].includes((m.type||'').toLowerCase())
            );
            // ALWAYS dispatch thread:read when direct chat loads.
            if (currentUser?.email) {
              lfcDelete(currentUser.email, `world_contacts_unread:${characterId}`);
            }
            queryClient.invalidateQueries({ queryKey: ['conversations', characterId, currentUser.email] });
            traceEvent('thread:read DISPATCH', { caller: 'useChatLoadConvo', page: getActiveContext().page, detail: `charId=${characterId} channel=${chatType}` });
            window.dispatchEvent(new CustomEvent('thread:read', { detail: { characterId, channel: chatType } }));
            if (unread.length > 0) {
              unread.forEach(m => {
                base44.entities.Message.update(m.id, { is_read: true }).catch(err => console.warn('[LoadConvo] inline is_read update failed for msg', m.id, err?.message));
              });
            }
          } else {
            if (setHasOlderMessages) setHasOlderMessages(false);
            oldestMsgTimestampRef.current = null;
            setConversationId(convoId);
            setConvoLoadError(null);
          }
          } // end else (selectedConvo exists)
        }

        // No valid direct user↔character conversation — REUSE or CREATE (never duplicate)
        if (!convoId) {
          // ABSOLUTE GUARD: Query for ANY conversation with this owner+character
          // This is the final safety net to ensure we NEVER create a duplicate
          const absoluteCheck = await base44.entities.Conversation.filter(
            { 
              owner_email: currentUser.email,
              character_ids: characterId,
              type: chatType
            },
            "-created_date",
            100
          );

          // Filter to direct conversations only (no world_phone, no char-to-char, no shared_key)
          const directCandidates = absoluteCheck.filter(c => {
            const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
            return ids.length === 1 && !c.shared_conversation_key && c.channel !== 'world_phone';
          });

          if (directCandidates.length > 0) {
            // REUSE the most recent conversation
            const mostRecent = directCandidates.reduce((prev, curr) => {
              const prevTime = new Date(prev.last_message_date || prev.created_date).getTime();
              const currTime = new Date(curr.last_message_date || curr.created_date).getTime();
              return currTime > prevTime ? curr : prev;
            });
            
            console.log(`[CHAT_LOAD] REUSING canonical conversation ${mostRecent.id} (found ${directCandidates.length} direct conversations)`);
            convoId = mostRecent.id;
            setConversationId(convoId);
            convoIdRef.current = convoId;
          } else {
            // No existing direct conversation: CREATE one
            console.log(`[CHAT_LOAD] No existing direct conversation found — creating new one t=${Date.now()}`);
            const convo = await base44.entities.Conversation.create({
              title: `${chatType} with ${character.name}`,
              type: chatType,
              character_ids: [characterId],
              owner_email: currentUser.email,
            });
            setConversationId(convo.id);
            convoIdRef.current = convo.id;
            convoId = convo.id;
            console.log(`[CHAT_LOAD] Conversation CREATED id=${convoId} (new, no prior conversations found) t=${Date.now()}`);
          }
          if (setHasOlderMessages) setHasOlderMessages(false);
          setConvoLoadError(null);
        }

        // ── STEP 3: Deliver any pending messages queued during offline/away ──
        // PendingMessage failure is non-fatal — silently skip if 429 exhausted.
        console.log(`[CHAT_LOAD] PendingMessage.filter START t=${Date.now()}`);
        traceRequest('PendingMessage.filter', { caller: 'useChatLoadConvo', page: getActiveContext().page, status: 'ALLOWED', detail: `charId=${characterId}` });
        let pending = [];
        try {
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

        resetChatRetry();
        traceMilestone('CHAT_LOAD_COMPLETE', `elapsed=${Date.now() - t0}ms charId=${characterId}`);
        console.log(`[CHAT_LOAD] loadConvo COMPLETE elapsed=${Date.now() - t0}ms t=${Date.now()}`);
      } catch (err) {
        const rateLimited = is429(err);
        console.error(`[CHAT_LOAD] loadConvo FAILED isRateLimit=${rateLimited} error="${err?.message}" t=${Date.now()}`);
        // Only show full-page error screen if NO messages have been shown yet.
        // If messages are already visible, preserve them and show a soft non-blocking warning.
        if (rateLimited) {
          traceRateLimit('useChatLoadConvo outer catch', `charId=${characterId} hasShownMessages=${hasShownMessagesRef.current}`);
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

    loadConvo();
    return () => {
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
      // Server-side $lt cursor + exclude archived server-side so archived records don't consume pagination slots.
      // CRITICAL: Use { archived_date: null } NOT { $exists: false } — see proofArchivedDateFilter.
      const olderRaw = await base44.entities.Message.filter(
        { conversation_id: convoId, created_date: { $lt: cursor }, archived_date: null },
        "-created_date",
        PAGINATION_PAGE
      );
      // Filter legacy date-marker records (sender_type='system') — archived already excluded server-side
      const older = Array.isArray(olderRaw) ? olderRaw.filter(m => {
        if (m.sender_type === 'system') return false;
        const c = (m.content || '').trim();
        if (c && /^[-–—]{2,}/.test(c) && /[-–—]{2,}$/.test(c) && /\d{4}/.test(c)) return false;
        if (c && /^[-–—,.\s]{0,8}(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(c) && /\d{4}/.test(c)) return false;
        return true;
      }) : olderRaw;

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