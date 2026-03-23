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
    if (!characterId) return;
    const loadConvo = async () => {
      const convos = await base44.entities.Conversation.filter({ type: chatType, character_ids: [characterId] });
      let convoId = null;
      let loadedMsgs = [];

      if (convos.length > 0) {
        convoId = convos[0].id;
        setConversationId(convoId);
        conversationIdRef.current = convoId;
        loadedMsgs = await base44.entities.Message.filter({ conversation_id: convoId }, "created_date", 100);
        setMessages(loadedMsgs);
      }

      // Deliver any pending proactive messages from the character
      const pending = await base44.entities.PendingMessage.filter({ character_id: characterId, delivered: false });
      if (pending.length > 0 && character) {
        const pm = pending[0];

        if (!convoId) {
          const convo = await base44.entities.Conversation.create({
            title: `${chatType} with ${character.name}`,
            type: chatType,
            character_ids: [characterId],
          });
          convoId = convo.id;
          setConversationId(convoId);
          conversationIdRef.current = convoId;
        }

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
    if (character) loadConvo();
  }, [characterId, chatType, character]);

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

  const sendMessage = async (text, userImageUrl) => {
    if (!character) return;
    setSendError(null);

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
    }

    const userMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "user",
      content: text,
      image_url: userImageUrl || undefined,
      timestamp: new Date().toISOString(),
    });
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    let recentMsgs, response, responseText, emotionalState, imageUrl;
    try {
      recentMsgs = [...messages.slice(-20), userMsg];
      const chatHistory = recentMsgs.map(m => ({
        role: m.sender_type === "user" ? "user" : "assistant",
        content: m.content,
      }));

      const userSettings = settings?.[0] || {};
      const lengthInstruction = { short: "Keep responses to 1-2 sentences max.", medium: "Keep responses natural length, 1-4 sentences.", long: "You can elaborate more, up to a paragraph." }[userSettings.response_length || "medium"];
      const intensityInstruction = { low: "React with mild emotional responses.", medium: "React naturally with moderate emotional responses.", high: "React with strong, intense emotional responses." }[userSettings.emotional_intensity || "medium"];

      const systemPrompt = character.system_prompt || buildSystemPrompt(character);
      const modeInstruction = isPhone ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs." : "";

      const fullPrompt = `${systemPrompt}${modeInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${chatHistory.map(m => `${m.role === "user" ? "User" : character.name}: ${m.content}`).join("\n")}\n\nWrite ONLY your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.`;

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
          response = await base44.integrations.Core.InvokeLLM({ prompt: fullPrompt });
          break;
        } catch (llmErr) {
          if (retries === 0) throw llmErr;
          retries--;
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      responseText = response.replace(/^[\w\s]+:\s*/i, "").trim();
      emotionalState = character.emotional_state || "calm";

      const imageMatch = responseText.match(/\[IMAGE:\s*(.+?)\]/i);
      imageUrl = null;
      if (imageMatch) {
        const imagePrompt = imageMatch[1];
        responseText = responseText.replace(imageMatch[0], "").trim();
        const refImages = character.reference_image_urls?.length
          ? character.reference_image_urls
          : character.avatar_url
            ? [character.avatar_url]
            : null;
        const lockedPrompt = refImages
          ? `MATCH THE EXACT APPEARANCE of the person in the reference photo(s) — same face, same skin tone, same features. Do NOT alter their look. ${imagePrompt}`
          : imagePrompt;
        const imgResult = refImages
          ? await base44.integrations.Core.GenerateImage({ prompt: lockedPrompt, existing_image_urls: refImages })
          : await base44.integrations.Core.GenerateImage({ prompt: lockedPrompt });
        imageUrl = imgResult.url;
      }
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
    setMessages(prev => [...prev, charMsg]);

    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
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
      queryClient.invalidateQueries({ queryKey: ["character", characterId] });
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