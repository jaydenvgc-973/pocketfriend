import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Share2, Check, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function ShareNarrativeModal({ message, onClose }) {
  const [characters, setCharacters] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!message) return;
    base44.auth.me().then(me => {
      if (!me?.email) return;
      base44.entities.Character.filter({ status: "active", owner_email: me.email })
        .then(chars => setCharacters(chars || []))
        .catch(() => {});
    }).catch(() => {});
  }, [message]);

  const toggle = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const handleShare = async () => {
    if (selectedIds.length === 0) return;
    setIsSending(true);
    try {
      for (const charId of selectedIds) {
        const char = characters.find(c => c.id === charId);
        if (!char) continue;

        // Find or create direct conversation for this character
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

        // Create as a narrative message (not forwarded, not a bubble)
        await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: "character",
          character_id: message.character_id,
          character_name: message.character_name,
          content: message.content,
          is_narrative: true,
          timestamp: new Date().toISOString(),
        });

        await base44.entities.Conversation.update(convoId, {
          last_message_preview: message.content.substring(0, 100),
          last_message_date: new Date().toISOString(),
        }).catch(() => {});
      }
      setSent(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      console.error("[ShareNarrative] Failed:", err.message);
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
              <Share2 className="w-4 h-4 text-primary" /> Share narrative to...
            </h3>
            <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>

          {/* Preview */}
          <div className="px-3 py-2 rounded-xl bg-secondary border border-border text-xs text-muted-foreground max-h-16 overflow-hidden italic">
            {message.content.substring(0, 120)}
            {message.content?.length > 120 && "..."}
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
            onClick={handleShare}
            disabled={selectedIds.length === 0 || isSending || sent}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {sent ? (
              <><Check className="w-4 h-4" /> Shared!</>
            ) : isSending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sharing...</>
            ) : (
              <><Share2 className="w-4 h-4" /> Share to {selectedIds.length > 0 ? `${selectedIds.length} chat${selectedIds.length > 1 ? "s" : ""}` : "..."}</>
            )}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}