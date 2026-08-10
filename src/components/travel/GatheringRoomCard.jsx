import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Clock, AlertCircle } from "lucide-react";

/**
 * GatheringRoomCard — displays a Gathering Room on the Travel page.
 *
 * SINGLE SELECTION AUTHORITY: This component does NOT maintain its own character
 * selection state. It consumes the existing Travel page character picker
 * (selectedCharacterIds) directly. When the user taps a card, admission is
 * attempted with whatever characters are already selected in the Travel picker.
 *
 * If capacity fails, the error is shown inline — the user returns to the
 * existing Travel picker to adjust their selection. No second picker modal.
 */
export default function GatheringRoomCard({ room, currentUser, selectedCharacterIds = [] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    setAdmitError(null);

    // Already in the room → just navigate
    if (mySession) {
      navigate(`/gathering-room/${room.id}`);
      return;
    }

    // Use the EXISTING Travel picker selection — no second picker
    const partySize = 1 + selectedCharacterIds.length;

    // Pre-check capacity locally for instant feedback
    if (partySize > availableSlots) {
      setAdmitError(
        `Your party of ${partySize} exceeds ${availableSlots} available slot${availableSlots !== 1 ? "s" : ""}. Adjust your selection above.`
      );
      return;
    }

    setIsAdmitting(true);
    try {
      const res = await base44.functions.invoke("admitToGatheringRoom", {
        gathering_room_id: room.id,
        character_ids: selectedCharacterIds,
      });
      queryClient.invalidateQueries({ queryKey: ["gatheringRoomParticipants", room.id] });
      navigate(`/gathering-room/${room.id}`);
    } catch (err) {
      const data = err?.response?.data || err?.data || {};
      if (data.error === "capacity_exceeded") {
        setAdmitError(data.message || `Room has only ${data.available_slots} slot(s) open. Adjust your selection above.`);
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

  return (
    <>
      <motion.div
        whileTap={{ scale: 0.98 }}
        onClick={handleEnter}
        className="relative rounded-2xl overflow-hidden border border-border bg-card cursor-pointer group"
      >
        {/* Room scene image — prefer dynamically generated scene, fall back to base image */}
        <div className="relative h-28 overflow-hidden">
          {room.scene_image_url ? (
            <img src={room.scene_image_url} alt={room.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          ) : room.image_url ? (
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
                {selectedCharacterIds.length > 0 && (
                  <span className="text-primary/70"> · your party: {1 + selectedCharacterIds.length}</span>
                )}
              </span>
            )}
          </div>

          {/* Inline error — no second picker, user adjusts selection in Travel picker */}
          <AnimatePresence>
            {admitError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-1.5 pt-1"
              >
                <AlertCircle className="w-3 h-3 text-destructive flex-shrink-0 mt-0.5" />
                <span className="text-[10px] text-destructive">{admitError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {isAdmitting && (
            <div className="flex items-center gap-2 pt-1">
              <div className="w-3 h-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              <span className="text-[10px] text-muted-foreground">Entering…</span>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}