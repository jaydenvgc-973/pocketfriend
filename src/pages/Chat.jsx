import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import TypingIndicator from "@/components/chat/TypingIndicator";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import MediaGallery from "@/components/chat/MediaGallery";

import ArchiveNotice from "@/components/chat/ArchiveNotice";
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import CharacterStatusPopup from "@/components/character/CharacterStatusPopup";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import { BarChart2, BookOpen, Globe } from "lucide-react";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import DialogueSelector from "@/components/chat/DialogueSelector";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";

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
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [voiceErrors, setVoiceErrors] = useState({});
  const lastMessageTimeRef = useRef(0);

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

  // VOICE GENERATION & PLAYBACK - Completely independent from message delivery
  // Voice is optional. Message delivery is required.
  // If voice fails, the message STAYS visible and delivered.
  const generateAndPlayVoice = async (messageId, text, characterData, userSettings) => {
    const voiceId = `[VOICE-${messageId.substring(0, 8)}]`;
    
    // Exit early if voice is disabled globally or no API key
    if (!userSettings?.voice_enabled || !userSettings?.openai_api_key) {
      console.log(`${voiceId} Voice disabled or no API key - skipping audio generation`);
      return;
    }

    // Exit early if character doesn't have voice configured
    if (!characterData?.voice_enabled || !characterData?.voice_name) {
      console.log(`${voiceId} Character voice not configured - skipping audio`);
      return;
    }

    // Exit early if in phone mode
    if (chatType === "phone") {
      console.log(`${voiceId} Phone mode - voice disabled`);
      return;
    }

    if (!messageId || !text) {
      console.log(`${voiceId} Missing messageId or text - cannot generate voice`);
      return;
    }

    try {
      console.log(`${voiceId} Voice generation starting for: "${text.substring(0, 80)}..."`);

      // Check cache
      const cacheKey = `${characterData.id}_${characterData.voice_name}_${text}`;
      let audioUrl = voiceCache.get(cacheKey);

      if (!audioUrl) {
        // Generate audio
        const res = await base44.functions.invoke('generateSpeech', {
          text: text,
          voice: characterData.voice_name,
          voiceStyleNote: characterData.voice_style_note,
          apiKey: userSettings.openai_api_key,
        });

        if (!res?.data?.audioUrl) {
          throw new Error('No audio URL returned');
        }

        audioUrl = res.data.audioUrl;
        voiceCache.set(cacheKey, audioUrl);
        console.log(`${voiceId} Voice generated and cached`);

        // Update usage
        if (userSettings.id && res.data.estimatedMinutes) {
          base44.entities.UserSettings.update(userSettings.id, {
            voice_minutes_used: (userSettings.voice_minutes_used || 0) + res.data.estimatedMinutes,
          }).catch(() => {});
        }
      } else {
        console.log(`${voiceId} Using cached audio`);
      }

      // Save audio URL to message (fire-and-forget, doesn't block anything)
      base44.entities.Message.update(messageId, { audio_url: audioUrl }).catch(err => {
        console.error(`${voiceId} Failed to save audio URL:`, err.message);
      });

      // Try to play audio
      await playAudio(messageId, audioUrl);
      console.log(`${voiceId} ✓ Voice playback complete`);

    } catch (err) {
      // Voice failed - but MESSAGE IS ALREADY DELIVERED
      // Log the error but do NOT remove the message or block anything
      console.warn(`${voiceId} Voice generation failed: ${err.message}`);
      console.warn(`${voiceId} NOTE: Message is still delivered and visible. Voice is optional.`);
      setVoiceErrors(prev => ({ ...prev, [messageId]: err.message }));
    }
  };

  // Helper function to play audio (does not block message delivery)
  const playAudio = async (messageId, audioUrl) => {
    const diagnosticId = `[PLAYBACK-${messageId.substring(0, 8)}]`;
    
    return new Promise((resolve) => {
      try {
        console.log(`${diagnosticId} Creating Audio element`);
        
        // Stop any existing audio for this message
        const existingAudio = activeAudioRef.get(messageId);
        if (existingAudio) {
          existingAudio.pause();
          existingAudio.currentTime = 0;
        }

        const audio = new Audio(audioUrl);
        activeAudioRef.set(messageId, audio);

        audio.onended = () => {
          console.log(`${diagnosticId} Playback ended`);
          activeAudioRef.delete(messageId);
          setPlayingAudioId(null);
          resolve();
        };

        audio.onerror = (err) => {
          console.warn(`${diagnosticId} Playback error (message still visible):`, err);
          activeAudioRef.delete(messageId);
          setPlayingAudioId(null);
          resolve();
        };

        setPlayingAudioId(messageId);
        audio.play().catch(err => {
          console.warn(`${diagnosticId} Play failed (message still visible):`, err.message);
          activeAudioRef.delete(messageId);
          setPlayingAudioId(null);
          resolve();
        });
      } catch (err) {
        console.warn(`${diagnosticId} Audio setup error (message still visible):`, err);
        setPlayingAudioId(null);
        resolve();
      }
    });
  };



  const { data: currentUser = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // Disabled: initializeVoiceSettings was causing rate limiting — voice init deferred to on-demand
  // useEffect(() => { ... }, []);

  useEffect(() => {
    if (!characterId || !character || !currentUser.email) return;
    
    // Reset state immediately when switching characters
    setMessages([]);
    setConversationId(null);
    setIsTyping(false);
    
    const loadConvo = async () => {
      try {
        console.log(`[Chat] LOAD: Conversation for ${character.name}`);
        
        // Fetch conversations for this character
        const convos = await base44.entities.Conversation.filter(
          { type: chatType, character_ids: [characterId], created_by: currentUser.email },
          "-updated_date",
          1
        );

        let convoId = null;

        if (convos.length > 0) {
          convoId = convos[0].id;
          
          // Load the 50 most recent non-archived messages
          const loadedMsgs = await base44.entities.Message.filter(
            { conversation_id: convoId, archived_date: { $exists: false } },
            "-created_date",
            50
          );
          
          console.log(`[Chat] LOAD: ${loadedMsgs?.length || 0} messages loaded`);
          
          if (loadedMsgs && loadedMsgs.length > 0) {
            // Reverse to chronological order
            setMessages(loadedMsgs.reverse());
            setConversationId(convoId);

            // Mark unread messages as read (non-blocking)
            const unread = loadedMsgs.filter(m => m.sender_type === "character" && !m.is_read);
            if (unread.length > 0) {
              unread.forEach(m => {
                base44.entities.Message.update(m.id, { is_read: true }).catch(() => {});
              });
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

        // Archive old messages & extract memories (non-blocking, delayed)
        // Protected characters keep more messages visible (100 instead of 50)
        if (convoId) {
          setTimeout(async () => {
            const settings = await base44.entities.UserSettings.filter(
              { created_by: currentUser.email },
              "-created_date",
              1
            ).then(arr => arr?.[0]) || {};
            
            const isProtected = (settings.protected_character_ids || []).includes(characterId);
            const keepCount = isProtected ? 100 : 50;
            
            base44.functions.invoke('archiveOldMessages', { conversationId: convoId, keepRecent: keepCount }).catch(() => {});
            base44.functions.invoke('extractMemoriesFromArchive', { conversationId: convoId, characterId }).catch(() => {});
          }, 3000);
        }

        // Load pending messages and deliver them
        const pending = await base44.entities.PendingMessage.filter(
          { character_id: characterId, delivered: false }
        );

        if (pending.length > 0 && convoId) {
          console.log(`[Chat] LOAD: Delivering ${pending.length} pending messages`);
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

            console.log(`[Chat] LOAD: Pending delivered ${charMsg.id.substring(0, 8)}`);
            setMessages(prev => prev.some(m => m.id === charMsg.id) ? prev : [...prev, charMsg]);
            await base44.entities.PendingMessage.update(pm.id, { delivered: true });
            await base44.entities.Conversation.update(convoId, {
              last_message_preview: pm.content.substring(0, 100),
              last_message_date: new Date().toISOString(),
            });
            
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } catch (err) {
        console.error('[Chat] LOAD ERROR:', err);
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
      // Only process events for this conversation
      if (event.data?.conversation_id !== conversationId) return;

      if (event.type === "create") {
        setMessages(prev => {
          // Check if message already exists
          if (prev.some(m => m.id === event.data.id)) {
            console.log(`[Chat] SUB: Duplicate ignored ${event.data.id.substring(0, 8)}`);
            return prev;
          }
          const msgType = event.data.image_url && !event.data.content ? '(image)' : `"${event.data.content?.substring(0, 40)}..."`;
          console.log(`[Chat] SUB: New ${event.data.sender_type} ${event.data.id.substring(0, 8)} ${msgType}`);
          return [...prev, event.data];
        });
        
        // Auto-read character messages
        if (event.data.sender_type === "character" && !event.data.is_read) {
          base44.entities.Message.update(event.data.id, { is_read: true }).catch(() => {});
        }
      } else if (event.type === "update") {
        // Update existing message (e.g., image_url, audio_url being added)
        console.log(`[Chat] SUB: Updated ${event.data.id.substring(0, 8)}`);
        setMessages(prev => prev.map(m => m.id === event.data.id ? { ...m, ...event.data } : m));
      } else if (event.type === "delete") {
        // Remove deleted messages
        console.log(`[Chat] SUB: Deleted ${event.data.id.substring(0, 8)}`);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const [sendError, setSendError] = useState(null);

  const handleDeleteMessage = async (messageId) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    try {
      await base44.entities.Message.delete(messageId);
    } catch {
      // Message already deleted or not found — UI already updated
    }
  };

  const handleDeleteImage = async (messageId) => {
    // Remove image from visible message, but Media record is preserved via is_deleted flag in gallery
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

    // Rate limit: space out messages to prevent "Rate limit exceeded" errors
    // Messages still send immediately to UI, but API calls are throttled
    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageTimeRef.current;
    if (timeSinceLastMessage < 2000) {
      setSendError("Please wait a moment before sending another message.");
      return;
    }
    lastMessageTimeRef.current = now;

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
    console.log(`[Chat] USER MESSAGE SAVED: ${userMsg.id.substring(0, 8)} | "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    // Message is persisted to database immediately, subscription will add it if needed
    setMessages(prev => prev.some(m => m.id === userMsg.id) ? prev : [...prev, userMsg]);
    setIsTyping(true);

    let recentMsgs, response, responseText, emotionalState, imagePrompt, imagePrompts = [], detailReferenceImage = null;
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

      const userDisplayName = userSettings?.fictional_world_name || null;
       const systemPrompt = character.system_prompt || buildSystemPrompt(character, [], userDisplayName);
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

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
        ? `The user asked for ${requestedQuantity} images. Include exactly ${requestedQuantity} image_prompt entries (use "image_prompts" array instead of single "image_prompt").`
        : "";

      const imageRule = allowImageThisTurn
        ? `IMAGE SENDING (OPTIONAL): You MAY include an image_prompt this turn if it genuinely fits the conversation — a moment worth capturing, something you just did, or something the user asked to see. ${isPhotogenic ? "You enjoy sharing photos of yourself and your life." : "Only send a photo if it truly adds to the conversation."} ${imageCountInstruction}
CRITICAL IMAGE SUBJECT RULES — follow these exactly:
- "Send me a pic of me / myself" → subject is the USER. Describe the user in the prompt. Start image_prompt with "[USER]".
- "Send me a pic of you / yourself / your name" → subject is YOU (the character). Describe yourself. Start image_prompt with "[CHARACTER]".
- "Send me a pic of us / both / together / you and me" → subject is BOTH. Describe both of you together. Start image_prompt with "[JOINT]".
- If no explicit subject: default to yourself (the character). Start image_prompt with "[CHARACTER]".
- Always start image_prompt with the correct tag: [USER], [CHARACTER], or [JOINT]. This is required.`
        : `IMAGE SENDING: Do NOT include image_prompt this turn. Send text only. Images should be occasional — you have already sent enough recently or this message doesn't call for one.`;

      const conversationLog = chatHistory.map(m => `${m._speakerName}: ${m.content}`).join("\n");

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${memoryContext}${researchContext}${weatherContext}${recentEventsContext}${culturalContext}${timeContext}${modeInstruction}${playAsInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${conversationLog}\n\nWrite your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n- CULTURAL AWARENESS: When the user references celebrities, TV shows, music, entertainment, or cultural topics, you recognize them as real and familiar. You respond naturally without confusion or over-explanation. Your response should reflect your personality — some characters care deeply about entertainment, others less so — but you never pretend not to know widely recognized figures or trends.\n\nRespond ONLY with valid JSON in this format:\n{\n  "text": "Your message here",\n  "image_prompt": "Only include if sending exactly 1 image AND allowed this turn — a vivid description of the image",\n  "image_prompts": ["Only include if user requested multiple images — one entry per image"],\n  "scheduled_events": [\n    {\n      "description": "What will happen (e.g. 'Tiffany picks up the user at their apartment')",\n      "trigger_time": "<ISO 8601 UTC datetime — resolve relative times like '1pm' or 'tonight at 8' against the current date/time provided above>"\n    }\n  ]\n}\nOnly include scheduled_events if a specific real-world action with a concrete time is committed to in this message. Omit fields you don't use.\n\n${imageRule}`;


      const uncomfortableStates = ['irritated', 'defensive', 'closed-off'];
      const isUncomfortable = uncomfortableStates.includes(character.emotional_state);

      // Apply response lag if enabled
      const responseLagEnabled = userSettings.response_lag_enabled !== false;
      if (responseLagEnabled) {
        const lookupDelayMs = (weatherContext || recentEventsContext) ? 2500 : 0;
        const baseThinkingDelayMs = isUncomfortable
          ? (30 + Math.random() * 30) * 1000
          : (5 + Math.random() * 15) * 1000;
        await new Promise(r => setTimeout(r, baseThinkingDelayMs + lookupDelayMs));
      }


      // Robust parser: always returns a clean { text, image_prompt, image_prompts, scheduled_events }
      const parseCharacterResponse = (raw) => {
        if (!raw) return { text: "" };

        // 1. Try direct JSON parse (handles clean responses)
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj === "object") return obj;
        } catch {}

        // 2. Try to extract JSON block from markdown code fences or partial wrapping
        const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenceMatch) {
          try {
            const obj = JSON.parse(fenceMatch[1].trim());
            if (obj && typeof obj === "object") return obj;
          } catch {}
        }

        // 3. Try to find a JSON object anywhere in the string
        const braceMatch = raw.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          try {
            const obj = JSON.parse(braceMatch[0]);
            if (obj && typeof obj === "object") return obj;
          } catch {}
        }

        // 4. Regex-extract just the "text" field value from malformed JSON
        const textFieldMatch = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textFieldMatch) {
          try {
            return { text: JSON.parse(`"${textFieldMatch[1]}"`) };
          } catch {
            return { text: textFieldMatch[1] };
          }
        }

        // 5. Last resort: strip obvious JSON scaffolding and return what's left
        const stripped = raw
          .replace(/```(?:json)?/gi, "")
          .replace(/```/g, "")
          .replace(/"?(text|image_prompt|image_prompts|scheduled_events|trigger_time|description)"\s*:\s*/gi, "")
          .replace(/^\s*[\[{\]},]+\s*/gm, "")
          .replace(/[{}\[\]]/g, "")
          .replace(/\\n/g, " ")
          .replace(/\\"/g, '"')
          .trim();

        // If what remains looks like readable text (not just symbols/whitespace), use it
        if (stripped.length > 10 && /[a-zA-Z]/.test(stripped)) {
          return { text: stripped };
        }

        return { text: "" };
      };

      let retries = 2;
      let responseObj = { text: "", image_prompt: null };
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
      responseText = responseObj.text?.trim() || "Sorry, something went wrong with that response.";

      // Safety net: if responseText still looks like raw JSON, replace it
      if (responseText.startsWith("{") || responseText.startsWith("```")) {
        responseText = "Sorry, something went wrong with that response.";
      }
      // Support both single image_prompt and multiple image_prompts array
      // Also enforce the gate: if not allowed, discard any image_prompt the LLM snuck in
      imagePrompt = allowImageThisTurn ? (responseObj.image_prompt || null) : null;
      imagePrompts = allowImageThisTurn
        ? (responseObj.image_prompts?.length > 0 ? responseObj.image_prompts : (imagePrompt ? [imagePrompt] : []))
        : [];

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

    // Capture achievement events from this interaction (fire-and-forget)
    if (userMsg?.id && character?.id) {
      setTimeout(() => {
        base44.functions.invoke('captureAchievementEventV2', {
          event_type: 'message_sent',
          character_id: character.id,
          conversation_id: convoId,
          message_id: userMsg.id,
          metadata: {
            has_image: !!userImageUrl,
            text_length: text.length,
            response_received: !!responseText
          }
        }).catch(err => console.warn('[Chat] Achievement capture error:', err.message));
      }, 100);
    }

    // DECISION: If we have both text and image, send them as two separate messages
    const hasBothTextAndImage = responseText && imagePrompts.length > 0;

    let primaryCharMsg = null; // The first message (text or image)
    let secondaryCharMsg = null; // The second message if sending both

    if (hasBothTextAndImage) {
      // STRATEGY: Deliver text message, then queue voice generation
      // Voice is optional and will NOT block the message from appearing

      // 1. Create and save text message immediately
       primaryCharMsg = await base44.entities.Message.create({
         conversation_id: convoId,
         sender_type: "character",
         character_id: characterId,
         character_name: character.name,
         content: responseText,
         emotional_state: emotionalState,
         timestamp: new Date().toISOString(),
       });

       if (!primaryCharMsg || !primaryCharMsg.id) {
         setSendError("Character response failed to save. Try again.");
         return;
       }

       console.log(`[Chat] CHARACTER TEXT MESSAGE SAVED: ${primaryCharMsg.id.substring(0, 8)} | "${responseText.substring(0, 50)}${responseText.length > 50 ? '...' : ''}"`);
       // Message is delivered and visible immediately
       setMessages(prev => prev.some(m => m.id === primaryCharMsg.id) ? prev : [...prev, primaryCharMsg]);

       // Voice generation happens AFTER message delivery (fire-and-forget)
       const textMsgId = primaryCharMsg.id;
       setTimeout(() => {
         generateAndPlayVoice(textMsgId, responseText, character, userSettings);
       }, 300);

      // 2. Create image-only message(s) separately after a delay
      // This gives the text time to render and prevents image generation from blocking text
      const userRefImages = currentUser.generated_avatar_urls?.length > 0
        ? currentUser.generated_avatar_urls
        : (currentUser.reference_image_urls || []);

      const msgLower = text.toLowerCase();
      const isJointRequest = /\b(us|together|both|with (you and me|me and you|each other)|the two of us|selfie with (me|you))\b/i.test(msgLower);
      const isUserRequest = !isJointRequest && (
        /\b(pic|photo|picture|image|selfie|shot)\s*(of me|of myself)\b/i.test(msgLower) ||
        /\b(send|show|give|share)\s*(me\s*)?(a\s*)?(pic|photo|picture|selfie)\s*(of me|of myself)\b/i.test(msgLower) ||
        /\bpicture of me\b|\bphoto of me\b|\bpic of me\b/i.test(msgLower)
      );
      const subjectType = isJointRequest ? "joint" : isUserRequest ? "user" : "character";
      const useUserRefs = (subjectType === "joint" || subjectType === "user") && userRefImages.length > 0;
      const charRefs = character.avatar_url
        ? [character.avatar_url, ...(character.reference_image_urls || [])]
        : (character.reference_image_urls || []);

      // Create separate image message(s) after text has rendered
      setTimeout(async () => {
        // First image gets its own message
        secondaryCharMsg = await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: "character",
          character_id: characterId,
          character_name: character.name,
          content: "", // Image-only message: no text
          emotional_state: emotionalState,
          timestamp: new Date().toISOString(),
        });

        if (secondaryCharMsg?.id) {
          console.log(`[Chat] IMAGE MESSAGE CREATED (placeholder): ${secondaryCharMsg.id.substring(0, 8)}`);
          setMessages(prev => prev.some(m => m.id === secondaryCharMsg.id) ? prev : [...prev, secondaryCharMsg]);

          // Generate image for the image-only message (will update via subscription)
          base44.functions.invoke('generateImageAsync', {
            messageId: secondaryCharMsg.id,
            prompt: imagePrompts[0],
            characterReferenceImages: charRefs,
            userReferenceImages: useUserRefs ? userRefImages : [],
            characterName: character.name,
            subjectType,
          }).catch((err) => console.error(`[Chat] Image generation failed for ${secondaryCharMsg.id.substring(0, 8)}:`, err));
        }

        // Additional images (if multiple requested) get their own separate messages too
        for (let i = 1; i < imagePrompts.length; i++) {
          const extraImageMsg = await base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: "character",
            character_id: characterId,
            character_name: character.name,
            content: "",
            emotional_state: emotionalState,
            timestamp: new Date().toISOString(),
          });

          if (extraImageMsg?.id) {
            console.log(`[Chat] IMAGE MESSAGE CREATED (placeholder): ${extraImageMsg.id.substring(0, 8)}`);
            setMessages(prev => prev.some(m => m.id === extraImageMsg.id) ? prev : [...prev, extraImageMsg]);
            setTimeout(() => {
              base44.functions.invoke('generateImageAsync', {
                messageId: extraImageMsg.id,
                prompt: imagePrompts[i],
                characterReferenceImages: charRefs,
                userReferenceImages: useUserRefs ? userRefImages : [],
                characterName: character.name,
                subjectType,
              }).catch((err) => console.error(`[Chat] Image generation failed for ${extraImageMsg.id.substring(0, 8)}:`, err));
            }, i * 500);
          }
        }
      }, 1800); // Delay before sending image message(s) so text renders first

    } else if (responseText && !imagePrompts.length) {
       // TEXT-ONLY MESSAGE - deliver immediately
       primaryCharMsg = await base44.entities.Message.create({
         conversation_id: convoId,
         sender_type: "character",
         character_id: characterId,
         character_name: character.name,
         content: responseText,
         emotional_state: emotionalState,
         timestamp: new Date().toISOString(),
       });

       if (!primaryCharMsg || !primaryCharMsg.id) {
         setSendError("Character response failed to save. Try again.");
         return;
       }

       console.log(`[Chat] CHARACTER TEXT MESSAGE SAVED: ${primaryCharMsg.id.substring(0, 8)} | "${responseText.substring(0, 50)}${responseText.length > 50 ? '...' : ''}"`);
       // Message delivered and visible immediately
       setMessages(prev => prev.some(m => m.id === primaryCharMsg.id) ? prev : [...prev, primaryCharMsg]);

       // Voice generation happens AFTER message is safe (fire-and-forget)
       const textMsgId = primaryCharMsg.id;
       setTimeout(() => {
         generateAndPlayVoice(textMsgId, responseText, character, userSettings);
       }, 300);

    } else if (!responseText && imagePrompts.length > 0) {
      // IMAGE-ONLY MESSAGE(S)
      const userRefImages = currentUser.generated_avatar_urls?.length > 0
        ? currentUser.generated_avatar_urls
        : (currentUser.reference_image_urls || []);

      const msgLower = text.toLowerCase();
      const isJointRequest = /\b(us|together|both|with (you and me|me and you|each other)|the two of us|selfie with (me|you))\b/i.test(msgLower);
      const isUserRequest = !isJointRequest && (
        /\b(pic|photo|picture|image|selfie|shot)\s*(of me|of myself)\b/i.test(msgLower) ||
        /\b(send|show|give|share)\s*(me\s*)?(a\s*)?(pic|photo|picture|selfie)\s*(of me|of myself)\b/i.test(msgLower) ||
        /\bpicture of me\b|\bphoto of me\b|\bpic of me\b/i.test(msgLower)
      );
      const subjectType = isJointRequest ? "joint" : isUserRequest ? "user" : "character";
      const useUserRefs = (subjectType === "joint" || subjectType === "user") && userRefImages.length > 0;
      const charRefs = character.avatar_url
        ? [character.avatar_url, ...(character.reference_image_urls || [])]
        : (character.reference_image_urls || []);

      // Create image message
      primaryCharMsg = await base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "character",
        character_id: characterId,
        character_name: character.name,
        content: "",
        emotional_state: emotionalState,
        timestamp: new Date().toISOString(),
      });

      if (primaryCharMsg?.id) {
        console.log(`[Chat] IMAGE-ONLY MESSAGE CREATED: ${primaryCharMsg.id.substring(0, 8)}`);
        setMessages(prev => prev.some(m => m.id === primaryCharMsg.id) ? prev : [...prev, primaryCharMsg]);

        // Generate first image
        setTimeout(() => {
          base44.functions.invoke('generateImageAsync', {
            messageId: primaryCharMsg.id,
            prompt: imagePrompts[0],
            characterReferenceImages: charRefs,
            userReferenceImages: useUserRefs ? userRefImages : [],
            characterName: character.name,
            subjectType,
          }).catch((err) => console.error(`[Chat] Image generation failed for ${primaryCharMsg.id.substring(0, 8)}:`, err));
        }, 300);

        // Additional images get their own messages
        for (let i = 1; i < imagePrompts.length; i++) {
          const extraImageMsg = await base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: "character",
            character_id: characterId,
            character_name: character.name,
            content: "",
            emotional_state: emotionalState,
            timestamp: new Date().toISOString(),
          });

          if (extraImageMsg?.id) {
            console.log(`[Chat] IMAGE MESSAGE CREATED: ${extraImageMsg.id.substring(0, 8)}`);
            setMessages(prev => prev.some(m => m.id === extraImageMsg.id) ? prev : [...prev, extraImageMsg]);
            const capturedId = extraImageMsg.id;
            const capturedPrompt = imagePrompts[i];
            setTimeout(() => {
              base44.functions.invoke('generateImageAsync', {
                messageId: capturedId,
                prompt: capturedPrompt,
                characterReferenceImages: charRefs,
                userReferenceImages: useUserRefs ? userRefImages : [],
                characterName: character.name,
                subjectType,
              }).catch((err) => console.error(`[Chat] Image generation failed for ${capturedId.substring(0, 8)}:`, err));
            }, 300 + i * 500);
          }
        }
      }
    }

    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    }

    // CRITICAL: Do NOT invalidate message queries
    // Subscription handles all message updates in real-time
    // Query invalidation would fetch stale data and overwrite newly delivered messages

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

    base44.functions.invoke("updateRelationshipLevels", {
      characterId,
      userMessage: text,
      characterReply: responseText,
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

    // Invalidate character to update relationships/emotions (NOT messages)
    // Subscription will handle message updates, not query invalidation
    queryClient.invalidateQueries({ queryKey: ["character", characterId] });

    // Update conversation metadata
    await base44.entities.Conversation.update(convoId, {
      last_message_preview: responseText.substring(0, 100),
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
              onPlayVoice={msg.sender_type !== "user" && !msg.is_narrative ? () => generateAndPlayVoice(msg.id, msg.content, character, userSettings) : null}
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
      <BottomNav />
    </div>
  );
}