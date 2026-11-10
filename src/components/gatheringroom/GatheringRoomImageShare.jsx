import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Share2, Send, Users, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { resolveOrCreateConversation } from "@/lib/conversationResolver";
import ImageShareSelector from "@/components/sharing/ImageShareSelector";
import { alphabetizeByName } from "@/lib/imageShareCharacters";

/**
 * GatheringRoomImageShare
 *
 * Shares the current Gathering Room scene image through the application's
 * EXISTING media-delivery pathways — no duplicate messaging system.
 *
 * Two sharing modes:
 *   1. "Share to Room" — sends the image as a GatheringRoomMessage with
 *      image_url. All room participants see it in the live room transcript.
 *      Uses the existing sendGatheringRoomMessage backend function.
 *   2. "Send to Character" — the existing sender selection applies: the image is
 *      sent either as the user (canonical direct conversation, as before) or as
 *      one of the user's characters through the existing World Phone image
 *      pathway, which is also how characters reach characters on another account.
 */

const sortByName = (list) => alphabetizeByName(list);

export default function GatheringRoomImageShare({
  imageUrl,
  roomName,
  roomId,
  myCharacters,
  roomParticipants,
  onClose,
}) {
  const [caption, setCaption] = useState("");
  const [sendingTo, setSendingTo] = useState(null); // 'room' | character_id | null
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [senderId, setSenderId] = useState("user");
  const [recipients, setRecipients] = useState([]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  if (!imageUrl) return null;

  const ownCharacters = sortByName(myCharacters || []);
  const otherAccountCharacters = sortByName(
    (roomParticipants || [])
      .filter((p) => !p.is_self && !p.is_owned && p.participant_name && p.participant_type !== "user")
      .map((p) => ({ id: p.participant_id || p.id, name: p.participant_name, avatar_url: p.avatar_url || null, is_other_account: true }))
  );

  const senderOptions = [
    { id: "user", name: user?.full_name || "You", avatar_url: null },
    ...ownCharacters,
  ];
  const allRecipients = [...ownCharacters, ...otherAccountCharacters];

  const toggleRecipient = (id) =>
    setRecipients((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleShareToRoom = async () => {
    setSendingTo("room");
    setError(null);
    try {
      await base44.functions.invoke("sendGatheringRoomMessage", {
        gathering_room_id: roomId,
        content: caption.trim() || `Shared a moment from ${roomName}`,
        image_url: imageUrl,
      });
      onClose();
    } catch (err) {
      setError(err?.message || "Failed to share to room");
    }
    setSendingTo(null);
  };

  const handleSend = async () => {
    if (recipients.length === 0) return;
    setError(null);
    setSendingTo("characters");

    const senderIsUser = senderId === "user";
    const senderCharacter = ownCharacters.find((c) => c.id === senderId) || null;

    try {
      for (const personId of recipients) {
        const person = allRecipients.find((p) => p.id === personId);
        if (!person || person.id === senderId) continue;

        if (senderIsUser) {
          // User-sent image — unchanged existing chat delivery path.
          if (person.is_other_account) continue;
          const me = user || (await base44.auth.me());
          if (!me?.email) throw new Error("Not authenticated");

          const conversationId = await resolveOrCreateConversation({
            characterId: person.id,
            characterName: person.name,
            chatType: "direct",
            ownerEmail: me.email,
          });

          await base44.entities.Message.create({
            conversation_id: conversationId,
            sender_type: "user",
            content: caption.trim() || `Shared a moment from ${roomName}`,
            image_url: imageUrl,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Character-sent image — existing World Phone image pathway.
          const res = await base44.functions.invoke("sendWorldPhoneMessage", {
            sender_character_id: senderCharacter.id,
            recipient_identifier: person.id,
            requested_message: "",
            image_url: imageUrl,
            image_description: caption.trim() || `Shared a moment from ${roomName}`,
            image_analysis_status: "complete",
            image_analysis_is_transport_metadata: false,
            message_type: "image",
            source: "gathering_room_image_share",
            owner_email: user?.email,
          });
          if (!res?.data?.success) {
            throw new Error(res?.data?.error || `Failed to send to ${person.name}`);
          }
        }
      }

      onClose();
    } catch (err) {
      setError(err?.message || "Failed to send image");
    }
    setSendingTo(null);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 50 }}
          animate={{ y: 0 }}
          exit={{ y: 50 }}
          className="bg-card border border-border rounded-2xl w-full max-w-sm max-h-[85vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold">Share Room Image</h3>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Image preview */}
          <div className="px-4 pt-3">
            <img
              src={imageUrl}
              alt={roomName || "Gathering Room"}
              className="w-full h-32 rounded-xl object-cover border border-border"
            />
          </div>

          {/* Caption */}
          <div className="px-4 py-3">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption (optional)…"
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
            {/* Share to Room — unchanged */}
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <Users className="w-3 h-3" /> Share to Room
              </p>
              <button
                onClick={handleShareToRoom}
                disabled={sendingTo !== null}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium truncate">Everyone in {roomName || "Room"}</p>
                  <p className="text-[10px] text-muted-foreground">All participants see it here</p>
                </div>
                {sendingTo === "room" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <Send className="w-4 h-4 text-primary" />
                )}
              </button>
            </div>

            {/* Send to a character — sender + alphabetical recipient list */}
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Send to a character
              </p>
              <ImageShareSelector
                senders={senderOptions}
                senderId={senderId}
                onSenderChange={setSenderId}
                ownCharacters={ownCharacters}
                otherAccountCharacters={otherAccountCharacters}
                selectedIds={recipients}
                onToggle={toggleRecipient}
                disabled={sendingTo !== null}
                userLabel={user?.full_name || "You"}
              />
              <button
                onClick={handleSend}
                disabled={sendingTo !== null || recipients.length === 0}
                className="w-full mt-2 flex items-center justify-center gap-2 p-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {sendingTo === "characters" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sendingTo === "characters" ? "Sending..." : `Send${recipients.length > 0 ? ` (${recipients.length})` : ""}`}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-4 py-2 text-[10px] text-destructive border-t border-border">{error}</div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}