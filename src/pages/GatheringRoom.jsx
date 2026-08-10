import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, LogOut, Clock, Users, AtSign, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";

export default function GatheringRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [directedTo, setDirectedTo] = useState([]); // participant IDs for directed speech
  const [showDirectPicker, setShowDirectPicker] = useState(false);
  const [error, setError] = useState(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(1800);
  const messagesEndRef = useRef(null);

  // ── Current user ──
  const { data: currentUser = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // ── Load room ──
  const { data: room } = useQuery({
    queryKey: ["gatheringRoom", roomId],
    queryFn: async () => {
      const rooms = await base44.entities.GatheringRoom.filter({ id: roomId }, null, 1);
      return rooms[0] || null;
    },
    enabled: !!roomId,
  });

  // ── Load participants ──
  const { data: participants = [], refetch: refetchParticipants } = useQuery({
    queryKey: ["gatheringRoomParticipants", roomId],
    queryFn: async () => {
      return await base44.entities.GatheringRoomParticipant.filter(
        { gathering_room_id: roomId },
        "joined_at", 20
      );
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

  // ── Load my active session ──
  const { data: mySession } = useQuery({
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
    if (mySession?.expires_at) {
      setSessionExpiresAt(mySession.expires_at);
    }
  }, [mySession]);

  // ── Session countdown timer ──
  useEffect(() => {
    if (!sessionExpiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(sessionExpiresAt).getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        navigate("/travel");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionExpiresAt]);

  // ── Realtime subscriptions (event-driven, no polling) ──
  useEffect(() => {
    if (!roomId) return;

    const unsubMessages = base44.entities.GatheringRoomMessage.subscribe((event) => {
      if (event.data?.gathering_room_id === roomId) {
        refetchMessages();
      }
    });

    const unsubParticipants = base44.entities.GatheringRoomParticipant.subscribe((event) => {
      if (event.data?.gathering_room_id === roomId || event.type === 'delete') {
        refetchParticipants();
      }
    });

    return () => {
      unsubMessages();
      unsubParticipants();
    };
  }, [roomId, refetchMessages, refetchParticipants]);

  // ── Auto-scroll to bottom on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Sorted participants: self first, then others by join time ──
  const sortedParticipants = useMemo(() => {
    const myEmail = currentUser?.email;
    if (!myEmail) return participants;
    const mine = participants.filter(p => p.owner_email === myEmail);
    const others = participants.filter(p => p.owner_email !== myEmail);
    return [...mine, ...others];
  }, [participants, currentUser?.email]);

  // ── My participant record (user type) ──
  const myUserParticipant = useMemo(() => {
    return participants.find(p => p.owner_email === currentUser?.email && p.participant_type === "user");
  }, [participants, currentUser?.email]);

  // ── Am I in the room? ──
  const isInRoom = !!mySession && mySession.status === "active";

  // ── Handle send message ──
  const handleSend = async () => {
    if (!messageText.trim() || !isInRoom || !myUserParticipant) return;
    setIsSending(true);
    setError(null);
    try {
      await base44.functions.invoke("sendGatheringRoomMessage", {
        gathering_room_id: roomId,
        content: messageText.trim(),
        sender_participant_id: myUserParticipant.id,
        is_directed: directedTo.length > 0,
        directed_to_participant_ids: directedTo,
      });
      setMessageText("");
      setDirectedTo([]);
      setShowDirectPicker(false);
      refetchMessages();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Failed to send message");
    }
    setIsSending(false);
  };

  // ── Handle exit ──
  const handleExit = async () => {
    try {
      await base44.functions.invoke("exitGatheringRoom", {
        gathering_room_id: roomId,
      });
      queryClient.invalidateQueries({ queryKey: ["gatheringRoomParticipants", roomId] });
      queryClient.invalidateQueries({ queryKey: ["gatheringRoomMessages", roomId] });
      navigate("/travel");
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to exit room");
    }
  };

  // ── Format time remaining ──
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── Format message timestamp ──
  const formatMsgTime = (ts) => {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    });
  };

  if (!room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* ── Header ── */}
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
          <button
            onClick={handleExit}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Leave
          </button>
        )}
      </div>

      {/* ── Scene Image ── */}
      <div className="pt-14">
        <div className="relative w-full h-48 sm:h-64 overflow-hidden">
          {room.image_url ? (
            <img
              src={room.image_url}
              alt={room.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 via-secondary to-background flex items-center justify-center">
              <Users className="w-12 h-12 text-muted-foreground/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
          {room.description && (
            <p className="absolute bottom-2 left-4 right-4 text-xs text-foreground/70 line-clamp-2">
              {room.description}
            </p>
          )}
        </div>
      </div>

      {/* ── Participant Bar ── */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {sortedParticipants.map((p) => {
            const isMe = p.owner_email === currentUser?.email;
            return (
              <div
                key={p.id}
                className={`flex flex-col items-center gap-1 min-w-[56px] ${isMe ? 'order-first' : ''}`}
              >
                <div className={`relative w-12 h-12 rounded-full overflow-hidden border-2 ${isMe ? 'border-primary' : 'border-border'}`}>
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={p.participant_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground">
                      {p.participant_name?.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <span className={`text-[10px] truncate max-w-[56px] ${isMe ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {isMe ? "You" : p.participant_name?.split(" ")[0]}
                </span>
              </div>
            );
          })}
          {participants.length === 0 && !isInRoom && (
            <p className="text-xs text-muted-foreground py-2">No one is here right now.</p>
          )}
        </div>
      </div>

      {/* ── Not in room state ── */}
      {!isInRoom && (
        <div className="flex flex-col items-center justify-center py-20 px-4 gap-4">
          <Users className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center">
            You're not in this Gathering Room. Go to Travel to enter.
          </p>
          <Link to="/travel">
            <Button variant="outline" size="sm">Go to Travel</Button>
          </Link>
        </div>
      )}

      {/* ── Conversation ── */}
      {isInRoom && (
        <>
          <div className="max-w-lg mx-auto px-4 py-4 space-y-3 min-h-[40vh]">
            {messages.map((msg) => {
              const isMine = msg.owner_email === currentUser?.email;
              return (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 border border-border">
                    {msg.sender_avatar_url ? (
                      <img src={msg.sender_avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                        {msg.sender_participant_name?.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-[10px] font-medium ${isMine ? 'text-primary' : 'text-muted-foreground'}`}>
                        {isMine ? "You" : msg.sender_participant_name?.split(" ")[0]}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">{formatMsgTime(msg.timestamp)}</span>
                    </div>
                    {msg.is_directed && msg.directed_to_participant_names?.length > 0 && (
                      <span className="text-[10px] text-primary/70 flex items-center gap-0.5">
                        <AtSign className="w-2.5 h-2.5" />
                        {msg.directed_to_participant_names.join(", ")}
                      </span>
                    )}
                    <div
                      className={`rounded-2xl px-3 py-2 text-sm ${
                        isMine
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground"
                      }`}
                    >
                      {msg.content}
                    </div>
                    {msg.image_url && (
                      <img src={msg.image_url} alt="" className="mt-1 rounded-xl max-w-[200px]" />
                    )}
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                Start the conversation — say something to the room.
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ── Directed speech picker ── */}
          <AnimatePresence>
            {showDirectPicker && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
                onClick={() => setShowDirectPicker(false)}
              >
                <motion.div
                  initial={{ y: 50 }}
                  animate={{ y: 0 }}
                  exit={{ y: 50 }}
                  className="bg-card border border-border rounded-2xl p-4 w-full max-w-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold">Direct message to…</h3>
                    <button onClick={() => setShowDirectPicker(false)}>
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {participants
                      .filter(p => p.id !== myUserParticipant?.id)
                      .map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setDirectedTo(prev =>
                              prev.includes(p.id)
                                ? prev.filter(id => id !== p.id)
                                : [...prev, p.id]
                            );
                          }}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                            directedTo.includes(p.id) ? "bg-primary/10" : "hover:bg-secondary"
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full overflow-hidden border border-border">
                            {p.avatar_url ? (
                              <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-secondary flex items-center justify-center text-xs">
                                {p.participant_name?.charAt(0)}
                              </div>
                            )}
                          </div>
                          <span className="text-sm">{p.participant_name}</span>
                        </button>
                      ))}
                  </div>
                  <Button
                    size="sm"
                    className="w-full mt-3"
                    onClick={() => setShowDirectPicker(false)}
                  >
                    Done
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Message Input ── */}
          <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/90 backdrop-blur-xl border-t border-border px-4 py-3">
            <div className="max-w-lg mx-auto">
              {directedTo.length > 0 && (
                <div className="flex items-center gap-1 mb-2 flex-wrap">
                  {directedTo.map(id => {
                    const p = participants.find(pp => pp.id === id);
                    return (
                      <span key={id} className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        <AtSign className="w-2.5 h-2.5" />
                        {p?.participant_name?.split(" ")[0]}
                        <button onClick={() => setDirectedTo(prev => prev.filter(x => x !== id))}>
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {error && <p className="text-[10px] text-destructive mb-2">{error}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDirectPicker(true)}
                  className={`p-2 rounded-lg transition-colors ${
                    directedTo.length > 0 ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <AtSign className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder={directedTo.length > 0 ? "Direct message…" : "Say something to the room…"}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground text-sm"
                />
                <button
                  onClick={handleSend}
                  disabled={!messageText.trim() || isSending}
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <BottomNav />
    </div>
  );
}