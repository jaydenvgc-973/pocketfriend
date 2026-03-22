import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Users, X } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import TypingIndicator from "@/components/chat/TypingIndicator";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

export default function GroupChat() {
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSetup, setIsSetup] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [typingName, setTypingName] = useState("");
  const bottomRef = useRef(null);

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list(),
    initialData: [],
  });

  const characters = allCharacters.filter(c => !c.is_default && c.status !== "deleted");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const toggleCharacter = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectedCharacters = characters.filter(c => selectedIds.includes(c.id));

  const sendMessage = async (text) => {
    if (selectedCharacters.length === 0) return;
    const userMsg = { id: Date.now().toString(), sender_type: "user", content: text, timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    for (const char of selectedCharacters) {
      setIsTyping(true);
      setTypingName(char.name);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 2000));

      const chatHistory = newMessages.map(m => m.sender_type === "user" ? `User: ${m.content}` : `${m.character_name}: ${m.content}`).join("\n");
      const systemPrompt = char.system_prompt || buildSystemPrompt(char);
      const otherNames = selectedCharacters.filter(c => c.id !== char.id).map(c => c.name).join(", ");

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `${systemPrompt}\n\nYou are in a group conversation with ${otherNames} and the user. Respond naturally. Keep it short and real.\n\nConversation:\n${chatHistory}\n\nRespond as ${char.name} only.`,
      });

      const charMsg = { id: `${Date.now()}-${char.id}`, sender_type: "character", character_id: char.id, character_name: char.name, content: response, emotional_state: char.emotional_state, timestamp: new Date().toISOString() };
      newMessages.push(charMsg);
      setMessages([...newMessages]);
    }
    setIsTyping(false);
  };

  if (!isSetup) {
    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
          <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
          <h2 className="text-sm font-semibold">Create Group Chat</h2>
        </div>
        <div className="max-w-lg mx-auto px-6 py-6">
          <p className="text-sm text-muted-foreground mb-4">Select characters to include:</p>
          <div className="space-y-3">
            {characters.map(c => (
              <div key={c.id} onClick={() => toggleCharacter(c.id)} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${selectedIds.includes(c.id) ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                <Checkbox checked={selectedIds.includes(c.id)} />
                <CharacterAvatar character={c} size="sm" />
                <div>
                  <p className="text-sm font-medium text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.personality_summary?.substring(0, 50)}</p>
                </div>
              </div>
            ))}
          </div>
          <Button onClick={() => setIsSetup(true)} disabled={selectedIds.length < 2} className="w-full mt-6 h-12 rounded-xl">
            <Users className="w-4 h-4 mr-2" /> Start Group Chat ({selectedIds.length} selected)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background max-w-lg mx-auto">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl">
        <button onClick={() => setIsSetup(false)} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex -space-x-2">{selectedCharacters.slice(0, 3).map(c => <CharacterAvatar key={c.id} character={c} size="sm" />)}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{selectedCharacters.map(c => c.name).join(", ")}</h2>
          <p className="text-xs text-muted-foreground">Group chat</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.length === 0 && <div className="text-center py-16"><Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">Start the conversation</p></div>}
        <AnimatePresence>{messages.map(msg => <MessageBubble key={msg.id} message={msg} showName={true} />)}</AnimatePresence>
        <AnimatePresence>{isTyping && <TypingIndicator name={typingName} />}</AnimatePresence>
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={sendMessage} disabled={isTyping} />
    </div>
  );
}