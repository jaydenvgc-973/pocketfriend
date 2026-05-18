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
import FinancialActionsPanel from "@/components/chat/FinancialActionsPanel";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import DialogueSelector from "@/components/chat/DialogueSelector";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";
import TroubleshootingPanel from "@/components/chat/TroubleshootingPanel";
import DeleteMemoryChoiceModal from "@/components/chat/DeleteMemoryChoiceModal";
import ForwardMessageModal from "@/components/chat/ForwardMessageModal";
import GameLauncher from "@/components/games/GameLauncher";
import ShoppingApp from "@/components/chat/ShoppingApp";
import { dispatchImageGeneration } from "@/components/chat/ChatImageDispatch";
import { resolvePhotoSubject } from "@/lib/photoSubjectResolver";
import ChatApprovals from "@/components/chat/ChatApprovals";
import LogHousingChangeModal from "@/components/housing/LogHousingChangeModal";
import { callLLMWithRetry } from "@/lib/llmUtils";
import { buildEducationContext, buildSongsContext, buildDynamicContexts, buildImageRule, validateLocationInResponse, buildLinkContext, buildFinancialContext, buildCommitmentsContext, buildHouseholdCoPresenceContext } from "@/lib/promptContextBuilders";
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
import { getLocations } from "@/lib/locationSessionCache";
import NewPersonDetectedModal from "@/components/chat/NewPersonDetectedModal.jsx";
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
import { useChatBackgroundTasks } from "@/hooks/useChatBackgroundTasks.js";
import { usePageContext } from "@/hooks/usePageContext";
import { isGloballyRateLimited, reportRateLimit, activateChatSafeMode, isChatSafeModeActive } from "@/lib/simulationGate";
import { registerForegroundTask, FOREGROUND_TASKS, PRIORITY_LEVELS } from "@/lib/foregroundPriority";
import { lfcRead as lfcReadChat } from "@/lib/localFirstCache.js";
import { resolveCoPresence } from "@/lib/coPresenceResolver";
import LocationShareTool from "@/components/chat/LocationShareTool";
import { analyzeImageForCharacterContext } from "@/lib/analyzeImageForCharacterContext";
import { isCharacterConfined, canCharacterRespond, getConfinementNotice } from "@/lib/confinementMessagingEngine";
import { useChatTimingProof } from "@/hooks/useChatTimingProof";
import ChatTimingOverlay from "@/components/chat/ChatTimingOverlay";

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
  const [showHousingModal, setShowHousingModal] = useState(false);
  const [showLocationShare, setShowLocationShare] = useState(false);
  const [pendingAliasResolution, setPendingAliasResolution] = useState(null);
  const [catchupNarrativeText, setCatchupNarrativeText] = useState(null);
  const [isLoadingConvo, setIsLoadingConvo] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);

  // Reset conversation state immediately when switching characters.
  // This prevents Character A's messages showing while Character B loads.
  // Do NOT set isLoadingConvo(true) here — the hook owns that flag.
  // Setting it here causes an endless spinner if character query returns null.
  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    setConvoLoadError(null);
    setUserScrolledAway(false);
    setCatchupNarrativeText(null);
    // Clear canonical context cache — new character needs fresh canonical fetch
    // NOTE: location cache (locationSessionCache.js) is module-level and NOT cleared here —
    // location data is shared across characters and stable for the session.
    // (Only clear this character's entry, not others)
    if (characterId) {
      delete systemPromptCacheRef.current[`canonical::${characterId}`];
    }
  }, [characterId]);

  const { isRegeneratingNarrative, handleNonsenseNarrative, handleSleepViolationNarrative } = useNarrativeCorrection({
    characterId, conversationId, messages, setMessages,
  });

  const bottomRef = useRef(null);
  const { activeCharacter } = useActiveCharacter();
  const { pendingApproval, checkForApprovalEvents, approveEvent, dismissApproval, triggerHousingChangePopup } = useApprovalEvents();
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
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: character } = useQuery({
    queryKey: ["character", characterId],
    // Fast seed from localStorage — zero wait, no spinner flash
    initialData: () => {
      if (!characterId || !currentUser?.email) return undefined;
      // Check React Query cache first
      const rqCache = queryClient.getQueryData(["characters", currentUser.email]);
      if (Array.isArray(rqCache)) {
        const found = rqCache.find(c => c.id === characterId);
        if (found) return found;
      }
      // Check localStorage fallback
      const lfc = lfcReadChat(currentUser.email, 'characters');
      if (lfc?.data) {
        const found = lfc.data.find(c => c.id === characterId);
        if (found) return found;
      }
      return undefined;
    },
    initialDataUpdatedAt: () => {
      if (!currentUser?.email) return undefined;
      const lfc = lfcReadChat(currentUser.email, 'characters');
      return lfc?.loaded_at ?? undefined;
    },
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
          // Use EXACT same key as CharacterCard: [characterId, owner_email]
          queryClient.invalidateQueries({ queryKey: ['conversations', characterId, currentUser?.email] });
        }
      } else if (event.type === "update") {
        setMessages(prev => prev.map(m => {
          if (m.id !== event.data.id) return m;
          // CRITICAL: Never clobber an existing image_url with undefined/null from a partial
          // staging write. The backend does two writes per image generation:
          //   1. A non-final "staging" write (no image_url) for camera validation state
          //   2. The final accepted write (with image_url)
          // If write #1 arrives after write #2 (out of order), or if write #1 spreads
          // `image_url: undefined` onto a message that already has a valid URL, the image
          // disappears and never recovers without a manual retry.
          const incoming = { ...event.data };
          if (!incoming.image_url && m.image_url) {
            // Preserve the existing image_url — do not let a partial write erase it
            incoming.image_url = m.image_url;
          }
          return { ...m, ...incoming };
        }));
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
    ownerEmail: currentUser?.email,
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

  const { dispatchPostSend, clearCharacterCooldowns } = useChatBackgroundTasks({
    queryClient, setNewPeopleDetected, setPendingAliasResolution, setLastChangeReason, setMessages,
    onAchievementRevisited: (revisited) => {
      window.dispatchEvent(new CustomEvent('achievement:revisited', { detail: revisited }));
    },
  });

  // Register page context so simulationGate knows chat is active for this character
  usePageContext({ page: 'chat', characterId });

  // ── REAL FRONTEND TIMING PROOF ────────────────────────────────────────────
  // Measures actual UI milestones from route enter to character_connected and first send.
  // Add ?timing=1 to the URL to see the visual overlay.
  const { timingRecord, markSendStart } = useChatTimingProof({
    characterId,
    chatType,
    currentUser,
    character,
    conversationId,
    messages,
    isLoadingConvo,
    isTyping,
  });

  // Invalidate userSettings on character open so co-presence reads fresh location data.
  // THROTTLED: once per character per 5 min — prevents storm when user rapidly navigates.
  // UserSettings contains user_current_location_id which determines co-presence.
  useEffect(() => {
    if (!characterId || !currentUser?.email) return;
    // Use sessionStorage to debounce per-character — cheap check, no module imports needed
    const key = `settings_invalidated_for_${characterId}_${currentUser.email}`;
    const last = parseInt(sessionStorage.getItem(key) || '0', 10);
    if (Date.now() - last < 5 * 60 * 1000) return; // within 5 min — skip
    sessionStorage.setItem(key, String(Date.now()));
    queryClient.invalidateQueries({ queryKey: ['userSettings', currentUser.email] });
  }, [characterId, currentUser?.email]); // eslint-disable-line

  // Clear per-character cooldowns on character switch so stale state doesn't bleed
  useEffect(() => {
    if (characterId) clearCharacterCooldowns(characterId);
  }, [characterId]); // eslint-disable-line

  // Approval events from background hook — dispatched as CustomEvent to avoid circular deps
  useEffect(() => {
    const handler = (e) => {
      const { responseText: rt, character: ch, cachedChars, userText } = e.detail || {};
      if (!rt || !ch) return;
      const allCharsForApproval = Array.isArray(cachedChars) ? cachedChars : [ch];
      checkForApprovalEvents(rt, ch, allCharsForApproval, userText);
    };
    window.addEventListener('chat:checkApprovals', handler);
    return () => window.removeEventListener('chat:checkApprovals', handler);
  }, [checkForApprovalEvents]);

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

    // NOTE: video links are NO LONGER routed to handleShareSong.
    // They go through the analyzeSharedLink pipeline below so the character
    // actually understands the content rather than just showing a card.

    const lookupMatch = text.match(/(?:look up|search|find out|what.*about|can you.*find|research)[\s:]*(.*?)(?:\?|$)/i);

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

    // ── IMAGE + LINK ANALYSIS — started immediately, non-blocking ────────────
    // Both analyses are kicked off right after userMsg is created (we have the ID).
    // They run concurrently and are awaited later inside the LLM prep block,
    // by which time they will usually have resolved — but they NEVER block the
    // optimistic message insert or the setIsTyping(true) call below.
    const imageAnalysisPromise = userImageUrl
      ? analyzeImageForCharacterContext({ imageUrl: userImageUrl, messageId: userMsg.id, context: "user_uploaded" })
          .then(r => r.imageAnalysisContext || "")
          .catch(() => "")
      : Promise.resolve("");

    const isMusicLinkForAnalysis = /(spotify\.com|apple\.com\/.*music|music\.apple\.com|music\.youtube\.com|amazon\.com\/music|tidal\.com|soundcloud\.com|bandcamp\.com)/i.test(text);
    const linkAnalysisPromise = (!isMusicLinkForAnalysis && !isGloballyRateLimited())
      ? buildLinkContext(text, userMsg.id, conversationIdRef.current || conversationId, characterId)
          .catch(() => "")
      : Promise.resolve("");

    // processUserIncome is dispatched via useChatBackgroundTasks (Tier 4, 7s, with cooldown)

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

      // Confinement block for Text/Phone mode
      if (isCharacterConfined(character)) {
        const confinementCheck = canCharacterRespond(character);
        if (!confinementCheck.allowed) {
          const noticeMsg = await base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: 'character',
            character_id: characterId,
            character_name: character.name,
            content: getConfinementNotice(),
            is_narrative: false,
            is_read: true,
            timestamp: new Date().toISOString(),
          });
          if (noticeMsg?.id) {
            setMessages(prev => prev.some(m => m.id === noticeMsg.id) ? prev : [...prev, noticeMsg]);
          }
          if (isMountedRef.current) setIsTyping(false);
          return;
        }
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

    // ── CONFINEMENT MESSAGING LAYER ───────────────────────────────────────────
    // Confined characters (jailed/imprisoned/incarcerated/house arrest) can only
    // receive/respond between 9 AM and 9 PM. Outside those hours, show a notice
    // instead of getting a response.
    if (isCharacterConfined(character)) {
      const confinementCheck = canCharacterRespond(character);
      if (!confinementCheck.allowed) {
        const noticeMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: getConfinementNotice(),
          is_narrative: false,
          is_read: true,
          timestamp: new Date().toISOString(),
        });
        if (noticeMsg?.id) {
          setMessages(prev => prev.some(m => m.id === noticeMsg.id) ? prev : [...prev, noticeMsg]);
        }
        if (isMountedRef.current) setIsTyping(false);
        return;
      }
    }

    // ── SLEEP INTERRUPTION WRITE (direct/chat mode only) ──────────────────────
    // Write sleep_interrupted_at + sleep_debt to the Character record so that
    // buildTemporalState knows this character is in interaction_awake state on
    // subsequent message turns. This is the data that feeds the three-way state:
    //   sleep_protected → interaction_awake (responsive but travel/activity locked)
    // Only fires once per interruption window (field expires after 30 min per getSleepState).
    if (!isPhone && getCharacterStatus(character) === 'asleep') {
      const alreadyInterrupted = character.sleep_interrupted_at &&
        (Date.now() - new Date(character.sleep_interrupted_at).getTime()) < 30 * 60 * 1000;
      if (!alreadyInterrupted) {
        import('@/lib/sleepUtils').then(({ buildSleepInterruptionUpdate }) => {
          const update = buildSleepInterruptionUpdate(character);
          base44.entities.Character.update(characterId, update).catch(() => {});
        }).catch(() => {});
      }
    }

    if (isMountedRef.current) setIsTyping(true);

    // Register foreground task for the full LLM response cycle.
    // This blocks ALL background simulations, presence syncs, and narrative calls
    // while the user is waiting for a response. Released when LLM responds or fails.
    const releaseFgTask = registerForegroundTask(FOREGROUND_TASKS.CHAT_MESSAGE_RESPONSE, PRIORITY_LEVELS.CRITICAL);

    // callLLMWithRetry is imported from lib/llmUtils.js

    let recentMsgs, response, responseText, emotionalState, imagePrompts = [], msgType = "text_only";
    let responseObj = { message_type: "text_only", text_content: "", image_generation_prompts: [] };
    let charLocationName = character.resolved_current_location_name || null;
    let charLocationId = character.resolved_current_location_id || null;
    let fullPrompt = ""; // hoisted so catch block can access it for retry
    try {
      if (!isMountedRef.current) {
        console.warn('[sendMessage] Component unmounted, aborting message send');
        return;
      }

      recentMsgs = [...messages.slice(-50), userMsg];
      // Each message carries its own speaker identity at send time.
      // For user messages: use the stored played_as_character_name if it exists (historical accuracy),
      // otherwise fall back to the user's world name or "User".
      // Do NOT use the current activeCharacter to label all historical messages — that causes identity bleeding.
      const chatHistory = recentMsgs.map(m => ({
        role: m.sender_type === "user" ? "user" : "assistant",
        content: m.content,
        _speakerName: m.sender_type === "user"
          ? (m.played_as_character_name || userSettings.fictional_world_name || "User")
          : character.name,
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
      // ── CRITICAL/NONCRITICAL SPLIT ────────────────────────────────────────────
      // NONCRITICAL (weather, finance, commitments) run in background.
      // They are given a 2500ms window — if they resolve in time they are included.
      // If they time out they are skipped and the LLM call proceeds without them.
      // This guarantees pre_llm_blocking_ms stays under 3000ms even on cold starts.
      const t_send_start = Date.now();
      const noncriticalPromise = Promise.all([
        buildDynamicContexts(text, character, recentMsgs).catch(() => ({ weatherContext: '', recentEventsContext: '', culturalContext: '' })),
        buildFinancialContext(characterId, text, recentMsgs).catch(() => ''),
        buildCommitmentsContext(characterId).catch(() => ''),
      ]);
      const noncriticalTimeout = new Promise(resolve =>
        setTimeout(() => resolve([{ weatherContext: '', recentEventsContext: '', culturalContext: '' }, '', '']), 2500)
      );
      let skippedNoncriticalStages = false;
      const noncriticalRace = Promise.race([noncriticalPromise, noncriticalTimeout]);
      // Do not await here — we'll grab results just before assembling the prompt
      // after the critical stages (canonical prompt + memory) are resolved.

      // ── HOUSEHOLD / CO-PRESENCE CONTEXT ────────────────────────────────────
      const allCachedCharsForCoPresence = queryClient.getQueryData(["characters", currentUser?.email]) || [];
      const householdCoPresenceContext = buildHouseholdCoPresenceContext(character, allCachedCharsForCoPresence);

      // ── AWAIT NONCRITICAL NOW (just before prompt assembly) ─────────────────
      // By the time we reach here, canonical prompt + memory are resolved.
      // The noncritical promise has been running in parallel the whole time.
      // We give it whatever time remains up to the 2500ms window.
      const [noncriticalResult] = await Promise.all([noncriticalRace]);
      const [{ weatherContext, recentEventsContext, culturalContext }, financialContext, commitmentsContext] = noncriticalResult;
      const t_pre_llm = Date.now();
      const pre_llm_blocking_ms = t_pre_llm - t_send_start;
      if (pre_llm_blocking_ms > 2500) {
        skippedNoncriticalStages = true;
        console.warn(`[Chat] PRE_LLM_BLOCKING_MS=${pre_llm_blocking_ms} — noncritical stages timed out, skipped`);
      }
      console.log(`[SEND_TIMING_PROOF] pre_llm_blocking_ms=${pre_llm_blocking_ms} | skipped_noncritical=${skippedNoncriticalStages} | weather_loaded=${!!weatherContext} | finance_loaded=${!!financialContext} | commitments_loaded=${!!commitmentsContext}`);

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
              qrContext = `\n\nQR CODE DETECTED — CANNOT DECODE:\nThe user uploaded an image containing a QR code, but it could not be read clearly. You MUST tell the user you can see the QR code but could not decode it. Do NOT guess what it contains.`;
            } else if (/^https?:\/\//i.test(qrRaw)) {
              try {
                const res = await base44.functions.invoke('performWebLookup', { characterId, searchQuery: qrRaw, sourceUrl: qrRaw });
                const data = res?.data;
                const content = (data?.title || data?.summary)
                  ? `Title: ${data.title || 'Unknown'}\nContent: ${data.summary || data.description || 'No content retrieved'}`
                  : '(Content could not be retrieved)';
                qrContext = `\n\nQR CODE DECODED — LINK:\nThe user's uploaded image contained a QR code that decoded to this URL: ${qrRaw}\n${content}\nSTRICT RULES: Respond ONLY to the actual content above. If content was retrieved, reference specific details. If not retrieved, tell the user explicitly you cannot access the linked content. Do NOT fabricate or guess.`;
              } catch {
                qrContext = `\n\nQR CODE DECODED — LINK (unresolved):\nThe user's image contained a QR code that decoded to: ${qrRaw}\nThe linked content could not be retrieved. You MUST tell the user you can see the link from the QR code but cannot access its content.`;
              }
            } else {
              qrContext = `\n\nQR CODE DECODED — TEXT CONTENT:\nThe user's uploaded image contained a QR code with the following exact text:\n"${qrRaw}"\nRespond to this exact decoded content. Do NOT fabricate or expand on it beyond what is provided.`;
            }
          }
        } catch {
          // QR scan failed silently — do not block message flow
        }
      }

      // ── RESOLVE IMAGE + LINK ANALYSIS (started before setIsTyping) ───────────
      // Both promises were kicked off immediately after userMsg was created.
      // By this point they are resolved.
      const [imageAnalysisContext, linkContext] = await Promise.all([
        imageAnalysisPromise,
        linkAnalysisPromise,
      ]);

      // ── CRITICAL PATH: Character response LLM call happens FIRST ───────────
      // Optional context is fetched in parallel but does NOT block response.
      // If optional context is still loading when LLM is ready, use empty fallback.

      const frequentedPlaces = character.frequented_places || [];
      if (frequentedPlaces.length > 0) {
        const fullText = (text + " " + (recentMsgs.slice(-3).map(m => m.content).join(" "))).toLowerCase();
        const mentionedPlace = frequentedPlaces.find(p => fullText.includes(p.toLowerCase()));
        if (mentionedPlace) {
          // Emotional state update from frequented place mention — deferred 8s so it
          // does NOT compete with the main LLM response. No retry on failure.
          setTimeout(async () => {
            try {
              const newState = await base44.integrations.Core.InvokeLLM({
                prompt: `A character named ${character.name} (personality: ${character.personality_summary || "unknown"}) is currently at or talking about "${mentionedPlace}", one of their frequented places. Based on their personality and the context, what emotional state best fits them right now? Choose ONE from this list: calm, irritated, defensive, reflective, closed-off, flirtatious, bored, burnt out, joyful, anxious, sad, excited, overwhelmed, content, frustrated. Return ONLY the single word.`,
              });
              const cleaned = newState?.trim().toLowerCase().replace(/[^a-z\s-]/g, "");
              const validStates = ["calm","irritated","defensive","reflective","closed-off","flirtatious","bored","burnt out","joyful","anxious","sad","excited","overwhelmed","content","frustrated"];
              if (validStates.includes(cleaned)) {
                await base44.entities.Character.update(characterId, { emotional_state: cleaned });
                queryClient.invalidateQueries({ queryKey: ["character", characterId] });
              }
            } catch { /* nonessential — do not throw */ }
          }, 8000);
        }
      }

      // performWebLookup — deferred 5s so it does not compete with the main LLM response.
      // Rate-limit gated. Failure is logged visibly, not swallowed.
      if (lookupMatch && lookupMatch[1]) {
        const query = lookupMatch[1].trim();
        setTimeout(() => {
          if (isGloballyRateLimited()) {
            console.log('[Chat] SKIP performWebLookup — rate limit active');
            return;
          }
          base44.functions.invoke('performWebLookup', { characterId, searchQuery: query }).catch(err => {
            const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
            if (is429) reportRateLimit(60000);
            console.warn('[Chat] performWebLookup failed:', err?.message);
          });
        }, 5000);
      }

      // ── OPTIONAL CONTEXT LOADING (non-blocking parallel fetch) ──────────────
      // Memory, progression, research, and spatial context are fetched in parallel
      // but do NOT block the LLM response. If these are still loading when the LLM
      // call completes, empty fallbacks are used instead.
      const needsLocationFetch = !!(character.occupation_location_id || character.current_activity ||
        character.additional_occupation_locations?.length > 0);
      let allLocationsForContext = [];

      const getLocationsForContext = async () => {
        if (!needsLocationFetch) return null;
        const allLocs = await getLocations(async () => {
          const allLocRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
          return allLocRes?.data?.locations || [];
        });
        allLocationsForContext = allLocs;
        const allActiveChars = queryClient.getQueryData(["characters", currentUser.email]) || [];
        const { buildSpatialOccupancyMap, buildSpatialContextString } = await import('@/lib/spatialAwareness.js');
        const occupancyMap = buildSpatialOccupancyMap(allActiveChars, allLocs);
        return buildSpatialContextString(characterId, occupancyMap, allLocs) || null;
      };

      // Start optional context fetches in the background (do not await yet)
      const optionalContextPromises = {
        memory: base44.functions.invoke('retrieveActiveMemory', {
          characterId,
          currentMessage: text,
          recentMessages: recentMsgs.slice(-6),
          topK: 14,
        }).catch(() => ({ data: { memories: [], total: 0, _fallback: true } })),
        progression: base44.functions.invoke('buildProgressionFilteredContext', { characterId, currentMessage: text })
          .catch(() => null),
        pastLookups: base44.entities.WebLookup.filter({ character_id: characterId }, "-lookup_date", 10)
          .catch(() => []),
        spatial: getLocationsForContext()
          .catch(() => null),
      };

      // For employment prompt block (critical for schedule accuracy), fetch locations with shorter timeout
      let employmentLocations = [];
      if (needsLocationFetch) {
        try {
          employmentLocations = await Promise.race([
            getLocations(async () => {
              const allLocRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
              return allLocRes?.data?.locations || [];
            }),
            new Promise(resolve => setTimeout(() => resolve([]), 3000)) // 3s timeout
          ]);
        } catch {
          employmentLocations = [];
        }
      }

      // Extract optional context with immediate non-blocking fallbacks
      // These promises are already running in parallel — we do NOT await them
      // before calling the LLM. Instead, use timeouts to grab them if ready,
      // otherwise proceed with empty context.
      let memoryResult = null;
      let progressionResult = null;
      let pastLookupsResult = [];
      let spatialResult = null;

      // Try to grab optional context if it resolves within 2s, otherwise use fallback
      try {
        memoryResult = await Promise.race([
          optionalContextPromises.memory,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
      } catch {
        console.log('[Chat] Memory context timeout — using fallback');
        memoryResult = { data: { memories: [], total: 0, _fallback: true } };
      }

      try {
        progressionResult = await Promise.race([
          optionalContextPromises.progression,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
      } catch {
        console.log('[Chat] Progression context timeout — using fallback');
        progressionResult = null;
      }

      try {
        pastLookupsResult = await Promise.race([
          optionalContextPromises.pastLookups,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
      } catch {
        console.log('[Chat] Past lookups timeout — using fallback');
        pastLookupsResult = [];
      }

      try {
        spatialResult = await Promise.race([
          optionalContextPromises.spatial,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
      } catch {
        console.log('[Chat] Spatial context timeout — using fallback');
        spatialResult = null;
      }

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

      // ── CANONICAL CONTEXT — single identity source of truth ───────────────
      // Fetch canonical prompt from backend service. This owns: identity, hard facts,
      // memory, Life Journal, relationships, soap opera threads.
      // buildSystemPrompt then wraps it with frontend-only layers (image rules, narration, etc.)
      //
      // CACHING RULE: Only identity/memory/relationship data is cached.
      // Co-presence is LIVE STATE — it must NOT be cached. It is injected separately below
      // via the frontend authoritative co-presence override block, which reads fresh
      // UserSettings on every message send.
      let canonicalPrompt = null;
      let canonicalContextLoaded = false;
      let canonicalMemoryCount = 0;
      let canonicalLifeJournalCount = 0;
      let canonicalFallbackUsed = false;
      const canonicalCacheKey = `canonical::${characterId}`;

      // ── CACHE-FIRST: check global runtime cache, then mount cache, then fetch ──
      // Global cache is warmed by prewarmCharacterRuntime fired on page open.
      const { getCachedCanonicalPrompt: _gccp, setCachedCanonicalPrompt: _sccp } =
        await import('@/lib/characterRuntimeCache.js');
      const globalCachedPrompt = currentUser?.email
        ? _gccp(currentUser.email, characterId)
        : null;

      // ── FRONTEND TIMING: mark send start — report canonical cache state ────
      {
        const isCached = !!(globalCachedPrompt || systemPromptCacheRef.current[canonicalCacheKey]);
        markSendStart({
          canonical_prompt_cached: isCached,
          blocking_stages: isCached ? [] : ['canonical_prompt'],
        });
      }

      if (globalCachedPrompt) {
        canonicalPrompt = globalCachedPrompt;
        canonicalContextLoaded = true;
        // Backfill mount cache so subsequent sends in same session skip even the import
        systemPromptCacheRef.current[canonicalCacheKey] = {
          systemPrompt: canonicalPrompt,
          memoryCount: 0,
          lifeJournalCount: 0,
        };
        console.log(`[Chat] canonical_prompt=GLOBAL_CACHE_HIT | character=${character.name}`);
      } else if (systemPromptCacheRef.current[canonicalCacheKey]) {
        const cached = systemPromptCacheRef.current[canonicalCacheKey];
        canonicalPrompt = cached.systemPrompt;
        canonicalContextLoaded = true;
        canonicalMemoryCount = cached.memoryCount || 0;
        canonicalLifeJournalCount = cached.lifeJournalCount || 0;
      } else {
        try {
          const t_canonical_start = Date.now();
          const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
            characterId,
            interactionContext: 'direct_chat',
            topKMemories: 14,
          });
          const ctxData = ctxRes?.data || ctxRes;
          if (ctxData?.systemPrompt) {
            canonicalPrompt = ctxData.systemPrompt;
            canonicalContextLoaded = true;
            canonicalMemoryCount = ctxData.memories?.length ?? 0;
            canonicalLifeJournalCount = ctxData.lifeJournalEntries?.length ?? 0;
            systemPromptCacheRef.current[canonicalCacheKey] = {
              systemPrompt: canonicalPrompt,
              memoryCount: canonicalMemoryCount,
              lifeJournalCount: canonicalLifeJournalCount,
            };
            // Populate global cache for future page opens
            if (currentUser?.email) _sccp(currentUser.email, characterId, canonicalPrompt);
            console.log(`[Chat] canonical_prompt=DB_FETCH | blocking_stage=canonical_prompt | ms=${Date.now() - t_canonical_start}`);
          } else {
            canonicalFallbackUsed = true;
          }
        } catch (ctxErr) {
          canonicalFallbackUsed = true;
          console.warn(`[Chat] Canonical context unavailable for ${character.name}: ${ctxErr.message} — using legacy inline fallback`);
        }
      }

      // ── AUTHORITATIVE CO-PRESENCE BLOCK — shared resolver, never cached ─────
      // resolveCoPresence reads live userSettings + character data on every send.
      // No API call. No cache. Overrides any stale co-presence in the canonical prompt.
      const coPresenceResult = resolveCoPresence(character, userSettings, userDisplayName);
      const frontendCoPresenceBlock = coPresenceResult.promptBlock;

      console.log(
        `[Chat] route=direct_chat | character=${character.name} (${characterId})` +
        ` | canonical_loaded=${canonicalContextLoaded}` +
        ` | memory_count=${canonicalMemoryCount}` +
        ` | life_journal_count=${canonicalLifeJournalCount}` +
        ` | fallback_used=${canonicalFallbackUsed}`
      );

      let systemPrompt = "";
      if (character.system_prompt_url) {
        const cacheKey = `url::${characterId}::${character.system_prompt_url}`;
        if (systemPromptCacheRef.current[cacheKey]) {
          systemPrompt = systemPromptCacheRef.current[cacheKey];
        } else {
          try {
            const promptResponse = await fetch(character.system_prompt_url);
            systemPrompt = await promptResponse.text();
            systemPromptCacheRef.current[cacheKey] = systemPrompt;
          } catch {
            systemPrompt = buildSystemPrompt(canonicalPrompt, character, { allowNarration: false, outfitHint, worldName: userDisplayName });
          }
        }
      } else {
        // Pass canonical prompt as the identity base; buildSystemPrompt adds frontend-only layers
        systemPrompt = buildSystemPrompt(canonicalPrompt, character, { allowNarration: false, outfitHint, worldName: userDisplayName });
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
        // PLAY-AS MODE: user is currently speaking as activeCharacter
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

        playAsInstruction = `\n\n🔴 CRITICAL — CURRENT SPEAKER IDENTITY:
CURRENT SPEAKER: ${activeCharacter.name}
MODE: play_as_character
CHARACTER TYPE: ${activeCharacter.character_type || "active_created_character"}
IS USER WORLD SELF: false

The message you just received is FROM ${activeCharacter.name} — NOT from the app user, NOT from a narrator, NOT from anyone else.
${relContext}${memoryContext2}

Your response MUST:
1. Treat ${activeCharacter.name} as a REAL PERSON you know in your life — respond to THEM directly.
2. Recognize them by name and relationship — you know who they are.
3. NEVER refer to them as "the user" or treat them as the app operator.
4. IGNORE any prior speaker labels in conversation history for this response — the CURRENT speaker is ${activeCharacter.name} and only ${activeCharacter.name}.
5. This is character-to-character interaction. Respond accordingly.`;
      } else {
        // REGULAR USER MODE: user is speaking as their world self
        const worldName = userSettings.fictional_world_name || "the person you're talking to";
        playAsInstruction = `\n\n🟢 CURRENT SPEAKER IDENTITY:
CURRENT SPEAKER: ${worldName}
MODE: user_world_self
IS USER WORLD SELF: true

The message you just received is from the user's world self (${worldName}). This is NOT a character-to-character interaction.
Do NOT attribute this message to any previously seen play-as character. The current speaker is ${worldName} only.
Respond to ${worldName} naturally as you normally would.`;
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

      // conversationLog uses per-message speaker names — historical accuracy, no bleeding
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

      // Use employment-scoped locations fetched with short timeout (3s).
      // buildEmploymentPromptBlock needs worker_shifts from locations — this is the only
      // place locations are critical for schedule accuracy. Everything else (spatial, awareness)
      // is optional and uses fallback if timeout.
      const employmentPresenceSeparation = buildEmploymentPromptBlock(character, employmentLocations);

      // Build location share context for the prompt
      const locationShareInstruction = charLocationName ? `\n\nLOCATION SHARING: If the user asks where you are, or if you want to share your location naturally in conversation, you may set "share_location": true in your JSON response. Your current verified location is: "${charLocationName}". Only share when genuinely relevant. You may also include a short optional "location_share_note" field (max 1 sentence) to add a personal note about why you're there or what you're doing. Only set share_location:true when you have a real verified location — never fabricate one.` : "";

      console.log('[FINANCIAL_CONTEXT_PROOF]', {
        characterId,
        characterName: character?.name,
        userText: text,
        financialContextIncluded: !!financialContext,
        financialContextPreview: financialContext?.slice(0, 500),
      });

      fullPrompt = `${systemPrompt}${frontendCoPresenceBlock}${householdCoPresenceContext}${educationContext}${songsContext}${memoryContext}${lifeEventContext}${researchContext}${weatherContext}${recentEventsContext}${culturalContext}${financialContext}${commitmentsContext}${timeContext}${needsContext}${catchupContext}${imageAnalysisContext}${linkContext}${qrContext}${locationShareInstruction}${modeInstruction}${statusContext}${sleepContext}${awarenessContext}${employmentPresenceSeparation}${spatialContext}${playAsInstruction}${evidenceInstruction}${toneContext}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${conversationLog}\n\nWrite your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- CRITICAL: NEVER say your own name (${character.name}) in your response. Real people do not address themselves by name. The speaker labels in the conversation above (e.g. "${character.name}: ...") indicate WHO IS SPEAKING — they are NOT the name of the person being spoken to. Do not confuse speaker labels with the recipient's name.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n- CULTURAL AWARENESS: When the user references celebrities, TV shows, music, entertainment, or cultural topics, you recognize them as real and familiar. You respond naturally without confusion or over-explanation.\n\nRespond ONLY with valid JSON in this exact format:\n{\n  "message_type": "text_only" | "image_only" | "text_then_image" | "image_then_text",\n  "text_content": "The visible character dialogue — ONLY include if message_type includes text. Never put image prompts here.",\n  "image_generation_prompt": "INTERNAL ONLY — vivid image description for generation. Never shown to user. Only include if message_type includes image.",\n  "image_generation_prompts": ["For multiple images only — array of internal image prompts"],\n  "share_location": true,
  "location_share_note": "Optional one-sentence note about why you're sharing or what you're doing there",\n  "scheduled_events": [\n    {\n      "description": "What will happen",\n      "trigger_time": "<ISO 8601 UTC datetime>"\n    }\n  ]\n}\nOnly include scheduled_events if a specific real-world action with a concrete time is committed to. Only include share_location:true when genuinely sharing location. Omit fields you don't use.\n\n${imageRule}`;


      // ── RESPONSE LAG — MOVED TO POST-LLM (after response is received) ─────────
      // Artificial delay no longer blocks the LLM call. The LLM fires immediately.
      // Delay (if enabled) is applied AFTER the response is received, before saving the message.
      // This preserves the user-visible "typing..." feel without blocking the first response.
      const responseLagEnabled = userSettings.response_lag_enabled !== false;
      let pendingResponseLagMs = 0;
      if (responseLagEnabled) {
        if (isPhone) {
          const textDelayMs = getTextDelayMs(character);
          if (textDelayMs === null) {
            console.log(`[TIMING] TEXT blocked — character is asleep. No response sent.`);
            setIsTyping(false);
            return;
          }
          pendingResponseLagMs = textDelayMs;
          console.log(`[TIMING] TEXT delay (post-LLM): ${Math.round(textDelayMs / 1000)}s | status=${getCharacterStatus(character)}`);
        } else {
          const chatDelayMs = getChatDelayMs(character);
          pendingResponseLagMs = chatDelayMs;
          console.log(`[TIMING] CHAT delay (post-LLM): ${Math.round(chatDelayMs / 1000)}s`);
        }
      }

      // validateLocationInResponse is imported from lib/promptContextBuilders.js

      const t_llm_start = Date.now();
      response = await callLLMWithRetry(fullPrompt);
      const t_llm_end = Date.now();
      console.log(`[SEND_TIMING_PROOF] llm_call_ms=${t_llm_end - t_llm_start} | llm_start_ms=${t_llm_start - t_send_start}`);

      // Apply response lag AFTER LLM response (not before) — keeps typing indicator visible
      // without blocking the actual LLM call. Skip lag if total time already exceeds threshold.
      if (pendingResponseLagMs > 0) {
        const alreadyElapsed = Date.now() - t_send_start;
        const lagRemaining = Math.max(0, pendingResponseLagMs - alreadyElapsed);
        if (lagRemaining > 0) await new Promise(r => setTimeout(r, lagRemaining));
      }

      responseObj = parseCharacterResponse(response);

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
      releaseFgTask(); // release on error — background systems can resume
      if (!isMountedRef.current) return;
      setIsTyping(false);

      const { handleFallbackResponse } = await import('@/lib/chatFallbackIntegration');

      const msg = err?.message || '';
      const isRateLimit = msg.includes('429') || msg.includes('Rate limit') || msg.includes('rate limit') || err?.status === 429;
      const isRetryable = isRateLimit || msg.includes('timeout') || msg.includes('Network');
      console.error('[sendMessage] Error:', msg, '| retryable:', isRetryable);

      // ── CIRCUIT BREAKER: NEVER save generic fallback text as a character Message ──
      // handleFallbackResponse always returns should_save=false.
      // Recovery triggers automatically in background with exponential backoff.
      // UI shows "Reconnecting…" via isRecovering state — NOT a saved Message.
      if (isMountedRef.current) {
        await handleFallbackResponse({
          characterId,
          conversationId: conversationIdRef.current || conversationId,
          currentUser,
          base44,
          character,
          setRecoveringState: setIsRecovering,
          errorReason: isRateLimit ? 'rate_limit' : msg.includes('timeout') ? 'timeout' : 'llm_failure',
          errorStage: 'response_generation',
          originalPrompt: fullPrompt, // REQUIRED: pass the full prompt for recovery
          sourceMessageId: userMsg?.id, // REQUIRED: user message for idempotency
          channel: isPhone ? 'phone' : 'direct',
        });
      }
      return;
    }

    releaseFgTask();
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

      // ── PHOTO SUBJECT ROUTING ────────────────────────────────────────────────
      // Resolve WHO appears in the photo before dispatching.
      // Sender ≠ subject unless the photo is a selfie or explicit sender-shot.
      const allCachedChars = queryClient.getQueryData(["characters", currentUser?.email]) || [];
      const subjectResolution = resolvePhotoSubject({
        imageGenPrompt,
        userMessage: text,
        senderCharacterId: characterId,
        senderCharacterName: character.name,
        allCharacters: allCachedChars,
      });

      // Determine which refs and subjectType to send to generateImageAsync
      const resolvedSubjectType = subjectResolution.photo_subject_type === 'group_photo'
        ? 'joint'
        : subjectResolution.photo_subject_type === 'selfie'
        ? 'character'
        : subjectResolution.main_focal_character_id && subjectResolution.main_focal_character_id !== characterId
        ? 'known_character'
        : 'character';

      // If the subject is a known saved character (not the sender), resolve their refs
      let resolvedCharRefs = charRefs;
      let resolvedCharacterId = characterId;
      if (
        subjectResolution.main_focal_character_id &&
        subjectResolution.main_focal_character_id !== characterId
      ) {
        const subjectChar = allCachedChars.find(c => c.id === subjectResolution.main_focal_character_id);
        if (subjectChar) {
          resolvedCharRefs = (subjectChar.reference_image_urls || []).slice(0, 2);
          resolvedCharacterId = subjectChar.id;
        } else {
          resolvedCharRefs = [];
          resolvedCharacterId = null;
        }
      } else if (!subjectResolution.use_sender_refs) {
        // Third party / location — do not use sender refs
        resolvedCharRefs = [];
        resolvedCharacterId = null;
      }

      // Build final prompt: if subject is a described third party, prepend clear subject instruction
      let finalImageGenPrompt = imageGenPrompt;
      if (
        subjectResolution.photo_subject_type === 'described_third_party' &&
        subjectResolution.subject_override_desc
      ) {
        finalImageGenPrompt = `[PHOTO SUBJECT — NOT THE SENDER]: ${subjectResolution.subject_override_desc}. Context: ${imageGenPrompt}`;
      }

      console.log(`[Chat] Photo subject resolved: type=${subjectResolution.photo_subject_type} | focalCharId=${subjectResolution.main_focal_character_id || 'none'} | useSenderRefs=${subjectResolution.use_sender_refs} | sender=${character.name}`);

      let imgMsg;
      try {
        imgMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: "character",
          character_id: characterId,
          character_name: character.name,
          sender_character_id: characterId,
          receiver_character_id: null,
          content: "",
          emotional_state: emotionalState,
          is_read: navigatedAway ? false : true,
          timestamp: new Date().toISOString(),
          channel: isPhone ? 'phone' : 'direct',
          // ── IDEMPOTENCY FIELDS ───────────────────────────────────────────────
          source_message_id: userMsg?.id || null,
          reply_to_message_id: userMsg?.id || null,
          generation_lock_id: null,  // image generation doesn't use generation lock
          generation_context: {
            prompt: imageGenPrompt,
            character_id: characterId,
            character_reference_images: resolvedCharRefs,
            subject_character_id: subjectResolution.main_focal_character_id || null,
            subject_description: subjectResolution.subject_description || null,
            photo_subject_type: subjectResolution.photo_subject_type,
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
      console.log(`[Chat] Image msg created: ${targetMsgId} | sender=${character.name} | subject_type=${subjectResolution.photo_subject_type} | focal_char=${resolvedCharacterId || 'none'} | prompt="${finalImageGenPrompt.substring(0, 80)}"`);
      setTimeout(() => dispatchImageGeneration({
        targetMsgId,
        imageGenPrompt: finalImageGenPrompt,
        charRefs: resolvedCharRefs,
        userRefImages,
        useUserRefs: subjectResolution.photo_subject_type === 'group_photo',
        character,
        userSettings,
        currentUser,
        subjectType: resolvedSubjectType,
        // CRITICAL: For described third parties with no saved character record,
        // pass null explicitly — NOT the sender's characterId.
        // The backend's isThirdPartyPhoto guard uses this to hard-block sender identity.
        characterId: resolvedCharacterId, // null for described strangers — intentional
        isMountedRef,
        setMessages,
        convoId,
        queryClient,
      }), delayMs);
      return imgMsg;
    };

    const createTextMessage = async (textContent, { sourceMessageId = null, lockId = null } = {}) => {
      if (!textContent?.trim()) return null;
      const navigatedAway = !isMountedRef.current;
      let txtMsg;
      try {
        txtMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: "character",
          character_id: characterId,
          character_name: character.name,
          sender_character_id: characterId,
          receiver_character_id: null, // user is receiver — no character id
          content: textContent,
          emotional_state: emotionalState,
          is_read: navigatedAway ? false : true,
          timestamp: new Date().toISOString(),
          // ── IDEMPOTENCY FIELDS ───────────────────────────────────────────────
          source_message_id: sourceMessageId || userMsg?.id || null,
          reply_to_message_id: sourceMessageId || userMsg?.id || null,
          generation_lock_id: lockId || null,
          channel: isPhone ? 'phone' : 'direct',
          // ── TEXT RESPONSE CLASSIFICATION — real LLM response ─────────────────
          recovery_signal: false,
          memory_eligible: true,
          relationship_eligible: true,
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
        queryClient.invalidateQueries({ queryKey: ['conversations', characterId, currentUser?.email] });
      }
      return txtMsg;
    };

    // ── LOCATION SHARE: if character opted to share their location, create a location card message
    const shouldShareLocation = responseObj.share_location === true && charLocationName && charLocationId;

    let primaryTextMsg = null;

    const idempotencyOpts = { sourceMessageId: userMsg?.id || null };

    // ── LOCATION SHARE IDEMPOTENCY KEY ────────────────────────────────────────
    const locationShareIdempotencyKey = shouldShareLocation
      ? `location_share::${characterId}::direct::${charLocationId}::${new Date().toISOString().substring(0, 13)}`
      : null;

    if (msgType === "text_only") {
      // CRITICAL: Never save a hardcoded fallback string as character dialogue.
      // If responseText is empty after a successful LLM call, save "..." (minimal safe token) not a fake apology.
      primaryTextMsg = await createTextMessage(responseText || "...", idempotencyOpts);
      if (!primaryTextMsg) { setSendError("Character response failed to save. Try again."); return; }

    } else if (msgType === "image_only") {
      if (imagePrompts.length > 0) {
        await createImageMessage(imagePrompts[0], 300);
        for (let i = 1; i < imagePrompts.length; i++) {
          await createImageMessage(imagePrompts[i], 300 + i * 800);
        }
      } else {
        primaryTextMsg = await createTextMessage(responseText || "...", idempotencyOpts);
      }

    } else if (msgType === "text_then_image") {
      primaryTextMsg = await createTextMessage(responseText || "", idempotencyOpts);
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
      primaryTextMsg = await createTextMessage(responseText || "", idempotencyOpts);
      if (!primaryTextMsg && imagePrompts.length === 0) { setSendError("Character response failed to save. Try again."); return; }

    } else {
      primaryTextMsg = await createTextMessage(responseText || "...", idempotencyOpts);
    }

    // Create location share card if flagged
    if (shouldShareLocation && locationShareIdempotencyKey) {
      // Fetch the location record to get category info
      base44.entities.LocationReference.filter({ id: charLocationId })
        .then(locs => {
          const loc = locs?.[0];
          base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: "character",
            character_id: characterId,
            character_name: character.name,
            sender_character_id: characterId,
            receiver_character_id: null,
            content: "",
            emotional_state: emotionalState,
            is_read: true,
            timestamp: new Date().toISOString(),
            channel: isPhone ? 'phone' : 'direct',
            // ── IDEMPOTENCY FIELDS ───────────────────────────────────────────────
            source_message_id: userMsg?.id || null,
            reply_to_message_id: userMsg?.id || null,
            generation_lock_id: null,
            idempotency_key: locationShareIdempotencyKey,
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
            sender_character_id: characterId,
            receiver_character_id: null,
            content: "",
            emotional_state: emotionalState,
            is_read: true,
            timestamp: new Date().toISOString(),
            channel: isPhone ? 'phone' : 'direct',
            // ── IDEMPOTENCY FIELDS ───────────────────────────────────────────────
            source_message_id: userMsg?.id || null,
            reply_to_message_id: userMsg?.id || null,
            generation_lock_id: null,
            idempotency_key: locationShareIdempotencyKey,
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
      // Surgical patch — do NOT broadcast a full characters list refetch on every emotional state change.
      // A broad invalidateQueries(["characters"]) fires a 300-record re-fetch on every message send.
      // Patch the single-character cache used by Chat.
      queryClient.setQueryData(["character", characterId], (prev) => prev ? { ...prev, emotional_state: emotionalState } : prev);
      // Also patch the all-characters array cache used by Home and other pages —
      // avoids stale emotional_state showing there without triggering a full re-fetch.
      if (currentUser?.email) {
        queryClient.setQueryData(["characters", currentUser.email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map(c => c.id === characterId ? { ...c, emotional_state: emotionalState } : c);
        });
      }
    }

    const prevLevels = {
      user_respect_level: character.user_respect_level ?? 50,
      friendship_level: character.friendship_level ?? 75,
      romantic_level: character.romantic_level ?? 0,
      attraction_level: character.attraction_level ?? 0,
      chosen_family_level: character.chosen_family_level ?? 0,
    };
    setPreviousLevels(prevLevels);

    // ── ALL POST-SEND BACKGROUND WORK delegated to useChatBackgroundTasks ──────
    // Governed by: per-function cooldowns, in-flight guards, staggered tiers (0/2/4/7/10s),
    // emoji cooldown (once per 5 messages), and visible skip logging.
    dispatchPostSend({
      characterId, convoId, character, text, responseText, recentMsgs,
      activeCharacter, isPhone, currentUser, isTyping: false, userMsg,
    });

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
        onHousingChangeToggle={() => setShowHousingModal(true)}
        onLocationShareToggle={() => setShowLocationShare(true)}
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
        <FinancialActionsPanel
          character={character}
          userBalance={userSettings.user_balance ?? 0}
          isSending={isSendingMoney}
          onSendMoney={async (amount, reason, direction) => {
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
        />
      )}
      {convoLoadError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              {convoLoadError === 'rate_limited' ? 'Too many requests — app is recovering' : 'Chat failed to load'}
            </p>
            <p className="text-xs text-muted-foreground">
              {convoLoadError === 'rate_limited'
                ? 'Background systems are being paused so this chat can load.'
                : 'Check your connection and try again.'}
            </p>
          </div>
          <button
            onClick={() => {
              // SAFEGUARD RECOVERY: Retry is not passive. It activates Chat-Safe Mode
              // which pauses all nonessential background work for 45s, then retries the page load.
              console.warn('[Chat] RETRY pressed — activating chat-safe mode and running safeguard recovery');
              activateChatSafeMode(45000);
              // Brief delay to let in-flight background tasks drain before retrying
              setTimeout(() => {
                setConvoLoadError(null);
                setRetryKey(k => k + 1);
              }, 800);
            }}
            className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Recover &amp; Retry
          </button>
          {convoLoadError === 'rate_limited' && (
            <p className="text-[10px] text-muted-foreground/50">Background tasks paused for 45s to prioritize chat</p>
          )}
        </div>
      ) : (isLoadingConvo && messages.length === 0) ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <ChatMessageList messages={messages} conversationId={conversationId} characterId={characterId} character={character} userSettings={userSettings} isTyping={isTyping} sendError={sendError} setSendError={setSendError} playingAudioId={playingAudioId} voiceErrors={voiceErrors} bottomRef={bottomRef} onReact={handleReact} onDelete={handleDeleteMessage} onDeleteImage={handleDeleteImage} onPlayVoice={playCharacterVoice} onForward={(msg) => setForwardTarget(msg)} onImageLoaded={(msgId, url) => {
              setMessages(prev => {
                const next = prev.map(m => m.id === msgId ? { ...m, image_url: url } : m);
                // Write back to LFC so the recovered image is visible instantly on next navigation
                if (currentUser?.email && characterId) {
                  import('@/lib/localFirstCache.js').then(({ lfcWrite }) => {
                    const recent = [...next].sort((a, b) =>
                      new Date(b.created_date || b.timestamp || 0) - new Date(a.created_date || a.timestamp || 0)
                    ).slice(0, 50).reverse();
                    lfcWrite(currentUser.email, `chat_msgs:${characterId}`, recent);
                  }).catch(() => {});
                }
                return next;
              });
            }} onLocationSignal={handleLocationSignal} hasOlderMessages={hasOlderMessages} onLoadOlderMessages={loadOlderMessages} />
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
      {/* Reconnecting indicator — UI state only, never saved as a Message */}
      {isRecovering && (
        <div className="px-4 pb-1 flex items-center gap-2 text-xs text-muted-foreground/70">
          <div className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground/70 rounded-full animate-spin flex-shrink-0" />
          <span>Reconnecting to {character?.name || 'character'}…</span>
        </div>
      )}
      <NarrativeBuilderPopup
        isOpen={showNarrativeBuilder}
        onClose={() => setShowNarrativeBuilder(false)}
        characterId={characterId}
        conversationId={conversationId}
        chatHistory={messages}
        currentUser={currentUser}
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

      {showLocationShare && character && conversationId && (
        <LocationShareTool
          isOpen={showLocationShare}
          onClose={() => setShowLocationShare(false)}
          character={character}
          characterId={characterId}
          conversationId={conversationId}
          userSettings={userSettings}
          currentUser={currentUser}
          onMessageCreated={(msg) => setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])}
        />
      )}
      {character && <PendingLifeEventApproval characterId={characterId} character={character} />}
      {showHousingModal && character && (
        <LogHousingChangeModal
          character={character}
          currentUser={currentUser}
          queryClient={queryClient}
          onClose={() => setShowHousingModal(false)}
          onSaved={() => setShowHousingModal(false)}
        />
      )}
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
      <ChatTimingOverlay timingRecord={timingRecord} />
    </div>
  );
}