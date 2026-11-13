import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Phone, Send, ChevronLeft, Image as ImageIcon, Loader2, Globe2 } from "lucide-react";
import { loadCrossAccountContacts, alphabetizeByName } from "@/lib/imageShareCharacters";

/**
 * UserWorldPhonePanel
 *
 * The account user's OWN World Phone. The user speaks under their World Name
 * (UserSettings.fictional_world_name) — never as one of their characters.
 *
 * It uses the existing World Phone pathway: one conversation per user↔character
 * pair keyed `world_phone::user_<userId>::<characterId>`, written by
 * sendUserWorldPhoneMessage. Character World Phones are untouched.
 *
 * Reachable characters: the user's own characters, plus eligible characters on
 * other accounts known through the existing contact graph.
 */

function keyFor(userId, characterId) {
  return `world_phone::user_${userId}::${characterId}`;
}

function Avatar({ url, name, size = "w-8 h-8" }) {
  return (
    <div className={`${size} rounded-full bg-primary/20 overflow-hidden flex items-center justify-center flex-shrink-0`}>
      {url
        ? <img src={url} alt={name} className="w-full h-full object-cover" />
        : <span className="text-[11px] font-bold text-primary">{(name || "?").trim().charAt(0).toUpperCase()}</span>}
    </div>
  );
}

export default function UserWorldPhonePanel({ worldName = "You", avatarUrl = null }) {
  const [user, setUser] = useState(null);
  const [ownCharacters, setOwnCharacters] = useState([]);
  const [crossAccountCharacters, setCrossAccountCharacters] = useState([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(true);
  const [activeContact, setActiveContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    base44.auth.me().then(async (me) => {
      if (cancelled || !me?.email) return;
      setUser(me);
      const chars = await base44.entities.Character
        .filter({ owner_email: me.email, status: "active" }, "name", 200)
        .catch(() => []);
      const own = alphabetizeByName(
        (chars || []).filter((c) => !c.is_user && !c.is_test_character)
      );
      if (cancelled) return;
      setOwnCharacters(own);
      const cross = await loadCrossAccountContacts({
        characterRecords: chars || [],
        ownerEmail: me.email,
        excludeIds: own.map((c) => c.id),
      }).catch(() => []);
      if (cancelled) return;
      setCrossAccountCharacters(cross || []);
    }).catch(() => {}).finally(() => { if (!cancelled) setIsLoadingContacts(false); });
    return () => { cancelled = true; };
  }, []);

  const loadThread = async (contact, me = user) => {
    if (!me?.id || !contact?.id) return;
    setIsLoadingThread(true);
    setMessages([]);
    try {
      const convos = await base44.entities.Conversation
        .filter({ shared_conversation_key: keyFor(me.id, contact.id) }, "-updated_date", 1)
        .catch(() => []);
      const convo = convos?.[0] || null;
      if (!convo) return;
      const rows = await base44.entities.Message
        .filter({ conversation_id: convo.id }, "timestamp", 200)
        .catch(() => []);
      setMessages((rows || []).slice().sort((a, b) =>
        new Date(a.timestamp || a.created_date || 0) - new Date(b.timestamp || b.created_date || 0)
      ));
    } finally {
      setIsLoadingThread(false);
    }
  };

  const openContact = (contact) => {
    setActiveContact(contact);
    setError(null);
    loadThread(contact);
  };

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoadingThread]);

  const send = async ({ imageUrl = null } = {}) => {
    if (!activeContact || isSending) return;
    if (!imageUrl && !text.trim()) return;
    setIsSending(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("sendUserWorldPhoneMessage", {
        recipient_character_id: activeContact.id,
        content: imageUrl ? undefined : text.trim(),
        image_url: imageUrl || undefined,
        message_type: imageUrl ? "image" : "text",
        source: "user_profile_world_phone",
      });
      if (!res?.data?.success) {
        throw new Error(res?.data?.error || "Message could not be sent");
      }
      setText("");
      await loadThread(activeContact);
    } catch (err) {
      setError(err?.message || "Message could not be sent");
    } finally {
      setIsSending(false);
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsSending(true);
    setError(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      if (file_url) await send({ imageUrl: file_url });
    } catch (err) {
      setError(err?.message || "Image could not be sent");
    } finally {
      setIsSending(false);
    }
  };

  // ── THREAD VIEW ────────────────────────────────────────────────────────────
  if (activeContact) {
    return (
      <div className="flex flex-col h-[420px]">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <button onClick={() => { setActiveContact(null); setMessages([]); }} className="p-1 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <Avatar url={activeContact.avatar_url} name={activeContact.name} size="w-7 h-7" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{activeContact.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              as {worldName}{activeContact.is_other_account ? " · other account" : ""}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 space-y-2">
          {isLoadingThread && (
            <p className="text-xs text-muted-foreground flex items-center gap-2 py-3">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading messages…
            </p>
          )}
          {!isLoadingThread && messages.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No messages yet. Say hello as {worldName}.
            </p>
          )}
          {messages.map((m) => {
            const fromUser = m.sender_type === "user";
            return (
              <div key={m.id} className={`flex ${fromUser ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] rounded-2xl px-3 py-2 ${fromUser ? "bg-primary/15 border border-primary/25" : "bg-secondary border border-border"}`}>
                  <p className="text-[9px] font-medium text-muted-foreground mb-0.5">
                    {fromUser ? worldName : (m.character_name || activeContact.name)}
                  </p>
                  {m.image_url && (
                    <img src={m.image_url} alt="Shared" className="rounded-xl max-h-48 object-cover mb-1" />
                  )}
                  {m.content && <p className="text-xs text-foreground whitespace-pre-wrap">{m.content}</p>}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {error && <p className="text-[10px] text-destructive pb-1">{error}</p>}

        <div className="flex items-center gap-1.5 pt-2 border-t border-border">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isSending}
            className="p-2 rounded-xl border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Send an image"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Message as ${worldName}…`}
            className="flex-1 px-3 py-2 rounded-xl bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => send()}
            disabled={isSending || !text.trim()}
            className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  }

  // ── CONTACT LIST ───────────────────────────────────────────────────────────
  const renderContact = (char, isCross) => (
    <button
      key={char.id}
      onClick={() => openContact(char)}
      className={`w-full flex items-center gap-2 px-2 py-2 rounded-xl border text-left transition-colors ${
        isCross
          ? "border-dashed border-border bg-secondary/30 hover:border-primary/40"
          : "border-border bg-secondary/50 hover:border-primary/40"
      }`}
    >
      <Avatar url={char.avatar_url} name={char.name} size="w-7 h-7" />
      <span className="flex-1 min-w-0 truncate text-xs font-medium text-foreground">{char.name}</span>
      {isCross && (
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 flex-shrink-0">
          Other account
        </span>
      )}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Avatar url={avatarUrl} name={worldName} size="w-8 h-8" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{worldName}</p>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Globe2 className="w-2.5 h-2.5" /> Your own World Phone
          </p>
        </div>
      </div>

      {isLoadingContacts ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2 py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading contacts…
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1">
          {ownCharacters.length === 0 && crossAccountCharacters.length === 0 && (
            <p className="text-xs text-muted-foreground py-3">No characters available to message.</p>
          )}
          {ownCharacters.map((c) => renderContact(c, false))}
          {crossAccountCharacters.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-300 pt-2 px-1">Other accounts</p>
              {crossAccountCharacters.map((c) => renderContact(c, true))}
            </>
          )}
        </div>
      )}
    </div>
  );
}