import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Globe, ArrowLeft, User } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function WorldContactsPopup({ isOpen, onClose, character }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef(null);

  const contacts = (character?.fictional_relationships || []).filter(r => r.person_name);

  const selectContact = (contact) => {
    setSelectedContact(contact);
    setMessages([]);
    setInputText("");
  };

  const handleBack = () => {
    setSelectedContact(null);
    setMessages([]);
  };

  const handleClose = () => {
    setSelectedContact(null);
    setMessages([]);
    setInputText("");
    onClose();
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isTyping) return;
    const text = inputText.trim();
    setInputText("");

    const userMsg = { role: "user", content: text, id: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    const history = [...messages, userMsg]
      .map(m => `${m.role === "user" ? "User" : selectedContact.person_name}: ${m.content}`)
      .join("\n");

    const prompt = `You are ${selectedContact.person_name}, a person in ${character.name}'s life.

ABOUT YOU (${selectedContact.person_name}):
- Relationship to ${character.name}: ${selectedContact.relationship_type || "acquaintance"}
- Description: ${selectedContact.description || "A person in their social world."}
- Current status: ${selectedContact.current_status || ""}
- How you feel about ${character.name}: ${selectedContact.emotional_impact || ""}
- Your history with ${character.name}: ${selectedContact.history_summary || "You have shared history."}
- Last interaction: ${selectedContact.last_interaction_summary || ""}

You are NOT an AI. You are a real person. Speak naturally, as a real human would in a text/chat. Keep replies short and conversational. Do NOT use bullet points or formal language.

The user is now speaking to you directly (not through ${character.name}).

Conversation so far:
${history}

Reply as ${selectedContact.person_name} — short, real, human. Do NOT start with your name.`;

    try {
      const response = await base44.integrations.Core.InvokeLLM({ prompt });
      setMessages(prev => [...prev, { role: "npc", content: response?.trim() || "...", id: Date.now() + 1 }]);
    } catch {
      setMessages(prev => [...prev, { role: "npc", content: "...", id: Date.now() + 1 }]);
    }

    setIsTyping(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
        onClick={handleClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl flex flex-col"
          style={{ height: "80vh" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
            {selectedContact ? (
              <button onClick={handleBack} className="text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {selectedContact ? selectedContact.person_name : `${character?.name}'s World`}
              </h3>
              <p className="text-xs text-muted-foreground">
                {selectedContact ? selectedContact.relationship_type || "known contact" : `${contacts.length} known contact${contacts.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          {!selectedContact ? (
            /* Contact List */
            <div className="flex-1 overflow-y-auto py-2">
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <Globe className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No known contacts yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">As {character?.name} builds relationships, they'll appear here.</p>
                </div>
              ) : (
                contacts.map((contact, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => selectContact(contact)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/60 transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-primary">
                        {contact.person_name?.[0]?.toUpperCase() || "?"}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{contact.person_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {contact.relationship_type || "known contact"}
                        {contact.current_status ? ` · ${contact.current_status}` : ""}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      {contact.romantic_level > 30 && <span className="text-xs text-pink-400">❤</span>}
                      {contact.friendship_level > 70 && !contact.romantic_level > 30 && <span className="text-xs text-emerald-400">✦</span>}
                    </div>
                  </motion.button>
                ))
              )}
            </div>
          ) : (
            /* Chat View */
            <>
              {/* Contact info bar */}
              {selectedContact.description && (
                <div className="px-4 py-2 bg-secondary/40 border-b border-border flex-shrink-0">
                  <p className="text-xs text-muted-foreground line-clamp-2">{selectedContact.description}</p>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto py-4 space-y-2 px-4">
                {messages.length === 0 && (
                  <div className="flex justify-center mt-8">
                    <div className="flex flex-col items-center gap-2 text-center px-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-6 h-6 text-primary" />
                      </div>
                      <p className="text-sm font-medium text-foreground">{selectedContact.person_name}</p>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        {selectedContact.history_summary || selectedContact.description || `A ${selectedContact.relationship_type || "contact"} of ${character?.name}.`}
                      </p>
                    </div>
                  </div>
                )}
                <AnimatePresence>
                  {messages.map(msg => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-secondary text-foreground rounded-bl-sm"
                      }`}>
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {isTyping && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                    <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-1" />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-2" />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-3" />
                    </div>
                  </motion.div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="px-4 pb-4 pt-2 flex-shrink-0">
                <div className="flex items-end gap-2 bg-secondary rounded-2xl p-2">
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${selectedContact.person_name}...`}
                    rows={1}
                    className="flex-1 bg-transparent text-foreground text-sm resize-none outline-none px-1 py-2 max-h-28 placeholder:text-muted-foreground"
                    style={{ minHeight: "40px" }}
                  />
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={sendMessage}
                    disabled={!inputText.trim() || isTyping}
                    className="h-9 w-9 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 flex-shrink-0"
                  >
                    <Send className="w-4 h-4 text-primary-foreground" />
                  </motion.button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}