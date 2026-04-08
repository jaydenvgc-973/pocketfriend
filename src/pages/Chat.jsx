import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Wrench } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import TypingIndicator from "@/components/chat/TypingIndicator";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import MediaGallery from "@/components/chat/MediaGallery";
import MusicPreviewPlayer from "@/components/chat/MusicPreviewPlayer";
import VoiceDiagnosticsPanel from "@/components/chat/VoiceDiagnosticsPanel";
import ArchiveNotice from "@/components/chat/ArchiveNotice";
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import CharacterStatusPopup from "@/components/character/CharacterStatusPopup";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import { BarChart2, BookOpen, Globe } from "lucide-react";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import DialogueSelector from "@/components/chat/DialogueSelector";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";
import TroubleshootingPanel from "@/components/chat/TroubleshootingPanel";
import DeleteMemoryChoiceModal from "@/components/chat/DeleteMemoryChoiceModal";
import ForwardMessageModal from "@/components/chat/ForwardMessageModal";
import GameLauncher from "@/components/games/GameLauncher";
import ApprovalPopup from "@/components/approvals/ApprovalPopup";
import BirthApprovalPopup from "@/components/approvals/BirthApprovalPopup";
import { useApprovalEvents } from "@/hooks/useApprovalEvents";
import {
  getCharacterStatus,
  getChatDelayMs,
  getTextDelayMs,
  getTextSystemMessage,
  buildStatusPromptContext,
  buildSleepInterruptionContext,
} from "@/lib/responseTimingUtils";
import { filterDashes } from "@/lib/dashFilter";

