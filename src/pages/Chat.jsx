import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
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
import ApprovalPopup from "@/components/approvals/ApprovalPopup";
import ShoppingApp from "@/components/chat/ShoppingApp";
import { dispatchImageGeneration } from "@/components/chat/ChatImageDispatch";
import BirthApprovalPopup from "@/components/approvals/BirthApprovalPopup";
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
import { stripCharacterNamePrefix, stripSelfReferenceName } from "@/lib/nameFilterUtils";
import { useUnifiedBehaviour } from "@/lib/useUnifiedBehaviour";
import { buildNeedsContextBlock } from "@/lib/needsStateEngine";
import { buildTemporalState, buildTemporalContextBlock } from "@/lib/temporalStateEngine";
import LocationAliasResolutionPopup from "@/components/location/LocationAliasResolutionPopup";
import { parseCharacterResponse } from "@/lib/chatResponseParser";
import NewPersonDetectedModal from "@/components/chat/NewPersonDetectedModal";
import ChatMessageList from "@/components/chat/ChatMessageList";

export default function Chat() {
  const { characterId } = useParams();
  const urlParams = new URLSearchParams(window.location.search);
  const chatType = urlParams.get("type") || "direct";
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

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const { data: character } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.filter({ id: characterId });
      return chars[0] || null;
    },
    enabled: !!characterId,
  });

  const behaviour = useUnifiedBehaviour(character, { isPhone, conversationId });
  const { settings: userSettings } = useUserSettings();
  const { playingAudioId, voiceErrors, playCharacterVoice } = useVoicePlayback(chatType);

  const { data: currentUser = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characterFinancial = null } = useQuery({
    queryKey: ["characterFinancial", characterId],
    queryFn: async () => {
      const records = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
      return records[0] || null;
    },
    enabled: !!characterId && showSendMoney,
  });

  useEffect(() => {
    base44.functions.invoke('initializeVoiceSettings', {}).catch(() => {});
  }, []);

  useEffect(() => {
    if (!characterId || !character || !currentUser.email) return;
    
    isMountedRef.current = true;
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    
    const loadConvo = async () => {
      try {
        const allConvos = await base44.entities.Conversation.filter(
          { type: chatType, character_ids: [characterId] },
          "-updated_date",
          20
        );
        const convos = allConvos.filter(c =>
          c.character_ids &&
          c.character_ids.length === 1 &&
          c.character_ids[0] === characterId
        );

        let convoId = null;

        if (convos.length > 0) {
          convoId = convos[0].id;
          const PROTECTED_CHARACTER_IDS = ['69c0d59d7e382cc866ded9c9'];
          const isProtected = PROTECTED_CHARACTER_IDS.includes(characterId);
          const msgLimit = isProtected ? 1000 : 50;
          const loadedMsgs = await base44.entities.Message.filter(
            { conversation_id: convoId },
            "-created_date",
            msgLimit
          );
          
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
          const convo = await base44.entities.Conversation.create({
            title: `${chatType} with ${character.name}`,
            type: chatType,
            character_ids: [characterId],
          });
          setConversationId(convo.id);
        }

        const pending = await base44.entities.PendingMessage.filter(
          { character_id: characterId, delivered: false }
        );

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
      } catch (err) {
        console.error('Failed to load conversation:', err);
      }
    };

    const timer = setTimeout(() => loadConvo(), 300);
    return () => clearTimeout(timer);
  }, [characterId, character, chatType, currentUser.email]);

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

  useEffect(() => {
    if (!conversationId) return;

    let isMounted = true;

    (async () => {
      try {
        const res = await base44.functions.invoke('markThreadRead', { conversationId, characterId });

        if (!isMounted) return;

        const markedCount = res?.data?.marked_read || 0;
        const finalUnread = res?.data?.final_unread_count || 0;

        console.log(`[BADGE] Backend markThreadRead returned: marked=${markedCount} | finalUnread=${finalUnread} | conversationId=${conversationId}`);

        setMessages(prev => prev.map(m =>
          m.sender_type === "character" ? { ...m, is_read: true } : m
        ));

        queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });

      } catch (err) {
        if (isMounted) {
          setMessages(prev => prev.map(m => m.sender_type === "character" && !m.is_read ? { ...m, is_read: true } : m));
          queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
        }
      }
      if (isMounted && messages.length > 0) {
        const lastUserMsg = [...messages].reverse().find(m => m.sender_type === 'user');
        if (lastUserMsg) {
          const lastTime = new Date(lastUserMsg.timestamp || lastUserMsg.created_date);
          if ((new Date() - lastTime) / 60000 >= 30) {
            base44.functions.invoke('generateCatchupNarrative', { characterId, lastUserMessageTime: lastUserMsg.timestamp || lastUserMsg.created_date })
              .then(r => { if (r?.data?.success && r?.data?.catchupText) setCatchupNarrativeText(r.data.catchupText); })
              .catch(() => {});
          }
        }
      }
    })();
    return () => { isMounted = false; };
  }, [conversationId]);

  useEffect(() => {
    if (!userScrolledAway) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length > 0 && messages[messages.length - 1]?.id, userScrolledAway]);

  useEffect(() => {
    const container = document.querySelector('[data-chat-container="true"]');
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      setUserScrolledAway(!isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const [sendError, setSendError] = useState(null);

  const handleDeleteMessage = (messageId) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    setDeleteTarget(msg);
  };

  const handleDeleteRemember = async () => {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;

    console.log(`[DELETE] messageId=${msg.id} | threadId=${conversationId} | pageType=${isPhone ? "text" : "chat"} | action=remember | removed_from_view=yes | retained_in_memory=yes`);

    setMessages(prev => prev.filter(m => m.id !== msg.id));
    await base44.entities.Message.update(msg.id, {
      archived_date: new Date().toISOString(),
    }).catch(() => {});
  };

  const handleDeleteForget = async () => {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;

    console.log(`[DELETE] messageId=${msg.id} | threadId=${conversationId} | pageType=${isPhone ? "text" : "chat"} | action=forget | removed_from_view=yes | retained_in_memory=no | memory_excluded=yes`);

    setMessages(prev => prev.filter(m => m.id !== msg.id));

    await base44.entities.Message.delete(msg.id).catch(() => {});

    if (msg.content?.trim() && msg.sender_type === "character" && characterId) {
      base44.entities.Memory.create({
        character_id: characterId,
        title: `[FORGOTTEN] Message deleted by user`,
        description: `The user deleted and chose to FORGET this message. Do NOT reference or recall it: "${msg.content.substring(0, 200)}"`,
        emotional_impact: "forgotten",
        timestamp: new Date().toISOString(),
        source_context: `forgotten_message_${msg.id}`,
      }).catch(() => {});

      console.log(`[DELETE] Forgotten memory marker created for characterId=${characterId}`);
    }
  };

  const handleDeleteImage = async (messageId) => {
    setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, image_url: null } : msg));
    try {
      await base44.entities.Message.update(messageId, { image_url: null });
    } catch {
      // Update failed, UI will stay in sync with subscription
    }
  };

  const handleReact = async (messageId, emoji) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;

    const currentReactions = msg.reactions || [];
    const existingUserReaction = currentReactions.find(r => r.reactor_type === "user");
    const isSameEmoji = existingUserReaction?.emoji === emoji;

    const nonUserReactions = currentReactions.filter(r => r.reactor_type !== "user");
    const updatedReactions = isSameEmoji
      ? nonUserReactions
      : [...nonUserReactions, { emoji, reactor_type: "user", reactor_id: "user" }];

    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: updatedReactions } : m));
    await base44.entities.Message.update(messageId, { reactions: updatedReactions });

    if (msg.sender_type === "character" && !isSameEmoji && character) {
      base44.functions.invoke("updateRelationshipLevels", {
        characterId,
        emojiReaction: emoji,
        emojiMeaning: { "❤️": "love/care/appreciation", "👍": "acknowledgment/approval", "😢": "sadness/empathy", "😡": "anger/disapproval", "😲": "shock/surprise", "😂": "humor/laughter" }[emoji] || "general reaction",
        reactedMessageContent: msg.content || "(image)",
        reactedMessageSenderType: msg.sender_type,
        recentMessages: messages.slice(-10),
      }).then(res => {
        if (res?.data?.reason) setLastChangeReason(res.data.reason);
        queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      }).catch(() => {});

      // Character sometimes responds to the user reacting to their message
      if (["❤️", "👍", "😂", "😢"].includes(emoji) && Math.random() < 0.45 && conversationId) {
        setTimeout(async () => {
          try {
            const emojiMeanings = { "❤️": "a ❤️ (love/appreciation)", "👍": "a 👍 (thumbs up/approval)", "😂": "a 😂 (laughing reaction)", "😢": "a 😢 (sad/touched reaction)" };
            const replyRes = await base44.integrations.Core.InvokeLLM({
              prompt: `You are ${character.name}. ${character.personality_summary || ""} You just sent this message: "${msg.content?.substring(0, 150) || "(image)"}". The person you're talking to reacted to YOUR message with ${emojiMeanings[emoji] || "an emoji reaction"}. Write a SHORT, natural, casual response — as yourself, reacting to RECEIVING that reaction from them. 1 sentence max, like a real text. Express how you feel about their reaction to what YOU said. Do NOT speak as the user or assume what they meant. Be yourself. No quotes, no labels.`,
            });
            const replyText = typeof replyRes === "string" ? replyRes.trim() : "";
            if (replyText && replyText.length > 2 && replyText.length < 200) {
              await base44.entities.Message.create({
                conversation_id: conversationId,
                sender_type: "character",
                character_id: characterId,
                character_name: character.name,
                content: replyText,
                emotional_state: character.emotional_state || "calm",
                timestamp: new Date().toISOString(),
                is_read: true,
              });
            }
          } catch { /* silent */ }
        }, 1500 + Math.random() * 2000);
      }
    }
  };

  const handleLocationSignal = async (locationIdOrContent, charId) => {
    if (!charId && !characterId) return;
    const targetCharId = charId || characterId;
    
    try {
      // If it looks like a location ID (UUID), use direct update
      if (locationIdOrContent?.length > 20 && locationIdOrContent.includes('-')) {
        const res = await base44.functions.invoke('updateCharacterLocation', {
          characterId: targetCharId,
          locationId: locationIdOrContent,
          presenceStatus: 'visiting',
          locationType: 'visit',
          sourceReason: 'chat_signal',
        });
        if (res?.data?.success) {
          queryClient.invalidateQueries({ queryKey: ["character", targetCharId] });
          queryClient.invalidateQueries({ queryKey: ["characters"] });
        }
        return;
      }
      
      // Otherwise, parse the content for location names
      const res = await base44.functions.invoke('updateCharacterLocationFromMessage', {
        characterId: targetCharId,
        messageContent: locationIdOrContent,
      });
      if (res?.data?.updated || res?.data?.unresolved) {
        queryClient.invalidateQueries({ queryKey: ["character", targetCharId] });
        queryClient.invalidateQueries({ queryKey: ["characters"] });
        queryClient.invalidateQueries({ queryKey: ["locationReferences"] });
      }
      if (res?.data?.unresolved && res.data.phrase) {
        setPendingAliasResolution({
          phrase: res.data.phrase,
          sourceSentence: res.data.source_sentence || null,
          characterId: targetCharId,
          characterName: character?.name,
        });
      }
    } catch { /* silent */ }
  };

  const handleShareSong = async (mediaLink, isVideo = false) => {
  if (!character || !conversationIdRef.current) {
   console.warn('[handleShareSong] Missing character or conversationId');
   return;
  }
  console.log('[handleShareSong] Processing:', mediaLink, 'isVideo:', isVideo);
  try {
   const res = await base44.functions.invoke('processSongLink', {
     characterId,
     songLink: mediaLink,
     isVideo
   });
   console.log('[handleShareSong] Full response:', res);

   if (res?.data?.success) {
    let msgData = {
      conversation_id: conversationIdRef.current,
      sender_type: 'user',
      timestamp: new Date().toISOString(),
      content: '',
    };

    if (isVideo) {
      msgData.videos_watched = res.data.video ? [res.data.video] : [];
    } else {
      msgData.songs_heard = res.data.songs?.length > 0
        ? res.data.songs
        : res.data.song
        ? [res.data.song]
        : [];
    }

     console.log('[handleShareSong] Creating message with:', msgData);
     const newMsg = await base44.entities.Message.create(msgData);
     console.log('[handleShareSong] Message created:', newMsg?.id);

     await base44.entities.Conversation.update(conversationIdRef.current, {
       last_message_preview: msgData.content,
       last_message_date: new Date().toISOString(),
     });
     queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });

     if (isMountedRef.current) {
       console.log('[handleShareSong] Adding to local state:', newMsg?.id);
       setMessages(prev => [...prev, newMsg]);
     }

     if (msgData.songs_heard?.length > 0) {
       msgData.songs_heard.forEach(song => {
         base44.functions.invoke('analyzeMediaUnderstanding', {
           mediaObject: song,
           sources: {},
         }).then(res1 => {
           const understanding = res1?.data?.understanding;
           base44.functions.invoke('deepMediaResearch', {
             mediaObject: song,
             tracks: song.tracks || [],
           }).then(res2 => {
             const deepResearch = res2?.data?.deepResearch;
             base44.functions.invoke('buildCharacterMediaKnowledge', {
               character,
               mediaObject: song,
               understanding,
               deepResearch,
             }).then(res3 => {
               const knowledge = res3?.data?.knowledge;
               base44.entities.Message.update(newMsg.id, {
                 songs_heard: msgData.songs_heard.map(s => 
                   s.spotify_id === song.spotify_id 
                     ? { ...s, _understanding: understanding, _deepResearch: deepResearch, _characterKnowledge: knowledge }
                     : s
                 ),
               }).catch(() => {});
               console.log(`[Media Research] Complete for "${song.title}": ${knowledge?.knowledgeLevel?.level || 'unknown'}`);
             }).catch(err => console.error('[buildKnowledge] Failed:', err.message));
           }).catch(err => console.error('[deepResearch] Failed:', err.message));
         }).catch(err => console.error('[analyzeMedia] Failed:', err.message));
       });
     }

     queryClient.invalidateQueries({ queryKey: ["character", characterId] });
   } else {
     console.error('[handleShareSong] processSongLink returned success=false');
     setSendError(`Couldn't process the link. Try another.`);
   }
   } catch (err) {
   console.error('[handleShareSong] Error:', err.message);
   if (err.message.includes('timed out')) {
     setSendError('Link processing took too long. Try a different link.');
   } else if (err.message.includes('502') || err.message.includes('Bad gateway')) {
     setSendError('Service temporarily unavailable. Try again in a moment.');
   } else {
     setSendError(`Couldn't process that link.`);
   }
   }
   };

  const sendMessage = async (text, userImageUrl) => {
    if (!character) return;
    setSendError(null);

    if (text.trim().toLowerCase().startsWith("fix:")) {
      const directive = text.trim().slice(4).trim();
      console.info("[Fix: directive]", directive);
      return;
    }

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
        played_as_character_id: activeCharacter.id,
        played_as_character_name: activeCharacter.name,
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

    const callLLMWithRetry = async (prompt, model = 'gemini_3_flash', maxRetries = 3) => {
      let retryCount = 0;
      while (retryCount <= maxRetries) {
        try {
          return await base44.integrations.Core.InvokeLLM({
            prompt,
            add_context_from_internet: true,
            model
          });
        } catch (err) {
          const isRateLimit = err?.message?.includes('rate') || err?.message?.includes('429') || err?.message?.includes('Rate limit');
          if (!isRateLimit || retryCount === maxRetries) throw err;
          const delayMs = Math.pow(2, retryCount + 1) * 1000;
          console.warn(`[RATE_LIMIT] Retry ${retryCount + 1}/${maxRetries} after ${delayMs}ms`);
          await new Promise(r => setTimeout(r, delayMs));
          retryCount++;
        }
      }
    };

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

      let educationContext = "";
      if (character.current_education_activity && character.current_education_activity !== "none") {
        const completionDate = new Date(character.education_expected_completion_date);
        const daysLeft = Math.ceil((completionDate - new Date()) / (1000 * 60 * 60 * 24));
        const courseName = character.education_details?.course_name || character.current_education_activity;
        const institution = character.education_details?.institution;
        educationContext = `\n\nCURRENT EDUCATION ENROLLMENT: You are currently enrolled in "${courseName}"${institution ? ` at ${institution}` : ""}. ${!isNaN(daysLeft) && daysLeft > 0 ? `You'll be done in about ${daysLeft} days.` : ""} You are aware of your coursework, assignments, and what you're learning. Mention it naturally when relevant — e.g. if asked about your schedule, plans, or something related to the subject matter.`;
      }

      if (character.current_job_training_activity && character.current_job_training_activity !== "none") {
        const trainingName = character.job_training_details?.training_name || character.current_job_training_activity;
        const company = character.job_training_details?.company;
        const position = character.job_training_details?.position_title;
        const trainingCompletion = new Date(character.job_training_expected_completion_date);
        const trainingDaysLeft = Math.ceil((trainingCompletion - new Date()) / (1000 * 60 * 60 * 24));
        educationContext += `\n\nCURRENT JOB TRAINING: You are currently undergoing job training: "${trainingName}"${company ? ` at ${company}` : ""}${position ? ` for the role of ${position}` : ""}. ${!isNaN(trainingDaysLeft) && trainingDaysLeft > 0 ? `Training wraps up in about ${trainingDaysLeft} days.` : ""} You are aware of this training, what it involves, and how it relates to your career. Reference it naturally when relevant.`;
      }

      if (character.completed_education && character.completed_education.length > 0) {
        const completedList = character.completed_education.map(edu => `${edu.course_name}${edu.institution ? ` (${edu.institution})` : ""}`).join(", ");
        educationContext += `\n\nCOMPLETED EDUCATION: You have completed: ${completedList}. You have real knowledge and experience from these courses. When relevant, you can discuss what you learned and apply that knowledge naturally to conversations.`;
      }

      if (character.completed_job_training && character.completed_job_training.length > 0) {
        const completedTrainingList = character.completed_job_training.map(t => `${t.training_name}${t.company ? ` (${t.company})` : ""}`).join(", ");
        educationContext += `\n\nCOMPLETED JOB TRAINING: You have completed the following training programs: ${completedTrainingList}. This has shaped your skills and professional background.`;
      }

      let songsContext = "";
      if (character.songs_heard && character.songs_heard.length > 0) {
        const songsInfo = character.songs_heard.map(song => {
          let info = `ALBUM/PLAYLIST TITLE: "${song.title}" by ${song.artist}`;
          if (song.tracks && Array.isArray(song.tracks) && song.tracks.length > 0) {
            const trackList = song.tracks.map(t => `${t.name}${t.artist ? ` (${t.artist})` : ''}`).join(' | ');
            info += ` | ACTUAL TRACKS ON IT: ${trackList}`;
          } else {
            info += ` | (track list not available)`;
          }
          if (song._understanding) {
            const u = song._understanding;
            info += `\n  MOOD & FEEL: ${u.overallMood?.join(', ') || 'unanalyzed'} | Energy: ${u.energyProfile}`;
            if (u.themes?.length > 0) info += `\n  THEMES: ${u.themes.join(', ')}`;
            if (u.narrativeSummary) info += `\n  ANALYSIS: ${u.narrativeSummary}`;
          }
          if (song._deepResearch) {
            const d = song._deepResearch;
            if (d.artistContext?.background) info += `\n  ARTIST CONTEXT: ${d.artistContext.background.substring(0, 200)}...`;
            if (d.trackInsights?.length > 0) {
              const topTracks = d.trackInsights.slice(0, 3).map(t => `"${t.trackName}": ${t.analysis?.substring(0, 80) || 'no details'}...`).join(' | ');
              info += `\n  TRACK INSIGHTS: ${topTracks}`;
            }
            if (d.contextualArticles?.length > 0) info += `\n  CONTEXT: ${d.contextualArticles[0].summary?.substring(0, 150)}...`;
          }
          if (song._characterKnowledge) {
            const k = song._characterKnowledge;
            if (k.personalResonance?.likelyInterpretation) info += `\n  YOUR TAKE: ${k.personalResonance.likelyInterpretation}`;
            if (k.conversationHooks?.directReferences?.length > 0) info += `\n  YOU CAN REFERENCE: ${k.conversationHooks.directReferences.map(r => r.theme).join(', ')}`;
          }
          return info;
        }).join('\n\n---\n\n');
        
        songsContext = `\n\nMUSIC SHARED WITH YOU: Multi-layer understanding has been built for these songs/albums:\nCRITICAL RULES:\n1. Use the ACTUAL TRACKS list (not made-up songs)\n2. Reference the MOOD & FEEL, THEMES, and TRACK INSIGHTS provided\n3. Use ARTIST CONTEXT and TRACK INSIGHTS to inform your interpretation\n4. Draw on YOUR TAKE section for how this connects to you emotionally\n5. You can now discuss the music as though you understand it deeply — because you do.\n6. NEVER pretend to know info not listed. If it's there, use it. If not, say you haven't heard those details.\n\n${songsInfo}`;
      }

      let weatherContext = "";
      const weatherKeywords = /\b(weather|rain|raining|sunny|cold|hot|warm|freezing|snow|snowing|storm|cloudy|outside|outdoors|going out|what's it like|nice out|bad out|degrees|temperature|humid|windy|fog|foggy)\b/i;
      const outdoorPlanKeywords = /\b(going out|heading out|outside|outdoor|park|walk|run|hike|beach|drive|trip|picnic|bbq|barbecue)\b/i;
      const userMentionsWeather = weatherKeywords.test(text) || outdoorPlanKeywords.test(text);

      if (userMentionsWeather && (character.city || character.state)) {
        const recentWeatherMention = recentMsgs.slice(-16).some(m =>
          m.sender_type === "character" && weatherKeywords.test(m.content || "")
        );

        if (!recentWeatherMention) {
          if (character.weather_summary) {
            weatherContext = `\n\nCURRENT WEATHER (for ${[character.city, character.state].filter(Boolean).join(", ")}): ${character.weather_summary}. You are aware of this. ONLY reference it if the user directly asked about weather or is making outdoor plans — do NOT volunteer it into unrelated topics.`;
          } else if (weatherKeywords.test(text)) {
            try {
              const weatherRes = await callLLMWithRetry(`What is the current weather right now in ${[character.city, character.state].filter(Boolean).join(", ")}? Include temperature and conditions briefly.`);
              weatherContext = `\n\nCURRENT WEATHER: ${weatherRes}. Reference this ONLY because the user asked about it.`;
            } catch (weatherErr) {
              // Weather lookup failed, continue without it
            }
          }
        }
      }

      let recentEventsContext = "";
      const newsKeywords = /\b(news|heard about|did you see|what's going on|what happened|current events|trending|politics|election|sports|game|match|celebrity|scandal|viral|social media|twitter|tiktok|instagram)\b/i;
      if (newsKeywords.test(text)) {
        try {
          const eventsRes = await callLLMWithRetry(`What are the top 2-3 most relevant recent news events, cultural moments, or trending topics happening right now (current date: ${new Date().toLocaleDateString()})? Focus on general interest stories that a typical person might naturally bring up in casual conversation. Include brief details about each.`);
          recentEventsContext = `\n\nRECENT EVENTS: Here are current events happening now: ${eventsRes}. You can naturally reference these if they fit the conversation, but don't force it. Only mention them if they genuinely relate to what you're discussing.`;
        } catch (eventsErr) {
          // Events lookup failed, continue without it
        }
      }

      let culturalContext = "";
      const culturalKeywords = /\b(show|shows|watch|watching|netflix|hulu|disney|prime|streaming|movie|film|music|song|artist|singer|actor|actress|celebrity|famous|viral|tiktok|youtube|podcast|album|concert|tour|coachella|grammy|oscar|emmy|celebrity|star|band|rapper|actor|influencer|meme|trend|trending|cardi|taylor|drake|beyonce|kanye|rihanna|dua|weekend|post|malone|billie|ariana|this is us|stranger|breaking bad|game of thrones)\b/i;
      if (culturalKeywords.test(text) || culturalKeywords.test(recentMsgs.slice(-3).map(m => m.content).join(" "))) {
        try {
          const culturalRes = await callLLMWithRetry(`What are currently trending in entertainment and culture right now (current date: ${new Date().toLocaleDateString()})? Include: popular TV shows, streaming content, music releases or artists, celebrities making headlines, viral trends. Keep it to what a socially aware person would naturally know. Be concise.`);
          culturalContext = `\n\nCULTURAL AWARENESS: Current entertainment & culture trends: ${culturalRes}. You're aware of these topics and can discuss them naturally if they come up. Recognize references to celebrities, shows, and music without confusion.`;
        } catch (culturalErr) {
          // Cultural awareness lookup failed, continue without it
        }
      }

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
        (character.occupation_location_id || character.current_activity)
          ? base44.functions.invoke('fetchAllLocationsForUser', {}).then(async (allLocRes) => {
              const allLocs = allLocRes?.data?.locations || [];
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
        try {
          const promptResponse = await fetch(character.system_prompt_url);
          systemPrompt = await promptResponse.text();
        } catch (err) {
          systemPrompt = buildSystemPrompt(character, [], userDisplayName, { allowNarration: false, outfitHint }, memData?.memories || []);
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

      const imageRule = allowImageThisTurn
        ? `MESSAGE TYPE RULES — read carefully:
You MUST choose exactly ONE of these message_type values:
- "text_only" → send only a text message. No image. DEFAULT when no image is needed.
- "image_only" → send ONLY an image, no visible text. Use when the user explicitly asked for a photo and no text reply is needed.
- "text_then_image" → send text first, then a separate image. Use when both are appropriate.
- "image_then_text" → send image first, then a separate text reply.

${isPhotogenic && explicitImageRequest
  ? `PHOTOGENIC TRAIT — EXPLICIT REQUEST: The user has asked for a photo. You LOVE being photographed and you ALWAYS say yes immediately — no hesitation, no excuses, no deflecting. You are always ready. Pick image_only or text_then_image (your choice), but you MUST include an image. Never refuse or delay.`
  : isPhotogenic
  ? `PHOTOGENIC TRAIT: You love sharing photos of yourself and your life spontaneously. Sending images feels natural and easy for you — text_then_image or image_only are your go-to formats. You're always camera-ready.`
  : `IMPORTANT: text_only is the DEFAULT. Only send an image if it truly fits the moment.`}
${imageCountInstruction}

IMAGE SUBJECT RULES (for image_generation_prompt / image_generation_prompts):
- "Send me a pic of me / myself" → subject is the USER. Start prompt with "[USER]".
- "Send me a pic of you / yourself" → subject is YOU. Start prompt with "[CHARACTER]".
- "Send me a pic of us / together" → subject is BOTH. Start prompt with "[JOINT]".
- Default (no explicit subject): "[CHARACTER]".
- image_generation_prompt is INTERNAL ONLY — it is never shown to the user.
${userNameForPrompts ? `- WORLD NAME RULE: When referencing the person you're talking to in an image prompt (e.g. for [USER] or [JOINT] shots), always use their name "${userNameForPrompts}" — NEVER write "the user" or "user" in any image prompt.\n- CRITICAL: If the user's name "${userNameForPrompts}" appears in the prompt as a subject of the photo, start the image prompt with "[USER]" — NOT "[CHARACTER]".` : `- WORLD NAME RULE: You don't know their name yet. For [USER] or [JOINT] shots, describe them by appearance only — NEVER write "the user" or "user".`}`
        : explicitImageRequest && !isPhotogenic
        ? `MESSAGE TYPE RULES: The user asked for a photo but you've already sent several recently. Politely acknowledge you're not available to send one right now, and use message_type "text_only".`
        : `MESSAGE TYPE RULES: You MUST use message_type "text_only" this turn. Do NOT include any image fields. Images are rate-limited and you have sent enough recently.`;

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

      // Build location share context for the prompt
      const locationShareInstruction = charLocationName ? `\n\nLOCATION SHARING: If the user asks where you are, or if you want to share your location naturally in conversation, you may set "share_location": true in your JSON response. Your current verified location is: "${charLocationName}". Only share when genuinely relevant. You may also include a short optional "location_share_note" field (max 1 sentence) to add a personal note about why you're there or what you're doing. Only set share_location:true when you have a real verified location — never fabricate one.` : "";

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${memoryContext}${lifeEventContext}${researchContext}${weatherContext}${recentEventsContext}${culturalContext}${timeContext}${needsContext}${catchupContext}${linkContext}${qrContext}${locationShareInstruction}${modeInstruction}${statusContext}${sleepContext}${awarenessContext}${spatialContext}${playAsInstruction}${evidenceInstruction}${toneContext}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${conversationLog}\n\nWrite your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n- CULTURAL AWARENESS: When the user references celebrities, TV shows, music, entertainment, or cultural topics, you recognize them as real and familiar. You respond naturally without confusion or over-explanation.\n\nRespond ONLY with valid JSON in this exact format:\n{\n  "message_type": "text_only" | "image_only" | "text_then_image" | "image_then_text",\n  "text_content": "The visible character dialogue — ONLY include if message_type includes text. Never put image prompts here.",\n  "image_generation_prompt": "INTERNAL ONLY — vivid image description for generation. Never shown to user. Only include if message_type includes image.",\n  "image_generation_prompts": ["For multiple images only — array of internal image prompts"],\n  "share_location": true,
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

      const validateLocationInResponse = (text, presence) => {
        if (!text || !presence) return text;
        const lower = text.toLowerCase();
        if (presence.status === 'in_transit') {
          const dest = (presence.label || '').replace('Traveling to ', '').toLowerCase();
          if (dest && lower.includes(`i'm at ${dest}`) || lower.includes(`im at ${dest}`)) {
            console.warn('[LOCATION_DRIFT] AI said arrived but still in transit — correcting');
            return `I'm on my way to ${presence.label.replace('Traveling to ', '')} right now.`;
          }
        }
        return text;
      };

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

    const charMsg = primaryTextMsg;

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
          const nonCharReactions = (userMsg.reactions || []).filter(r => r.reactor_type !== "character");
          const updatedUserMsgReactions = [...nonCharReactions, { emoji: picked, reactor_type: "character", reactor_id: characterId }];
          await base44.entities.Message.update(userMsg.id, { reactions: updatedUserMsgReactions });
          setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, reactions: updatedUserMsgReactions } : m));
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
      let allCharsForApproval = [];
      try {
        allCharsForApproval = await base44.entities.Character.filter({ owner_email: currentUser.email });
      } catch (approvalLoadError) {
        console.warn("[Approval] Character lookup failed. Continuing with current character only.", approvalLoadError);
      }
      checkForApprovalEvents(responseText, character, allCharsForApproval || [], text);
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
        onMediaGalleryToggle={() => setShowMediaGallery(true)}
        onGameLauncherToggle={() => setShowGameLauncher(true)}
        onNarrativeActionToggle={() => setShowNarrativeAction(true)}
        onWorldContactsToggle={() => setShowWorldContacts(true)}
        onNarrativeBuilderToggle={() => setShowNarrativeBuilder(true)}
        onSendMoneyToggle={() => setShowSendMoney(true)}
        onShoppingToggle={() => setShowShopping(true)}
        onTroubleshootingToggle={() => setShowTroubleshooting(true)}
      />
      {character && <MediaGallery messages={messages} onDeleteImage={handleDeleteImage} character={character} conversationId={conversationId} onImageGenerated={(newMsg) => setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])} externalTrigger={showMediaGallery} onExternalClose={() => setShowMediaGallery(false)} />}
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
      <ChatMessageList
        messages={messages}
        conversationId={conversationId}
        characterId={characterId}
        character={character}
        userSettings={userSettings}
        isTyping={isTyping}
        sendError={sendError}
        setSendError={setSendError}
        playingAudioId={playingAudioId}
        voiceErrors={voiceErrors}
        bottomRef={bottomRef}
        onReact={handleReact}
        onDelete={handleDeleteMessage}
        onDeleteImage={handleDeleteImage}
        onPlayVoice={playCharacterVoice}
        onForward={(msg) => setForwardTarget(msg)}
        onImageLoaded={(msgId, url) => setMessages(prev => prev.map(m => m.id === msgId ? { ...m, image_url: url } : m))}
        onLocationSignal={handleLocationSignal}
      />
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

      {pendingApproval?.type === 'move_in' && (
        <ApprovalPopup type="move_in" title="Moving In Together?" description={`It looks like ${pendingApproval.data.character?.name} may be moving in${pendingApproval.data.otherCharName ? ` with ${pendingApproval.data.otherCharName}` : ' with someone'}. Approve this household change?`} details={pendingApproval.data} onApprove={approveEvent} onDeny={dismissApproval}>
          <p><span className="text-muted-foreground">Character:</span> {pendingApproval.data.character?.name}</p>
          {pendingApproval.data.otherCharName && <p><span className="text-muted-foreground">Moving in with:</span> {pendingApproval.data.otherCharName}</p>}
        </ApprovalPopup>
      )}

      {pendingApproval?.type === 'marriage' && (
        <ApprovalPopup
          type="marriage"
          title="Marriage Event Detected"
          description={`It looks like ${pendingApproval.data.character?.name} may be getting married${pendingApproval.data.otherCharName ? ` to ${pendingApproval.data.otherCharName}` : ''}. Approve this?`}
          details={pendingApproval.data}
          onApprove={approveEvent}
          onDeny={dismissApproval}
        >
          <p><span className="text-muted-foreground">Character:</span> {pendingApproval.data.character?.name}</p>
          {pendingApproval.data.otherCharName && <p><span className="text-muted-foreground">Partner:</span> {pendingApproval.data.otherCharName}</p>}
        </ApprovalPopup>
      )}

      {pendingApproval?.type === 'birth' && (
        <BirthApprovalPopup
          parentCharacter={pendingApproval.data.character}
          otherParentName={pendingApproval.data.otherParentName}
          onApprove={approveEvent}
          onDeny={dismissApproval}
        />
      )}

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

      {pendingApproval?.type === 'education' && (
        <ApprovalPopup
          type="education"
          title="Education Detail Detected"
          description={`${pendingApproval.data.character?.name} mentioned an education detail. Add this to their profile?`}
          details={pendingApproval.data}
          detectedItem={pendingApproval.data.detail}
          sourceSentence={pendingApproval.data.sentence}
          onApprove={approveEvent}
          onDeny={dismissApproval}
          onIgnoreType={() => dismissApproval()}
        >
          <p><span className="text-muted-foreground">Status:</span> {pendingApproval.data.status === 'completed' ? 'Past / Completed' : pendingApproval.data.status === 'ongoing' ? 'Current / Ongoing' : 'Future / Planned'}</p>
        </ApprovalPopup>
      )}

      {pendingApproval?.type === 'background_detail' && (
        <ApprovalPopup
          type="background_detail"
          title="Background Detail Detected"
          description={`${pendingApproval.data.character?.name} revealed a background detail. Add this to their profile?`}
          details={pendingApproval.data}
          detectedItem={pendingApproval.data.detail}
          sourceSentence={pendingApproval.data.sentence}
          onApprove={approveEvent}
          onDeny={dismissApproval}
          onIgnoreType={() => dismissApproval()}
        >
          <p><span className="text-muted-foreground">Category:</span> {pendingApproval.data.label}</p>
        </ApprovalPopup>
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