import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Clock, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GatheringRoomCard({ room, currentUser, activeCharacters }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [selectedCharIds, setSelectedCharIds] = useState([]);
  const [isAdmitting, setIsAdmitting] = useState(false);
  const [admitError, setAdmitError] = useState(null);

  // ── Load current participants for this room (occupancy count) ──
  const { data: participants = [] } = useQuery({
    queryKey: ["gatheringRoomParticipants", room.id],
    queryFn: async () => {
      return await base44.entities.GatheringRoomParticipant.filter(
        { gathering_room_id: room.id },
        "joined_at", 20
      );
    },
  });

  // ── Load cooldown for this user + room ──
  const { data: cooldowns = [] } = useQuery({
    queryKey: ["gatheringRoomCooldown", room.id, currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      return await base44.entities.GatheringRoomCooldown.filter(
        { gathering_room_id: room.id, owner_email: currentUser.email },
        "-created_at", 5
      );
    },
    enabled: !!currentUser?.email,
  });

  const activeCooldown = useMemo(() => {
    return cooldowns.find(c => new Date(c.cooldown_until).getTime() > Date.now());
  }, [cooldowns]);

  const occupancy = participants.length;
  const availableSlots = 8 - occupancy;

  // ── Check if user already has an active session in this room ──
  const { data: mySession } = useQuery({
    queryKey: ["myGatheringRoomSession", room.id, currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const sessions = await base44.entities.GatheringRoomSession.filter(
        { gathering_room_id: room.id, owner_email: currentUser.email, status: "active" },
        "-started_at", 1
      );
      return sessions[0] || null;
    },
    enabled: !!currentUser?.email,
  });

  const handleEnter = async () => {
    if (mySession) {
      navigate(`/gathering-room/${room.id}`);
      return;
    }
    setShowEntryModal(true);
    setSelectedCharIds([]);
    setAdmitError(null);
  };

  const handleConfirmAdmit = async () => {
    setIsAdmitting(true);
    setAdmitError(null);
    try {
      const res = await base44.functions.invoke("admitToGatheringRoom", {
        gathering_room_id: room.id,
        character_ids: selectedCharIds,
      });
      queryClient.invalidateQueries({ queryKey: ["gatheringRoomParticipants", room.id] });
      setShowEntryModal(false);
      navigate(`/gathering-room/${room.id}`);
    } catch (err) {
      const data = err?.response?.data || {};
      if (data.error === "capacity_exceeded") {
        setAdmitError(data.message || `Room is full. ${data.available_slots} slot(s) available.`);
      } else if (data.error === "cooldown_active") {
        const mins = Math.ceil((new Date(data.cooldown_until).getTime() - Date.now()) / 60000);
        setAdmitError(`You're on cooldown for this room. Try again in ${mins} minute(s).`);
      } else if (data.error === "already_in_room") {
        navigate(`/gathering-room/${room.id}`);
      } else {
        setAdmitError(data.error || "Failed to enter room.");
      }
    }
    setIsAdmitting(false);
  };

  const toggleChar = (id) => {
    setSelectedCharIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const partySize = 1 + selectedCharIds.length;
  const wouldFit = partySize <= availableSlots;

  return (
    <>
      <motion.div
        whileTap={{ scale: 0.98 }}
        onClick={handleEnter}
        className="relative rounded-2xl overflow-hidden border border-border bg-card cursor-pointer group"
      >
        {/* Room image */}
        <div className="relative h-28 overflow-hidden">
          {room.image_url ? (
            <img src={room.image_url} alt={room.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/20 via-secondary to-background" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
        </div>

        {/* Room info */}
        <div className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground truncate">{room.name}</h3>
              {room.description && (
                <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{room.description}</p>
              )}
            </div>
            <div className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${
              occupancy >= 8 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            }`}>
              <Users className="w-3 h-3" />
              {occupancy}/8
            </div>
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-2">
            {mySession ? (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                You're in this room
              </span>
            ) : activeCooldown ? (
              <span className="text-[10px] text-amber-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Cooldown active
              </span>
            ) : availableSlots === 0 ? (
              <span className="text-[10px] text-destructive">Room is full</span>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {availableSlots} slot{availableSlots !== 1 ? "s" : ""} open
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── Entry Modal (character selector) ── */}
      <AnimatePresence>
        {showEntryModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
            onClick={() => !isAdmitting && setShowEntryModal(false)}
          >
            <motion.div
              initial={{ y: 50 }}
              animate={{ y: 0 }}
              exit={{ y: 50 }}
              className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold">Enter {room.name}</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {occupancy}/8 here · {availableSlots} slot{availableSlots !== 1 ? "s" : ""} open
                  </p>
                </div>
                <button onClick={() => !isAdmitting && setShowEntryModal(false)}>
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <p className="text-xs text-muted-foreground mb-2">Choose who's coming with you:</p>

              {/* Character selector */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
                {activeCharacters.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No characters available to bring.</p>
                )}
                {activeCharacters.map(char => {
                  const isSelected = selectedCharIds.includes(char.id);
                  return (
                    <button
                      key={char.id}
                      onClick={() => toggleChar(char.id)}
                      disabled={isAdmitting}
                      className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-colors text-left ${
                        isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-secondary border border-transparent"
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full overflow-hidden border border-border flex-shrink-0">
                        {char.avatar_url || char.image_avatar_url ? (
                          <img src={char.avatar_url || char.image_avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-secondary flex items-center justify-center text-xs font-bold">
                            {char.name?.charAt(0)}
                          </div>
                        )}
                      </div>
                      <span className="flex-1 text-sm font-medium truncate">{char.name}</span>
                      {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Party size + capacity check */}
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="text-muted-foreground">
                  Your party: <span className={`font-bold ${wouldFit ? "text-foreground" : "text-destructive"}`}>{partySize}</span>
                  {" "}/ {availableSlots} available
                </span>
                {!wouldFit && partySize > 0 && (
                  <span className="text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Too many
                  </span>
                )}
              </div>

              {admitError && (
                <div className="mb-3 p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{admitError}</span>
                </div>
              )}

              <Button
                onClick={handleConfirmAdmit}
                disabled={isAdmitting || (partySize > availableSlots)}
                className="w-full"
              >
                {isAdmitting ? "Entering…" : `Enter with ${selectedCharIds.length} ${selectedCharIds.length === 1 ? "character" : "characters"}`}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                30-minute session · 5-min cooldown after
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}