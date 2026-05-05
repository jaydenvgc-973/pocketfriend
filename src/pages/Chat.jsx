import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import ChatHeader from "@/components/chat/ChatHeader";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import TypingIndicator from "@/components/chat/TypingIndicator";
import MediaGallery from "@/components/chat/MediaGallery";
import ArchiveNotice from "@/components/chat/ArchiveNotice";
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { resolveCharacterOutfit, buildOutfitNarrativeHint } from "@/lib/resolveOutfitContext";
import { getCharacterLivePresence, buildLiveLocationContext } from "@/lib/locationResolutionEngine";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";

import SendMoneyModal from "@/components/chat/SendMoneyModal";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import DialogueSelector from "@/components/chat/DialogueSelector";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";
import TroubleshootingPanel from "@/components/chat/TroubleshootingPanel";
import DeleteMemoryChoiceModal from "@/components/chat/DeleteMemoryChoiceModal";
import ForwardMessageModal from "@/components/chat/ForwardMessageModal";
import GameLauncher from "@/components/games/GameLauncher";
import ShoppingApp from "@/components/chat/ShoppingApp";
import { dispatchImageGeneration } from "@/components/chat/ChatImageDispatch";
import ChatApprovals from "@/components/chat/ChatApprovals";
import { callLLMWithRetry } from "@/lib/llmUtils";
import { buildEducationContext, buildSongsContext, buildDynamicContexts, buildImageRule, validateLocationInResponse } from "@/lib/promptContextBuilders";
import NarrativeActionButton from "@/components/chat/NarrativeActionButton";
import PendingLifeEventApproval from "@/components/approvals/PendingLifeEventApproval";
import { useApprovalEvents } from "@/hooks/useApprovalEvents";
import { useNarrativeCorrection } from "@/hooks/useNarrativeCorrection";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useVoicePlayback } from "@/hooks/useVoicePlayback";
import {
  getCharacterStatus,
  getChatDelayMs,
  getTextDelayMs,
  getTextSystemMessage,
  buildStatusPromptContext,
  buildSleepInterruptionContext,
} from "@/lib/responseTimingUtils";
import { filterDashes } from "@/lib/dashFilter";
import { stripCharacterNamePrefix } from "@/lib/nameFilterUtils";
import { useUnifiedBehaviour } from "@/lib/useUnifiedBehaviour";
import { buildNeedsContextBlock } from "@/lib/needsStateEngine";
import { buildTemporalState, buildTemporalContextBlock } from "@/lib/temporalStateEngine";
import { buildEmploymentPromptBlock } from "@/lib/employmentResolver.js";
import LocationAliasResolutionPopup from "@/components/location/LocationAliasResolutionPopup";
import { parseCharacterResponse } from "@/lib/chatResponseParser";
import NewPersonDetectedModal from "@/components/chat/NewPersonDetectedModal";
import ChatMessageList from "@/components/chat/ChatMessageList";
import { useChatScroll } from "@/hooks/useChatScroll";
import { useChatLoadConvo } from "@/hooks/useChatLoadConvo";
import { useChatDeleteActions } from "@/hooks/useChatDeleteActions";
import { useChatReactionActions } from "@/hooks/useChatReactionActions";
import { useChatLocationSignal } from "@/hooks/useChatLocationSignal";
import { useChatSongShare } from "@/hooks/useChatSongShare";
import { useChatPostLoadEffects } from "@/hooks/useChatPostLoadEffects";
import { useChatScrollTracking } from "@/hooks/useChatScrollTracking";
import { useChatLocationShare } from "@/hooks/useChatLocationShare";

