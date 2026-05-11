import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Forward, Check, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function ForwardMessageModal({ message, onClose }) {
  const [characters, setCharacters] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!message) return;
    base44.entities.Character.filter({ status: "active" })
      .then(chars => setCharacters(chars || []))
      .catch(() => {});
  }, [message]);

  const toggle = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const handleForward = async () => {
    if (selectedIds.length === 0) return;
    setIsSending(true);
    try {
      for (const charId of selectedIds) {
        const char = characters.find(c => c.id === charId);
        if (!char) continue;

        // Find or create direct conversation
        const convos = await base44.entities.Conversation.filter({ type: "direct", character_ids: [charId] });
        const direct = convos.filter(c => c.character_ids?.length === 1 && c.character_ids[0] === charId);
        let convoId = direct[0]?.id;
        if (!convoId) {
          const newConvo = await base44.entities.Conversation.create({
            title: `direct with ${char.name}`,
            type: "direct",
            character_ids: [charId],
          });
          convoId = newConvo.id;
        }

        const senderLabel = message.character_name || "them";
        const fwdContent = message.content
          ? `Fwd Message from ${senderLabel}:\n${message.content}`
          : `Fwd Message from ${senderLabel}`;

        // CRITICAL: Preserve location_share payload so the receiving chat renders the
        // same location card UI as the original message — not just generic forwarded text.
        const forwardedPayload = {
          conversation_id: convoId,
          sender_type: "user",
          content: fwdContent,
          image_url: message.image_url || undefined,
          timestamp: new Date().toISOString(),
          is_forwarded: true,
          forwarded_from: senderLabel,
        };
        if (message.location_share) {
          forwardedPayload.location_share = message.location_share;
          // Location card has no text content — clear the generic "Fwd Message" text
          // so the renderer hits the location_share branch, not the text branch.
          forwardedPayload.content = "";
        }

        // Preserve stored image_description on forwarded messages so the
        // receiving character inherits the visual analysis and is not blind.
        // If no stored description exists, image_analysis_status marks it pending
        // so a future analysis pass can back-fill it if needed.
        if (message.image_url) {
          if (message.image_description) {
            forwardedPayload.image_description = message.image_description;
            forwardedPayload.image_analysis_status = "complete";
          } else {
            forwardedPayload.image_analysis_status = "pending";
          }
        }

        await base44.entities.Message.create(forwardedPayload);

        await base44.entities.Conversation.update(convoId, {
          last_message_preview: fwdContent.substring(0, 100),
          last_message_date: new Date().toISOString(),
        }).catch(() => {});
      }
      setSent(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      console.error("[Forward] Failed:", err.message);
    } finally {
      setIsSending(false);
    }
  };

  if (!message) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-[60] flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg bg-card border-t border-border rounded-t-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Forward className="w-4 h-4 text-primary" /> Forward to...
            </h3>
            <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>

          {/* Preview of what's being forwarded */}
          <div className="px-3 py-2 rounded-xl bg-secondary border border-border text-xs text-muted-foreground max-h-16 overflow-hidden">
            <span className="font-medium text-foreground">Fwd: </span>
            {message.image_url && !message.content && "📷 Photo"}
            {message.content && message.content.substring(0, 120)}
            {message.content?.length > 120 && "..."}
            {message.image_url && message.content && " 📷"}
          </div>

          {/* Character list */}
          <div className="max-h-56 overflow-y-auto space-y-1">
            {characters.map(char => (
              <button
                key={char.id}
                onClick={() => toggle(char.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left ${
                  selectedIds.includes(char.id)
                    ? "bg-primary/10 border-primary/40"
                    : "bg-secondary/50 border-border hover:border-primary/30"
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-primary/20 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {char.avatar_url
                    ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                    : <span className="text-xs font-bold text-primary">{char.name?.[0]}</span>
                  }
                </div>
                <span className="flex-1 text-sm font-medium text-foreground">{char.name}</span>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  selectedIds.includes(char.id) ? "bg-primary border-primary" : "border-border"
                }`}>
                  {selectedIds.includes(char.id) && <Check className="w-3 h-3 text-white" />}
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={handleForward}
            disabled={selectedIds.length === 0 || isSending || sent}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {sent ? (
              <><Check className="w-4 h-4" /> Forwarded!</>
            ) : isSending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
            ) : (
              <><Forward className="w-4 h-4" /> Forward to {selectedIds.length > 0 ? `${selectedIds.length} chat${selectedIds.length > 1 ? "s" : ""}` : "..."}</>
            )}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}