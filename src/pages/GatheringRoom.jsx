import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, LogOut, Clock, Users, AtSign, X, Video, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GatheringRoomWatchParty from "@/components/gatheringroom/GatheringRoomWatchParty";
import GatheringRoomImageShare from "@/components/gatheringroom/GatheringRoomImageShare";
import GatheringRoomGamesModal from "@/components/gatheringroom/GatheringRoomGamesModal";

// Type-neutral avatar: identical presentation for all participants.
// No branching on entity type. Falls back to a generic person icon identically.
function ParticipantAvatar({ url, name, size = "w-12 h-12" }) {
  if (url) {
    return (
      <div className={`${size} rounded-full overflow-hidden border-2 border-border flex-shrink-0`}>
        <img src={url} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${size} rounded-full overflow-hidden border-2 border-border flex-shrink-0 bg-secondary flex items-center justify-center`}>
      <Users className="w-1/2 h-1/2 text-muted-foreground" />
    </div>
  );
}

export default function GatheringRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [directedTo, setDirectedTo] = useState([]);
  const [showDirectPicker, setShowDirectPicker] = useState(false);
  const [error, setError] = useState(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(1800);
  const [showWatchPartyInput, setShowWatchPartyInput] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showGamesModal, setShowGamesModal] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const gatheringEpochRef = useRef(null);

  const { data: currentUser = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // ── Load room ──
  const { data: room, refetch: refetchRoom } = useQuery({
    queryKey: ["gatheringRoom", roomId],
    queryFn: async () => {
      const rooms = await base44.entities.GatheringRoom.filter({ id: roomId }, null, 1);
      return rooms[0] || null;
    },
    enabled: !!roomId,
  });

  // ── Sanitized cross-account participants from backend function ──
  // Returns ALL valid active occupants regardless of account. No entity type disclosure.
  const { data: participants = [], refetch: refetchParticipants } = useQuery({
    queryKey: ["gatheringRoomParticipants", roomId, currentUser?.email],
    queryFn: async () => {
      if (!roomId) return [];
      const res = await base44.functions.invoke("getGatheringRoomParticipants", {
        gathering_room_id: roomId,
      });
      return res?.data?.participants || [];
    },
    enabled: !!roomId,
  });

  // ── Load messages ──
  // ── Live 20-message window — scoped to the current gathering ──────────────
  // Only the 20 newest messages from the CURRENT gathering (timestamp >=
  // gathering_epoch) are loaded. Past gatherings do not repopulate the active
  // room. If gathering_epoch is null (room not yet entered or transition state),
  // no messages are loaded — the room starts clean. Character memory is
  // preserved independently through the canonical Memory entity.
  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ["gatheringRoomMessages", roomId, room?.gathering_epoch],
    queryFn: async () => {
      const epoch = room?.gathering_epoch;
      if (!epoch) return [];
      const msgs = await base44.entities.GatheringRoomMessage.filter(
        { gathering_room_id: roomId, timestamp: { $gte: epoch } },
        "-timestamp", 20
      );
      return msgs.reverse();
    },
    enabled: !!roomId && !!room?.gathering_epoch,
  });

  // ── My active session ──
  const { data: mySession, refetch: refetchSession } = useQuery({
    queryKey: ["myGatheringRoomSession", roomId, currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const sessions = await base44.entities.GatheringRoomSession.filter(
        { gathering_room_id: roomId, owner_email: currentUser.email, status: "active" },
        "-started_at", 1
      );
      return sessions[0] || null;
    },
    enabled: !!roomId && !!currentUser?.email,
  });

  useEffect(() => {
    if (mySession?.expires_at) setSessionExpiresAt(mySession.expires_at);
  }, [mySession]);

  // ── Track gathering epoch for subscription-based message filtering ──
  // The epoch scopes the live transcript to the current gathering. Messages from
  // previous gatherings (timestamp < epoch) are excluded from the live room.
  // The ref is read inside the realtime subscription handler (which captures the
  // stable ref object, not a stale value) so it always reflects the current epoch.
  useEffect(() => {
    gatheringEpochRef.current = room?.gathering_epoch || null;
  }, [room?.gathering_epoch]);

  // ── Session countdown ──
  useEffect(() => {
    if (!sessionExpiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(sessionExpiresAt).getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) { clearInterval(interval); navigate("/travel"); }
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionExpiresAt]);

  // ── Realtime subscriptions ──
  // Subscribe to GatheringRoom entity for participant refetch (occupancy changes trigger room update).
  // Subscribe to GatheringRoomMessage for new messages.
  // Subscribe to GatheringRoomSession for session expiration.
  useEffect(() => {
    if (!roomId) return;

    // ── MESSAGE EVENTS: direct cache update for immediate cross-account delivery ──
    // A committed message must appear immediately — no refetch round-trip, no polling.
    // The subscription event carries the full message record; we append it directly
    // to the query cache. This is event-driven, not polling.
    const unsubMessages = base44.entities.GatheringRoomMessage.subscribe((event) => {
      if (!event.data || event.data.gathering_room_id !== roomId) return;
      const msg = event.data;
      const epoch = gatheringEpochRef.current;
      // ── Filter: only messages from the current gathering ──
      // Messages from a previous gathering (timestamp < gathering_epoch) are
      // excluded — they must not repopulate the active room.
      if (epoch && new Date(msg.timestamp).getTime() < new Date(epoch).getTime()) return;
      queryClient.setQueryData(["gatheringRoomMessages", roomId, epoch], (old = []) => {
        if (event.type === 'delete') return (old || []).filter(m => m.id !== msg.id);
        const exists = (old || []).some(m => m.id === msg.id);
        if (exists) {
          return (old || []).map(m => m.id === msg.id ? { ...m, ...msg } : m);
        }
        // Append new message, maintain timestamp order
        let updated = [...(old || []), msg];
        updated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        // ── Rolling 20-message window: trim oldest, newest survives ──
        // The newest message is NEVER removed to preserve older ones. When the
        // transcript exceeds 20, the oldest live message rolls off. Character
        // memory of rolled-off messages is preserved through the Memory entity.
        if (updated.length > 20) {
          updated = updated.slice(updated.length - 20);
        }
        return updated;
      });
    });

    const unsubRoom = base44.entities.GatheringRoom.subscribe((event) => {
      if (event.data?.id === roomId) {
        refetchRoom();
        refetchParticipants(); // occupancy changed → refetch sanitized participants
        refetchMessages(); // room state changed → refetch messages for cross-user resilience
      }
    });

    const unsubSessions = base44.entities.GatheringRoomSession.subscribe(() => {
      refetchSession();
      refetchParticipants();
      queryClient.invalidateQueries({ queryKey: ["myActiveGatheringRoomSession"] });
      queryClient.invalidateQueries({ queryKey: ["gatheringRooms"] });
    });

    return () => { unsubMessages(); unsubRoom(); unsubSessions(); };
  }, [roomId, refetchRoom, refetchParticipants, refetchSession, refetchMessages, queryClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Sorted participants: owned first (self first within owned), then others ──
  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      if (a.is_self && !b.is_self) return -1;
      if (!a.is_self && b.is_self) return 1;
      if (a.is_owned && !b.is_owned) return -1;
      if (!a.is_owned && b.is_owned) return 1;
      return 0;
    });
  }, [participants]);

  const myUserParticipant = useMemo(() => {
    return participants.find(p => p.is_self);
  }, [participants]);

  const isInRoom = !!mySession && mySession.status === "active";

  // ── User's own characters (from their session) — for image sharing ──
  const myCharacters = useMemo(() => {
    if (!mySession) return [];
    return (mySession.character_ids || []).map((id, i) => ({
      id,
      name: mySession.character_names?.[i] || "Character",
      avatar_url: null,
    }));
  }, [mySession]);

  // ── Handle send message (non-blocking) ──
  // The backend commits the message immediately and returns early. Character
  // response generation + memory extraction run non-blocking on the backend.
  // We clear the input instantly and fire the invoke without blocking the UI.
  // This prevents "Network Error" from LLM timeout being shown as a send
  // failure when the message was actually committed. Realtime delivers the
  // committed message to all participants (cross-user, cross-account).
  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !isInRoom) return;
    const content = messageText.trim();
    const directed = [...directedTo];
    setMessageText("");
    setDirectedTo([]);
    setShowDirectPicker(false);
    setError(null);
    base44.functions.invoke("sendGatheringRoomMessage", {
      gathering_room_id: roomId,
      content,
      is_directed: directed.length > 0,
      directed_to_participant_ids: directed,
    }).catch(err => {
      const status = err?.response?.status || err?.status;
      if (status === 403) {
        const data = err?.response?.data || err?.data || {};
        setError(data.error || "You are not authorized to send messages here.");
      }
      // Network errors are silently handled — the message was likely committed
      // and will arrive via realtime. If it didn't commit, the user can retype.
    });
  }, [messageText, isInRoom, roomId, directedTo]);

  // ── Handle exit ──
  const handleExit = async () => {
    try {
      await base44.functions.invoke("exitGatheringRoom", { gathering_room_id: roomId });
      queryClient.invalidateQueries({ queryKey: ["myActiveGatheringRoomSession"] });
      queryClient.invalidateQueries({ queryKey: ["gatheringRooms"] });
      navigate("/travel");
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to exit room");
    }
  };

  // ── Watch-party callbacks (shared room media state via setGatheringRoomMedia) ──
  // These update the GatheringRoom.active_media field, which propagates to all
  // valid occupants via the realtime subscription on the GatheringRoom entity.
  // Local viewing state (isWatching) is managed inside GatheringRoomWatchParty.
  const handleStartWatchParty = async (data) => {
    await base44.functions.invoke("setGatheringRoomMedia", {
      gathering_room_id: roomId,
      media_type: "video",
      url: data.url,
      title: data.title,
      embed_type: data.embed_type,
    });
    refetchRoom();
  };

  const handleStopWatchParty = async () => {
    await base44.functions.invoke("setGatheringRoomMedia", {
      gathering_room_id: roomId,
      media_type: "none",
    });
    refetchRoom();
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const formatMsgTime = (ts) => ts ? new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "";

  if (!room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/travel" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-foreground truncate">{room.name}</h1>
          <p className="text-[10px] text-muted-foreground">
            {participants.length}/8 here · {isInRoom ? formatTime(timeRemaining) + " left" : "Not in room"}
          </p>
        </div>
        {isInRoom && (
          <button onClick={handleExit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Leave
          </button>
        )}
      </div>

      {/* Watch party — reuses exact Scenes player path with shared/local state separation */}
      <GatheringRoomWatchParty
        room={room}
        isInRoom={isInRoom}
        showInputPanel={showWatchPartyInput}
        onCloseInputPanel={() => setShowWatchPartyInput(false)}
        onStartWatchParty={handleStartWatchParty}
        onStopWatchParty={handleStopWatchParty}
        onShareImage={() => setShowShareModal(true)}
      />

      {/* Participant bar — normalized avatars, no type disclosure */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {sortedParticipants.map((p) => (
            <div key={p.id} className="flex flex-col items-center gap-1 min-w-[56px]">
              <div className={p.is_self ? "ring-2 ring-primary rounded-full" : ""}>
                <ParticipantAvatar url={p.avatar_url} name={p.participant_name} />
              </div>
              <span className={`text-[10px] truncate max-w-[56px] ${p.is_self ? "text-primary font-medium" : "text-muted-foreground"}`}>
                {p.is_self ? "You" : p.participant_name?.split(" ")[0]}
              </span>
            </div>
          ))}
          {participants.length === 0 && !isInRoom && (
            <p className="text-xs text-muted-foreground py-2">No one is here right now.</p>
          )}
        </div>
      </div>

      {/* Not in room */}
      {!isInRoom && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 gap-4">
          <Users className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center">You're not in this Gathering Room. Go to Travel to enter.</p>
          <Link to="/travel"><Button variant="outline" size="sm">Go to Travel</Button></Link>
        </div>
      )}

      {/* Conversation + input */}
      {isInRoom && (
        <>
          <div className="flex-1 overflow-y-auto max-w-lg mx-auto px-4 py-4 space-y-3">
            {messages.map((msg) => {
              const isMine = msg.sender_participant_id === myUserParticipant?.id;
              // ── Unified avatar authority ──
              // Resolve the sender's room-facing avatar from the same source as the
              // participant bar. If the message's stored avatar is null (legacy
              // messages created before the avatar fix), fall back to the live
              // participant list, then to the authenticated user's own avatar for
              // self-messages. This prevents a generic icon from revealing which
              // senders are users vs characters.
              const senderInParticipants = participants.find(p => p.id === msg.sender_participant_id);
              const myAvatar = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;
              const resolvedAvatarUrl = msg.sender_avatar_url || senderInParticipants?.avatar_url || (isMine ? myAvatar : null);
              return (
                <div key={msg.id} className={`flex gap-2 ${isMine ? "flex-row-reverse" : "flex-row"}`}>
                  <ParticipantAvatar url={resolvedAvatarUrl} name={msg.sender_participant_name} size="w-8 h-8" />
                  <div className={`max-w-[75%] ${isMine ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-[10px] font-medium ${isMine ? "text-primary" : "text-muted-foreground"}`}>
                        {isMine ? "You" : msg.sender_participant_name?.split(" ")[0]}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">{formatMsgTime(msg.timestamp)}</span>
                    </div>
                    {msg.is_directed && msg.directed_to_participant_names?.length > 0 && (
                      <span className="text-[10px] text-primary/70 flex items-center gap-0.5">
                        <AtSign className="w-2.5 h-2.5" /> {msg.directed_to_participant_names.join(", ")}
                      </span>
                    )}
                    <div className={`rounded-2xl px-3 py-2 text-sm ${isMine ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">Start the conversation — say something to the room.</p>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Directed speech picker */}
          <AnimatePresence>
            {showDirectPicker && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
                onClick={() => setShowDirectPicker(false)}>
                <motion.div initial={{ y: 50 }} animate={{ y: 0 }} exit={{ y: 50 }}
                  className="bg-card border border-border rounded-2xl p-4 w-full max-w-sm"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold">Direct message to…</h3>
                    <button onClick={() => setShowDirectPicker(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {participants.filter(p => !p.is_self).map(p => (
                      <button key={p.id}
                        onClick={() => setDirectedTo(prev => prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${directedTo.includes(p.id) ? "bg-primary/10" : "hover:bg-secondary"}`}>
                        <ParticipantAvatar url={p.avatar_url} name={p.participant_name} size="w-8 h-8" />
                        <span className="text-sm">{p.participant_name}</span>
                      </button>
                    ))}
                  </div>
                  <Button size="sm" className="w-full mt-3" onClick={() => setShowDirectPicker(false)}>Done</Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Message input — z-50, no BottomNav covering it */}
          <div className="flex-shrink-0 bg-background/90 backdrop-blur-xl border-t border-border px-4 py-3">
            <div className="max-w-lg mx-auto">
              {directedTo.length > 0 && (
                <div className="flex items-center gap-1 mb-2 flex-wrap">
                  {directedTo.map(id => {
                    const p = participants.find(pp => pp.id === id);
                    return (
                      <span key={id} className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        <AtSign className="w-2.5 h-2.5" /> {p?.participant_name?.split(" ")[0]}
                        <button onClick={() => setDirectedTo(prev => prev.filter(x => x !== id))}><X className="w-2.5 h-2.5" /></button>
                      </span>
                    );
                  })}
                </div>
              )}
              {error && <p className="text-[10px] text-destructive mb-2">{error}</p>}
              <div className="flex items-center gap-2">
                <button onClick={() => setShowDirectPicker(true)}
                  className={`p-2 rounded-lg transition-colors ${directedTo.length > 0 ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-secondary"}`}>
                  <AtSign className="w-5 h-5" />
                </button>
                <button onClick={() => setShowWatchPartyInput(true)}
                  className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors" title="Start watch party">
                  <Video className="w-5 h-5" />
                </button>
                <button onClick={() => setShowGamesModal(true)}
                  className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors" title="Play games">
                  <Gamepad2 className="w-5 h-5" />
                </button>
                <input ref={inputRef} type="text" value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder={directedTo.length > 0 ? "Direct message…" : "Say something to the room…"}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground text-sm" />
                <button onClick={handleSend} disabled={!messageText.trim() || isSending}
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors">
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Image share modal — uses existing media-delivery pathways */}
      {showShareModal && (
        <GatheringRoomImageShare
          imageUrl={room?.scene_image_url || room?.image_url}
          roomName={room?.name}
          roomId={roomId}
          myCharacters={myCharacters}
          roomParticipants={participants}
          onClose={() => setShowShareModal(false)}
        />
      )}
      {/* Games modal — launches existing app games + Bowling as shared room activities */}
      <GatheringRoomGamesModal
        open={showGamesModal}
        onClose={() => setShowGamesModal(false)}
        roomId={roomId}
        roomName={room?.name}
        participants={participants}
        myUserParticipant={myUserParticipant}
        currentUser={currentUser}
      />
    </div>
  );
}