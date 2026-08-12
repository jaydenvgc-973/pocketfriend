import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Share2, Send, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { resolveOrCreateConversation } from "@/lib/conversationResolver";

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
 *   2. "Send to Character" — resolves/creates the canonical direct conversation
 *      with a character (via resolveOrCreateConversation) and sends the image
 *      as a Message with image_url. Uses the exact same chat delivery path
 *      as normal Chat/Text image sends.
 *
 * Recipients:
 *   - Room participants (other users' characters visible in the room)
 *   - Characters the user came with (from mySession.character_ids)
 *   - The room itself (all participants see it)
 */
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

  if (!imageUrl) return null;

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

  const handleSendToCharacter = async (characterId, characterName) => {
    setSendingTo(characterId);
    setError(null);
    try {
      const me = await base44.auth.me();
      if (!me?.email) throw new Error("Not authenticated");

      const conversationId = await resolveOrCreateConversation({
        characterId,
        characterName,
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

      onClose();
    } catch (err) {
      setError(err?.message || `Failed to send to ${characterName}`);
    }
    setSendingTo(null);
  };

  // Build recipient list: user's own characters + other room participants' characters
  const ownCharacterRecipients = myCharacters || [];
  const otherRoomCharacters = (roomParticipants || [])
    .filter((p) => !p.is_self && !p.is_owned && p.participant_name)
    .map((p) => ({ id: p.id, name: p.participant_name }));

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
          className="bg-card border border-border rounded-2xl w-full max-w-sm max-h-[80vh] overflow-hidden flex flex-col"
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

          {/* Recipients */}
          <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
            {/* Share to Room */}
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
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium">Everyone in {roomName || "Room"}</p>
                  <p className="text-[10px] text-muted-foreground">All participants see it here</p>
                </div>
                {sendingTo === "room" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <Send className="w-4 h-4 text-primary" />
                )}
              </button>
            </div>

            {/* User's own characters */}
            {ownCharacterRecipients.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Your Characters
                </p>
                <div className="space-y-1">
                  {ownCharacterRecipients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSendToCharacter(c.id, c.name)}
                      disabled={sendingTo !== null}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {c.avatar_url ? (
                          <img src={c.avatar_url} alt={c.name} className="w-full h-full object-cover" />
                        ) : (
                          <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <span className="text-sm flex-1 text-left">{c.name}</span>
                      {sendingTo === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Other room participants' characters */}
            {otherRoomCharacters.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Others in Room
                </p>
                <div className="space-y-1">
                  {otherRoomCharacters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSendToCharacter(c.id, c.name)}
                      disabled={sendingTo !== null}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <span className="text-sm flex-1 text-left">{c.name}</span>
                      {sendingTo === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 py-2 text-[10px] text-destructive border-t border-border">
              {error}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}