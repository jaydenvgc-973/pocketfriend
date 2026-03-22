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
import { buildSystemPrompt } from "@/lib/defaultCharacter";

export default function Chat() {
  const { characterId } = useParams();
  const urlParams = new URLSearchParams(window.location.search);
  const chatType = urlParams.get("type") || "direct";
  const isPhone = chatType === "phone";

  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const bottomRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: character } = useQuery({
    queryKey: ["character", characterId],
    queryFn: async () => {
      const chars = await base44.entities.Character.list();
      return chars.find(c => c.id === characterId);
    },
    enabled: !!characterId,
  });

  const { data: settings } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
    initialData: [],
  });

  // Load existing conversation
  useEffect(() => {
    if (!characterId) return;
    const loadConvo = async () => {
      const convos = await base44.entities.Conversation.filter({
        type: chatType,
        character_ids: [characterId],
      });
      if (convos.length > 0) {
        setConversationId(convos[0].id);
        const msgs = await base44.entities.Message.filter(
          { conversation_id: convos[0].id },
          "created_date",
          100
        );
        setMessages(msgs);
      }
    };
    loadConvo();
  }, [characterId, chatType]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const sendMessage = async (text) => {
    if (!character) return;

    let convoId = conversationId;
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
      timestamp: new Date().toISOString(),
    });
    setMessages(prev => [...prev, userMsg]);

    setIsTyping(true);

    // Build context from recent messages
    const recentMsgs = [...messages.slice(-20), userMsg];
    const chatHistory = recentMsgs.map(m => ({
      role: m.sender_type === "user" ? "user" : "assistant",
      content: m.content,
    }));

    const userSettings = settings?.[0] || {};
    const lengthInstruction = {
      short: "Keep responses to 1-2 sentences max.",
      medium: "Keep responses natural length, 1-4 sentences.",
      long: "You can elaborate more, up to a paragraph."
    }[userSettings.response_length || "medium"];

    const intensityInstruction = {
      low: "React with mild emotional responses.",
      medium: "React naturally with moderate emotional responses.",
      high: "React with strong, intense emotional responses."
    }[userSettings.emotional_intensity || "medium"];

    const systemPrompt = character.system_prompt || buildSystemPrompt(character);
    const modeInstruction = isPhone
      ? "\n\nYOU ARE TEXTING. Keep messages short like real texts. Use casual abbreviations sometimes. No long paragraphs. React like you would in a real text conversation."
      : "";

    const fullPrompt = `${systemPrompt}${modeInstruction}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${chatHistory.map(m => `${m.role === "user" ? "User" : character.name}: ${m.content}`).join("\n")}\n\nWrite ONLY your next reply as ${character.name}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Do NOT sound like a motivational quote. Just say what you'd actually say — short, unpolished, real.`;

    // Simulate typing delay for phone mode
    if (isPhone) {
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1500));
    }

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: fullPrompt,
    });

    // Strip any leading "Name:" or "Name: " prefix the LLM might add
    let responseText = response.replace(/^[\w\s]+:\s*/i, "").trim();
    let emotionalState = character.emotional_state || "calm";

    // Check if the character wants to send an image
    const imageMatch = responseText.match(/\[IMAGE:\s*(.+?)\]/i);
    let imageUrl = null;
    if (imageMatch) {
      const imagePrompt = imageMatch[1];
      responseText = responseText.replace(imageMatch[0], "").trim();
      const imgResult = await base44.integrations.Core.GenerateImage({ prompt: imagePrompt });
      imageUrl = imgResult.url;
    }

    setIsTyping(false);

    const charMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: characterId,
      character_name: character.name,
      content: responseText,
      emotional_state: emotionalState,
      timestamp: new Date().toISOString(),
    });
    setMessages(prev => [...prev, charMsg]);

    // Update character emotional state
    if (emotionalState !== character.emotional_state) {
      await base44.entities.Character.update(characterId, { emotional_state: emotionalState });
      queryClient.invalidateQueries({ queryKey: ["character", characterId] });
    }

    // Update conversation
    await base44.entities.Conversation.update(convoId, {
      last_message_preview: responseText.substring(0, 100),
      last_message_date: new Date().toISOString(),
      emotional_context: emotionalState,
    });
  };

  return (
    <div className={`h-screen flex flex-col bg-background ${isPhone ? "max-w-lg mx-auto" : ""}`}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-border ${isPhone ? "bg-card" : "bg-background/80 backdrop-blur-xl"}`}>
        <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        {character && <CharacterAvatar character={character} size="sm" />}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{character?.name || "Loading..."}</h2>
          <p className="text-xs text-muted-foreground">{isPhone ? "Texting" : "Talking"}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.length === 0 && character && (
          <div className="text-center py-16 px-6">
            <CharacterAvatar character={character} size="xl" />
            <p className="text-sm text-muted-foreground mt-4">
              {isPhone ? `Start texting ${character.name}` : `Start talking to ${character.name}`}
            </p>
          </div>
        )}
        <AnimatePresence>
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {isTyping && character && <TypingIndicator name={character.name} />}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <ChatInput onSend={sendMessage} disabled={isTyping} />
    </div>
  );
}