import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Globe, ArrowLeft, User, Loader2, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { analyzeImageForCharacterContext } from "@/lib/analyzeImageForCharacterContext";
import { resolveCharacterContacts } from "@/lib/characterContactsResolver";

// ── CONTACT KEY: use stable character_id when available, fall back to name-keyed only for unlinked NPCs ──
// Format with linked ID:    npc_chat__[ownerCharId]__cid_[contactCharId]
// Format without linked ID: npc_chat__[ownerCharId]__[contactName]   (legacy / unlinked)
function npcConvoTitle(ownerCharacterId, contactName, contactCharacterId) {
  if (contactCharacterId) return `npc_chat__${ownerCharacterId}__cid_${contactCharacterId}`;
  return `npc_chat__${ownerCharacterId}__${contactName}`;
}

export default function WorldContactsPopup({ isOpen, onClose, character }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const bottomRef = useRef(null);

  // ── LOAD CONTACTS via shared resolver ────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !character?.id) return;
    setIsLoadingContacts(true);
    base44.auth.me()
      .then(me => resolveCharacterContacts(character, me?.email))
      .then(list => {
        setContacts(list);
        setIsLoadingContacts(false);
      })
      .catch(() => {
        // Fallback: fictional_relationships only — NEVER hide existing contacts
        const fallback = (character?.fictional_relationships || []).filter(r => r.person_name).map(r => ({
          ...r,
          _linkage: r.related_character_id ? 'linked' : 'name_only',
        }));
        setContacts(fallback);
        setIsLoadingContacts(false);
      });
  }, [isOpen, character?.id]);

  // Load or create a persistent conversation for the selected NPC
  const selectContact = async (contact) => {
    setSelectedContact(contact);
    setMessages([]);
    setConversationId(null);
    setInputText("");
    setIsLoadingHistory(true);

    try {
      // FIX: Search by BOTH the stable character_id key AND the legacy name-based key.
      // This prevents creating a new orphan thread when a legacy conversation exists.
      const existing = await base44.entities.Conversation.filter(
        { type: "npc", character_ids: [character.id] },
        "-updated_date",
        100
      );

      const stableTitle = npcConvoTitle(character.id, contact.person_name, contact.related_character_id);
      const legacyTitle  = npcConvoTitle(character.id, contact.person_name, null); // name-only fallback

      const found = existing.find(c => c.title === stableTitle) ||
                    existing.find(c => c.title === legacyTitle);

      if (found) {
        setConversationId(found.id);
        const history = await base44.entities.Message.filter(
          { conversation_id: found.id },
          "created_date"
        );
        setMessages(history.map(m => ({
          id: m.id,
          dbId: m.id,
          role: m.sender_type === "user" ? "user" : "npc",
          content: m.content,
        })));

        const unreadIncoming = history.filter(m => m.sender_type === "character" && !m.is_read);
        for (const msg of unreadIncoming) {
          await base44.entities.Message.update(msg.id, { is_read: true }).catch(() => {});
        }
      }
    } catch {
      // Could not load history — start fresh
    }

    setIsLoadingHistory(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const handleBack = () => {
    setSelectedContact(null);
    setMessages([]);
    setConversationId(null);
  };

  const handleClose = () => {
    setSelectedContact(null);
    setMessages([]);
    setConversationId(null);
    setInputText("");
    onClose();
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages, isTyping]);

  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    // FIX: Use stable character_id key when available so future lookups find this thread
    const title = npcConvoTitle(character.id, selectedContact.person_name, selectedContact.related_character_id);
    const me = await base44.auth.me().catch(() => null);
    // Include contact's character_id in character_ids when we have it — enables bilateral memory
    const charIds = selectedContact.related_character_id
      ? [character.id, selectedContact.related_character_id]
      : [character.id];
    const convo = await base44.entities.Conversation.create({
      title,
      type: "npc",
      character_ids: charIds,
      owner_email: me?.email || character.owner_email,
    });
    setConversationId(convo.id);
    return convo.id;
  };

  const sendMessage = async (imageUrl = null) => {
    if (!inputText.trim() || isTyping) return;
    const text = inputText.trim();
    setInputText("");
    setIsTyping(true);

    const convoId = await ensureConversation();
    const savedUserMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "user",
      content: text,
      image_url: imageUrl || undefined,
      timestamp: new Date().toISOString(),
    });

    const userMsg = { id: savedUserMsg.id, dbId: savedUserMsg.id, role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);

    // ── IMAGE UNDERSTANDING PIPELINE ──────────────────────────────────────
    // Analyze any attached image before the NPC LLM call.
    // Uses the shared module so World Contacts are not blind to image content.
    let imageAnalysisContext = "";
    if (imageUrl) {
      const analysis = await analyzeImageForCharacterContext({
        imageUrl,
        messageId: savedUserMsg.id,
        context: "user_uploaded",
      });
      imageAnalysisContext = analysis.imageAnalysisContext;
    }

    const allMsgs = [...messages, userMsg];
    const historyStr = allMsgs
      .map(m => `${m.role === "user" ? "User" : selectedContact.person_name}: ${m.content}`)
      .join("\n");

    let characterHardFacts = "";
    let characterMemoryContext = "";
    try {
      const ctxRes = await base44.functions.invoke("buildCanonicalCharacterContext", {
        characterId: character.id,
        interactionContext: "world_contacts",
        topKMemories: 8,
      });
      const ctxData = ctxRes?.data || ctxRes;
      if (ctxData?.hardFacts) characterHardFacts = ctxData.hardFacts;
      if (ctxData?.memories?.length > 0) {
        const relevantMems = ctxData.memories
          .filter(m => m.description?.toLowerCase().includes(selectedContact.person_name?.toLowerCase()))
          .slice(0, 4);
        if (relevantMems.length > 0) {
          characterMemoryContext = `\nYOUR SHARED HISTORY WITH ${character.name} (from their memory):\n${relevantMems.map(m => `- ${m.title}: ${m.description}`).join("\n")}\n`;
        }
      }
    } catch { /* non-blocking */ }

    const prompt = `You are ${selectedContact.person_name}, a real person in ${character.name}'s life.

ABOUT YOU (${selectedContact.person_name}):
- Relationship to ${character.name}: ${selectedContact.relationship_type || "acquaintance"}
- Description: ${selectedContact.description || "A person in their social world."}
- Current status: ${selectedContact.current_status || ""}
- How you feel about ${character.name}: ${selectedContact.emotional_impact || ""}
- Your history with ${character.name}: ${selectedContact.history_summary || "You have shared history."}
- Last interaction: ${selectedContact.last_interaction_summary || ""}
${characterMemoryContext}
WHAT YOU KNOW ABOUT ${character.name}'s CURRENT SITUATION:
${characterHardFacts || `${character.name} is doing what they normally do. You know them well.`}

You are NOT an AI. You are a real person. Speak naturally in short conversational texts. Do NOT use bullet points or formal language. Do NOT start with your name.
Do NOT contradict any facts listed above about ${character.name}'s current situation. Your knowledge of them is accurate and current.

Conversation so far:
${historyStr}
${imageAnalysisContext}
Reply as ${selectedContact.person_name}:`;

    let npcText = "...";
    try {
      const response = await base44.integrations.Core.InvokeLLM({ prompt });
      npcText = response?.trim() || "...";
    } catch {
      npcText = "...";
    }

    // FIX: Stamp the CONTACT's real character_id on the reply message (not the owner's ID).
    // This ensures reply messages are correctly attributed and memory queries find them.
    const savedNpcMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: selectedContact.related_character_id || character.id, // ← real contact ID when known
      character_name: selectedContact.person_name,
      content: npcText,
      timestamp: new Date().toISOString(),
    });

    const npcMsg = { id: savedNpcMsg.id, dbId: savedNpcMsg.id, role: "npc", content: npcText };
    setMessages(prev => [...prev, npcMsg]);

    await base44.entities.Conversation.update(convoId, {
      last_message_preview: npcText.substring(0, 100),
      last_message_date: new Date().toISOString(),
    }).catch(() => {});

    setIsTyping(false);

    base44.functions.invoke('syncGroupChatMemories', {
      conversationId: convoId,
      source: 'world_phone',
    }).catch(() => {});

    // FIX: Always fire bilateral memory when both character IDs are known.
    // This covers the case where related_character_id was enriched from a Character record above.
    if (selectedContact.related_character_id) {
      base44.functions.invoke('syncWorldPhoneMemory', {
        senderCharacterId: character.id,
        receiverCharacterId: selectedContact.related_character_id,
        messageContent: `${character.name}: ${text}\n${selectedContact.person_name}: ${npcText}`,
        context: 'world_phone',
        conversationId: convoId,
      }).catch(() => {});
    }
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
        key="world-contacts-overlay"
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
                {selectedContact
                  ? selectedContact.relationship_type || "known contact"
                  : `${contacts.length} known contact${contacts.length !== 1 ? "s" : ""}`}
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
              {isLoadingContacts ? (
                <div className="flex items-center justify-center h-16">
                  <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <Globe className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No known contacts yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    As {character?.name} builds relationships, they'll appear here.
                  </p>
                </div>
              ) : (
                contacts.map((contact, i) => (
                  <motion.button
                    key={contact.related_character_id || `name:${contact.person_name}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => selectContact(contact)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/60 transition-colors text-left"
                  >
                    {/* Avatar: real photo if linked, else letter initial */}
                    <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 overflow-hidden flex-shrink-0">
                      {contact.avatar_url
                        ? <img src={contact.avatar_url} alt={contact.person_name} className="w-full h-full object-cover" />
                        : <span className="text-sm font-semibold text-primary">{contact.person_name?.[0]?.toUpperCase() || "?"}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{contact.person_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {contact.relationship_type || "known contact"}
                        {contact.current_status ? ` · ${contact.current_status}` : ""}
                      </p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {contact.romantic_level > 30 && <span className="text-xs text-pink-400">❤</span>}
                      {contact.friendship_level > 70 && contact.romantic_level <= 30 && (
                        <span className="text-xs text-emerald-400">✦</span>
                      )}
                      {/* DIAGNOSTIC: show linkage state — name-only contacts are visibly flagged */}
                      {!contact.related_character_id && (
                        <span title="Not linked to a Character record — bilateral memory may be incomplete">
                          <AlertTriangle className="w-3 h-3 text-amber-400/70" />
                        </span>
                      )}
                    </div>
                  </motion.button>
                ))
              )}
            </div>
          ) : (
            /* Chat View */
            <>
              {selectedContact.description && (
                <div className="px-4 py-2 bg-secondary/40 border-b border-border flex-shrink-0">
                  <p className="text-xs text-muted-foreground line-clamp-2">{selectedContact.description}</p>
                </div>
              )}
              {/* Linkage diagnostic banner — visible, non-destructive */}
              {!selectedContact.related_character_id && (
                <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 flex-shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  <p className="text-[10px] text-amber-300/80">Not linked to a Character record — memory may not carry over to Chat/Scene</p>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto py-4 space-y-2 px-4">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex justify-center mt-8">
                    <div className="flex flex-col items-center gap-2 text-center px-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                        {selectedContact.avatar_url
                          ? <img src={selectedContact.avatar_url} alt={selectedContact.person_name} className="w-full h-full object-cover" />
                          : <User className="w-6 h-6 text-primary" />
                        }
                      </div>
                      <p className="text-sm font-medium text-foreground">{selectedContact.person_name}</p>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        {selectedContact.history_summary ||
                          selectedContact.description ||
                          `A ${selectedContact.relationship_type || "contact"} of ${character?.name}.`}
                      </p>
                    </div>
                  </div>
                ) : null}

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