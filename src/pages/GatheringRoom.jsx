import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, LogOut, Clock, Users, AtSign, X, Video, Square, Tv, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sanitizeVideoInput } from "@/lib/videoEmbedSanitizer";

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
  const [showWatchPanel, setShowWatchPanel] = useState(false);
  const [videoInput, setVideoInput] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoError, setVideoError] = useState(null);
  const [isSettingMedia, setIsSettingMedia] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

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
  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ["gatheringRoomMessages", roomId],
    queryFn: async () => {
      return await base44.entities.GatheringRoomMessage.filter(
        { gathering_room_id: roomId },
        "timestamp", 100
      );
    },
    enabled: !!roomId,
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

    const unsubMessages = base44.entities.GatheringRoomMessage.subscribe((event) => {
      if (event.data?.gathering_room_id === roomId) refetchMessages();
    });

    const unsubRoom = base44.entities.GatheringRoom.subscribe((event) => {
      if (event.data?.id === roomId) {
        refetchRoom();
        refetchParticipants(); // occupancy changed → refetch sanitized participants
      }
    });

    const unsubSessions = base44.entities.GatheringRoomSession.subscribe(() => {
      refetchSession();
      refetchParticipants();
      queryClient.invalidateQueries({ queryKey: ["myActiveGatheringRoomSession"] });
      queryClient.invalidateQueries({ queryKey: ["gatheringRooms"] });
    });

    return () => { unsubMessages(); unsubRoom(); unsubSessions(); };
  }, [roomId, refetchMessages, refetchRoom, refetchParticipants, refetchSession, queryClient]);

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

  // ── Handle send message ──
  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !isInRoom) return;
    setIsSending(true);
    setError(null);
    try {
      await base44.functions.invoke("sendGatheringRoomMessage", {
        gathering_room_id: roomId,
        content: messageText.trim(),
        is_directed: directedTo.length > 0,
        directed_to_participant_ids: directedTo,
      });
      setMessageText("");
      setDirectedTo([]);
      setShowDirectPicker(false);
      refetchMessages();
    } catch (err) {
      const data = err?.response?.data || err?.data || {};
      setError(data.error || err?.message || "Failed to send message");
    }
    setIsSending(false);
  }, [messageText, isInRoom, roomId, directedTo, refetchMessages]);

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

  // ── Handle watch-party video (reuses existing Scenes sanitizeVideoInput) ──
  const handleStartVideo = async () => {
    const result = sanitizeVideoInput(videoInput);
    if (!result.valid) { setVideoError(result.error); return; }
    setVideoError(null);
    setIsSettingMedia(true);
    try {
      await base44.functions.invoke("setGatheringRoomMedia", {
        gathering_room_id: roomId,
        media_type: "video",
        url: result.embedUrl,
        title: videoTitle.trim() || null,
        embed_type: result.type, // 'iframe' or 'video'
      });
      refetchRoom();
      setShowWatchPanel(false);
      setVideoInput("");
      setVideoTitle("");
    } catch (err) {
      setVideoError("Failed to set video");
    }
    setIsSettingMedia(false);
  };

  const handleStopMedia = async () => {
    try {
      await base44.functions.invoke("setGatheringRoomMedia", {
        gathering_room_id: roomId,
        media_type: "none",
      });
      refetchRoom();
    } catch (err) {
      setError("Failed to stop media");
    }
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

  const activeMedia = room.active_media;
  const sceneImage = room.scene_image_url || room.image_url;
  const hasActiveVideo = activeMedia && activeMedia.media_type === "video" && activeMedia.url;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
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

      {/* Scene image or Watch-party video */}
      <div className="pt-14">
        <div className="relative w-full h-48 sm:h-64 overflow-hidden">
          {hasActiveVideo ? (
            activeMedia.embed_type === "iframe" ? (
              <iframe src={activeMedia.url} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen title="Watch party" referrerPolicy="strict-origin-when-cross-origin" />
            ) : (
              <video src={activeMedia.url} className="w-full h-full" controls playsInline />
            )
          ) : sceneImage ? (
            <img src={sceneImage} alt={room.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 via-secondary to-background flex items-center justify-center">
              <Users className="w-12 h-12 text-muted-foreground/40" />
            </div>
          )}
          {!hasActiveVideo && <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />}
          {!hasActiveVideo && room.description && (
            <p className="absolute bottom-2 left-4 right-4 text-xs text-foreground/70 line-clamp-2">{room.description}</p>
          )}
        </div>
      </div>

      {/* Active media bar */}
      {hasActiveVideo && (
        <div className="px-4 py-2 bg-secondary/50 border-b border-border flex items-center gap-2">
          <Video className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{activeMedia.title || "Watch Party"}</p>
            <p className="text-[10px] text-muted-foreground">Started by {activeMedia.started_by_participant_name}</p>
          </div>
          {isInRoom && (
            <button onClick={handleStopMedia} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Stop video">
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

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
        <div className="flex flex-col items-center justify-center py-20 px-4 gap-4">
          <Users className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center">You're not in this Gathering Room. Go to Travel to enter.</p>
          <Link to="/travel"><Button variant="outline" size="sm">Go to Travel</Button></Link>
        </div>
      )}

      {/* Conversation + input */}
      {isInRoom && (
        <>
          <div className="max-w-lg mx-auto px-4 py-4 space-y-3 min-h-[30vh]">
            {messages.map((msg) => {
              const isMine = msg.owner_email === currentUser?.email;
              return (
                <div key={msg.id} className={`flex gap-2 ${isMine ? "flex-row-reverse" : "flex-row"}`}>
                  <ParticipantAvatar url={msg.sender_avatar_url} name={msg.sender_participant_name} size="w-8 h-8" />
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

          {/* Watch-party video panel — reuses existing sanitizeVideoInput from Scenes */}
          <AnimatePresence>
            {showWatchPanel && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
                onClick={() => setShowWatchPanel(false)}>
                <motion.div initial={{ y: 50 }} animate={{ y: 0 }} exit={{ y: 50 }}
                  className="bg-card border border-border rounded-2xl p-4 w-full max-w-sm space-y-3"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-2"><Tv className="w-4 h-4 text-primary" /> Watch Party</h3>
                    <button onClick={() => setShowWatchPanel(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Paste any public video link — YouTube, Vimeo, or direct MP4/WebM. Everyone in the room watches together.</p>
                  <input type="url" value={videoInput} onChange={(e) => setVideoInput(e.target.value)}
                    placeholder="Paste video link…"
                    className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  <input type="text" value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)}
                    placeholder="Title (optional)"
                    className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  {videoError && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30">
                      <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive">{videoError}</p>
                    </div>
                  )}
                  <Button onClick={handleStartVideo} disabled={!videoInput.trim() || isSettingMedia} className="w-full rounded-xl" size="sm">
                    {isSettingMedia ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Starting…</> : <><Video className="w-4 h-4 mr-1.5" /> Start Watching</>}
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Message input — z-50, no BottomNav covering it */}
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-xl border-t border-border px-4 py-3">
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
                <button onClick={() => setShowWatchPanel(true)}
                  className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors" title="Watch party">
                  <Video className="w-5 h-5" />
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
    </div>
  );
}