export default function Chat() {
  const { characterId } = useParams();
  const [searchParams] = useSearchParams();
  const chatType = searchParams.get("type") || "direct";
  const isPhone = chatType === "phone";

  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [userScrolledAway, setUserScrolledAway] = useState(false);
  const [lastChangeReason, setLastChangeReason] = useState(null);
  const [previousLevels, setPreviousLevels] = useState(null);
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [showNarrativeBuilder, setShowNarrativeBuilder] = useState(false);
  const [showWorldContacts, setShowWorldContacts] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [forwardTarget, setForwardTarget] = useState(null);
  const [newPeopleDetected, setNewPeopleDetected] = useState(null);
  const [showSendMoney, setShowSendMoney] = useState(false);
  const [isSendingMoney, setIsSendingMoney] = useState(false);
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showGameLauncher, setShowGameLauncher] = useState(false);
  const [showNarrativeAction, setShowNarrativeAction] = useState(false);
  const [showShopping, setShowShopping] = useState(false);
  const [pendingAliasResolution, setPendingAliasResolution] = useState(null);
  const [catchupNarrativeText, setCatchupNarrativeText] = useState(null);
  const [isLoadingConvo, setIsLoadingConvo] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Reset conversation state immediately when switching characters.
  // This prevents Character A's messages showing while Character B loads.
  // Do NOT set isLoadingConvo(true) here — the hook owns that flag.
  // Setting it here causes an endless spinner if character query returns null.
  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    setConvoLoadError(null);
    setUserScrolledAway(false); // Reset scroll position tracking on character switch
    setCatchupNarrativeText(null); // Don't carry over catchup from previous character
  }, [characterId]);

  const { isRegeneratingNarrative, handleNonsenseNarrative, handleSleepViolationNarrative } = useNarrativeCorrection({
    characterId, conversationId, messages, setMessages,
  });

  const bottomRef = useRef(null);
  const { activeCharacter } = useActiveCharacter();
  const { pendingApproval, checkForApprovalEvents, approveEvent, dismissApproval } = useApprovalEvents();
  const queryClient = useQueryClient();
  const conversationIdRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const isMountedRef = useRef(true);
  const catchupTimerRef = useRef(null);
  // Session cache for system_prompt_url content — prevents re-fetching on every message send.
  // Keyed as "characterId::url" so prompt leakage between characters is impossible.
  const systemPromptCacheRef = useRef({});
  const [convoLoadError, setConvoLoadError] = useState(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ["user"],
    queryFn: async () => {
      console.log(`[CHAT_LOAD] auth.me START t=${Date.now()}`);
      try {
        const u = await base44.auth.me();
        console.log(`[CHAT_LOAD] auth.me DONE email=${u?.email} t=${Date.now()}`);
        return u;
      } catch (err) {
        console.error(`[CHAT_LOAD] auth.me ERROR ${err?.message} t=${Date.now()}`);
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  const { data: character } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      if (!characterId || !currentUser?.email) return null;
      const cachedAll = queryClient.getQueryData(["characters", currentUser.email]);
      if (Array.isArray(cachedAll)) {
        const found = cachedAll.find(c => c.id === characterId);
        if (found) {
          console.log(`[CHAT_LOAD] Character CACHE_HIT name=${found.name} t=${Date.now()}`);
          return found;
        }
      }
      console.log(`[CHAT_LOAD] Character.filter START charId=${characterId} t=${Date.now()}`);
      try {
        // Query by id only — RLS enforces ownership scope server-side.
        // Do NOT filter by owner_email here: many characters (Ethan, Matt Lopez, etc.)
        // were created before owner_email was a required field and have it null/missing.
        // Filtering by owner_email causes Character.filter to return 0 results for these
        // characters, falling through to fetchNPCsForUser on EVERY chat open (+1.5-2s).
        const chars = await base44.entities.Character.filter({ id: characterId });
        if (chars.length > 0) {
          console.log(`[CHAT_LOAD] Character.filter DONE name=${chars[0].name} t=${Date.now()}`);
          return chars[0];
        }
        console.log(`[CHAT_LOAD] Character.filter EMPTY — trying fetchNPCsForUser fallback id=${characterId} t=${Date.now()}`);
      } catch (err) {
        console.error(`[CHAT_LOAD] Character.filter ERROR ${err?.message} — trying fetchNPCsForUser fallback t=${Date.now()}`);
      }
      // Fallback: character may be an NPC or legacy record not returned by id filter.
      // fetchNPCsForUser returns all NPCs for the current user scoped by owner_email.
      // NOTE: fetchNPCsForUser returns { npcs: [...] } — NOT { characters: [...] }
      try {
        const npcRes = await base44.functions.invoke('fetchNPCsForUser', {});
        const npcs = npcRes?.data?.npcs || [];
        const found = npcs.find(c => c.id === characterId);
        if (found) {
          console.log(`[CHAT_LOAD] Character FOUND via fetchNPCsForUser fallback name=${found.name} type=${found.character_type} t=${Date.now()}`);
          return found;
        }
        console.log(`[CHAT_LOAD] Character NOT FOUND in fetchNPCsForUser fallback id=${characterId} t=${Date.now()}`);
      } catch (fallbackErr) {
        console.error(`[CHAT_LOAD] fetchNPCsForUser fallback ERROR ${fallbackErr?.message} t=${Date.now()}`);
      }
      return null;
    },
    enabled: !!characterId && !isUserLoading && !!currentUser?.email && !!currentUser,
    staleTime: 5 * 60 * 1000,      // 5 min — character data is stable during a chat session
    refetchOnWindowFocus: false,   // Prevents re-fetch storm when user switches tabs/apps
  });

  const behaviour = useUnifiedBehaviour(character, { isPhone, conversationId });
  const { settings: userSettings } = useUserSettings();
  const { playingAudioId, voiceErrors, playCharacterVoice } = useVoicePlayback(chatType);
  const { data: characterFinancial = null } = useQuery({
    queryKey: ["characterFinancial", characterId],
    queryFn: async () => {
      const records = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
      return records[0] || null;
    },
    enabled: !!characterId && showSendMoney,
  });

  useEffect(() => {
    // Guard: only run once per session — prevents 429 storms on repeated Chat mounts
    const voiceInitKey = 'voice_settings_initialized';
    if (sessionStorage.getItem(voiceInitKey)) return;
    sessionStorage.setItem(voiceInitKey, '1');
    base44.functions.invoke('initializeVoiceSettings', {}).catch(() => {});
  }, []);

  const { isLoadingConvoRef, loadOlderMessages } = useChatLoadConvo({
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
    retryKey,
  });

  useEffect(() => {
    if (!conversationId || !characterId) return;

    if (unsubscribeRef.current) unsubscribeRef.current();

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id !== conversationId) return;

      if (event.type === "create") {
        setMessages(prev => {
          if (prev.some(m => m.id === event.data.id)) return prev;
          return [...prev, event.data];
        });
        
        if (event.data.sender_type === "character" && !event.data.is_read) {
          base44.entities.Message.update(event.data.id, { is_read: true }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
        }
      } else if (event.type === "update") {
        setMessages(prev => prev.map(m => m.id === event.data.id ? { ...m, ...event.data } : m));
      } else if (event.type === "delete") {
        setMessages(prev => prev.filter(m => m.id !== event.data.id));
      }
    });
    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [conversationId, characterId]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useChatPostLoadEffects({
    conversationId,
    characterId,
    messages,
    queryClient,
    catchupTimerRef,
    isMountedRef,
    setCatchupNarrativeText,
  });

  useChatScroll(
    messages.length > 0 ? messages[messages.length - 1].id : null,
    characterId,
    userScrolledAway,
    bottomRef,
    messages.length
  );

  useChatScrollTracking(setUserScrolledAway);

  const [sendError, setSendError] = useState(null);

  const { handleDeleteMessage, handleDeleteRemember, handleDeleteForget, handleDeleteImage } = useChatDeleteActions({
    messages, setMessages, deleteTarget, setDeleteTarget, conversationId, characterId, isPhone,
  });

  const { handleReact } = useChatReactionActions({
    messages, setMessages, conversationId, characterId, character, queryClient, setLastChangeReason,
  });

  const { handleLocationSignal } = useChatLocationSignal({
    characterId, character, queryClient, setPendingAliasResolution,
  });

  const { handleShareSong } = useChatSongShare({
    characterId, character, conversationIdRef, queryClient, setSendError,
  });

  const { tryHandleLocationShare } = useChatLocationShare({
    character, characterId, chatType, currentUser, conversationIdRef, conversationId,
    setConversationId, activeCharacter, setMessages, setIsTyping, setSendError,
    isMountedRef, queryClient,
  });

  const sendMessage = async (text, userImageUrl) => {
    if (!character) return;
    setSendError(null);

    if (text.trim().toLowerCase().startsWith("fix:")) {
      const directive = text.trim().slice(4).trim();
      console.info("[Fix: directive]", directive);
      return;
    }

    // ── LOCATION SHARE DETECTION ───────────────────────────────────────────
    const locationShareResult = await tryHandleLocationShare(text);
    if (locationShareResult.handled) return;

    const musicLinkMatch = text.match(/https?:\/\/[^\s]*(spotify\.com|apple\.com\/.*music|music\.apple\.com|music\.youtube\.com|amazon\.com\/music|music\.amazon|tidal\.com|soundcloud\.com|bandcamp\.com)[^\s]*/i);
    if (musicLinkMatch) {
      await handleShareSong(musicLinkMatch[0], false);
      return;
    }

    const videoLinkMatch = text.match(/https?:\/\/[^\s]*(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitch\.tv|dailymotion\.com)[^\s]*/i);
    if (videoLinkMatch) {
      await handleShareSong(videoLinkMatch[0], true);
      return;
    }

    const lookupMatch = text.match(/(?:look up|search|find out|what.*about|can you.*find|research)[\s:]*(.*?)(?:\?|$)/i);

      // ── QR CODE DETECTION (when user uploads an image) ────────────────────
      let qrContext = "";
      if (userImageUrl) {
        try {
          const qrResult = await base44.integrations.Core.InvokeLLM({
            prompt: `Examine this image carefully. Does it contain a QR code?
    If YES: decode the QR code and return ONLY the decoded content (URL or text) — nothing else, no explanation.
    If NO QR code is present: return exactly the word "NO_QR".
    If a QR code is present but cannot be decoded: return exactly the word "QR_UNREADABLE".`,
            file_urls: [userImageUrl],
          });
          const qrRaw = (typeof qrResult === 'string' ? qrResult : '').trim();

          if (qrRaw && qrRaw !== 'NO_QR') {
            if (qrRaw === 'QR_UNREADABLE') {
              qrContext = `\n\nQR CODE DETECTED — CANNOT DECODE:
    The user uploaded an image containing a QR code, but it could not be read clearly.
    You MUST tell the user you can see the QR code but could not decode it. Do NOT guess what it contains.`;
            } else if (/^https?:\/\//i.test(qrRaw)) {
              // QR contains a URL — run it through the same link lookup flow
              try {
                const res = await base44.functions.invoke('performWebLookup', { characterId, searchQuery: qrRaw, sourceUrl: qrRaw });
                const data = res?.data;
                const content = (data?.title || data?.summary)
                  ? `Title: ${data.title || 'Unknown'}\nContent: ${data.summary || data.description || 'No content retrieved'}`
                  : '(Content could not be retrieved)';
                qrContext = `\n\nQR CODE DECODED — LINK:
    The user's uploaded image contained a QR code that decoded to this URL: ${qrRaw}
    ${content}
    STRICT RULES: Respond ONLY to the actual content above. If content was retrieved, reference specific details. If not retrieved, tell the user explicitly you cannot access the linked content. Do NOT fabricate or guess.`;
              } catch {
                qrContext = `\n\nQR CODE DECODED — LINK (unresolved):
    The user's image contained a QR code that decoded to: ${qrRaw}
    The linked content could not be retrieved. You MUST tell the user you can see the link from the QR code but cannot access its content.`;
              }
            } else {
              // QR contains plain text
              qrContext = `\n\nQR CODE DECODED — TEXT CONTENT:
    The user's uploaded image contained a QR code with the following exact text:
    "${qrRaw}"
    Respond to this exact decoded content. Do NOT fabricate or expand on it beyond what is provided.`;
            }
          }
        } catch {
          // QR scan failed silently — do not block message flow
        }
      }

      // ── LINK-AWARE CONTEXT EXTRACTION ─────────────────────────────────────
    // Detect any general URLs (non-music, non-video already handled above)
    const generalLinkMatch = text.match(/https?:\/\/[^\s]+/gi);
    let linkContext = "";
    if (generalLinkMatch && generalLinkMatch.length > 0) {
      const detectedLinks = generalLinkMatch.filter(url =>
        !/(spotify\.com|apple\.com\/.*music|music\.apple\.com|music\.youtube\.com|amazon\.com\/music|tidal\.com|soundcloud\.com|bandcamp\.com)/i.test(url) &&
        !/(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitch\.tv|dailymotion\.com)/i.test(url)
      );
      if (detectedLinks.length > 0) {
        const linkResults = await Promise.all(detectedLinks.slice(0, 3).map(async (url) => {
          try {
            const res = await base44.functions.invoke('performWebLookup', {
              characterId,
              searchQuery: url,
              sourceUrl: url,
            });
            const data = res?.data;
            if (data?.title || data?.summary) {
              return `URL: ${url}\nTitle: ${data.title || 'Unknown'}\nContent: ${data.summary || data.description || 'No content retrieved'}`;
            }
            return `URL: ${url}\n(Content could not be retrieved)`;
          } catch {
            return `URL: ${url}\n(Content could not be retrieved)`;
          }
        }));
        linkContext = `\n\n════════════════════════════════════
    LINK CONTENT — EXACT SOURCE REQUIRED
    ════════════════════════════════════
    The user shared the following link(s). You MUST respond ONLY based on the actual content provided below — NOT on general knowledge, artist reputation, title guesses, or assumptions.

    ${linkResults.join('\n\n---\n\n')}

    STRICT RULES:
    - If content was retrieved: reference SPECIFIC details from it (quotes, facts, topics mentioned)
    - If content shows "(Content could not be retrieved)": you MUST explicitly tell the user you can see the link but cannot access the actual content. You may mention the URL but must NOT fabricate or guess what it contains.
    - NEVER pretend to have watched, read, or listened to something you did not receive content for above.
    - NEVER summarize based on the link title, domain, or your general training knowledge.
    ════════════════════════════════════`;
      }
    }

    let convoId = conversationIdRef.current || conversationId;
    if (!convoId) {
      const convo = await base44.entities.Conversation.create({
        title: `${chatType} with ${character.name}`,
        type: chatType,
        character_ids: [characterId],
        owner_email: currentUser.email,
      });
      convoId = convo.id;
      setConversationId(convoId);
    }

    const userMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "user",
      content: text,
      image_url: userImageUrl || undefined,
      timestamp: new Date().toISOString(),
      ...(activeCharacter ? {
        played_as_character_id: activeCharacter?.id,
        played_as_character_name: activeCharacter?.name,
      } : {}),
    });
    if (!userMsg || !userMsg.id) {
      setSendError("Message failed to save. Try again.");
      return;
    }
    setMessages(prev => prev.some(m => m.id === userMsg.id) ? prev : [...prev, userMsg]);

    base44.functions.invoke('processUserIncome', { mode: 'message' }).catch(() => {});

    if (isPhone) {
      const sysMsg = getTextSystemMessage(character);
      if (sysMsg) {
        const persistedSysMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: sysMsg,
          is_narrative: true,
          is_read: true,
          timestamp: new Date().toISOString(),
        });
        setMessages(prev => prev.some(m => m.id === persistedSysMsg.id) ? prev : [...prev, persistedSysMsg]);
        console.log(`[SYSTEM-MSG] Text mode status message persisted: "${sysMsg}" | id=${persistedSysMsg.id}`);
      }

      if (getCharacterStatus(character) === 'asleep') {
        console.log(`[TIMING] TEXT blocked — character is asleep. Scheduling wake-up reply.`);
        
        const wakeTime = character.wake_up_time || '07:00';
        const now = new Date();
        const [wakeHour, wakeMin] = wakeTime.split(':').map(Number);
        const wakeDate = new Date(now);
        wakeDate.setHours(wakeHour, wakeMin, 0, 0);
        if (wakeDate <= now) wakeDate.setDate(wakeDate.getDate() + 1);

        base44.entities.CharacterAutonomyEvent.create({
          character_id: characterId,
          event_type: 'follow_up_message',
          trigger_source: 'time_based',
          scheduled_for: wakeDate.toISOString(),
          status: 'pending',
          event_payload: {
            trigger_reason: 'user_message_while_asleep',
            conversation_id: convoId,
            original_user_message: text,
            wake_reply_style: 'just_woke_up',
            user_message_id: userMsg.id,
          },
        }).then(ev => {
          console.log(`[WAKE-REPLY] Scheduled wake-up reply event id=${ev.id} for ${wakeDate.toISOString()}`);
        }).catch(err => {
          console.error('[WAKE-REPLY] Failed to schedule wake-up event:', err.message);
        });

        return;
      }
    }

    if (isMountedRef.current) setIsTyping(true);

    // callLLMWithRetry is imported from lib/llmUtils.js

    let recentMsgs, response, responseText, emotionalState, imagePrompts = [], msgType = "text_only";
    let responseObj = { message_type: "text_only", text_content: "", image_generation_prompts: [] };
    let charLocationName = character.resolved_current_location_name || null;
    let charLocationId = character.resolved_current_location_id || null;
    try {
      if (!isMountedRef.current) {
        console.warn('[sendMessage] Component unmounted, aborting message send');
        return;
      }

      recentMsgs = [...messages.slice(-50), userMsg];
      const chatHistory = recentMsgs.map(m => ({
        role: m.sender_type === "user" ? "user" : "assistant",
        content: m.content,
        _speakerName: m.sender_type === "user" ? (activeCharacter?.name || "User") : character.name,
      }));

      const toneFromBehaviour = behaviour?.tone || 'neutral';
      const lengthInstruction = { short: "Keep responses to 1-2 sentences max.", medium: "Keep responses natural length, 1-4 sentences.", long: "You can elaborate more, up to a paragraph." }[userSettings.response_length || "medium"];
      const toneContext = toneFromBehaviour !== 'neutral' ? `\n\nTONE FILTER: Based on your current state (${toneFromBehaviour}), adjust your response tone accordingly. If tired, be brief. If stressed, be clipped. If warm, be open.` : '';
      const intensityInstruction = { low: "React with mild emotional responses.", medium: "React naturally with moderate emotional responses.", high: "React with strong, intense emotional responses." }[userSettings.emotional_intensity || "medium"];

      const lastThreadMsg = recentMsgs.length > 0 ? recentMsgs[recentMsgs.length - 2] : null;
      const lastThreadTimestamp = lastThreadMsg?.timestamp || lastThreadMsg?.created_date || null;
      const temporalState = buildTemporalState(character, lastThreadTimestamp);
      const timeContext = buildTemporalContextBlock(temporalState) +
        `\n\nYou are aware of the current time (${temporalState.currentTime}). If plans or commitments are mentioned at specific times, treat them as real.`;

      const educationContext = buildEducationContext(character);
      const songsContext = buildSongsContext(character);
      const { weatherContext, recentEventsContext, culturalContext } = await buildDynamicContexts(text, character, recentMsgs);

      const frequentedPlaces = character.frequented_places || [];
      if (frequentedPlaces.length > 0) {
        const fullText = (text + " " + (recentMsgs.slice(-3).map(m => m.content).join(" "))).toLowerCase();
        const mentionedPlace = frequentedPlaces.find(p => fullText.includes(p.toLowerCase()));
        if (mentionedPlace) {
          setTimeout(() => {
            base44.integrations.Core.InvokeLLM({
              prompt: `A character named ${character.name} (personality: ${character.personality_summary || "unknown"}) is currently at or talking about "${mentionedPlace}", one of their frequented places. Based on their personality and the context, what emotional state best fits them right now? Choose ONE from this list: calm, irritated, defensive, reflective, closed-off, flirtatious, bored, burnt out, joyful, anxious, sad, excited, overwhelmed, content, frustrated. Return ONLY the single word.`,
            }).then(async (newState) => {
              const cleaned = newState?.trim().toLowerCase().replace(/[^a-z\s-]/g, "");
              const validStates = ["calm","irritated","defensive","reflective","closed-off","flirtatious","bored","burnt out","joyful","anxious","sad","excited","overwhelmed","content","frustrated"];
              if (validStates.includes(cleaned)) {
                await base44.entities.Character.update(characterId, { emotional_state: cleaned });
                queryClient.invalidateQueries({ queryKey: ["character", characterId] });
              }
            }).catch(() => {});
          }, 0);
        }
      }

      if (lookupMatch && lookupMatch[1]) {
        const query = lookupMatch[1].trim();
        base44.functions.invoke('performWebLookup', { characterId, searchQuery: query }).catch(() => {});
      }

      // Fetch locations for BOTH spatial awareness AND employment schedule resolution.
      // occupation_location_id triggers this fetch so worker_shifts are available.
      // Without locations, buildEmploymentPromptBlock cannot read worker_shifts and
      // the LLM falls back to training knowledge (9am-5pm default).
      const needsLocationFetch = !!(character.occupation_location_id || character.current_activity ||
        character.additional_occupation_locations?.length > 0);
      let allLocationsForContext = [];

      const [memoryResult, progressionResult, pastLookupsResult, spatialResult] = await Promise.all([
        base44.functions.invoke('retrieveActiveMemory', {
          characterId,
          currentMessage: text,
          recentMessages: recentMsgs.slice(-6),
          topK: 14,
        }).catch(async () => {
          const mems = await base44.entities.Memory.filter({ character_id: characterId }, "-timestamp", 12).catch(() => []);
          return { data: { memories: mems, total: mems.length, _fallback: true } };
        }),
        base44.functions.invoke('buildProgressionFilteredContext', { characterId, currentMessage: text }).catch(() => null),
        base44.entities.WebLookup.filter({ character_id: characterId }, "-lookup_date", 10).catch(() => []),
        needsLocationFetch
          ? base44.functions.invoke('fetchAllLocationsForUser', {}).then(async (allLocRes) => {
              const allLocs = allLocRes?.data?.locations || [];
              allLocationsForContext = allLocs; // capture for employment block below
              const allActiveChars = await base44.entities.Character.filter({ owner_email: currentUser.email, status: 'active' });
              const { buildSpatialOccupancyMap, buildSpatialContextString } = await import('@/lib/spatialAwareness.js');
              const occupancyMap = buildSpatialOccupancyMap(allActiveChars, allLocs);
              return buildSpatialContextString(characterId, occupancyMap, allLocs) || null;
            }).catch(() => null)
          : Promise.resolve(null),
      ]);

      let memoryContext = "";
      const memData = memoryResult?.data;
      if (memData?._fallback) {
        const mems = memData.memories || [];
        if (mems.length > 0) {
          memoryContext = `\n\nLONG-TERM MEMORY BANK (things that happened that you remember — reference naturally when relevant):\n${mems.map(m => `- ${m.title}: ${m.description}`).join("\n")}`;
        }
      } else {
        const activeMemories = memData?.memories || [];
        if (activeMemories.length > 0) {
          const totalStored = memData?.total || activeMemories.length;
          memoryContext = `\n\nLONG-TERM MEMORY BANK (${activeMemories.length} most relevant from ${totalStored} total stored memories — reference naturally when relevant, don't force it):\n${activeMemories.map(m => `- ${m.title}: ${m.description}`).join("\n")}`;
        }
      }

      let lifeEventContext = "";
      const progressionData = progressionResult?.data;
      if (progressionData?.progressionContext) {
        lifeEventContext = `\n\n${progressionData.progressionContext}`;
      }

      let researchContext = "";
      const pastLookups = Array.isArray(pastLookupsResult) ? pastLookupsResult : [];
      if (pastLookups.length > 0) {
        const researchInfo = pastLookups.map(l => `"${l.search_query}" - Found: "${l.title}" by ${l.author_source}. Key info: ${l.summary}`).join("\n");
        researchContext = `\n\nTHINGS YOU'VE LOOKED UP:\n${researchInfo}`;
      }

      let spatialContext = "";
      if (spatialResult) {
        spatialContext = `\n\nSPATIAL AWARENESS: ${spatialResult} If the conversation naturally touches on being somewhere or running into someone, you can acknowledge this shared presence.`;
      }

      const userDisplayName = userSettings.fictional_world_name || null;
      const outfitHint = buildOutfitNarrativeHint(resolveCharacterOutfit(character, {}), character);
      let systemPrompt = "";
      if (character.system_prompt_url) {
        // Use session cache to avoid re-fetching on every message send.
        // Key includes both characterId and url to prevent cross-character prompt leakage.
        const cacheKey = `${characterId}::${character.system_prompt_url}`;
        if (systemPromptCacheRef.current[cacheKey]) {
          systemPrompt = systemPromptCacheRef.current[cacheKey];
        } else {
          try {
            const promptResponse = await fetch(character.system_prompt_url);
            systemPrompt = await promptResponse.text();
            systemPromptCacheRef.current[cacheKey] = systemPrompt;
          } catch (err) {
            systemPrompt = buildSystemPrompt(character, [], userDisplayName, { allowNarration: false, outfitHint }, memData?.memories || []);
          }
        }
      } else {
        systemPrompt = buildSystemPrompt(character, [], userDisplayName, { allowNarration: false, outfitHint }, memData?.memories || []);
      }
      const userNameForPrompts = userDisplayName || null;
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

      const charStatus = getCharacterStatus(character);
      const statusContext = !isPhone ? buildStatusPromptContext(character, isPhone, recentMsgs.slice(-10)) : "";
      const sleepContext = charStatus === 'asleep' ? buildSleepInterruptionContext(character) : "";

      const livePresence = getCharacterLivePresence(character, {});
      const awarenessContext = buildLiveLocationContext(character, {});

      const needsContext = buildNeedsContextBlock(character);

      const catchupContext = catchupNarrativeText
        ? `\n\nTIMELINE CATCH-UP — WHAT HAPPENED WHILE THE USER WAS AWAY:\n${catchupNarrativeText}\nThis is real. You lived through it. Reference it naturally when appropriate. Do NOT pretend the last message was just seconds ago.`
        : "";

      const _presenceForValidation = livePresence;

      let playAsInstruction = "";
      if (activeCharacter) {
        const senderRelEntry = (character.fictional_relationships || []).find(
          r => r.related_character_id === activeCharacter.id
        );
        const senderMemories = await base44.entities.Memory.filter({ character_id: characterId }, "-timestamp", 50);
        const relevantMemories = senderMemories
          .filter(m => m.description?.toLowerCase().includes(activeCharacter.name.toLowerCase()))
          .slice(0, 5);

        const relContext = senderRelEntry
           ? `Your relationship with ${activeCharacter.name}: ${senderRelEntry.relationship_type || "known person"} — Respect: ${senderRelEntry.user_respect_level ?? 50}/100, Friendship: ${senderRelEntry.friendship_level ?? 75}/100, Romantic: ${senderRelEntry.romantic_level ?? 0}/100. Current status: ${senderRelEntry.current_status || "ongoing"}. ${senderRelEntry.last_interaction_summary ? `Last time you interacted: ${senderRelEntry.last_interaction_summary}` : ""} ${senderRelEntry.description ? `Background: ${senderRelEntry.description}` : ""}`
           : `You know ${activeCharacter.name} from your world.`;

        const memoryContext2 = relevantMemories.length > 0
           ? `\nMemories involving ${activeCharacter.name}:\n${relevantMemories.map(m => `- ${m.title}: ${m.description}`).join("\n")}`
           : "";

        playAsInstruction = `\n\n🔴 CRITICAL — WHO IS SPEAKING: The message is DEFINITELY NOT from the app user. It is FROM another character: ${activeCharacter.name} (${activeCharacter.personality_summary || activeCharacter.archetype || "someone you know"}).

        ${relContext}${memoryContext2}

        Your response must: 1. Treat ${activeCharacter.name} as a REAL CHARACTER in your life, not as "the user" 2. Recognize them immediately — you know who they are 3. Have a conversation with THEM, not about them 4. NEVER explain "I thought you were someone else" or act confused about their identity. This is character-to-character interaction.`;
      }

      const totalMsgsInConvo = messages.length;
      const mediaSentInConvo = messages.filter(m => m.sender_type === "character" && m.image_url).length;
      const isPhotogenic = !!character.is_photogenic;

      const userTextLower = text.toLowerCase();
      const explicitImageRequest = /\b(send|show|give|share|post).{0,20}(pic|photo|picture|image|selfie|shot)\b|\b(pic|photo|picture|selfie|image)\b.{0,10}(of you|of me|please|now|quick|real quick)\b/i.test(text);
      const quantityMatch = text.match(/\b(\d+)\s+(pic|photo|picture|image|selfie|shot)s?\b/i);
      const requestedQuantity = quantityMatch ? parseInt(quantityMatch[1]) : (explicitImageRequest ? 1 : 0);

      const mediaRatioLimit = isPhotogenic ? (2 / 10) : (3 / 20);
      const currentRatio = totalMsgsInConvo > 0 ? mediaSentInConvo / totalMsgsInConvo : 0;
      const atMediaLimit = currentRatio >= mediaRatioLimit && !explicitImageRequest;

      const recentCharMsgs = messages.filter(m => m.sender_type === "character").slice(-5);
      const lastMediaIdx = recentCharMsgs.map(m => !!m.image_url).lastIndexOf(true);
      const msgsSinceLastMedia = lastMediaIdx === -1 ? 999 : (recentCharMsgs.length - 1 - lastMediaIdx);
      const cooldownMsgs = isPhotogenic ? 2 : 5;
      const inCooldown = msgsSinceLastMedia < cooldownMsgs && !(explicitImageRequest || isPhotogenic);

      const baseImageChance = isPhotogenic ? 0.25 : 0.08;
      const passedRandomCheck = Math.random() < baseImageChance;

      const allowImageThisTurn = explicitImageRequest || (!atMediaLimit && !inCooldown && passedRandomCheck);

      const imageCountInstruction = requestedQuantity > 1
        ? `The user asked for ${requestedQuantity} images. Provide exactly ${requestedQuantity} entries in "image_generation_prompts" array.`
        : "";

      // Extract last image prompt from recent messages for anti-repetition context
      const lastImageMsg = [...messages].reverse().find(m => m.sender_type === "character" && m.image_url && m.generation_context?.prompt);
      const lastImagePromptSnippet = lastImageMsg?.generation_context?.prompt
        ? lastImageMsg.generation_context.prompt.substring(0, 200)
        : null;

      const imageRule = buildImageRule({
        allowImageThisTurn,
        isPhotogenic,
        explicitImageRequest,
        requestedQuantity,
        userNameForPrompts,
        lastImagePromptSnippet,
      });

      const conversationLog = chatHistory.map(m => `${m._speakerName}: ${m.content}`).join("\n");

      const evidenceInstruction = `\n\nEVIDENCE PRIORITY & CONTEXT RULES:
${userImageUrl ? `• NEW EVIDENCE (this image) is the PRIMARY source of truth for this turn.\n• New evidence OVERRIDES vague or prior assumptions. Treat it as an intentional correction.` : `• Focus on the CURRENT user request as the primary goal.`}
• CONTEXT LAYERS:
  - Past conversation: Background only. Do NOT repeat or dwell unless directly relevant.
  - Long-term memory: Use only if it directly supports understanding the CURRENT task.
  - User's current request: This IS the task goal. Stay focused on it.
  - Newly provided evidence: This REDEFINES or REFINES the task. Shift focus here.
• If the user corrects, narrows, re-explains, or provides a screenshot → that is the NEW task definition.
• DO NOT blend old context with new evidence. Treat new evidence as an update that supersedes prior ambiguity.
• If previous information proved incorrect → DO NOT repeat it. Accept the new evidence as the correction.
• Only include information that DIRECTLY solves the current task. Do NOT inject unrelated memory or topics.
• DO NOT drift into past topics, stored memories, or general summaries unless directly relevant to THIS request.`;

      // Pass the locations fetched above (same fetch, no duplicate call).
      // allLocationsForContext is populated when needsLocationFetch is true (character has a job).
      // This gives buildEmploymentPromptBlock access to worker_shifts — the authoritative
      // schedule source. Empty array only if character has no job at all.
      const employmentPresenceSeparation = buildEmploymentPromptBlock(character, allLocationsForContext);

      // Build location share context for the prompt
      const locationShareInstruction = charLocationName ? `\n\nLOCATION SHARING: If the user asks where you are, or if you want to share your location naturally in conversation, you may set "share_location": true in your JSON response. Your current verified location is: "${charLocationName}". Only share when genuinely relevant. You may also include a short optional "location_share_note" field (max 1 sentence) to add a personal note about why you're there or what you're doing. Only set share_location:true when you have a real verified location — never fabricate one.` : "";

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${memoryContext}${lifeEventContext}${researchContext}${weatherContext}${recentEventsContext}${culturalContext}${timeContext}${needsContext}${catchupContext}${linkContext}${qrContext}${locationShareInstruction}${modeInstruction}${statusContext}${sleepContext}${awarenessContext}${employmentPresenceSeparation}${spatialContext}${playAsInstruction}${evidenceInstruction}${toneContext}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${conversationLog}\n\nWrite your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n- CULTURAL AWARENESS: When the user references celebrities, TV shows, music, entertainment, or cultural topics, you recognize them as real and familiar. You respond naturally without confusion or over-explanation.\n\nRespond ONLY with valid JSON in this exact format:\n{\n  "message_type": "text_only" | "image_only" | "text_then_image" | "image_then_text",\n  "text_content": "The visible character dialogue — ONLY include if message_type includes text. Never put image prompts here.",\n  "image_generation_prompt": "INTERNAL ONLY — vivid image description for generation. Never shown to user. Only include if message_type includes image.",\n  "image_generation_prompts": ["For multiple images only — array of internal image prompts"],\n  "share_location": true,
  "location_share_note": "Optional one-sentence note about why you're sharing or what you're doing there",\n  "scheduled_events": [\n    {\n      "description": "What will happen",\n      "trigger_time": "<ISO 8601 UTC datetime>"\n    }\n  ]\n}\nOnly include scheduled_events if a specific real-world action with a concrete time is committed to. Only include share_location:true when genuinely sharing location. Omit fields you don't use.\n\n${imageRule}`;


      const responseLagEnabled = userSettings.response_lag_enabled !== false;

      if (responseLagEnabled) {
        if (isPhone) {
          const textDelayMs = getTextDelayMs(character);

          if (textDelayMs === null) {
            console.log(`[TIMING] TEXT blocked — character is asleep. No response sent.`);
            setIsTyping(false);
            return;
          }

          console.log(`[TIMING] TEXT delay: ${Math.round(textDelayMs / 1000)}s | status=${getCharacterStatus(character)}`);
          await new Promise(r => setTimeout(r, textDelayMs));
        } else {
          const chatDelayMs = getChatDelayMs(character);
          console.log(`[TIMING] CHAT delay: ${Math.round(chatDelayMs / 1000)}s`);
          await new Promise(r => setTimeout(r, chatDelayMs));
        }
      }

      // validateLocationInResponse is imported from lib/promptContextBuilders.js

      try {
        response = await callLLMWithRetry(fullPrompt);
        responseObj = parseCharacterResponse(response);
      } catch (llmErr) {
        console.error('[sendMessage] LLM error:', llmErr.message);
        if (llmErr?.message?.includes('Network') || llmErr?.message?.includes('timeout') || llmErr?.message?.includes('429')) {
          responseObj = {
            message_type: "text_only",
            text_content: `[Connection issue — I'll respond when the connection is back]`,
            image_generation_prompts: []
          };
        } else {
          throw llmErr;
        }
      }

      msgType = responseObj.message_type || "text_only";
      if (isPhotogenic && explicitImageRequest && msgType === "text_only") {
        msgType = "text_then_image";
      }
      const hasText = ["text_only", "text_then_image", "image_then_text"].includes(msgType);
      const hasImage = allowImageThisTurn && ["image_only", "text_then_image", "image_then_text"].includes(msgType);

      responseText = hasText ? (responseObj.text_content?.trim() || "") : "";
      if (responseText.startsWith("{") || responseText.startsWith("```") || responseText.startsWith("[IMAGE]") || responseText.startsWith("[CHARACTER]") || responseText.startsWith("[USER]") || responseText.startsWith("[JOINT]")) {
        responseText = "";
      }
      if (responseText) {
        const charFirstName = character.name.split(' ')[0];
        const narrationLinePattern = new RegExp(
          `^(?:${charFirstName}|He|She|They|His|Her|Their)\\s+(?:pulls|settles|leans|moves|looks|reaches|sits|stands|shifts|sighs|turns|walks|steps|grabs|holds|wraps|places|rests|draws|closes|opens|breathes|exhales|inhales|drops|lifts|slides|presses|curls|stretches|rolls|nods|shakes|smiles|frowns|watches|stares|gazes|feels|senses|notices|realizes|allows|lets|keeps|stays|remains|becomes|seems|appears)`,
          'i'
        );
        const lines = responseText.split('\n');
        const cleanLines = lines.filter(line => {
          const trimmed = line.trim();
          if (!trimmed) return true;
          if (narrationLinePattern.test(trimmed)) {
            console.warn(`[NARRATION_BLEED] Stripped prose line from message: "${trimmed.substring(0, 80)}..."`);
            return false;
          }
          return true;
        });
        responseText = cleanLines.join('\n').trim();
        if (!responseText && hasText) responseText = '...';
      }

      if (responseText) {
        responseText = validateLocationInResponse(responseText, _presenceForValidation);
      }

      responseText = filterDashes(responseText);
      responseText = stripCharacterNamePrefix(responseText, character.name);

      if (hasImage && responseObj.image_generation_prompts?.length === 0 && isPhotogenic && explicitImageRequest) {
        imagePrompts = [`[CHARACTER] Candid selfie, ${character.name} looking natural and confident, ready for the camera, good lighting, genuine expression`];
      } else {
        imagePrompts = hasImage
          ? (responseObj.image_generation_prompts?.length > 0 ? responseObj.image_generation_prompts : [])
          : [];
      }

      console.log(`[MSG-TYPE] message_type="${msgType}" | hasText=${hasText} | hasImage=${hasImage} | imagePrompts=${imagePrompts.length} | textLength=${responseText.length}`);

      if (responseObj.scheduled_events?.length > 0 && convoId) {
        for (const ev of responseObj.scheduled_events) {
          if (!ev.trigger_time || !ev.description) continue;
          base44.entities.ScheduledEvent.create({
            character_ids: [characterId],
            character_names: [character.name],
            description: ev.description,
            trigger_time: ev.trigger_time,
            status: "pending",
            type: "narrative",
            source: "chat",
            conversation_id: convoId,
            primary_character_id: characterId
          }).catch(() => {});
        }
      }

      let typingDelayMs = 0;
      const typingSpeedEnabled = userSettings.typing_speed_enabled !== false;
      if (typingSpeedEnabled) {
        const wpm = userSettings.words_per_minute || 41;
        const wordCount = responseText.split(/\s+/).filter(w => w.length > 0).length;
        typingDelayMs = Math.min((wordCount / wpm) * 60000, 6000);
      }

      await new Promise(r => setTimeout(r, typingDelayMs));
      emotionalState = character.emotional_state || "calm";

      if (catchupNarrativeText) {
        setCatchupNarrativeText(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setIsTyping(false);
        setSendError("Couldn't get a response. Try again.");
      }
      return;
    }

    if (isMountedRef.current) setIsTyping(false);

    // --- STRICT MESSAGE SEPARATION ---
    // Resolve subject type for image generation (used across all image messages)
    const msgLower = text.toLowerCase();
    const worldNameLower = userSettings?.fictional_world_name?.toLowerCase() || '';
    const worldNameInPrompt = worldNameLower && msgLower.includes(worldNameLower);

    const isJointRequest = /\b(us|together|both|with (you and me|me and you|each other)|the two of us|selfie with (me|you))\b/i.test(msgLower);
    const isUserRequest = !isJointRequest && (
      worldNameInPrompt || // CRITICAL: user's world name in prompt = user avatar reference
      /\b(pic|photo|picture|image|selfie|shot)\s*(of me|of myself)\b/i.test(msgLower) ||
      /\b(send|show|give|share)\s*(me\s*)?(a\s*)?(pic|photo|picture|selfie)\s*(of me|of myself)\b/i.test(msgLower) ||
      /\bpicture of me\b|\bphoto of me\b|\bpic of me\b/i.test(msgLower)
    );
    const subjectType = isJointRequest ? "joint" : isUserRequest ? "user" : "character";

    if (worldNameInPrompt) {
      console.log(`[SUBJECT-TYPE] World name "${worldNameLower}" detected in prompt → subjectType=user`);
    }

    const userRefImages = [
      ...(currentUser.generated_avatar_urls || []),
      ...(userSettings.generated_avatar_urls || []),
      ...(currentUser.reference_image_urls || []),
      ...(userSettings.reference_image_urls || []),
    ].filter((v, i, a) => v && a.indexOf(v) === i);
    const useUserRefs = (subjectType === "joint" || subjectType === "user") && userRefImages.length > 0;
    const charRefs = (character.reference_image_urls || []).filter(Boolean);

    const createImageMessage = async (imageGenPrompt, delayMs = 500) => {
      const navigatedAway = !isMountedRef.current;
      let imgMsg;
      try {
        imgMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: "character",
          character_id: characterId,
          character_name: character.name,
          content: "",
          emotional_state: emotionalState,
          is_read: navigatedAway ? false : true,
          timestamp: new Date().toISOString(),
          generation_context: {
            prompt: imageGenPrompt,
            character_id: characterId,
            character_reference_images: charRefs,
          },
        });
      } catch (err) {
        console.error('[createImageMessage] Network error saving image message:', err.message);
        return null;
      }
      if (!imgMsg?.id) return null;
      if (!navigatedAway) {
        setMessages(prev => prev.some(m => m.id === imgMsg.id) ? prev : [...prev, imgMsg]);
      }
      const targetMsgId = imgMsg.id;
      console.log(`[Chat] Image msg created: ${targetMsgId} | char=${character.name} | subject=${subjectType} | prompt="${imageGenPrompt.substring(0, 80)}"`);
      setTimeout(() => dispatchImageGeneration({
        targetMsgId, imageGenPrompt, charRefs, userRefImages, useUserRefs,
        character, userSettings, currentUser, subjectType, characterId,
        isMountedRef, setMessages, convoId, queryClient,
      }), delayMs);
      return imgMsg;
    };

    const createTextMessage = async (textContent) => {
      if (!textContent?.trim()) return null;
      const navigatedAway = !isMountedRef.current;
      let txtMsg;
      try {
        txtMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: "character",
          character_id: characterId,
          character_name: character.name,
          content: textContent,
          emotional_state: emotionalState,
          is_read: navigatedAway ? false : true,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[createTextMessage] Network error saving message:', err.message);
        return null;
      }
      if (!txtMsg?.id) return null;
      if (!navigatedAway) {
        setMessages(prev => prev.some(m => m.id === txtMsg.id) ? prev : [...prev, txtMsg]);
        setTimeout(() => {
          playCharacterVoice(txtMsg.id, textContent, character, userSettings, false);
        }, 500);
      } else {
        base44.entities.Conversation.update(convoId, {
          last_message_preview: textContent.substring(0, 100),
          last_message_date: new Date().toISOString(),
        }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
      }
      return txtMsg;
    };

    // ── LOCATION SHARE: if character opted to share their location, create a location card message
    const shouldShareLocation = responseObj.share_location === true && charLocationName && charLocationId;

    let primaryTextMsg = null;

    if (msgType === "text_only") {
      primaryTextMsg = await createTextMessage(responseText || "Sorry, something went wrong.");
      if (!primaryTextMsg) { setSendError("Character response failed to save. Try again."); return; }

    } else if (msgType === "image_only") {
      if (imagePrompts.length > 0) {
        await createImageMessage(imagePrompts[0], 300);
        for (let i = 1; i < imagePrompts.length; i++) {
          await createImageMessage(imagePrompts[i], 300 + i * 800);
        }
      } else {
        primaryTextMsg = await createTextMessage(responseText || "Sorry, something went wrong.");
      }

    } else if (msgType === "text_then_image") {
      primaryTextMsg = await createTextMessage(responseText || "");
      if (imagePrompts.length > 0) {
        await createImageMessage(imagePrompts[0], 800);
        for (let i = 1; i < imagePrompts.length; i++) {
          await createImageMessage(imagePrompts[i], 800 + i * 800);
        }
      }
      if (!primaryTextMsg && imagePrompts.length === 0) { setSendError("Character response failed to save. Try again."); return; }

    } else if (msgType === "image_then_text") {
      if (imagePrompts.length > 0) {
        await createImageMessage(imagePrompts[0], 300);
        for (let i = 1; i < imagePrompts.length; i++) {
          await createImageMessage(imagePrompts[i], 300 + i * 800);
        }
      }
      await new Promise(r => setTimeout(r, 600));
      primaryTextMsg = await createTextMessage(responseText || "");
      if (!primaryTextMsg && imagePrompts.length === 0) { setSendError("Character response failed to save. Try again."); return; }

    } else {
      primaryTextMsg = await createTextMessage(responseText || "Sorry, something went wrong.");
    }

    // Create location share card if flagged
    if (shouldShareLocation) {
      // Fetch the location record to get category info
      base44.entities.LocationReference.filter({ id: charLocationId })
        .then(locs => {
          const loc = locs?.[0];
          base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: "character",
            character_id: characterId,
            character_name: character.name,
            content: "",
            emotional_state: emotionalState,
            is_read: true,
            timestamp: new Date().toISOString(),
            location_share: {
              location_id: charLocationId,
              location_name: charLocationName,
              presence_status: character.resolved_presence_status || character.location_status || null,
              location_category: loc?.category || null,
              character_avatar_url: character.avatar_url || null,
              note: responseObj.location_share_note || null,
              timestamp: new Date().toISOString(),
            },
          }).catch(() => {});
        })
        .catch(() => {
          // Fallback without category
          base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: "character",
            character_id: characterId,
            character_name: character.name,
            content: "",
            emotional_state: emotionalState,
            is_read: true,
            timestamp: new Date().toISOString(),
            location_share: {
              location_id: charLocationId,
              location_name: charLocationName,
              presence_status: character.resolved_presence_status || null,
              character_avatar_url: character.avatar_url || null,
              note: responseObj.location_share_note || null,
              timestamp: new Date().toISOString(),
            },
          }).catch(() => {});
        });
    }

    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    }
    
    if (Math.random() > 0.5) {
      setTimeout(async () => {
        const isImage = !!userImageUrl;
        const messageDesc = isImage
          ? `The user sent an image${text ? ` with caption: "${text}"` : ""}.`
          : `The user said: "${text}"`;

        const emojiRes = await base44.integrations.Core.InvokeLLM({
          prompt: `You are ${character.name}. ${character.personality_summary ? `Your personality: ${character.personality_summary}.` : ""} Your relationship with the user: friendship level ${character.friendship_level ?? 75}/100, romantic level ${character.romantic_level ?? 0}/100.

${messageDesc}

Based on how this message makes YOU feel — its emotional impact on you — choose ONE emoji reaction from this list, or respond with "none" if no strong reaction fits:
- ❤️ (love, care, appreciation, warmth — "this means something to me / I love this")
- 👍 (acknowledgment, approval, agreement — "got it / looks good / that works")
- 😢 (sadness, empathy, being touched — "this is sad / I feel for you")
- 😡 (anger, frustration, disapproval — "this upset me / this is wrong")
- 😲 (shock, surprise, being impressed — "I didn't expect this / that's wild")

Consider:
- Is this a positive message that makes you feel warmth or love? → ❤️
- Is it neutral information or approval-seeking? → 👍
- Is it sad or touching? → 😢
- Is it upsetting or wrong? → 😡
- Is it shocking or unexpected? → 😲
- Does it not warrant any strong reaction? → none

Reply with ONLY the single emoji or the word "none".`,
        });

        const picked = emojiRes?.trim();
        const validEmojis = ["❤️", "👍", "😢", "😡", "😲"];
        if (picked && validEmojis.includes(picked)) {
          // Guard: message may have been deleted while the LLM was running
          setMessages(prev => {
            const stillExists = prev.some(m => m.id === userMsg.id);
            if (!stillExists) return prev;
            const nonCharReactions = (userMsg.reactions || []).filter(r => r.reactor_type !== "character");
            const updatedUserMsgReactions = [...nonCharReactions, { emoji: picked, reactor_type: "character", reactor_id: characterId }];
            base44.entities.Message.update(userMsg.id, { reactions: updatedUserMsgReactions }).catch(() => {});
            return prev.map(m => m.id === userMsg.id ? { ...m, reactions: updatedUserMsgReactions } : m);
          });
        }
      }, 2000 + Math.random() * 3000);
    }

    const prevLevels = {
      user_respect_level: character.user_respect_level ?? 50,
      friendship_level: character.friendship_level ?? 75,
      romantic_level: character.romantic_level ?? 0,
      attraction_level: character.attraction_level ?? 0,
      chosen_family_level: character.chosen_family_level ?? 0,
    };
    setPreviousLevels(prevLevels);

    base44.functions.invoke("checkAchievements", {
      characterId,
      characterName: character.name,
      userMessage: text,
      characterState: {
        health_status: character.health_status,
        current_education_activity: character.current_education_activity,
        future_life_goals: character.future_life_goals,
        emotional_state: character.emotional_state,
        friendship_level: character.friendship_level,
        romantic_level: character.romantic_level,
        chosen_family_level: character.chosen_family_level,
      },
    }).catch(() => {});

    if (responseText) {
      // Use the cached characters list from React Query instead of a fresh full-account scan.
      // This avoids a Character.filter({ owner_email }) call on every single message sent.
      const cachedChars = queryClient.getQueryData(["characters", currentUser.email]);
      const allCharsForApproval = Array.isArray(cachedChars) ? cachedChars : [character];
      checkForApprovalEvents(responseText, character, allCharsForApproval, text);
    }

    base44.functions.invoke("classifyConversationEvent", {
      characterId,
      characterName: character.name,
      conversationId: convoId,
      userMessage: text,
      characterReply: responseText || "(image sent)",
      recentMessages: recentMsgs.slice(-8),
      characterState: {
        emotional_state: character.emotional_state,
        health_status: character.health_status,
        current_activity: character.current_activity,
        personality_summary: character.personality_summary,
        fictional_relationships: (character.fictional_relationships || []).map(r => ({ person_name: r.person_name, related_character_id: r.related_character_id, relationship_type: r.relationship_type })),
      },
    }).catch(() => {});

    if (responseText) {
      base44.functions.invoke("extractMemoriesFromTurn", {
        characterId,
        conversationId: convoId,
        userMessage: text,
        characterReply: responseText,
        playingAsCharacterId: activeCharacter?.id || null,
      }).then(res => {
        const detected = res?.data?.newPeopleDetected?.relationships;
        if (detected?.length > 0) setNewPeopleDetected(detected);
      }).catch(() => {});

      // If playing as an active character, also sync World Phone memory bi-directionally
      if (activeCharacter?.id && responseText) {
        base44.functions.invoke("syncWorldPhoneMemory", {
          senderCharacterId: activeCharacter.id,
          receiverCharacterId: characterId,
          messageContent: text,
          context: isPhone ? 'world_phone' : 'character_chat',
          conversationId: convoId,
        }).catch(() => {});
      }
    }

    base44.functions.invoke("updateCharacterActivityFromMessage", {
      characterId,
      messageContent: text,
    }).catch(() => {});

    if (responseText) {
      base44.functions.invoke("updateCharacterLocationFromMessage", {
        characterId,
        messageContent: responseText,
      }).then(res => {
        if (res?.data?.unresolved && res.data.phrase) {
          setPendingAliasResolution({
            phrase: res.data.phrase,
            sourceSentence: res.data.source_sentence || null,
            characterId: res.data.characterId || characterId,
            characterName: res.data.characterName || character?.name,
          });
        } else if (res?.data?.updated) {
          queryClient.invalidateQueries({ queryKey: ["character", characterId] });
        }
      }).catch(() => {});
    }

    base44.functions.invoke("updateRelationshipLevels", {
      characterId,
      userMessage: text,
      characterReply: responseText || "(image)",
      recentMessages: recentMsgs,
      playingAsCharacterId: activeCharacter?.id || null,
    }).then(async res => {
      if (res?.data?.reason) setLastChangeReason(res.data.reason);
      if (res?.data?.milestone_messages?.length > 0) {
        for (const milestone of res.data.milestone_messages) {
          await base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: "character",
            character_id: characterId,
            character_name: character.name,
            content: milestone.text,
            is_narrative: true,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }).catch(() => {});

    queryClient.invalidateQueries({ queryKey: ["character", characterId] });

    const previewText = responseText || "(image sent)";
    await base44.entities.Conversation.update(convoId, {
      last_message_preview: previewText.substring(0, 100),
      last_message_date: new Date().toISOString(),
      emotional_context: emotionalState,
    });
  };

  return (
    <div className={`h-screen flex flex-col bg-background pb-[60px] ${isPhone ? "max-w-lg mx-auto" : ""}`}>
      <ChatHeader
        character={character}
        characterId={characterId}
        isPhone={isPhone}
        conversationId={conversationId}
        setMessages={setMessages}
        messages={messages}
        userSettings={userSettings}
        onMediaGalleryToggle={() => setShowMediaGallery(true)}
        onGameLauncherToggle={() => setShowGameLauncher(true)}
        onNarrativeActionToggle={() => setShowNarrativeAction(true)}
        onWorldContactsToggle={() => setShowWorldContacts(true)}
        onNarrativeBuilderToggle={() => setShowNarrativeBuilder(true)}
        onSendMoneyToggle={() => setShowSendMoney(true)}
        onShoppingToggle={() => setShowShopping(true)}
        onTroubleshootingToggle={() => setShowTroubleshooting(true)}
      />
      {character && showMediaGallery && <MediaGallery messages={messages} onDeleteImage={handleDeleteImage} character={character} conversationId={conversationId} onImageGenerated={(newMsg) => setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])} externalTrigger={showMediaGallery} onExternalClose={() => setShowMediaGallery(false)} />}
      {character && conversationId && (
        <NarrativeActionButton
          character={character}
          conversationId={conversationId}
          recentMessages={messages}
          onNarrativeCreated={(msg) => setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])}
          externalTrigger={showNarrativeAction}
          onExternalClose={() => setShowNarrativeAction(false)}
        />
      )}
      {character && !isPhone && (
        <GameLauncher
          character={character}
          conversationId={conversationId}
          onGameEnd={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
          externalTrigger={showGameLauncher}
          onExternalClose={() => setShowGameLauncher(false)}
        />
      )}

      {showShopping && character && (
        <ShoppingApp
          conversationId={conversationId}
          characterId={characterId}
          character={character}
          onClose={() => setShowShopping(false)}
          currentUser={currentUser}
        />
      )}

      {showSendMoney && character && (
        <SendMoneyModal
          character={character}
          userBalance={userSettings.user_balance ?? 0}
          isSending={isSendingMoney}
          onClose={() => setShowSendMoney(false)}
          onSend={async (amount, reason, direction) => {
            setIsSendingMoney(true);
            try {
              await base44.functions.invoke('sendMoneyToCharacter', {
                characterId,
                conversationId,
                amount,
                reason,
                direction,
              });
              setShowSendMoney(false);
              queryClient.invalidateQueries({ queryKey: ['userSettings'] });
              queryClient.invalidateQueries({ queryKey: ['character', characterId] });
            } finally {
              setIsSendingMoney(false);
            }
          }}
          characterBalance={characterFinancial?.current_balance ?? 0}
        />
      )}
      {convoLoadError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-sm font-medium text-foreground">{convoLoadError === 'rate_limited' ? 'Chat is temporarily rate limited. Please try again shortly.' : 'Failed to load chat. Check connection and retry.'}</p>
          <button onClick={() => { setConvoLoadError(null); setRetryKey(k => k + 1); }} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">Retry</button>
        </div>
      ) : isLoadingConvo ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <ChatMessageList messages={messages} conversationId={conversationId} characterId={characterId} character={character} userSettings={userSettings} isTyping={isTyping} sendError={sendError} setSendError={setSendError} playingAudioId={playingAudioId} voiceErrors={voiceErrors} bottomRef={bottomRef} onReact={handleReact} onDelete={handleDeleteMessage} onDeleteImage={handleDeleteImage} onPlayVoice={playCharacterVoice} onForward={(msg) => setForwardTarget(msg)} onImageLoaded={(msgId, url) => setMessages(prev => prev.map(m => m.id === msgId ? { ...m, image_url: url } : m))} onLocationSignal={handleLocationSignal} hasOlderMessages={hasOlderMessages} onLoadOlderMessages={loadOlderMessages} />
      )}
      {activeCharacter && character ? (
        <DialogueSelector
          playingAs={activeCharacter}
          targetCharacter={character}
          recentMessages={messages}
          onSelect={(text) => sendMessage(text, null)}
        />
      ) : (
        <ChatInput onSend={sendMessage} draftKey={characterId} />
      )}
      <NarrativeBuilderPopup
        isOpen={showNarrativeBuilder}
        onClose={() => setShowNarrativeBuilder(false)}
        characterId={characterId}
        conversationId={conversationId}
        chatHistory={messages}
        onNarrativeSubmitted={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
      />
      <WorldContactsPopup
        isOpen={showWorldContacts}
        onClose={() => setShowWorldContacts(false)}
        character={character}
      />
      <TroubleshootingPanel
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
        conversationId={conversationId}
        characterId={characterId}
      />
      <DeleteMemoryChoiceModal
        message={deleteTarget}
        isOpen={!!deleteTarget}
        onRemember={handleDeleteRemember}
        onForget={handleDeleteForget}
        onCancel={() => setDeleteTarget(null)}
        onNonsense={() => { const t = deleteTarget; setDeleteTarget(null); handleNonsenseNarrative(t); }}
        onSleepViolation={() => { const t = deleteTarget; setDeleteTarget(null); handleSleepViolationNarrative(t); }}
        isRegenerating={isRegeneratingNarrative}
      />
      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          onClose={() => setForwardTarget(null)}
        />
      )}
      <BottomNav />

      <ChatApprovals
        pendingApproval={pendingApproval}
        approveEvent={approveEvent}
        dismissApproval={dismissApproval}
        character={character}
      />

      {character && <PendingLifeEventApproval characterId={characterId} character={character} />}
      {pendingAliasResolution && (
        <LocationAliasResolutionPopup
          phrase={pendingAliasResolution.phrase}
          sourceSentence={pendingAliasResolution.sourceSentence}
          characterId={pendingAliasResolution.characterId}
          characterName={pendingAliasResolution.characterName}
          onResolved={() => { setPendingAliasResolution(null); queryClient.invalidateQueries({ queryKey: ["character", characterId] }); }}
          onDismiss={() => setPendingAliasResolution(null)}
        />
      )}
      {newPeopleDetected && character && (
        <NewPersonDetectedModal
          people={newPeopleDetected}
          characterId={characterId}
          characterName={character.name}
          onDone={() => { setNewPeopleDetected(null); queryClient.invalidateQueries({ queryKey: ["character", characterId] }); }}
        />
      )}
    </div>
  );
}