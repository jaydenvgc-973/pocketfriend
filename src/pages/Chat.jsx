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
import GameLauncher from "@/components/games/GameLauncher";
import {
  getCharacterStatus,
  getChatDelayMs,
  getTextDelayMs,
  getTextSystemMessage,
  buildStatusPromptContext,
  buildSleepInterruptionContext,
} from "@/lib/responseTimingUtils";

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
  const [lastChangeReason, setLastChangeReason] = useState(null);
  const [previousLevels, setPreviousLevels] = useState(null);
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [showNarrativeBuilder, setShowNarrativeBuilder] = useState(false);
  const [showWorldContacts, setShowWorldContacts] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [voiceErrors, setVoiceErrors] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null); // message pending delete choice

  const bottomRef = useRef(null);
  const { activeCharacter } = useActiveCharacter();
  const queryClient = useQueryClient();
  const conversationIdRef = useRef(null);
  const unsubscribeRef = useRef(null);

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
        setVoiceErrors(prev => ({ ...prev, [messageId]: 'Voice disabled in settings' }));
        return;
      }
      
      if (!charHasVoice) {
        console.log(`${diagnosticId} ABORT: character voice not enabled or no voice_name`);
        setPlayingAudioId(null);
        setVoiceErrors(prev => ({ ...prev, [messageId]: 'Character voice not configured' }));
        return;
      }
      
      if (!hasApiKey) {
        console.log(`${diagnosticId} ABORT: No OpenAI API key found`);
        setPlayingAudioId(null);
        setVoiceErrors(prev => ({ ...prev, [messageId]: 'No API key configured' }));
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

        // Archive old messages and extract memories asynchronously (fire-and-forget)
        // Never archive for protected characters
        const PROTECTED_CHARACTER_IDS = ['69c0d59d7e382cc866ded9c9'];
        if (convoId && !PROTECTED_CHARACTER_IDS.includes(characterId)) {
          setTimeout(() => {
            base44.functions.invoke('archiveOldMessages', { conversationId: convoId, keepRecent: 50 }).catch(() => {});
            base44.functions.invoke('extractMemoriesFromArchive', { conversationId: convoId, characterId }).catch(() => {});
          }, 2000);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

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

  const handleShareSong = async (songLink) => {
    if (!character) return;
    try {
      const res = await base44.functions.invoke('processSongLink', {
        characterId,
        songLink
      });
      if (res?.data?.success) {
        setMessages(prev => [...prev, {
          id: 'system_' + Date.now(),
          conversation_id: conversationIdRef.current,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: `Thanks for the song! "${res.data.song.title}" by ${res.data.song.artist} is great. ${res.data.song.lyrics_excerpt ? `I love the line "${res.data.song.lyrics_excerpt}"` : ''}.`,
          timestamp: new Date().toISOString()
        }]);
        queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      }
    } catch (err) {
      setSendError("Failed to process song link. Try again.");
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
    const musicLinkMatch = text.match(/https?:\/\/[^\s]+(spotify|apple|music|youtube|amazon|tidal|soundcloud|bandcamp)[^\s]*/i);
    if (musicLinkMatch) {
      await handleShareSong(musicLinkMatch[0]);
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

    // TEXT MODE: Insert status system message immediately if applicable
    if (isPhone) {
      const sysMsg = getTextSystemMessage(character);
      if (sysMsg) {
        const systemNotice = {
          id: `sys_status_${Date.now()}`,
          conversation_id: convoId,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: sysMsg,
          is_narrative: true,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, systemNotice]);
        console.log(`[SYSTEM-MSG] Text mode status message: "${sysMsg}"`);
      }

      // If asleep in text mode — stop here, no typing indicator or response
      if (getCharacterStatus(character) === 'asleep') {
        console.log(`[TIMING] TEXT blocked — character is asleep. Showing system message only.`);
        return;
      }
    }

    setIsTyping(true);

    let recentMsgs, response, responseText, emotionalState, imagePrompts = [], msgType = "text_only";
    try {
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
        const songsInfo = character.songs_heard.map(song => `"${song.title}" by ${song.artist} - key lyrics: "${song.lyrics_excerpt}"`).join("; ");
        songsContext = `\n\nSONGS YOU KNOW: You have listened to these songs and know them well: ${songsInfo}. You can naturally reference these songs, quote lyrics, or discuss what they mean to you in conversations.`;
      }

      // Weather context — use pre-fetched daily weather as primary, live lookup as fallback
      let weatherContext = "";
      const weatherKeywords = /\b(weather|rain|raining|sunny|cold|hot|warm|freezing|snow|snowing|storm|cloudy|outside|outdoors|going out|what's it like|nice out|bad out|degrees|temperature|humid|windy|fog|foggy)\b/i;
      if (character.city || character.state) {
        // Use stored daily weather if available (fetched at 5am each day)
        if (character.weather_summary) {
          weatherContext = `\n\nCURRENT WEATHER (for ${[character.city, character.state].filter(Boolean).join(", ")}): ${character.weather_summary}. You already know this — it's just part of your day. If weather comes up naturally in conversation, reference it authentically. Don't force it.`;
        } else if (weatherKeywords.test(text)) {
          // Fallback: live lookup only if no stored weather and user brings up weather
          try {
            const weatherRes = await base44.integrations.Core.InvokeLLM({
              prompt: `What is the current weather right now in ${[character.city, character.state].filter(Boolean).join(", ")}? Include temperature, conditions, and any notable weather patterns.`,
              add_context_from_internet: true,
              model: 'gemini_3_flash'
            });
            weatherContext = `\n\nCURRENT WEATHER: Right now in ${[character.city, character.state].filter(Boolean).join(", ")}: ${weatherRes}. Naturally reference this if it fits — mention how it affects your mood, what you're doing, or what you're wearing.`;
          } catch (weatherErr) {
            // Weather lookup failed, continue without it
          }
        }
      }

      // Fetch recent events ONLY if conversation seems news/current-events-related
      let recentEventsContext = "";
      const newsKeywords = /\b(news|heard about|did you see|what's going on|what happened|current events|trending|politics|election|sports|game|match|celebrity|scandal|viral|social media|twitter|tiktok|instagram)\b/i;
      if (newsKeywords.test(text)) {
        try {
          const eventsRes = await base44.integrations.Core.InvokeLLM({
            prompt: `What are the top 2-3 most relevant recent news events, cultural moments, or trending topics happening right now (current date: ${new Date().toLocaleDateString()})? Focus on general interest stories that a typical person might naturally bring up in casual conversation. Include brief details about each.`,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
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
          const culturalRes = await base44.integrations.Core.InvokeLLM({
            prompt: `What are currently trending in entertainment and culture right now (current date: ${new Date().toLocaleDateString()})? Include: popular TV shows, streaming content, music releases or artists, celebrities making headlines, viral trends. Keep it to what a socially aware person would naturally know. Be concise.`,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
          culturalContext = `\n\nCULTURAL AWARENESS: Current entertainment & culture trends: ${culturalRes}. You're aware of these topics and can discuss them naturally if they come up. Recognize references to celebrities, shows, and music without confusion.`;
        } catch (culturalErr) {
          // Cultural awareness lookup failed, continue without it
        }
      }

      // Get recent memories for long-term recall
      let memoryContext = "";
      const recentMemories = await base44.entities.Memory.filter({ character_id: characterId }, "-timestamp", 10);
      if (recentMemories.length > 0) {
        const memoryList = recentMemories.map(m => `- ${m.title}: ${m.description}`).join("\n");
        memoryContext = `\n\nLONG-TERM MEMORY BANK (things that happened that you remember — reference these naturally when relevant, don't force it):\n${memoryList}`;
      }

      // Get recent life events for behavioral context
      let lifeEventContext = "";
      try {
        const recentLifeEvents = await base44.entities.LifeEvent.filter({ character_id: characterId }, "-timestamp", 8);
        if (recentLifeEvents.length > 0) {
          const negEvents = recentLifeEvents.filter(e => e.valence === "negative");
          const posEvents = recentLifeEvents.filter(e => e.valence === "positive");
          const eventLines = recentLifeEvents.map(e => `- [${e.valence}] ${e.title}`).join("\n");
          let behaviorNote = "";
          if (negEvents.filter(e => e.event_type === "substance_use_event").length >= 2) {
            behaviorNote += " You've been drinking more than usual lately — your judgment and emotional regulation are affected.";
          }
          if (negEvents.filter(e => e.event_type === "grief_event").length >= 1) {
            behaviorNote += " You're carrying grief right now. It shapes how you see everything.";
          }
          if (negEvents.filter(e => ["conflict_event","fight_event"].includes(e.event_type)).length >= 2) {
            behaviorNote += " You've had repeated conflict recently. You may be more on edge than usual.";
          }
          if (posEvents.filter(e => ["growth_event","healthy_choice_event","recovery_event"].includes(e.event_type)).length >= 2) {
            behaviorNote += " You've been in a good place lately — making better choices, feeling more stable.";
          }
          lifeEventContext = `\n\nRECENT LIFE EVENTS (shape your current mood, behavior, and what's on your mind):\n${eventLines}${behaviorNote ? "\n\nBEHAVIORAL NOTE:" + behaviorNote : ""}`;
        }
      } catch (_) {
        // Life event fetch failed — continue without it
      }

      // Detect frequented places and update emotional state asynchronously (non-blocking)
      const frequentedPlaces = character.frequented_places || [];
      if (frequentedPlaces.length > 0) {
        const fullText = (text + " " + (recentMsgs.slice(-3).map(m => m.content).join(" "))).toLowerCase();
        const mentionedPlace = frequentedPlaces.find(p => fullText.includes(p.toLowerCase()));
        if (mentionedPlace) {
          // Fire-and-forget — does not block response generation
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

      // Get past web lookups to reference naturally
      let researchContext = "";
      const pastLookups = await base44.entities.WebLookup.filter({ character_id: characterId }, "-lookup_date", 10);
      if (pastLookups.length > 0) {
        const researchInfo = pastLookups.map(l => `"${l.search_query}" - Found: "${l.title}" by ${l.author_source}. Key info: ${l.summary}`).join("\n");
        researchContext = `\n\nTHINGS YOU'VE LOOKED UP: You've researched these topics and have this knowledge:\n${researchInfo}\nWhen relevant, naturally reference what you've learned from these lookups. Don't force it, but if something comes up in conversation that relates to your research, mention it like you actually read about it.`;
      }

      // Perform web lookup asynchronously if user asked for one (non-blocking)
      if (lookupMatch && lookupMatch[1]) {
        const query = lookupMatch[1].trim();
        base44.functions.invoke('performWebLookup', { characterId, searchQuery: query }).catch(() => {});
      }

      const userDisplayName = userSettings.fictional_world_name || null;
      const systemPrompt = character.system_prompt || buildSystemPrompt(character, [], userDisplayName);
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

      // Status-aware nuance (chat only) and sleep interruption context
      const charStatus = getCharacterStatus(character);
      const statusContext = !isPhone ? buildStatusPromptContext(character, isPhone, recentMsgs.slice(-10)) : "";
      const sleepContext = charStatus === 'asleep' ? buildSleepInterruptionContext(character) : "";

      // Awareness context: if character was unavailable and is now responding, acknowledge it naturally
      const awarenessContext = (() => {
        if (charStatus === 'work') return `\n\nAWARENESS: You are at work right now. If this is the first reply since being at work, you may briefly and naturally acknowledge it (e.g. "I'm at work rn" or "just got a sec"). Do NOT repeat this every message.`;
        if (charStatus === 'school') return `\n\nAWARENESS: You are at school right now. If this is the first reply since being at school, you may briefly and naturally acknowledge it. Do NOT repeat this every message.`;
        if (charStatus === 'gym') return `\n\nAWARENESS: You are at the gym. You can briefly mention it if natural, but don't force it or repeat it.`;
        if (charStatus === 'bar') return `\n\nAWARENESS: You are at the bar. You can briefly mention it if natural, but don't force it or repeat it.`;
        if (charStatus === 'out') return `\n\nAWARENESS: You are out right now. You can briefly mention it if natural, but don't force it or repeat it.`;
        return '';
      })();

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

      // Frequency limits: photogenic = 2 per 10 messages, normal = 3 per 20 messages
      const mediaRatioLimit = isPhotogenic ? (2 / 10) : (3 / 20);
      const currentRatio = totalMsgsInConvo > 0 ? mediaSentInConvo / totalMsgsInConvo : 0;
      const atMediaLimit = currentRatio >= mediaRatioLimit && !explicitImageRequest;

      // Cooldown: no media in the last N character messages
      const recentCharMsgs = messages.filter(m => m.sender_type === "character").slice(-5);
      const lastMediaIdx = recentCharMsgs.map(m => !!m.image_url).lastIndexOf(true);
      const msgsSinceLastMedia = lastMediaIdx === -1 ? 999 : (recentCharMsgs.length - 1 - lastMediaIdx);
      const cooldownMsgs = isPhotogenic ? 3 : 5;
      const inCooldown = msgsSinceLastMedia < cooldownMsgs && !explicitImageRequest;

      // Random weighted chance even when within limits (trait influences probability)
      const baseImageChance = isPhotogenic ? 0.20 : 0.08;
      const passedRandomCheck = Math.random() < baseImageChance;

      // Final gate: allow image prompt only if user explicitly asked, OR (within limit AND not in cooldown AND passed random check)
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

IMPORTANT: text_only is the DEFAULT. Only deviate if an image genuinely adds value.
${isPhotogenic ? "You enjoy sharing photos of yourself and your life, so text_then_image or image_only are more natural for you." : "Only send an image if it truly fits — prefer text_only."}
${imageCountInstruction}

IMAGE SUBJECT RULES (for image_generation_prompt / image_generation_prompts):
- "Send me a pic of me / myself" → subject is the USER. Start prompt with "[USER]".
- "Send me a pic of you / yourself" → subject is YOU. Start prompt with "[CHARACTER]".
- "Send me a pic of us / together" → subject is BOTH. Start prompt with "[JOINT]".
- Default (no explicit subject): "[CHARACTER]".
- image_generation_prompt is INTERNAL ONLY — it is never shown to the user.`
        : `MESSAGE TYPE RULES: You MUST use message_type "text_only" this turn. Do NOT include any image fields. Images are rate-limited and you have sent enough recently.`;

      const conversationLog = chatHistory.map(m => `${m._speakerName}: ${m.content}`).join("\n");

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${memoryContext}${lifeEventContext}${researchContext}${weatherContext}${recentEventsContext}${culturalContext}${timeContext}${modeInstruction}${statusContext}${sleepContext}${awarenessContext}${playAsInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${conversationLog}\n\nWrite your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n- CULTURAL AWARENESS: When the user references celebrities, TV shows, music, entertainment, or cultural topics, you recognize them as real and familiar. You respond naturally without confusion or over-explanation.\n\nRespond ONLY with valid JSON in this exact format:\n{\n  "message_type": "text_only" | "image_only" | "text_then_image" | "image_then_text",\n  "text_content": "The visible character dialogue — ONLY include if message_type includes text. Never put image prompts here.",\n  "image_generation_prompt": "INTERNAL ONLY — vivid image description for generation. Never shown to user. Only include if message_type includes image.",\n  "image_generation_prompts": ["For multiple images only — array of internal image prompts"],\n  "scheduled_events": [\n    {\n      "description": "What will happen",\n      "trigger_time": "<ISO 8601 UTC datetime>"\n    }\n  ]\n}\nOnly include scheduled_events if a specific real-world action with a concrete time is committed to. Omit fields you don't use.\n\n${imageRule}`;


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

      let retries = 2;
      let responseObj = { message_type: "text_only", text_content: "", image_generation_prompts: [] };
      while (retries >= 0) {
        try {
          response = await base44.integrations.Core.InvokeLLM({
            prompt: fullPrompt,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
          responseObj = parseCharacterResponse(response);
          break;
        } catch (llmErr) {
          if (retries === 0) throw llmErr;
          retries--;
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      msgType = responseObj.message_type || "text_only";
      const hasText = ["text_only", "text_then_image", "image_then_text"].includes(msgType);
      const hasImage = allowImageThisTurn && ["image_only", "text_then_image", "image_then_text"].includes(msgType);

      // text_content is for visible dialogue ONLY — never an image prompt
      responseText = hasText ? (responseObj.text_content?.trim() || "") : "";
      // Safety net: if responseText looks like raw JSON or a prompt blob, clear it
      if (responseText.startsWith("{") || responseText.startsWith("```") || responseText.startsWith("[IMAGE]") || responseText.startsWith("[CHARACTER]") || responseText.startsWith("[USER]") || responseText.startsWith("[JOINT]")) {
        responseText = "";
      }

      // image_generation_prompts is INTERNAL ONLY — never shown to user
      imagePrompts = hasImage
        ? (responseObj.image_generation_prompts?.length > 0 ? responseObj.image_generation_prompts : [])
        : [];

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

      // Calculate typing delay based on user's WPM setting
      let typingDelayMs = 0;
      const typingSpeedEnabled = userSettings.typing_speed_enabled !== false;
      if (typingSpeedEnabled) {
        const wpm = userSettings.words_per_minute || 41;
        const wordCount = responseText.split(/\s+/).filter(w => w.length > 0).length;
        typingDelayMs = (wordCount / wpm) * 60000;
      }

      await new Promise(r => setTimeout(r, typingDelayMs));
      emotionalState = character.emotional_state || "calm";
    } catch (err) {
      setIsTyping(false);
      setSendError("Couldn't get a response. Try again.");
      return;
    }

    setIsTyping(false);

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
    const userRefImages = currentUser.generated_avatar_urls?.length > 0
      ? currentUser.generated_avatar_urls
      : (currentUser.reference_image_urls || []);
    const useUserRefs = (subjectType === "joint" || subjectType === "user") && userRefImages.length > 0;
    const charRefs = character.avatar_url
      ? [character.avatar_url, ...(character.reference_image_urls || [])]
      : (character.reference_image_urls || []);

    // Helper: create a stable image-only message and kick off async generation
    const createImageMessage = async (imageGenPrompt, delayMs = 500) => {
      const imgMsg = await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "character",
        character_id: characterId,
        character_name: character.name,
        content: "",           // image-only: no visible text
        emotional_state: emotionalState,
        timestamp: new Date().toISOString(),
      });
      if (!imgMsg?.id) return null;
      setMessages(prev => prev.some(m => m.id === imgMsg.id) ? prev : [...prev, imgMsg]);
      setTimeout(() => {
        base44.functions.invoke('generateImageAsync', {
          messageId: imgMsg.id,
          prompt: imageGenPrompt,
          characterReferenceImages: charRefs,
          userReferenceImages: useUserRefs ? userRefImages : [],
          characterName: character.name,
          subjectType,
        }).catch(() => {});
      }, delayMs);
      return imgMsg;
    };

    // Helper: create a text-only message and auto-play voice
    const createTextMessage = async (textContent) => {
      if (!textContent?.trim()) return null;
      const txtMsg = await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "character",
        character_id: characterId,
        character_name: character.name,
        content: textContent,  // visible dialogue only — never an image prompt
        emotional_state: emotionalState,
        timestamp: new Date().toISOString(),
      });
      if (!txtMsg?.id) return null;
      setMessages(prev => prev.some(m => m.id === txtMsg.id) ? prev : [...prev, txtMsg]);
      // TTS: only fire on text messages, only speak visible text_content
      setTimeout(() => {
        playCharacterVoice(txtMsg.id, textContent, character, userSettings, false);
      }, 500);
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
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-border ${isPhone ? "bg-card" : "bg-background/80 backdrop-blur-xl"}`}>
        <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Link to={`/profile/${characterId}`}>
          {character && <CharacterAvatar character={character} size="sm" />}
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{character?.name || "Loading..."}</h2>
          <p className="text-xs text-muted-foreground">{isPhone ? "Texting" : "Talking"}</p>
        </div>
        {character && <MediaGallery messages={messages} onDeleteImage={handleDeleteImage} />}

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
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.length > 0 && <ArchiveNotice conversationId={conversationId} characterName={character?.name} />}
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
      <BottomNav />

    </div>
  );
}