// Voice playback cache and active audio tracking
const voiceCache = new Map();
const activeAudioRef = new Map(); // messageId -> Audio element

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
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [voiceErrors, setVoiceErrors] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null); // message pending delete choice
  const [forwardTarget, setForwardTarget] = useState(null); // message pending forward

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

  const { data: settings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const userSettings = settings?.[0] || {};

  // CORE VOICE PLAYBACK FUNCTION - This is the single source of truth for all voice playback
  const playCharacterVoice = async (messageId, text, characterData, userSettings, bypassCache = false) => {
    // DIAGNOSTIC: Log everything from the start
    const diagnosticId = `[VOICE-${messageId.substring(0, 8)}]`;
    
    console.log(`${diagnosticId} VOICE PLAYBACK INITIATED`);
    console.log(`${diagnosticId} messageId: ${messageId}`);
    console.log(`${diagnosticId} text source: ${text ? `"${text.substring(0, 100)}..."` : 'MISSING'}`);
    console.log(`${diagnosticId} text from message.content (final saved chat text)`);
    console.log(`${diagnosticId} characterData.name: ${characterData?.name}`);
    console.log(`${diagnosticId} characterData.voice_name: ${characterData?.voice_name}`);
    console.log(`${diagnosticId} userSettings.voice_enabled: ${userSettings?.voice_enabled}`);
    console.log(`${diagnosticId} userSettings.openai_api_key present: ${!!userSettings?.openai_api_key}`);
    
    if (!messageId || !text || !characterData || !userSettings) {
      console.warn(`${diagnosticId} ABORT: Missing critical parameters`, { 
        messageId: !!messageId, 
        text: !!text, 
        characterData: !!characterData, 
        userSettings: !!userSettings 
      });
      setPlayingAudioId(null);
      return;
    }

    try {
      setVoiceErrors(prev => ({ ...prev, [messageId]: null }));
      setPlayingAudioId(messageId);

      // Step 1: Check conditions
      const voiceGloballyEnabled = userSettings?.voice_enabled === true;
      const charHasVoice = characterData?.voice_enabled === true && characterData?.voice_name;
      const hasApiKey = userSettings?.openai_api_key;
      const isNotPhone = chatType !== "phone";

      console.log(`${diagnosticId} CONDITION CHECK:`);
      console.log(`${diagnosticId}   - voice_enabled (global): ${voiceGloballyEnabled}`);
      console.log(`${diagnosticId}   - character.voice_enabled: ${characterData?.voice_enabled}`);
      console.log(`${diagnosticId}   - character.voice_name: ${characterData?.voice_name}`);
      console.log(`${diagnosticId}   - API key present: ${hasApiKey ? 'YES' : 'NO'}`);
      console.log(`${diagnosticId}   - chatType !== 'phone': ${isNotPhone} (chatType=${chatType})`);

      if (!voiceGloballyEnabled) {
        console.log(`${diagnosticId} ABORT: voice_enabled is false at user settings level`);
        setPlayingAudioId(null);
        return;
      }
      
      if (!charHasVoice) {
        console.log(`${diagnosticId} ABORT: character voice not enabled or no voice_name`);
        setPlayingAudioId(null);
        return;
      }
      
      if (!hasApiKey) {
        console.log(`${diagnosticId} ABORT: No OpenAI API key found`);
        setPlayingAudioId(null);
        return;
      }
      
      if (!isNotPhone) {
        console.log(`${diagnosticId} ABORT: Phone chat mode, voice disabled`);
        setPlayingAudioId(null);
        return;
      }

      console.log(`${diagnosticId} ✓ All conditions passed`);

      // Step 2: Check cache first
      const cacheKey = `${characterData.id}_${characterData.voice_name}_${text}`;
      let audioUrl = voiceCache.get(cacheKey);

      if (audioUrl && !bypassCache) {
        console.log(`${diagnosticId} CACHE HIT: Using previously generated audio`);
        await playAudio(messageId, audioUrl);
        return;
      }

      if (audioUrl && bypassCache) {
        console.log(`${diagnosticId} Cache bypassed - forcing regeneration`);
      }

      // Step 3: Generate speech
      console.log(`${diagnosticId} GENERATING SPEECH via OpenAI TTS`);
      console.log(`${diagnosticId}   - text to speak: "${text.substring(0, 150)}${text.length > 150 ? '...' : ''}"`);
      console.log(`${diagnosticId}   - voice: ${characterData.voice_name}`);
      console.log(`${diagnosticId}   - voice_style_note: ${characterData.voice_style_note || '(none)'}`);
      
      const res = await base44.functions.invoke('generateSpeech', {
        text: text,
        voice: characterData.voice_name,
        voiceStyleNote: characterData.voice_style_note,
        apiKey: userSettings.openai_api_key,
      });

      console.log(`${diagnosticId} generateSpeech response:`, res?.data ? 'SUCCESS' : 'FAILED');

      if (!res?.data?.audioUrl) {
        throw new Error('No audio URL returned from generateSpeech');
      }

      audioUrl = res.data.audioUrl;
      voiceCache.set(cacheKey, audioUrl);

      console.log(`${diagnosticId} ✓ Audio generated successfully (${(audioUrl.length / 1024).toFixed(1)}KB)`);

      // Step 4: Verify stored audio URL (now a proper file URL, not base64)
      console.log(`${diagnosticId} VERIFYING audio URL before storage...`);
      console.log(`${diagnosticId} Audio URL type: ${typeof audioUrl}`);
      console.log(`${diagnosticId} Audio URL length: ${audioUrl.length} chars (within database field limit)`);
      console.log(`${diagnosticId} Audio URL is valid file URL: ${audioUrl.startsWith('http')}`);
      console.log(`${diagnosticId} Audio URL preview: ${audioUrl.substring(0, 80)}...`);

      // Step 5: Save audio to message
      console.log(`${diagnosticId} SAVING audio URL to message entity...`);
      await base44.entities.Message.update(messageId, { audio_url: audioUrl });
      console.log(`${diagnosticId} ✓ Audio URL saved to message.audio_url`);

      // Step 6: Update usage tracking
      const estimatedMinutes = res.data.estimatedMinutes || 0.1;
      if (userSettings.id) {
        base44.entities.UserSettings.update(userSettings.id, {
          voice_minutes_used: (userSettings.voice_minutes_used || 0) + estimatedMinutes,
        }).catch(() => {});
      }

      // Step 7: Play audio from stored URL
      console.log(`${diagnosticId} PLAYING audio from stored URL...`);
      await playAudio(messageId, audioUrl);
      console.log(`${diagnosticId} ✓ Playback complete`);

    } catch (err) {
      console.error(`${diagnosticId} ✗ ERROR:`, err.message);
      setVoiceErrors(prev => ({ ...prev, [messageId]: err.message }));
      setPlayingAudioId(null);
    }
  };

  // Helper function to actually play audio
  const playAudio = async (messageId, audioUrl) => {
    const diagnosticId = `[PLAYBACK-${messageId.substring(0, 8)}]`;
    
    return new Promise((resolve) => {
      try {
        console.log(`${diagnosticId} Creating Audio element from: ${audioUrl.substring(0, 50)}...`);
        
        // Stop any existing audio for this message
        const existingAudio = activeAudioRef.get(messageId);
        if (existingAudio) {
          console.log(`${diagnosticId} Stopping previous audio for this message`);
          existingAudio.pause();
          existingAudio.currentTime = 0;
        }

        const audio = new Audio(audioUrl);
        activeAudioRef.set(messageId, audio);
        console.log(`${diagnosticId} Audio element created and registered`);

        audio.onended = () => {
          console.log(`${diagnosticId} ✓ Playback finished`);
          activeAudioRef.delete(messageId);
          setPlayingAudioId(null);
          resolve();
        };

        audio.onerror = (err) => {
          console.error(`${diagnosticId} ✗ Audio playback error:`, err);
          activeAudioRef.delete(messageId);
          setPlayingAudioId(null);
          resolve();
        };

        console.log(`${diagnosticId} Calling audio.play()...`);
        audio.play().then(() => {
          console.log(`${diagnosticId} ✓ Play promise resolved, audio streaming`);
        }).catch(err => {
          console.error(`${diagnosticId} ✗ Play failed:`, err.message);
          activeAudioRef.delete(messageId);
          setPlayingAudioId(null);
          resolve();
        });
      } catch (err) {
        console.error(`${diagnosticId} ✗ Audio setup error:`, err);
        setPlayingAudioId(null);
        resolve();
      }
    });
  };



  const { data: currentUser = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // Initialize voice settings on first load
  useEffect(() => {
    base44.functions.invoke('initializeVoiceSettings', {}).catch(() => {});
  }, []);

  useEffect(() => {
    if (!characterId || !character || !currentUser.email) return;
    
    // Reset state immediately when switching characters to prevent cross-contamination
    isMountedRef.current = true; // re-arm for this character session
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    
    const loadConvo = async () => {
      try {
        // Fetch conversations for this character
        // STRICT ISOLATION: for direct/phone, only use conversations where character_ids contains
        // EXACTLY this one character (length === 1). This prevents cross-character contamination.
        const allConvos = await base44.entities.Conversation.filter(
          { type: chatType, character_ids: [characterId], created_by: currentUser.email },
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
          // Protected characters (e.g. Ethan) load ALL messages; others load recent 50
          const PROTECTED_CHARACTER_IDS = ['69c0d59d7e382cc866ded9c9'];
          const isProtected = PROTECTED_CHARACTER_IDS.includes(characterId);
          const msgLimit = isProtected ? 1000 : 50;
          const loadedMsgs = await base44.entities.Message.filter(
            { conversation_id: convoId },
            "-created_date",
            msgLimit
          );
          
          if (loadedMsgs && loadedMsgs.length > 0) {
            // Reverse to chronological order for display
            setMessages(loadedMsgs.reverse());
            setConversationId(convoId);

            // Mark unread character messages as read (fire-and-forget)
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
          // Create conversation if none exists
          const convo = await base44.entities.Conversation.create({
            title: `${chatType} with ${character.name}`,
            type: chatType,
            character_ids: [characterId],
          });
          setConversationId(convo.id);
        }

        // Load pending messages and deliver them
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
            
            // Add slight delay between deliveries
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

    // Unsubscribe from previous subscription
    if (unsubscribeRef.current) unsubscribeRef.current();

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      // Only process events for this conversation and character combo
      if (event.data?.conversation_id !== conversationId) return;

      if (event.type === "create") {
        setMessages(prev => {
          // Prevent duplicates: check if message already exists
          if (prev.some(m => m.id === event.data.id)) return prev;
          return [...prev, event.data];
        });
        
        // Auto-mark character messages as read
        if (event.data.sender_type === "character" && !event.data.is_read) {
          base44.entities.Message.update(event.data.id, { is_read: true }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
        }
      } else if (event.type === "update") {
        // Update existing message without losing state
        setMessages(prev => prev.map(m => m.id === event.data.id ? { ...m, ...event.data } : m));
      } else if (event.type === "delete") {
        // Remove deleted messages
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

  // FORCE-TO-ZERO: When page opens and we have a conversation + messages loaded,
  // call backend markThreadRead for instant, authoritative clearing.
  // Awaits backend, verifies success, updates local state, invalidates badge.
  useEffect(() => {
    if (!conversationId) return;

    let isMounted = true;

    (async () => {
      try {
        // BACKEND CALL — authoritative. Handles any unread messages in DB (not just local)
        const res = await base44.functions.invoke('markThreadRead', { conversationId, characterId });

        if (!isMounted) return;

        const markedCount = res?.data?.marked_read || 0;
        const finalUnread = res?.data?.final_unread_count || 0;

        console.log(`[BADGE] Backend markThreadRead returned: marked=${markedCount} | finalUnread=${finalUnread} | conversationId=${conversationId}`);

        // Update local state to match backend reality
        setMessages(prev => prev.map(m =>
          m.sender_type === "character" ? { ...m, is_read: true } : m
        ));

        // CRITICAL: Invalidate conversations query so CharacterCard recounts
        // This forces CharacterCard.countUnread() to run again and see zero unread
        queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });

        console.log(`[BADGE] Conversation ${conversationId} marked as read. CharacterCard will recount on next render.`);
      } catch (err) {
        console.error(`[BADGE] markThreadRead failed:`, err.message);
        // Still update local state even if backend call failed
        if (isMounted) {
          setMessages(prev => prev.map(m =>
            m.sender_type === "character" && !m.is_read ? { ...m, is_read: true } : m
          ));
          queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [conversationId]);

  useEffect(() => {
    // Only auto-scroll to bottom on initial load (empty messages becoming populated)
    // or when user is already at the bottom, not when they manually scrolled up
    if (!userScrolledAway) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length > 0 && messages[messages.length - 1]?.id, userScrolledAway]); // Only react to new messages when already at bottom

  // Detect when user scrolls away from bottom
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

  // Step 1: User taps delete — show memory-choice modal instead of deleting immediately
  const handleDeleteMessage = (messageId) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    setDeleteTarget(msg);
  };

  // Step 2a: "Remember this" — remove from visible thread, keep in memory/archive
  const handleDeleteRemember = async () => {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;

    console.log(`[DELETE] messageId=${msg.id} | threadId=${conversationId} | pageType=${isPhone ? "text" : "chat"} | action=remember | removed_from_view=yes | retained_in_memory=yes`);

    // Archive (hide from thread) without deleting — sets archived_date so it's not visible
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    await base44.entities.Message.update(msg.id, {
      archived_date: new Date().toISOString(),
    }).catch(() => {});
  };

  // Step 2b: "Forget this" — remove from visible thread AND mark as forgotten in memory
  const handleDeleteForget = async () => {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;

    console.log(`[DELETE] messageId=${msg.id} | threadId=${conversationId} | pageType=${isPhone ? "text" : "chat"} | action=forget | removed_from_view=yes | retained_in_memory=no | memory_excluded=yes`);

    // Remove from local state
    setMessages(prev => prev.filter(m => m.id !== msg.id));

    // Delete the message entity entirely (removes it as a memory source)
    await base44.entities.Message.delete(msg.id).catch(() => {});

    // If the message has meaningful content, store a "forgotten" marker memory so the
    // character knows NOT to reference this. Fire-and-forget.
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
    // Update message to remove image_url but keep content
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

    // One reaction per user per message: toggle off if same, replace if different
    const nonUserReactions = currentReactions.filter(r => r.reactor_type !== "user");
    const updatedReactions = isSameEmoji
      ? nonUserReactions  // remove reaction
      : [...nonUserReactions, { emoji, reactor_type: "user", reactor_id: "user" }];  // replace/set

    // Optimistic update
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: updatedReactions } : m));
    await base44.entities.Message.update(messageId, { reactions: updatedReactions });

    // If user reacted (not removed) to a character's message, trigger relationship update
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
    }
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
      // Both single song AND playlist: use res.data.songs (array) or fall back to res.data.song (single)
      msgData.songs_heard = res.data.songs?.length > 0
        ? res.data.songs
        : res.data.song
        ? [res.data.song]
        : [];
    }

     console.log('[handleShareSong] Creating message with:', msgData);
     const newMsg = await base44.entities.Message.create(msgData);
     console.log('[handleShareSong] Message created:', newMsg?.id);
     console.log('[handleShareSong] Returned message has:', { songs: newMsg?.songs_heard?.length, videos: newMsg?.videos_watched?.length });

     // Always update conversation and refresh queries
     await base44.entities.Conversation.update(conversationIdRef.current, {
       last_message_preview: msgData.content,
       last_message_date: new Date().toISOString(),
     });
     queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });

     // Add to local state immediately
     if (isMountedRef.current) {
       console.log('[handleShareSong] Adding to local state:', newMsg?.id);
       setMessages(prev => [...prev, newMsg]);
     }

     // Trigger deep media research & character knowledge building (non-blocking)
     if (msgData.songs_heard?.length > 0) {
       msgData.songs_heard.forEach(song => {
         // Layer 1: Analyze media understanding
         base44.functions.invoke('analyzeMediaUnderstanding', {
           mediaObject: song,
           sources: {},
         }).then(res1 => {
           const understanding = res1?.data?.understanding;

           // Layer 2: Deep research on artist, tracks, context
           base44.functions.invoke('deepMediaResearch', {
             mediaObject: song,
             tracks: song.tracks || [],
           }).then(res2 => {
             const deepResearch = res2?.data?.deepResearch;

             // Layer 3: Build character-specific knowledge
             base44.functions.invoke('buildCharacterMediaKnowledge', {
               character,
               mediaObject: song,
               understanding,
               deepResearch,
             }).then(res3 => {
               const knowledge = res3?.data?.knowledge;

               // Store all layers on message for character & narrative access
               base44.entities.Message.update(newMsg.id, {
                 songs_heard: msgData.songs_heard.map(s => 
                   s.spotify_id === song.spotify_id 
                     ? { 
                         ...s, 
                         _understanding: understanding,
                         _deepResearch: deepResearch,
                         _characterKnowledge: knowledge,
                       }
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

    // Fix: command — treat as admin backend directive, do NOT store or process as chat
    if (text.trim().toLowerCase().startsWith("fix:")) {
      const directive = text.trim().slice(4).trim();
      // Just acknowledge silently — no message stored, no memory, no narrative
      console.info("[Fix: directive]", directive);
      return;
    }

    // Check for music platform links (Spotify, Apple Music, YouTube Music, Amazon Music, Tidal, SoundCloud, etc.)
    const musicLinkMatch = text.match(/https?:\/\/[^\s]*(spotify\.com|apple\.com\/.*music|music\.apple\.com|music\.youtube\.com|amazon\.com\/music|music\.amazon|tidal\.com|soundcloud\.com|bandcamp\.com)[^\s]*/i);
    if (musicLinkMatch) {
      await handleShareSong(musicLinkMatch[0], false);
      return; // Don't generate character response for media links
    }

    // Check for video links (YouTube, Vimeo, TikTok, Instagram, Twitch, etc.)
    const videoLinkMatch = text.match(/https?:\/\/[^\s]*(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitch\.tv|dailymotion\.com)[^\s]*/i);
    if (videoLinkMatch) {
      await handleShareSong(videoLinkMatch[0], true);
      return; // Don't generate character response for media links
    }

    // Check if user is asking character to look something up
    const lookupMatch = text.match(/(?:look up|search|find out|what.*about|can you.*find|research)[\s:]*(.*?)(?:\?|$)/i);

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
    // Message is persisted to database immediately, subscription will add it if needed
    setMessages(prev => prev.some(m => m.id === userMsg.id) ? prev : [...prev, userMsg]);

    // Award $5 income for sending a message (fire-and-forget)
    base44.functions.invoke('processUserIncome', { mode: 'message' }).catch(() => {});

    // TEXT MODE: Insert status system message immediately if applicable
    if (isPhone) {
      const sysMsg = getTextSystemMessage(character);
      if (sysMsg) {
        // PERSIST the status message to DB so it survives navigation
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

      // If asleep in text mode — schedule wake-up reply and stop here
      if (getCharacterStatus(character) === 'asleep') {
        console.log(`[TIMING] TEXT blocked — character is asleep. Scheduling wake-up reply.`);
        
        // Schedule a wake-up follow-up autonomy event
        const wakeTime = character.wake_up_time || '07:00';
        const now = new Date();
        const [wakeHour, wakeMin] = wakeTime.split(':').map(Number);
        const wakeDate = new Date(now);
        wakeDate.setHours(wakeHour, wakeMin, 0, 0);
        // If wake time is in the past (e.g. it's 10am and wake is 7am), schedule for tomorrow
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

    // Exponential backoff retry for rate limits — defined here so it's available throughout sendMessage
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
    try {
      if (!isMountedRef.current) {
        console.warn('[sendMessage] Component unmounted, aborting message send');
        return;
      }

      recentMsgs = [...messages.slice(-50), userMsg];
      const chatHistory = recentMsgs.map(m => ({
        role: m.sender_type === "user" ? "user" : "assistant",
        content: m.content,
        // Track who the "user" slot actually represents for prompt labeling
        _speakerName: m.sender_type === "user" ? (activeCharacter?.name || "User") : character.name,
      }));

      const userSettings = settings?.[0] || {};
      const lengthInstruction = { short: "Keep responses to 1-2 sentences max.", medium: "Keep responses natural length, 1-4 sentences.", long: "You can elaborate more, up to a paragraph." }[userSettings.response_length || "medium"];
      const intensityInstruction = { low: "React with mild emotional responses.", medium: "React naturally with moderate emotional responses.", high: "React with strong, intense emotional responses." }[userSettings.emotional_intensity || "medium"];

      const nowISO = new Date().toISOString();
      const nowDisplay = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
      const timeContext = `\n\nCURRENT DATE & TIME: ${nowDisplay}\nYou are aware of the current time. If the user or you mention plans, events, or actions at a specific time (e.g. "I'll pick you up at 1pm", "see you tonight at 8"), you naturally reference the actual time and treat those plans as real commitments that will happen.`;

      let educationContext = "";
      if (character.current_education_activity && character.current_education_activity !== "none") {
        const completionDate = new Date(character.education_expected_completion_date);
        const daysLeft = Math.ceil((completionDate - new Date()) / (1000 * 60 * 60 * 24));
        educationContext = `\n\nCURRENT LEARNING: You are currently studying ${character.current_education_activity}${character.education_details?.institution ? ` at ${character.education_details.institution}` : ""}. You'll be done in about ${daysLeft} days. Naturally mention your studies, classes, or what you're learning when relevant to the conversation.`;
      }

      if (character.completed_education && character.completed_education.length > 0) {
        const completedList = character.completed_education.map(edu => `${edu.course_name}${edu.institution ? ` (${edu.institution})` : ""}`).join(", ");
        educationContext += `\n\nCOMPLETED EDUCATION: You have completed: ${completedList}. You have real knowledge and experience from these courses. When relevant, you can discuss what you learned and apply that knowledge naturally to conversations.`;
      }

      let songsContext = "";
      if (character.songs_heard && character.songs_heard.length > 0) {
        console.log('[DEBUG] songs_heard:', JSON.stringify(character.songs_heard, null, 2));
        const songsInfo = character.songs_heard.map(song => {
          let info = `ALBUM/PLAYLIST TITLE: "${song.title}" by ${song.artist}`;
          
          // Layer 1: Track list
          if (song.tracks && Array.isArray(song.tracks) && song.tracks.length > 0) {
            const trackList = song.tracks.map(t => `${t.name}${t.artist ? ` (${t.artist})` : ''}`).join(' | ');
            info += ` | ACTUAL TRACKS ON IT: ${trackList}`;
          } else {
            info += ` | (track list not available)`;
          }

          // Layer 2: Music understanding (mood, themes, energy)
          if (song._understanding) {
            const understanding = song._understanding;
            info += `\n  MOOD & FEEL: ${understanding.overallMood?.join(', ') || 'unanalyzed'} | Energy: ${understanding.energyProfile}`;
            if (understanding.themes?.length > 0) {
              info += `\n  THEMES: ${understanding.themes.join(', ')}`;
            }
            if (understanding.narrativeSummary) {
              info += `\n  ANALYSIS: ${understanding.narrativeSummary}`;
            }
          }

          // Layer 3: Deep research (artist intent, track context, critical info)
          if (song._deepResearch) {
            const deep = song._deepResearch;
            if (deep.artistContext?.background) {
              info += `\n  ARTIST CONTEXT: ${deep.artistContext.background.substring(0, 200)}...`;
            }
            if (deep.trackInsights && deep.trackInsights.length > 0) {
              const topTracks = deep.trackInsights.slice(0, 3).map(t => 
                `"${t.trackName}": ${t.analysis?.substring(0, 80) || 'no details'}...`
              ).join(' | ');
              info += `\n  TRACK INSIGHTS: ${topTracks}`;
            }
            if (deep.contextualArticles?.length > 0) {
              info += `\n  CONTEXT: ${deep.contextualArticles[0].summary?.substring(0, 150)}...`;
            }
          }

          // Layer 4: Character-specific knowledge (resonance, interpretation)
          if (song._characterKnowledge) {
            const knowledge = song._characterKnowledge;
            if (knowledge.personalResonance?.likelyInterpretation) {
              info += `\n  YOUR TAKE: ${knowledge.personalResonance.likelyInterpretation}`;
            }
            if (knowledge.conversationHooks?.directReferences?.length > 0) {
              info += `\n  YOU CAN REFERENCE: ${knowledge.conversationHooks.directReferences.map(r => r.theme).join(', ')}`;
            }
          }

          return info;
        }).join('\n\n---\n\n');
        
        songsContext = `\n\nMUSIC SHARED WITH YOU: Multi-layer understanding has been built for these songs/albums:
CRITICAL RULES:
1. Use the ACTUAL TRACKS list (not made-up songs)
2. Reference the MOOD & FEEL, THEMES, and TRACK INSIGHTS provided
3. Use ARTIST CONTEXT and TRACK INSIGHTS to inform your interpretation
4. Draw on YOUR TAKE section for how this connects to you emotionally
5. You can now discuss the music as though you understand it deeply — because you do.
6. NEVER pretend to know info not listed. If it's there, use it. If not, say you haven't heard those details.

${songsInfo}`;
      }

      // Weather context — only inject when user explicitly mentions weather or outdoor plans
      // STRICT RULES: no repetition within 8 hours, no injection into unrelated topics
      let weatherContext = "";
      const weatherKeywords = /\b(weather|rain|raining|sunny|cold|hot|warm|freezing|snow|snowing|storm|cloudy|outside|outdoors|going out|what's it like|nice out|bad out|degrees|temperature|humid|windy|fog|foggy)\b/i;
      const outdoorPlanKeywords = /\b(going out|heading out|outside|outdoor|park|walk|run|hike|beach|drive|trip|picnic|bbq|barbecue)\b/i;
      const userMentionsWeather = weatherKeywords.test(text) || outdoorPlanKeywords.test(text);

      if (userMentionsWeather && (character.city || character.state)) {
        // Check if weather was mentioned recently in the last 8 messages (proxy for 8 hours)
        const recentWeatherMention = recentMsgs.slice(-16).some(m =>
          m.sender_type === "character" && weatherKeywords.test(m.content || "")
        );

        if (!recentWeatherMention) {
          // Only inject weather if user is asking about it or discussing outdoor plans
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
        // If weather was already mentioned recently, silently skip — no injection
      }
      // If user didn't mention weather at all — NO weather context is injected at all

      // Fetch recent events ONLY if conversation seems news/current-events-related
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

      // Cultural & Entertainment Awareness: Detect if user references entertainment/culture
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

      // Detect frequented places and update emotional state asynchronously (non-blocking)
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

      // Perform web lookup asynchronously if user asked for one (non-blocking)
      if (lookupMatch && lookupMatch[1]) {
        const query = lookupMatch[1].trim();
        base44.functions.invoke('performWebLookup', { characterId, searchQuery: query }).catch(() => {});
      }

      // ── PARALLEL context fetching — run all async lookups simultaneously ──
      const [memoryResult, lifeEventsResult, pastLookupsResult, spatialResult] = await Promise.all([
        // Memory retrieval
        base44.functions.invoke('retrieveActiveMemory', {
          characterId,
          currentMessage: text,
          recentMessages: recentMsgs.slice(-6),
          topK: 14,
        }).catch(async () => {
          // Fallback: direct query
          const mems = await base44.entities.Memory.filter({ character_id: characterId }, "-timestamp", 12).catch(() => []);
          return { data: { memories: mems, total: mems.length, _fallback: true } };
        }),
        // Life events
        base44.entities.LifeEvent.filter({ character_id: characterId }, "-timestamp", 8).catch(() => []),
        // Web lookups
        base44.entities.WebLookup.filter({ character_id: characterId }, "-lookup_date", 10).catch(() => []),
        // Spatial awareness
        (character.occupation_location_id || character.current_activity)
          ? base44.functions.invoke('fetchAllLocationsForUser', {}).then(async (allLocRes) => {
              const allLocs = allLocRes?.data?.locations || [];
              const allActiveChars = await base44.entities.Character.filter({ created_by: currentUser.email, status: 'active' });
              const { buildSpatialOccupancyMap, buildSpatialContextString } = await import('@/lib/spatialAwareness.js');
              const occupancyMap = buildSpatialOccupancyMap(allActiveChars, allLocs);
              return buildSpatialContextString(characterId, occupancyMap, allLocs) || null;
            }).catch(() => null)
          : Promise.resolve(null),
      ]);

      // Build memory context
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

      // Build life event context
      let lifeEventContext = "";
      const recentLifeEvents = Array.isArray(lifeEventsResult) ? lifeEventsResult : [];
      if (recentLifeEvents.length > 0) {
        const negEvents = recentLifeEvents.filter(e => e.valence === "negative");
        const posEvents = recentLifeEvents.filter(e => e.valence === "positive");
        const eventLines = recentLifeEvents.map(e => `- [${e.valence}] ${e.title}`).join("\n");
        let behaviorNote = "";
        if (negEvents.filter(e => e.event_type === "substance_use_event").length >= 2) behaviorNote += " You've been drinking more than usual lately.";
        if (negEvents.filter(e => e.event_type === "grief_event").length >= 1) behaviorNote += " You're carrying grief right now.";
        if (negEvents.filter(e => ["conflict_event","fight_event"].includes(e.event_type)).length >= 2) behaviorNote += " You've had repeated conflict recently.";
        if (posEvents.filter(e => ["growth_event","healthy_choice_event","recovery_event"].includes(e.event_type)).length >= 2) behaviorNote += " You've been in a good place lately.";
        lifeEventContext = `\n\nRECENT LIFE EVENTS:\n${eventLines}${behaviorNote ? "\n\nBEHAVIORAL NOTE:" + behaviorNote : ""}`;
      }

      // Build research context
      let researchContext = "";
      const pastLookups = Array.isArray(pastLookupsResult) ? pastLookupsResult : [];
      if (pastLookups.length > 0) {
        const researchInfo = pastLookups.map(l => `"${l.search_query}" - Found: "${l.title}" by ${l.author_source}. Key info: ${l.summary}`).join("\n");
        researchContext = `\n\nTHINGS YOU'VE LOOKED UP:\n${researchInfo}`;
      }

      // Build spatial context
      let spatialContext = "";
      if (spatialResult) {
        spatialContext = `\n\nSPATIAL AWARENESS: ${spatialResult} If the conversation naturally touches on being somewhere or running into someone, you can acknowledge this shared presence.`;
      }

      const userDisplayName = userSettings.fictional_world_name || null;
      const systemPrompt = character.system_prompt || buildSystemPrompt(character, [], userDisplayName);
      // World name injected into image instruction so LLM uses the right name in prompts — never "the user"
      const userNameForPrompts = userDisplayName || null;
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

      // Status-aware nuance (chat only) and sleep interruption context
      const charStatus = getCharacterStatus(character);
      const statusContext = !isPhone ? buildStatusPromptContext(character, isPhone, recentMsgs.slice(-10)) : "";
      const sleepContext = charStatus === 'asleep' ? buildSleepInterruptionContext(character) : "";

      // Awareness context: if character was unavailable and is now responding, acknowledge it naturally
      let awarenessContext = '';
      if (charStatus === 'work') {
        const workLocId = character.occupation_location_id;
        const workLoc = workLocId
          ? await base44.functions.invoke("fetchAllLocationsForUser", {})
              .then(r => (r?.data?.locations || []).find(l => l.id === workLocId))
              .catch(() => null)
          : null;
        const workplaceName = workLoc?.name || character.occupation_location_name || character.work_details?.workplace_type || "work";
        // Keep current_location_id in sync so the travel map and character cards reflect their work location
        if (workLocId && character.current_location_id !== workLocId) {
          base44.entities.Character.update(characterId, { current_location_id: workLocId }).catch(() => {});
        }
        awarenessContext = `\n\nAWARENESS: You are currently at work — specifically at ${workplaceName}. If asked where you are, say you're at ${workplaceName} or at work. If this is the first reply since being at work, you may briefly and naturally acknowledge it (e.g. "I'm at ${workplaceName} rn" or "just got a sec, I'm at work"). Do NOT repeat this every message.`;
      } else if (charStatus === 'school') {
        awarenessContext = `\n\nAWARENESS: You are at school right now. If asked where you are, say you're at school or class. If this is the first reply since being at school, you may briefly and naturally acknowledge it. Do NOT repeat this every message.`;
      } else if (charStatus === 'gym') {
        awarenessContext = `\n\nAWARENESS: You are at the gym. If asked where you are, say you're at the gym. You can briefly mention it if natural, but don't force it or repeat it.`;
      } else if (charStatus === 'bar') {
        awarenessContext = `\n\nAWARENESS: You are at the bar. If asked where you are, say you're at the bar. You can briefly mention it if natural, but don't force it or repeat it.`;
      } else if (charStatus === 'out') {
        awarenessContext = `\n\nAWARENESS: You are out right now. If asked where you are, say you're out. You can briefly mention it if natural, but don't force it or repeat it.`;
      }

      let playAsInstruction = "";
      if (activeCharacter) {
        // Find the relationship entry the receiving character has toward the active (sender) character
        const senderRelEntry = (character.fictional_relationships || []).find(
          r => r.related_character_id === activeCharacter.id
        );
        // Also look for memories mentioning the sender
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

        playAsInstruction = `\n\nCRITICAL — IDENTITY OF THE SENDER: The message you just received is NOT from the app user. It is from ${activeCharacter.name} (${activeCharacter.personality_summary || activeCharacter.archetype || "someone you know"}). You already know exactly who ${activeCharacter.name} is — do NOT ask for identification or treat them as a stranger.

${relContext}${memoryContext2}

Respond to ${activeCharacter.name} as you genuinely would in real life — drawing on your history, your current relationship state, and your emotional context with them. Your first reply must reflect that you immediately recognize them and respond with continuity from your shared history. Do NOT treat this as a new interaction.`;
      }

      // --- MEDIA FREQUENCY GATING ---
      // Count messages and media sent in this conversation to enforce frequency limits
      const totalMsgsInConvo = messages.length;
      const mediaSentInConvo = messages.filter(m => m.sender_type === "character" && m.image_url).length;
      const isPhotogenic = !!character.is_photogenic;

      // Detect explicit user image request and how many they want
      const userTextLower = text.toLowerCase();
      const explicitImageRequest = /\b(send|show|give|share|post).{0,20}(pic|photo|picture|image|selfie|shot)\b|\b(pic|photo|picture|selfie|image)\b.{0,10}(of you|of me|please|now|quick|real quick)\b/i.test(text);
      const quantityMatch = text.match(/\b(\d+)\s+(pic|photo|picture|image|selfie|shot)s?\b/i);
      const requestedQuantity = quantityMatch ? parseInt(quantityMatch[1]) : (explicitImageRequest ? 1 : 0);

      // Photogenic characters ALWAYS comply with explicit image requests — no limits apply
      // For unprompted images: photogenic = 2 per 10 messages, normal = 3 per 20 messages
      const mediaRatioLimit = isPhotogenic ? (2 / 10) : (3 / 20);
      const currentRatio = totalMsgsInConvo > 0 ? mediaSentInConvo / totalMsgsInConvo : 0;
      const atMediaLimit = currentRatio >= mediaRatioLimit && !explicitImageRequest;

      // Cooldown: photogenic characters have NO cooldown on explicit requests, others still respect it
      const recentCharMsgs = messages.filter(m => m.sender_type === "character").slice(-5);
      const lastMediaIdx = recentCharMsgs.map(m => !!m.image_url).lastIndexOf(true);
      const msgsSinceLastMedia = lastMediaIdx === -1 ? 999 : (recentCharMsgs.length - 1 - lastMediaIdx);
      const cooldownMsgs = isPhotogenic ? 2 : 5;
      // Photogenic characters bypass cooldown entirely on explicit requests
      const inCooldown = msgsSinceLastMedia < cooldownMsgs && !(explicitImageRequest || isPhotogenic);

      // Random weighted chance for unprompted images
      const baseImageChance = isPhotogenic ? 0.25 : 0.08;
      const passedRandomCheck = Math.random() < baseImageChance;

      // Final gate: explicit request always wins; photogenic always allows on explicit; others rate-limited
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
${userNameForPrompts ? `- WORLD NAME RULE: When referencing the person you're talking to in an image prompt (e.g. for [USER] or [JOINT] shots), always use their name "${userNameForPrompts}" — NEVER write "the user" or "user" in any image prompt.` : `- WORLD NAME RULE: You don't know their name yet. For [USER] or [JOINT] shots, describe them by appearance only — NEVER write "the user" or "user".`}`
        : explicitImageRequest && !isPhotogenic
        ? `MESSAGE TYPE RULES: The user asked for a photo but you've already sent several recently. Politely acknowledge you're not available to send one right now, and use message_type "text_only".`
        : `MESSAGE TYPE RULES: You MUST use message_type "text_only" this turn. Do NOT include any image fields. Images are rate-limited and you have sent enough recently.`;

      const conversationLog = chatHistory.map(m => `${m._speakerName}: ${m.content}`).join("\n");

      // EVIDENCE PRIORITY & CONTEXT SEPARATION RULES
      const evidenceInstruction = `\n\nEVIDENCE PRIORITY & CONTEXT RULES:
${userImageUrl ? `• NEW EVIDENCE (this image) is the PRIMARY source of truth for this turn.
• New evidence OVERRIDES vague or prior assumptions. Treat it as an intentional correction.` : `• Focus on the CURRENT user request as the primary goal.`}
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

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${memoryContext}${lifeEventContext}${researchContext}${weatherContext}${recentEventsContext}${culturalContext}${timeContext}${modeInstruction}${statusContext}${sleepContext}${awarenessContext}${spatialContext}${playAsInstruction}${evidenceInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${conversationLog}\n\nWrite your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n- CULTURAL AWARENESS: When the user references celebrities, TV shows, music, entertainment, or cultural topics, you recognize them as real and familiar. You respond naturally without confusion or over-explanation.\n\nRespond ONLY with valid JSON in this exact format:\n{\n  "message_type": "text_only" | "image_only" | "text_then_image" | "image_then_text",\n  "text_content": "The visible character dialogue — ONLY include if message_type includes text. Never put image prompts here.",\n  "image_generation_prompt": "INTERNAL ONLY — vivid image description for generation. Never shown to user. Only include if message_type includes image.",\n  "image_generation_prompts": ["For multiple images only — array of internal image prompts"],\n  "scheduled_events": [\n    {\n      "description": "What will happen",\n      "trigger_time": "<ISO 8601 UTC datetime>"\n    }\n  ]\n}\nOnly include scheduled_events if a specific real-world action with a concrete time is committed to. Omit fields you don't use.\n\n${imageRule}`;


      const responseLagEnabled = userSettings.response_lag_enabled !== false;

      if (responseLagEnabled) {
        if (isPhone) {
          // TEXT MODE: exact timing per status rules
          const textDelayMs = getTextDelayMs(character);

          if (textDelayMs === null) {
            // Character is ASLEEP — no response allowed in text mode
            console.log(`[TIMING] TEXT blocked — character is asleep. No response sent.`);
            setIsTyping(false);
            return;
          }

          console.log(`[TIMING] TEXT delay: ${Math.round(textDelayMs / 1000)}s | status=${getCharacterStatus(character)}`);
          await new Promise(r => setTimeout(r, textDelayMs));
        } else {
          // CHAT MODE: always 0–60 seconds, no status blocking
          const chatDelayMs = getChatDelayMs(character);
          console.log(`[TIMING] CHAT delay: ${Math.round(chatDelayMs / 1000)}s`);
          await new Promise(r => setTimeout(r, chatDelayMs));
        }
      }


      // Robust parser: returns structured { message_type, text_content, image_generation_prompt, image_generation_prompts, scheduled_events }
      const parseCharacterResponse = (raw) => {
        if (!raw) return { message_type: "text_only", text_content: "" };

        let obj = null;

        // 1. Try direct JSON parse
        try { obj = JSON.parse(raw); } catch {}

        // 2. Try markdown code fence
        if (!obj) {
          const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
          if (fenceMatch) try { obj = JSON.parse(fenceMatch[1].trim()); } catch {}
        }

        // 3. Try to find a JSON object anywhere in the string
        if (!obj) {
          const braceMatch = raw.match(/\{[\s\S]*\}/);
          if (braceMatch) try { obj = JSON.parse(braceMatch[0]); } catch {}
        }

        if (obj && typeof obj === "object") {
          // Normalize: support both old schema (text/image_prompt) and new schema (text_content/image_generation_prompt)
          const messageType = obj.message_type || (obj.image_prompt || obj.image_prompts?.length > 0 ? "text_then_image" : "text_only");
          const textContent = obj.text_content || obj.text || "";
          const imgPrompt = obj.image_generation_prompt || obj.image_prompt || null;
          const imgPrompts = obj.image_generation_prompts || obj.image_prompts || (imgPrompt ? [imgPrompt] : []);
          return {
            message_type: messageType,
            text_content: textContent,
            image_generation_prompt: imgPrompt,
            image_generation_prompts: imgPrompts,
            scheduled_events: obj.scheduled_events || [],
          };
        }

        // 4. Fallback: try to extract text_content or text field
        const textMatch = raw.match(/"(?:text_content|text)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
          try { return { message_type: "text_only", text_content: JSON.parse(`"${textMatch[1]}"`), image_generation_prompts: [] }; }
          catch { return { message_type: "text_only", text_content: textMatch[1], image_generation_prompts: [] }; }
        }

        // 5. Last resort: plain text
        const stripped = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").replace(/[{}\[\]]/g, "").replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
        if (stripped.length > 10 && /[a-zA-Z]/.test(stripped)) {
          return { message_type: "text_only", text_content: stripped, image_generation_prompts: [] };
        }

        return { message_type: "text_only", text_content: "", image_generation_prompts: [] };
      };

      let responseObj = { message_type: "text_only", text_content: "", image_generation_prompts: [] };
      try {
        response = await callLLMWithRetry(fullPrompt);
        responseObj = parseCharacterResponse(response);
      } catch (llmErr) {
        console.error('[sendMessage] LLM error:', llmErr.message);
        // Network or timeout error — use fallback response
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
      // Photogenic + explicit request: force image even if LLM returned text_only
      if (isPhotogenic && explicitImageRequest && msgType === "text_only") {
        msgType = "text_then_image";
      }
      const hasText = ["text_only", "text_then_image", "image_then_text"].includes(msgType);
      const hasImage = allowImageThisTurn && ["image_only", "text_then_image", "image_then_text"].includes(msgType);

      // text_content is for visible dialogue ONLY — never an image prompt
      responseText = hasText ? (responseObj.text_content?.trim() || "") : "";
      // Safety net: if responseText looks like raw JSON or a prompt blob, clear it
      if (responseText.startsWith("{") || responseText.startsWith("```") || responseText.startsWith("[IMAGE]") || responseText.startsWith("[CHARACTER]") || responseText.startsWith("[USER]") || responseText.startsWith("[JOINT]")) {
        responseText = "";
      }
      // DASH FILTER: remove AI-generated dashes (— – and spaced -) from visible dialogue
      // Real people texting never use dashes for pauses or dramatic effect
      responseText = filterDashes(responseText);

      // image_generation_prompts is INTERNAL ONLY — never shown to user
      // If photogenic + explicit request forced an image but LLM gave no prompt, generate a natural selfie prompt
      if (hasImage && responseObj.image_generation_prompts?.length === 0 && isPhotogenic && explicitImageRequest) {
        imagePrompts = [`[CHARACTER] Candid selfie, ${character.name} looking natural and confident, ready for the camera, good lighting, genuine expression`];
      } else {
        imagePrompts = hasImage
          ? (responseObj.image_generation_prompts?.length > 0 ? responseObj.image_generation_prompts : [])
          : [];
      }

      console.log(`[MSG-TYPE] message_type="${msgType}" | hasText=${hasText} | hasImage=${hasImage} | imagePrompts=${imagePrompts.length} | textLength=${responseText.length}`);

      // Persist scheduled events extracted from this chat turn
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

      // Calculate typing delay based on user's WPM setting — capped at 6s max
      let typingDelayMs = 0;
      const typingSpeedEnabled = userSettings.typing_speed_enabled !== false;
      if (typingSpeedEnabled) {
        const wpm = userSettings.words_per_minute || 41;
        const wordCount = responseText.split(/\s+/).filter(w => w.length > 0).length;
        typingDelayMs = Math.min((wordCount / wpm) * 60000, 6000); // cap at 6s
      }

      await new Promise(r => setTimeout(r, typingDelayMs));
      emotionalState = character.emotional_state || "calm";
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
    const isJointRequest = /\b(us|together|both|with (you and me|me and you|each other)|the two of us|selfie with (me|you))\b/i.test(msgLower);
    const isUserRequest = !isJointRequest && (
      /\b(pic|photo|picture|image|selfie|shot)\s*(of me|of myself)\b/i.test(msgLower) ||
      /\b(send|show|give|share)\s*(me\s*)?(a\s*)?(pic|photo|picture|selfie)\s*(of me|of myself)\b/i.test(msgLower) ||
      /\bpicture of me\b|\bphoto of me\b|\bpic of me\b/i.test(msgLower)
    );
    const subjectType = isJointRequest ? "joint" : isUserRequest ? "user" : "character";
    // Authoritative user reference images — generated avatars first (stronger identity signal), then raw uploads
    // Also fall back to userSettings avatars in case auth user object is stale
    const userRefImages = [
      ...(currentUser.generated_avatar_urls || []),
      ...(userSettings.generated_avatar_urls || []),
      ...(currentUser.reference_image_urls || []),
      ...(userSettings.reference_image_urls || []),
    ].filter((v, i, a) => v && a.indexOf(v) === i); // dedupe, non-empty
    const useUserRefs = (subjectType === "joint" || subjectType === "user") && userRefImages.length > 0;
    const charRefs = character.avatar_url
      ? [character.avatar_url, ...(character.reference_image_urls || [])]
      : (character.reference_image_urls || []);

    // Helper: create a stable image-only message and kick off async generation
    // If user navigated away, write directly to DB as unread (no local state update)
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
      setTimeout(() => {
        base44.functions.invoke('generateImageAsync', {
          messageId: imgMsg.id,
          prompt: imageGenPrompt,
          characterReferenceImages: charRefs,
          userReferenceImages: useUserRefs ? userRefImages : [],
          characterName: character.name,
          userWorldName: userSettings.fictional_world_name || currentUser.full_name || null,
          subjectType,
          characterId,
        }).then(() => {
          base44.entities.Conversation.update(convoId, {
            last_message_preview: "(photo)",
            last_message_date: new Date().toISOString(),
          }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
        }).catch(() => {});
      }, delayMs);
      return imgMsg;
    };

    // Helper: create a text-only message and auto-play voice
    // If user navigated away, message is saved unread so the badge fires on CharacterCard
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
        // TTS only when user is still on the page
        setTimeout(() => {
          playCharacterVoice(txtMsg.id, textContent, character, userSettings, false);
        }, 500);
      } else {
        // User is away — update conversation so unread badge shows on CharacterCard
        base44.entities.Conversation.update(convoId, {
          last_message_preview: textContent.substring(0, 100),
          last_message_date: new Date().toISOString(),
        }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
      }
      return txtMsg;
    };

    let primaryTextMsg = null;

    if (msgType === "text_only") {
      // --- TEXT ONLY ---
      primaryTextMsg = await createTextMessage(responseText || "Sorry, something went wrong.");
      if (!primaryTextMsg) { setSendError("Character response failed to save. Try again."); return; }

    } else if (msgType === "image_only") {
      // --- IMAGE ONLY --- send image as standalone message, no text bubble
      if (imagePrompts.length > 0) {
        await createImageMessage(imagePrompts[0], 300);
        for (let i = 1; i < imagePrompts.length; i++) {
          await createImageMessage(imagePrompts[i], 300 + i * 800);
        }
      } else {
        // Fallback: LLM said image_only but gave no prompt — send text if available
        primaryTextMsg = await createTextMessage(responseText || "Sorry, something went wrong.");
      }

    } else if (msgType === "text_then_image") {
      // --- TEXT FIRST, THEN IMAGE ---
      primaryTextMsg = await createTextMessage(responseText || "");
      if (imagePrompts.length > 0) {
        await createImageMessage(imagePrompts[0], 800);
        for (let i = 1; i < imagePrompts.length; i++) {
          await createImageMessage(imagePrompts[i], 800 + i * 800);
        }
      }
      if (!primaryTextMsg && imagePrompts.length === 0) { setSendError("Character response failed to save. Try again."); return; }

    } else if (msgType === "image_then_text") {
      // --- IMAGE FIRST, THEN TEXT ---
      if (imagePrompts.length > 0) {
        await createImageMessage(imagePrompts[0], 300);
        for (let i = 1; i < imagePrompts.length; i++) {
          await createImageMessage(imagePrompts[i], 300 + i * 800);
        }
      }
      // Text arrives after a short delay so image appears first visually
      await new Promise(r => setTimeout(r, 600));
      primaryTextMsg = await createTextMessage(responseText || "");
      if (!primaryTextMsg && imagePrompts.length === 0) { setSendError("Character response failed to save. Try again."); return; }

    } else {
      // Unknown type fallback — text only
      primaryTextMsg = await createTextMessage(responseText || "Sorry, something went wrong.");
    }

    // Use primary text message for relationship/conversation tracking (or first image msg id for context)
    const charMsg = primaryTextMsg;

    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    }
    
    // Character occasionally reacts with an emoji to the user's message — LLM decides based on message impact
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
          // One character reaction per message — replace any existing character reaction
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

    // Check for achievements based on user message (fire-and-forget)
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

    // Check for life event approval pop-ups (move-in, marriage, birth) — non-blocking
    if (responseText) {
      base44.entities.Character.filter({ created_by: currentUser.email }).then(allCharsForApproval => {
        checkForApprovalEvents(responseText, character, allCharsForApproval || [], text);
      }).catch(() => {});
    }

    // Classify life events from this conversation turn (fire-and-forget)
    // This fans out to memory, mood, relationship, and achievement systems
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
      },
    }).catch(() => {});

    // Extract memories from this turn (fire-and-forget)
    if (responseText) {
      base44.functions.invoke("extractMemoriesFromTurn", {
        characterId,
        conversationId: convoId,
        userMessage: text,
        characterReply: responseText,
      }).catch(() => {});
    }

    // Update character location/activity from USER message (fire-and-forget)
    // This extracts activity like "I'm at work" from what the user sends
    base44.functions.invoke("updateCharacterActivityFromMessage", {
      characterId,
      messageContent: text,
    }).catch(() => {});

    // Update character location if character response mentions being somewhere (fire-and-forget)
    if (responseText) {
      base44.functions.invoke("updateCharacterLocationFromMessage", {
        characterId,
        messageContent: responseText,
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
      // Inject milestone narrative messages into the conversation
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
      <div className="sticky top-0 z-[1000] bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 pointer-events-auto">
        <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors pointer-events-auto cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Link to={`/profile/${characterId}`}>
          {character && <CharacterAvatar character={character} size="sm" />}
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{character?.name || "Loading..."}</h2>
          <p className="text-xs text-muted-foreground">{isPhone ? "Texting" : "Talking"}</p>
        </div>
        {character && <MediaGallery messages={messages} onDeleteImage={handleDeleteImage} character={character} conversationId={conversationId} onImageGenerated={(newMsg) => setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])} />}

        {character && !isPhone && (
          <GameLauncher
            character={character}
            conversationId={conversationId}
            onGameEnd={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
          />
        )}

        {character && conversationId && (
          <button
            onClick={() => setShowTroubleshooting(true)}
            className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Troubleshoot this thread"
          >
            <Wrench className="w-4 h-4" />
          </button>
        )}

        {character && (character.fictional_relationships || []).length > 0 && (
          <button
            onClick={() => setShowWorldContacts(true)}
            className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Speak to people in their world"
          >
            <Globe className="w-4 h-4" />
          </button>
        )}

        {character && (
          <button
            onClick={() => setShowNarrativeBuilder(true)}
            className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Add narrative event"
          >
            <BookOpen className="w-4 h-4" />
          </button>
        )}
        {character && (
          <button
            onClick={() => setShowStatusPopup(true)}
            className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="View relationship status"
          >
            <BarChart2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {showStatusPopup && character && (
        <CharacterStatusPopup
          character={character}
          onClose={() => setShowStatusPopup(false)}
          previousLevels={previousLevels}
          lastChangeReason={lastChangeReason}
        />
      )}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 px-4" data-chat-container="true">
        {messages.length > 0 && <ArchiveNotice conversationId={conversationId} characterId={characterId} characterName={character?.name} />}
        <AnimatePresence>
          {messages.map(msg => (
            <MessageBubble 
              key={msg.id} 
              message={msg} 
              onReact={handleReact} 
              onDelete={handleDeleteMessage} 
              onDeleteImage={handleDeleteImage}
              onPlayVoice={msg.sender_type !== "user" && !msg.is_narrative ? () => playCharacterVoice(msg.id, msg.content, character, userSettings, true) : null}
              isPlayingVoice={playingAudioId === msg.id}
              voiceError={voiceErrors[msg.id]}
              onForward={!msg.is_narrative ? (msg) => setForwardTarget(msg) : null}
            />
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {isTyping && character && <TypingIndicator name={character.name} avatarUrl={character.avatar_url} />}
        </AnimatePresence>
        {sendError && (
          <div className="text-center px-4 py-2">
            <p className="text-xs text-destructive bg-destructive/10 rounded-xl px-4 py-2 inline-block">{sendError} <button className="underline ml-1" onClick={() => setSendError(null)}>Dismiss</button></p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
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
      />
      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          onClose={() => setForwardTarget(null)}
        />
      )}
      <BottomNav />

      {/* Approval pop-ups for life events */}
      {pendingApproval?.type === 'move_in' && (
        <ApprovalPopup
          type="move_in"
          title="Moving In Together?"
          description={`It looks like ${pendingApproval.data.character?.name} may be moving in${pendingApproval.data.otherCharName ? ` with ${pendingApproval.data.otherCharName}` : ' with someone'}. Approve this household change?`}
          details={pendingApproval.data}
          onApprove={approveEvent}
          onDeny={dismissApproval}
        >
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
    </div>
  );
}