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
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import CharacterStatusPopup from "@/components/character/CharacterStatusPopup";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import { BarChart2, BookOpen } from "lucide-react";

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
  const bottomRef = useRef(null);
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

  useEffect(() => {
    if (!characterId || !character) return;
    const loadConvo = async () => {
      // Fetch conversations first, then pending messages sequentially to avoid rate limits
      const convos = await base44.entities.Conversation.filter({ type: chatType, character_ids: [characterId] }, "-updated_date", 1);
      await new Promise(r => setTimeout(r, 200));
      const pending = await base44.entities.PendingMessage.filter({ character_id: characterId, delivered: false });
      let convoId = null;

      if (convos.length > 0) {
        convoId = convos[0].id;
        
        const loadedMsgs = await base44.entities.Message.filter({ conversation_id: convoId }, "created_date");
        setMessages(loadedMsgs);
        setConversationId(convoId);

        // Mark unread messages as read sequentially with delays to avoid rate limits
        const unread = loadedMsgs.filter(m => m.sender_type === "character" && !m.is_read);
        for (const m of unread) {
          await base44.entities.Message.update(m.id, { is_read: true });
          await new Promise(r => setTimeout(r, 150));
        }
      }

      if (pending.length > 0 && !convoId) {
        const pm = pending[0];
        const convo = await base44.entities.Conversation.create({
          title: `${chatType} with ${character.name}`,
          type: chatType,
          character_ids: [characterId],
        });
        convoId = convo.id;
        setConversationId(convoId);

        await new Promise(r => setTimeout(r, 1200));

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

        setMessages(prev => [...prev, charMsg]);
        await base44.entities.PendingMessage.update(pm.id, { delivered: true });
        await base44.entities.Conversation.update(convoId, {
          last_message_preview: pm.content.substring(0, 100),
          last_message_date: new Date().toISOString(),
        });
      }
    };

    // Small delay to avoid rate limiting when navigating quickly between pages
    const timer = setTimeout(() => loadConvo(), 300);
    return () => {
      clearTimeout(timer);
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [characterId, character, chatType]);

  useEffect(() => {
    if (!conversationId) return;

    if (unsubscribeRef.current) unsubscribeRef.current();

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data.conversation_id === conversationId) {
        if (event.type === "create") {
          setMessages(prev => {
            if (prev.some(m => m.id === event.data.id)) return prev;
            return [...prev, event.data];
          });
          if (event.data.sender_type === "character" && !event.data.is_read) {
            base44.entities.Message.update(event.data.id, { is_read: true });
          }
        } else if (event.type === "update") {
          setMessages(prev => prev.map(m => m.id === event.data.id ? { ...m, ...event.data } : m));
        }
      }
    });
    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [conversationId]);

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
    });
    if (!userMsg || !userMsg.id) {
       setSendError("Message failed to save. Try again.");
       return;
     }
    setMessages(prev => prev.some(m => m.id === userMsg.id) ? prev : [...prev, userMsg]);
    setIsTyping(true);

    let recentMsgs, response, responseText, emotionalState, imagePrompt, detailReferenceImage = null;
    try {
      recentMsgs = [...messages.slice(-50), userMsg];
      const chatHistory = recentMsgs.map(m => ({
        role: m.sender_type === "user" ? "user" : "assistant",
        content: m.content,
      }));

      const userSettings = settings?.[0] || {};
      const lengthInstruction = { short: "Keep responses to 1-2 sentences max.", medium: "Keep responses natural length, 1-4 sentences.", long: "You can elaborate more, up to a paragraph." }[userSettings.response_length || "medium"];
      const intensityInstruction = { low: "React with mild emotional responses.", medium: "React naturally with moderate emotional responses.", high: "React with strong, intense emotional responses." }[userSettings.emotional_intensity || "medium"];

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

      // Fetch current weather ONLY if conversation seems weather-related
      let weatherContext = "";
      const weatherKeywords = /\b(weather|rain|raining|sunny|cold|hot|warm|freezing|snow|snowing|storm|cloudy|outside|outdoors|going out|what's it like|nice out|bad out|degrees|temperature|humid|windy|fog|foggy)\b/i;
      if (character.city && character.state && weatherKeywords.test(text)) {
        try {
          const weatherRes = await base44.integrations.Core.InvokeLLM({
            prompt: `What is the current weather right now in ${character.city}, ${character.state}? Include temperature, conditions (sunny, rainy, cloudy, etc.), and any notable weather patterns. Be specific and accurate.`,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
          weatherContext = `\n\nCURRENT WEATHER: Right now in ${character.city}, ${character.state}: ${weatherRes}. Naturally reference this weather in your response if it fits the conversation - mention how it affects your mood, what you're doing, or what you're wearing. Don't force it, but weave it in naturally.`;
        } catch (weatherErr) {
          // Weather lookup failed, continue without it
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

      const userDisplayName = userSettings.fictional_world_name || null;
      const systemPrompt = character.system_prompt || buildSystemPrompt(character, [], userDisplayName);
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${memoryContext}${researchContext}${weatherContext}${recentEventsContext}${modeInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${chatHistory.map(m => `${m.role === "user" ? "User" : character.name}: ${m.content}`).join("\n")}\n\nWrite your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n\nRespond ONLY with valid JSON in this format:\n{\n  "text": "Your message here",\n  "image_prompt": "Optional: A vivid description of an image you want to send, or omit this field if no image"\n}\n\nCRITICAL IMAGE RULES:\n- If the user asks for a picture of "me", "myself", or "of the user" — the image_prompt must describe THE USER, not you. Generate an image of the person the user represents.\n- If the user asks for a picture of "you", "yourself", or your name — then the image_prompt should describe you, ${character.name}.\n- Never confuse who "me" refers to. "Send me a pic of me" = image of the user. "Send me a pic of you" = image of you.\n\n${character.is_photogenic ? "BONUS TRAIT: You LOVE being photographed and sending pics. Include image prompts often when it feels natural." : ""}`;


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


      let retries = 2;
      let responseObj = { text: "", image_prompt: null };
      while (retries >= 0) {
        try {
          response = await base44.integrations.Core.InvokeLLM({
            prompt: fullPrompt,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
          try {
            responseObj = JSON.parse(response);
          } catch (parseErr) {
            // Fallback: if not valid JSON, treat as plain text
            responseObj = { text: response.replace(/^[\w\s]+:\s*/i, "").trim() };
          }
          break;
        } catch (llmErr) {
          if (retries === 0) throw llmErr;
          retries--;
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      responseText = responseObj.text?.trim() || "";
      imagePrompt = responseObj.image_prompt;

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

    // Create main message with text
    // Add message optimistically to state immediately (subscription will deduplicate)
    const charMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: characterId,
      character_name: character.name,
      content: responseText,
      emotional_state: emotionalState,
      timestamp: new Date().toISOString(),
    });
    if (!charMsg || !charMsg.id) {
      setSendError("Character response failed to save. Try again.");
      return;
    }
    // Add directly to state — subscription deduplication will prevent doubles
    setMessages(prev => prev.some(m => m.id === charMsg.id) ? prev : [...prev, charMsg]);

    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    }
    
    // Generate image asynchronously if the character wants to send one
    if (imagePrompt) {
      // Detect if the image is about the user (not the character)
      const isAboutUser = /\buser\b|\bme\b|\bmyself\b/i.test(imagePrompt) && !/\b(you|yourself|your|character)\b/i.test(imagePrompt);
      const userSettings0 = settings?.[0] || {};
      // Use user's reference images if available and image is about the user
      const userRefImages = userSettings0.reference_image_urls || [];
      const refImages = isAboutUser && userRefImages.length > 0 ? userRefImages : (character.reference_image_urls || []);
      setTimeout(() => {
        base44.functions.invoke('generateImageAsync', {
          messageId: charMsg.id,
          prompt: imagePrompt,
          referenceImageUrls: refImages
        }).catch(() => {});
      }, 500);
    }
    
    // Invalidate messages so async image updates appear when ready
    queryClient.invalidateQueries({ queryKey: ["messages", convoId] });

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

    base44.functions.invoke("updateRelationshipLevels", {
      characterId,
      userMessage: text,
      characterReply: responseText,
      recentMessages: recentMsgs,
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
        {character && <CharacterAvatar character={character} size="sm" />}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{character?.name || "Loading..."}</h2>
          <p className="text-xs text-muted-foreground">{isPhone ? "Texting" : "Talking"}</p>
        </div>
        {character && <MediaGallery messages={messages} />}
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
        <AnimatePresence>
          {messages.map(msg => <MessageBubble key={msg.id} message={msg} onReact={handleReact} onDelete={handleDeleteMessage} />)}
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
      <ChatInput onSend={sendMessage} draftKey={characterId} />
      <NarrativeBuilderPopup
        isOpen={showNarrativeBuilder}
        onClose={() => setShowNarrativeBuilder(false)}
        characterId={characterId}
        conversationId={conversationId}
        chatHistory={messages}
        onNarrativeSubmitted={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
      />
      <BottomNav />
    </div>
  );
}