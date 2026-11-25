import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Loader2, Search, Send } from "lucide-react";

/**
 * PocketMessageApp — the phone's messaging app.
 *
 * It uses the established user World Phone pathway (`sendUserWorldPhoneMessage`), which
 * writes into the one canonical `world_phone::user_<userId>::<characterId>` conversation
 * for the pair and lets the character reply in their own identity with their own records.
 * No second messaging engine, no second conversation history.
 */
function threadKey(userId, characterId) {
  return `world_phone::user_${userId}::${characterId}`;
}

export default function PocketMessageApp({ currentUser, worldName = "You", onBack }) {
  const [characters, setCharacters] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentUser?.email) { setIsLoading(false); return; }
    base44.entities.Character.filter({ owner_email: currentUser.email }, "name", 300)
      .then((rows) => {
        if (cancelled) return;
        setCharacters((rows || [])
          .filter((c) => c.id && !c.is_user
            && !["deleted", "soft_deleted", "merged"].includes(c.status)
            && c.life_status !== "deceased")
          .sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser?.email]);

  const loadThread = async (character) => {
    if (!currentUser?.id || !character?.id) return;
    setIsLoadingThread(true);
    setMessages([]);
    try {
      const convos = await base44.entities.Conversation
        .filter({ shared_conversation_key: threadKey(currentUser.id, character.id) }, "-updated_date", 1)
        .catch(() => []);
      const convo = convos?.[0];
      if (!convo) return;
      const rows = await base44.entities.Message
        .filter({ conversation_id: convo.id }, "timestamp", 100)
        .catch(() => []);
      setMessages((rows || []).slice().sort(
        (a, b) => new Date(a.timestamp || a.created_date || 0) - new Date(b.timestamp || b.created_date || 0)
      ));
    } finally {
      setIsLoadingThread(false);
    }
  };

  const openThread = (character) => {
    setActive(character);
    setError(null);
    loadThread(character);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoadingThread]);

  const send = async () => {
    if (!active || isSending || !text.trim()) return;
    setIsSending(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("sendUserWorldPhoneMessage", {
        recipient_character_id: active.id,
        content: text.trim(),
        message_type: "text",
        source: "scene_phone",
      });
      if (!res?.data?.success) throw new Error(res?.data?.error || "Message could not be sent");
      setText("");
      await loadThread(active);
    } catch (err) {
      setError(err?.message || "Message could not be sent");
    } finally {
      setIsSending(false);
    }
  };

  const visible = search.trim()
    ? characters.filter((c) => (c.name || "").toLowerCase().includes(search.trim().toLowerCase()))
    : characters;

  if (active) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10">
          <button onClick={() => { setActive(null); setMessages([]); }} className="p-1 text-white/70 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-6 h-6 rounded-full bg-white/20 overflow-hidden flex items-center justify-center flex-shrink-0">
            {active.avatar_url
              ? <img src={active.avatar_url} alt={active.name} className="w-full h-full object-cover" />
              : <span className="text-[9px] font-bold text-white">{(active.name || "?").charAt(0).toUpperCase()}</span>}
          </div>
          <p className="text-[11px] font-semibold text-white truncate">{active.name}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
          {isLoadingThread && (
            <p className="text-[10px] text-white/60 flex items-center gap-1.5 py-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </p>
          )}
          {!isLoadingThread && messages.length === 0 && (
            <p className="text-[10px] text-white/50 py-3 text-center">No messages yet. Say hello as {worldName}.</p>
          )}
          {messages.map((m) => {
            const fromUser = m.sender_type === "user";
            return (
              <div key={m.id} className={`flex ${fromUser ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-2.5 py-1.5 ${fromUser ? "bg-[#9b6af1] text-white" : "bg-white/15 text-white"}`}>
                  <p className="text-[8px] opacity-70 mb-0.5">{fromUser ? worldName : (m.character_name || active.name)}</p>
                  <p className="text-[11px] whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {error && <p className="text-[9px] text-red-300 px-2 pb-1">{error}</p>}

        <div className="flex items-center gap-1.5 px-2 py-2 border-t border-white/10">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Message as ${worldName}…`}
            className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/15 text-[11px] text-white placeholder:text-white/40 outline-none"
          />
          <button
            onClick={send}
            disabled={isSending || !text.trim()}
            className="p-1.5 rounded-lg bg-[#9b6af1] text-white disabled:opacity-40"
          >
            {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10">
        <button onClick={onBack} className="p-1 text-white/70 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <p className="text-[11px] font-semibold text-white">Pocket Message</p>
      </div>

      <div className="px-2 py-2">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/10 border border-white/15">
          <Search className="w-3 h-3 text-white/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people"
            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/40 outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {isLoading && (
          <p className="text-[10px] text-white/60 flex items-center gap-1.5 py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading people…
          </p>
        )}
        {!isLoading && visible.length === 0 && (
          <p className="text-[10px] text-white/50 py-3 text-center">No one to message yet.</p>
        )}
        {visible.map((c) => (
          <button
            key={c.id}
            onClick={() => openThread(c)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-left transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-white/20 overflow-hidden flex items-center justify-center flex-shrink-0">
              {c.avatar_url
                ? <img src={c.avatar_url} alt={c.name} className="w-full h-full object-cover" />
                : <span className="text-[9px] font-bold text-white">{(c.name || "?").charAt(0).toUpperCase()}</span>}
            </div>
            <span className="text-[11px] text-white truncate">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}