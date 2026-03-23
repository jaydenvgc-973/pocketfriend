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
import { BarChart2 } from "lucide-react";

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
  const bottomRef = useRef(null);
  const queryClient = useQueryClient();
  const conversationIdRef = useRef(null);
  const unsubscribeRef = useRef(null);

  const { data: character } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.list();
      return chars.find(c => c.id === characterId);
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
      const convos = await base44.entities.Conversation.filter({ type: chatType, character_ids: [characterId] }, "-updated_date", 1);
      let convoId = null;

      if (convos.length > 0) {
        convoId = convos[0].id;
        
        // Always load messages from database for this conversation
        const loadedMsgs = await base44.entities.Message.filter({ conversation_id: convoId }, "created_date");
        setMessages(loadedMsgs);
        setConversationId(convoId);
        conversationIdRef.current = convoId;
      }

      // Subscribe to new messages for this conversation (whether it exists or will be created)
      if (unsubscribeRef.current) unsubscribeRef.current();
      const unsubscribe = base44.entities.Message.subscribe((event) => {
        if (event.type === "create" && event.data.conversation_id === conversationIdRef.current) {
          setMessages(prev => {
            // Avoid duplicates: only add if not already present
            if (prev.some(m => m.id === event.data.id)) return prev;
            return [...prev, event.data];
          });
        }
      });
      unsubscribeRef.current = unsubscribe;

      // Check for pending proactive messages
      const pending = await base44.entities.PendingMessage.filter({ character_id: characterId, delivered: false });
      if (pending.length > 0 && !convoId) {
        const pm = pending[0];
        const convo = await base44.entities.Conversation.create({
          title: `${chatType} with ${character.name}`,
          type: chatType,
          character_ids: [characterId],
        });
        convoId = convo.id;
        setConversationId(convoId);
        conversationIdRef.current = convoId;

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

    loadConvo();
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [characterId, character, chatType]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const [sendError, setSendError] = useState(null);

  const handleReact = async (messageId, emoji) => {
    // Find the message
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;

    // Toggle: if user already reacted with this emoji, remove it
    const existing = (msg.reactions || []).find(r => r.reactor_type === "user" && r.emoji === emoji);
    const updatedReactions = existing
      ? msg.reactions.filter(r => !(r.reactor_type === "user" && r.emoji === emoji))
      : [...(msg.reactions || []), { emoji, reactor_type: "user", reactor_id: "user" }];

    // Optimistic update
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: updatedReactions } : m));
    await base44.entities.Message.update(messageId, { reactions: updatedReactions });

    // If user is reacting to a character's message, trigger character reaction awareness & relationship update
    if (msg.sender_type === "character" && !existing && character) {
      base44.functions.invoke("updateRelationshipLevels", {
        characterId,
        emojiReaction: emoji,
        reactedMessageContent: msg.content || "(image)",
        reactedMessageSenderType: msg.sender_type,
        recentMessages: messages.slice(-10),
      }).then(res => {
        if (res?.data?.reason) setLastChangeReason(res.data.reason);
        queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      }).catch(() => {});

      // Small chance the character reacts back to user messages too
      setTimeout(async () => {
        // Generate character's emoji reaction to a user message if applicable
        if (msg.sender_type === "character") {
          // Character might react to being reacted to (e.g., heart back on their own message)
          // This is a lightweight reaction — no LLM call, just mirror or complement occasionally
          const complementMap = { "❤️": "❤️", "😂": "😂", "😮": null, "😢": "😢", "😡": null, "👍": "👍" };
          const charEmoji = complementMap[emoji];
          if (charEmoji && Math.random() > 0.5) {
            const withCharReaction = [...updatedReactions, { emoji: charEmoji, reactor_type: "character", reactor_id: characterId }];
            await base44.entities.Message.update(messageId, { reactions: withCharReaction });
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: withCharReaction } : m));
          }
        }
      }, 1500 + Math.random() * 2000);
    }

    // If user reacts to their OWN message, character may also react to that message
    if (msg.sender_type === "user" && !existing && character) {
      setTimeout(async () => {
        const reloadedMsg = await base44.entities.Message.get ? null : null; // use current state
        const currentReactions = (messages.find(m => m.id === messageId)?.reactions || updatedReactions);
        const alreadyCharReacted = currentReactions.some(r => r.reactor_type === "character");
        if (!alreadyCharReacted) {
          // Character reacts to user's own message — context-based
          const responseMap = { "❤️": "😮", "😂": "😂", "😢": "😢", "👍": "👍", "😡": "😮", "😮": "😂" };
          const charEmoji = responseMap[emoji];
          if (charEmoji && Math.random() > 0.4) {
            const withCharReaction = [...currentReactions, { emoji: charEmoji, reactor_type: "character", reactor_id: characterId }];
            await base44.entities.Message.update(messageId, { reactions: withCharReaction });
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: withCharReaction } : m));
          }
        }
      }, 2000 + Math.random() * 3000);
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

    let convoId = conversationIdRef.current || conversationId;
    if (!convoId) {
      const convo = await base44.entities.Conversation.create({
        title: `${chatType} with ${character.name}`,
        type: chatType,
        character_ids: [characterId],
      });
      convoId = convo.id;
      setConversationId(convoId);
      conversationIdRef.current = convoId;

      // Set up subscription for this new conversation
       if (unsubscribeRef.current) unsubscribeRef.current();
       const unsubscribe = base44.entities.Message.subscribe((event) => {
         if (event.type === "create" && event.data.conversation_id === conversationIdRef.current) {
           setMessages(prev => {
             if (prev.some(m => m.id === event.data.id)) return prev;
             return [...prev, event.data];
           });
         }
       });
       unsubscribeRef.current = unsubscribe;
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
     setIsTyping(true);

    let recentMsgs, response, responseText, emotionalState, imageUrl;
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

      const systemPrompt = character.system_prompt || buildSystemPrompt(character);
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

      const fullPrompt = `${systemPrompt}${educationContext}${songsContext}${modeInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${chatHistory.map(m => `${m.role === "user" ? "User" : character.name}: ${m.content}`).join("\n")}\n\nWrite ONLY your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.`;

      const uncomfortableStates = ['irritated', 'defensive', 'closed-off'];
      const isUncomfortable = uncomfortableStates.includes(character.emotional_state);
      const delayMs = isUncomfortable
        ? (60 + Math.random() * 60) * 1000
        : isPhone
          ? 800 + Math.random() * 1500
          : (5 + Math.random() * 55) * 1000;
      await new Promise(r => setTimeout(r, delayMs));

      let retries = 2;
      while (retries >= 0) {
        try {
          response = await base44.integrations.Core.InvokeLLM({
            prompt: fullPrompt,
            add_context_from_internet: true,
            model: 'gemini_3_flash'
          });
          break;
        } catch (llmErr) {
          if (retries === 0) throw llmErr;
          retries--;
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      responseText = response.replace(/^[\w\s]+:\s*/i, "").trim();
      emotionalState = character.emotional_state || "calm";
      imageUrl = null;
    } catch (err) {
      setIsTyping(false);
      setSendError("Couldn't get a response. Try again.");
      return;
    }

    setIsTyping(false);

    const charMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: characterId,
      character_name: character.name,
      content: responseText,
      image_url: imageUrl || undefined,
      emotional_state: emotionalState,
      timestamp: new Date().toISOString(),
    });
    if (!charMsg || !charMsg.id) {
       setSendError("Character response failed to save. Try again.");
       return;
     }

    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    }

    // Character occasionally reacts with an emoji to the user's message
    if (Math.random() > 0.6) {
      const emojiByEmotion = {
        calm: ["👍", "❤️", "😂"],
        reflective: ["😢", "😮", "❤️"],
        irritated: ["😡", "😮"],
        defensive: ["😡", "😮"],
        "closed-off": ["😮"],
      };
      const pool = emojiByEmotion[emotionalState] || ["👍"];
      const pickedEmoji = pool[Math.floor(Math.random() * pool.length)];
      setTimeout(async () => {
        const updatedUserMsgReactions = [...(userMsg.reactions || []), { emoji: pickedEmoji, reactor_type: "character", reactor_id: characterId }];
        await base44.entities.Message.update(userMsg.id, { reactions: updatedUserMsgReactions });
        setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, reactions: updatedUserMsgReactions } : m));
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
    }).then(res => {
      if (res?.data?.reason) setLastChangeReason(res.data.reason);
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
          {messages.map(msg => <MessageBubble key={msg.id} message={msg} onReact={handleReact} />)}
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
      <ChatInput onSend={sendMessage} />
      <BottomNav />
    </div>
  );
}