import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * useChatLoadConvo
 *
 * Extracted from pages/Chat lines 148–259.
 * Handles: Conversation.filter, Message.filter, PendingMessage.filter,
 * conversation creation, and pending message delivery.
 *
 * NO behavior changes. Same logic, same guards, same error handling.
 * Instrumentation logs added ONLY to the load chain steps — no logic changes.
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
  retryKey = 0,
}) {
  const queryClient = useQueryClient();
  const isLoadingConvoRef = useRef(false);

  useEffect(() => {
    // If we have characterId and a resolved user but character came back null,
    // the character query is done and found nothing — exit the spinner visibly.
    if (characterId && currentUser?.email && character === null) {
      setConvoLoadError('error');
      setIsLoadingConvo(false);
      return;
    }
    if (!characterId || !character || !currentUser || !currentUser.email) return;
    // Guard: do not load conversation for a stale character object from a previous navigation
    if (character.id !== characterId) return;
    if (isLoadingConvoRef.current) { isLoadingConvoRef.current = false; }
    isMountedRef.current = true;
    setMessages([]); setConversationId(null); setIsTyping(false); setConvoLoadError(null);

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

          // ── STEP 2: Message.filter ─────────────────────────────────────────
          const isProtected = ['69c0d59d7e382cc866ded9c9'].includes(characterId);
          const msgLimit = isProtected ? 1000 : 50;
          console.log(`[CHAT_LOAD] Message.filter START convoId=${convoId} limit=${msgLimit} t=${Date.now()}`);
          let loadedMsgs;
          try {
            loadedMsgs = await base44.entities.Message.filter(
              { conversation_id: convoId },
              "-created_date",
              msgLimit
            );
            console.log(`[CHAT_LOAD] Message.filter DONE count=${loadedMsgs?.length ?? 0} t=${Date.now()}`);
          } catch (err) {
            console.error(`[CHAT_LOAD] Message.filter ERROR ${err?.message} t=${Date.now()}`);
            throw err;
          }

          if (loadedMsgs && loadedMsgs.length > 0) {
            setMessages(loadedMsgs.reverse());
            setConversationId(convoId);

            const unread = loadedMsgs.filter(m => m.sender_type === "character" && !m.is_read);
            if (unread.length > 0) {
              unread.forEach(m => {
                base44.entities.Message.update(m.id, { is_read: true }).catch(() => {});
              });
              queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
            }
          } else {
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
          convoId = convo.id;
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
  }, [characterId, character?.id, chatType, currentUser?.email, retryKey]);

  return { isLoadingConvoRef };
}