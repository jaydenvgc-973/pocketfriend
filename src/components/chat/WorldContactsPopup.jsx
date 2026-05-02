import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Globe, ArrowLeft, User, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Derive a stable conversation key using character IDs only (NOT names)
function npcConvoKey(characterId, contactCharacterId) {
  // Sort IDs to ensure [A, B] and [B, A] map to same key
  const ids = [characterId, contactCharacterId].sort();
  return `npc_chat__${ids[0]}__${ids[1]}`;
}

export default function WorldContactsPopup({ isOpen, onClose, character, onConversationOpened }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactUnreadCounts, setContactUnreadCounts] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const bottomRef = useRef(null);

  // Fetch current user
  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  // Load contacts from ALL valid sources:
  // 1. fictional_relationships on the character (primary)
  // 2. NPC_fictitious Character records owned by the user
  // 3. Any existing NPC Conversation participants involving this character
  // Deduplicate by related_character_id (ID-based, never name-based)
  useEffect(() => {
    if (!isOpen || !character) return;

    const loadContacts = async () => {
      const seen = new Set();
      const merged = [];

      // SOURCE 1: fictional_relationships embedded on the character
      for (const r of (character.fictional_relationships || [])) {
        if (!r.person_name || !r.related_character_id) continue;
        if (!seen.has(r.related_character_id)) {
          seen.add(r.related_character_id);
          merged.push(r);
        }
      }

      // SOURCE 2: Load all npc_fictitious characters owned by the user
      // These are the People in Their World and should appear as contacts
      try {
        const npcFictitious = await base44.entities.Character.filter(
          { character_type: 'npc_fictitious', owner_email: currentUser?.email },
          null,
          200
        ).catch(() => []);

        for (const npc of (npcFictitious || [])) {
          if (!seen.has(npc.id)) {
            seen.add(npc.id);
            merged.push({
              person_name: npc.name,
              related_character_id: npc.id,
              relationship_type: npc.archetype || 'npc',
              description: npc.profile_summary || npc.personality_summary || '',
              current_status: npc.emotional_state || '',
              friendship_level: npc.friendship_level || 0,
              romantic_level: npc.romantic_level || 0,
              avatar_url: npc.avatar_url || npc.image_avatar_url || null,
              _source: 'npc_fictitious',
            });
          }
        }
      } catch (err) {
        console.error('[WorldContacts] NPC fictitious load failed:', err.message);
      }

      // SOURCE 3: Existing NPC Conversations involving this character
      // This recovers any contacts from prior interactions
      try {
        const allNpcConvos = await base44.entities.Conversation.filter(
          { type: 'npc' }, '-updated_date', 200
        );
        const involvedConvos = (allNpcConvos || []).filter(c =>
          Array.isArray(c.character_ids) && c.character_ids.includes(character.id)
        );

        for (const convo of involvedConvos) {
          const otherIds = (convo.character_ids || []).filter(id => id !== character.id);
          for (const otherId of otherIds) {
            if (!seen.has(otherId)) {
              // Try to load their Character record to get a name
              try {
                const otherChars = await base44.entities.Character.filter({ id: otherId });
                const other = otherChars?.[0];
                const name = other?.name || other?.display_name || other?.primary_name || `Contact ${otherId.substring(0, 6)}`;
                seen.add(otherId);
                merged.push({
                  person_name: name,
                  related_character_id: otherId,
                  relationship_type: other?.archetype || other?.character_type || 'contact',
                  description: other?.profile_summary || other?.personality_summary || '',
                  current_status: other?.emotional_state || '',
                  friendship_level: other?.friendship_level || 0,
                  romantic_level: other?.romantic_level || 0,
                  avatar_url: other?.avatar_url || other?.image_avatar_url || null,
                  _source: 'existing_conversation',
                });
              } catch {
                // Still add a placeholder so the contact is not hidden
                seen.add(otherId);
                merged.push({
                  person_name: `Contact (${otherId.substring(0, 6)})`,
                  related_character_id: otherId,
                  relationship_type: 'contact',
                  description: '',
                  _source: 'existing_conversation_unresolved',
                });
              }
            }
          }
        }
      } catch (err) {
        console.error('[WorldContacts] Conversation-based contact load failed:', err.message);
      }

      setContacts(merged);
    };

    loadContacts();
  }, [isOpen, character, currentUser]);

  // Load unread counts for all contacts
  useEffect(() => {
    if (!character || contacts.length === 0) return;
    const loadUnreadCounts = async () => {
      const counts = {};

      // Load all NPC conversations once, then match per contact
      let allNpcConvos = [];
      try {
        allNpcConvos = await base44.entities.Conversation.filter(
          { type: "npc" }, null, 200
        );
      } catch { /* silent */ }

      for (const contact of contacts) {
        try {
          const convo = (allNpcConvos || []).find(c =>
            Array.isArray(c.character_ids) &&
            c.character_ids.includes(character.id) &&
            c.character_ids.includes(contact.related_character_id)
          );

          if (convo) {
            const unreadMsgs = await base44.entities.Message.filter({
              conversation_id: convo.id,
              sender_type: "character",
              is_read: false
            });
            counts[contact.related_character_id] = unreadMsgs?.length || 0;
          } else {
            counts[contact.related_character_id] = 0;
          }
        } catch (err) {
          console.error('[loadUnreadCounts]', err.message);
          counts[contact.related_character_id] = 0;
        }
      }
      setContactUnreadCounts(counts);
    };
    loadUnreadCounts();
  }, [character, contacts]);

  // Load or create a persistent conversation for the selected NPC using stable ID-based key
  const selectContact = async (contact) => {
    setSelectedContact(contact);
    setMessages([]);
    setConversationId(null);
    setInputText("");
    setIsLoadingHistory(true);

    try {
      // Use stable key based on character IDs only — NOT names
      const key = npcConvoKey(character.id, contact.related_character_id);
      
      console.log(`[selectContact] Looking for conversation key: ${key}`);

      // Look for conversation by multiple strategies — never by name alone
      let found = null;

      // Strategy 1: Exact ID-based key (current format)
      const byKey = await base44.entities.Conversation.filter(
        { type: "npc", title: key },
        null,
        1
      ).catch(() => []);
      if (byKey?.length > 0) {
        found = byKey[0];
      }

      // Strategy 2: Legacy name-based key written by organicCharacterInteractions
      // Format: npc_chat__CHARACTERID__ContactName  (NOT sorted IDs)
      if (!found && contact.person_name) {
        const legacyKey = `npc_chat__${character.id}__${contact.person_name}`;
        const byLegacyKey = await base44.entities.Conversation.filter(
          { type: "npc", title: legacyKey },
          null,
          1
        ).catch(() => []);
        if (byLegacyKey?.length > 0) {
          found = byLegacyKey[0];
        }
      }

      // Strategy 3: Search by character_ids array — works regardless of title format
      // This is the most reliable fallback for any conversation format
      if (!found) {
        const allNpc = await base44.entities.Conversation.filter(
          { type: "npc" },
          "-updated_date",
          200
        ).catch(() => []);
        found = (allNpc || []).find(c =>
          Array.isArray(c.character_ids) &&
          c.character_ids.includes(character.id) &&
          c.character_ids.includes(contact.related_character_id)
        );
      }

      if (found) {
        console.log(`[selectContact] Found conversation: ${found.id}`);
        setConversationId(found.id);
        
        // Load ALL messages (no limit, ascending order)
        const history = await base44.entities.Message.filter(
          { conversation_id: found.id },
          "created_date"
        );
        
        console.log(`[selectContact] Loaded ${history?.length || 0} messages`);
        
        const mapped = (history || []).map(m => ({
          id: m.id,
          dbId: m.id,
          role: m.sender_type === "user" ? "user" : "npc",
          content: m.content,
        }));
        
        setMessages(mapped);
        
        // Mark all unread messages in this conversation as read
        for (const msg of (history || [])) {
          if (msg.sender_type === "character" && !msg.is_read) {
            await base44.entities.Message.update(msg.id, { is_read: true }).catch(() => {});
          }
        }
        
        onConversationOpened?.(found.id);
      } else {
        console.log(`[selectContact] No conversation found for ${contact.person_name}`);
      }
    } catch (err) {
      console.error('[selectContact] Error:', err.message);
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

    const key = npcConvoKey(character.id, selectedContact.related_character_id);

    // Try ID-based key first
    const byKey = await base44.entities.Conversation.filter(
      { type: "npc", title: key }, null, 1
    ).catch(() => []);
    if (byKey?.length > 0) {
      setConversationId(byKey[0].id);
      return byKey[0].id;
    }

    // Try legacy name-based key
    if (selectedContact.person_name) {
      const legacyKey = `npc_chat__${character.id}__${selectedContact.person_name}`;
      const byLegacy = await base44.entities.Conversation.filter(
        { type: "npc", title: legacyKey }, null, 1
      ).catch(() => []);
      if (byLegacy?.length > 0) {
        setConversationId(byLegacy[0].id);
        return byLegacy[0].id;
      }
    }

    // Try character_ids match — do not create duplicate
    const allNpc = await base44.entities.Conversation.filter(
      { type: "npc" }, "-updated_date", 200
    ).catch(() => []);
    const existing = (allNpc || []).find(c =>
      Array.isArray(c.character_ids) &&
      c.character_ids.includes(character.id) &&
      c.character_ids.includes(selectedContact.related_character_id)
    );
    if (existing) {
      setConversationId(existing.id);
      return existing.id;
    }

    // Create new conversation only if none found by any method
    const convo = await base44.entities.Conversation.create({
      title: key,
      type: "npc",
      character_ids: [character.id, selectedContact.related_character_id],
    });
    setConversationId(convo.id);
    return convo.id;
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isTyping || !selectedContact?.related_character_id) return;
    const text = inputText.trim();
    setInputText("");
    setIsTyping(true);

    // Persist user message with ownership + character ID validation
    const convoId = await ensureConversation();
    
    // Validate sender and recipient are different valid character IDs
    if (character.id === selectedContact.related_character_id) {
      setIsTyping(false);
      return; // Prevent self-messaging
    }
    
    const savedUserMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "user",
      character_id: selectedContact.related_character_id,
      character_name: selectedContact.person_name,
      content: text,
      timestamp: new Date().toISOString(),
    });

    const userMsg = { id: savedUserMsg.id, dbId: savedUserMsg.id, role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);

    // Build history string for LLM (using persisted messages + new one)
    const allMsgs = [...messages, userMsg];
    const historyStr = allMsgs
      .map(m => `${m.role === "user" ? "User" : selectedContact.person_name}: ${m.content}`)
      .join("\n");

    const prompt = `You are ${selectedContact.person_name}, a real person in ${character.name}'s life.

ABOUT YOU (${selectedContact.person_name}):
- Relationship to ${character.name}: ${selectedContact.relationship_type || "acquaintance"}
- Description: ${selectedContact.description || "A person in their social world."}
- Current status: ${selectedContact.current_status || ""}
- How you feel about ${character.name}: ${selectedContact.emotional_impact || ""}
- Your history with ${character.name}: ${selectedContact.history_summary || "You have shared history."}
- Last interaction: ${selectedContact.last_interaction_summary || ""}

You are NOT an AI. You are a real person. Speak naturally in short conversational texts. Do NOT use bullet points or formal language. Do NOT start with your name.

The user is speaking with you directly. Remember everything said in this conversation.

Conversation so far:
${historyStr}

Reply as ${selectedContact.person_name}:`;

    let npcText = "...";
    try {
      const response = await base44.integrations.Core.InvokeLLM({ prompt });
      npcText = response?.trim() || "...";
    } catch {
      npcText = "...";
    }

    // Persist NPC reply — use selectedContact's character ID as the "speaker"
    const savedNpcMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: selectedContact.related_character_id,
      character_name: selectedContact.person_name,
      content: npcText,
      timestamp: new Date().toISOString(),
    });

    const npcMsg = { id: savedNpcMsg.id, dbId: savedNpcMsg.id, role: "npc", content: npcText };
    setMessages(prev => [...prev, npcMsg]);

    // Update conversation timestamp
    await base44.entities.Conversation.update(convoId, {
      last_message_preview: npcText.substring(0, 100),
      last_message_date: new Date().toISOString(),
    }).catch(() => {});

    setIsTyping(false);

    // Sync World Contacts conversation to character memory
    // This makes the conversation durable across all pages where character context is built
    base44.functions.invoke('syncWorldContactsMemory', {
      conversationId: convoId,
      primaryCharacterId: character.id,
    }).catch(() => {});
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
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <Globe className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No known contacts yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    As {character?.name} builds relationships, they'll appear here.
                  </p>
                </div>
              ) : (
                contacts.map((contact, i) => {
                  const contactUnread = contactUnreadCounts[contact.related_character_id] || 0;

                  return (
                    <motion.button
                      key={contact.related_character_id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => selectContact(contact)}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/60 transition-colors text-left ${
                        contactUnread > 0 ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 relative">
                        <span className="text-sm font-semibold text-primary">
                          {contact.person_name?.[0]?.toUpperCase() || "?"}
                        </span>
                        {contactUnread > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                            {contactUnread > 99 ? "99+" : contactUnread}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{contact.person_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {contact.relationship_type || "known contact"}
                          {contact.current_status ? ` · ${contact.current_status}` : ""}
                        </p>
                      </div>
                      <div className="flex-shrink-0 flex gap-1">
                        {contact.romantic_level > 30 && <span className="text-xs text-pink-400">❤</span>}
                        {contact.friendship_level > 70 && contact.romantic_level <= 30 && (
                          <span className="text-xs text-emerald-400">✦</span>
                        )}
                      </div>
                    </motion.button>
                  );
                })
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

              {/* Messages */}
              <div className="flex-1 overflow-y-auto py-4 space-y-2 px-4">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex justify-center mt-8">
                    <div className="flex flex-col items-center gap-2 text-center px-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-6 h-6 text-primary" />
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