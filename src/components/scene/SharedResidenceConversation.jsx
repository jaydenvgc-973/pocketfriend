import React, { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X, Users, Home } from "lucide-react";
import { useSharedResidenceParticipants } from "@/hooks/useSharedResidencePresence";

/**
 * SharedResidenceConversation
 *
 * Cross-account interaction inside a SHARED RESIDENTIAL LOCATION.
 *
 * This is the Gathering Room's established conversation engine applied to a home:
 * the same participant projection, the same message records, the same character
 * response generation, and the same canonical Memory writes. Only the container
 * differs — a residence instead of a timed room.
 *
 * Presence is the participation authority. Everyone listed here is here right
 * now according to the authoritative presence system: nothing is assumed from
 * ownership, residential assignment, or property access.
 */
export default function SharedResidenceConversation({ location, currentUser, onClose }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [senderId, setSenderId] = useState(null);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const { participants, refetch: refetchParticipants } = useSharedResidenceParticipants(location?.id, true);

  // ── Live transcript for THIS residence ──
  // Same message entity and same 20-message live window as a Gathering Room.
  const { data: messages = [] } = useQuery({
    queryKey: ["sharedResidenceMessages", location?.id],
    queryFn: async () => {
      if (!location?.id) return [];
      const rows = await base44.entities.GatheringRoomMessage.filter(
        { location_id: location.id },
        "-timestamp", 20
      );
      return rows.reverse();
    },
    enabled: !!location?.id,
  });

  // Event-driven delivery: a committed message arrives immediately for every
  // participant — no polling. Presence changes refresh the participant bar.
  useEffect(() => {
    if (!location?.id) return;
    const unsubMessages = base44.entities.GatheringRoomMessage.subscribe((event) => {
      if (event.data?.location_id !== location.id) return;
      queryClient.invalidateQueries({ queryKey: ["sharedResidenceMessages", location.id] });
    });
    const unsubCharacters = base44.entities.Character.subscribe(() => {
      refetchParticipants();
    });
    return () => {
      unsubMessages();
      unsubCharacters();
    };
  }, [location?.id, queryClient, refetchParticipants]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const myUser = useMemo(
    () => participants.find((p) => p.participant_type === "user" && p.owner_email === currentUser?.email) || null,
    [participants, currentUser?.email]
  );
  const mySpeakers = useMemo(
    () => participants.filter((p) => p.is_owned && (p.participant_type === "user" || p.participant_type === "character")),
    [participants]
  );
  const activeSender = participants.find((p) => p.id === senderId) || myUser;

  const others = participants.filter((p) => !p.is_self);

  const handleSend = () => {
    const content = text.trim();
    if (!content) return;
    setText("");
    setError(null);
    // Fire-and-forget exactly like the Gathering Room: the message is committed
    // before character responses are generated, and realtime delivers it.
    base44.functions.invoke("sendGatheringRoomMessage", {
      location_id: location.id,
      content,
      sender_participant_id: activeSender?.id || null,
    }).catch((err) => {
      const status = err?.response?.status || err?.status;
      if (status === 403) {
        setError(err?.response?.data?.error || err?.data?.error || "You're not present here right now.");
      }
    });
  };

  const formatTime = (ts) => ts
    ? new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    : "";

  const Avatar = ({ url, name, size = "w-8 h-8" }) => (
    <div className={`${size} rounded-full overflow-hidden border border-border flex-shrink-0 bg-secondary flex items-center justify-center`}>
      {url
        ? <img src={url} alt={name || "person"} className="w-full h-full object-cover" />
        : <span className="text-[10px] font-bold text-foreground">{name?.[0] || "?"}</span>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col">
      <div className="flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-xl px-4 py-3 flex items-center gap-3">
        <Home className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground truncate">{location?.name}</h2>
          <p className="text-[10px] text-muted-foreground">
            {participants.length} here together · everyone present can talk
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Who is actually here right now — presence, not ownership */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border">
        {participants.length === 0 ? (
          <p className="text-xs text-muted-foreground">No one is here right now.</p>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {participants.map((p) => (
              <div key={p.id} className="flex flex-col items-center gap-1 min-w-[52px]">
                <div className={p.is_self ? "ring-2 ring-primary rounded-full" : ""}>
                  <Avatar url={p.avatar_url} name={p.participant_name} size="w-9 h-9" />
                </div>
                <span className={`text-[9px] truncate max-w-[52px] ${p.is_self ? "text-primary font-medium" : "text-muted-foreground"}`}>
                  {p.is_self ? "You" : p.participant_name?.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 space-y-1">
            <Users className="w-8 h-8 text-muted-foreground/30 mx-auto" />
            <p className="text-xs text-muted-foreground">
              {others.length > 0
                ? `You're here with ${others.map((p) => p.participant_name).join(", ")}. Say something.`
                : "No one else is here right now."}
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const mine = msg.owner_email === currentUser?.email;
          return (
            <div key={msg.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
              <Avatar url={msg.sender_avatar_url} name={msg.sender_participant_name} />
              <div className={`max-w-[75%] flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-[10px] font-medium ${mine ? "text-primary" : "text-muted-foreground"}`}>
                    {mine ? "You" : msg.sender_participant_name?.split(" ")[0]}
                  </span>
                  <span className="text-[9px] text-muted-foreground/60">{formatTime(msg.timestamp)}</span>
                </div>
                <div className={`rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 border-t border-border bg-background/90 backdrop-blur-xl px-4 py-3">
        {mySpeakers.length > 1 && (
          <div className="flex items-center gap-1.5 mb-2 overflow-x-auto scrollbar-hide">
            {mySpeakers.map((p) => {
              const active = (activeSender?.id || myUser?.id) === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSenderId(p.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] whitespace-nowrap transition-colors ${
                    active ? "bg-primary/10 border-primary/40 text-primary" : "bg-secondary border-border text-muted-foreground"
                  }`}
                >
                  <Avatar url={p.avatar_url} name={p.participant_name} size="w-4 h-4" />
                  {p.participant_type === "user" ? "You" : p.participant_name?.split(" ")[0]}
                </button>
              );
            })}
          </div>
        )}
        {activeSender && activeSender.participant_type === "character" && (
          <p className="text-[10px] text-primary/80 mb-1">
            Speaking as {activeSender.participant_name}
          </p>
        )}
        {error && <p className="text-[10px] text-destructive mb-1">{error}</p>}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={participants.length > 1 ? "Say something here…" : "No one else is here…"}
            className="flex-1 px-4 py-2.5 rounded-xl bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}