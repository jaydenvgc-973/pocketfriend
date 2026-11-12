import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Forward, Check, Loader2, Globe2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { analyzeImageForCharacterContext } from "@/lib/analyzeImageForCharacterContext";
import { resolveOrCreateConversation } from "@/lib/conversationResolver";
import { resolveNarrativeShareRecipients } from "@/lib/narrativeShareRecipients";

export default function ForwardMessageModal({ message, onClose }) {
  const [characters, setCharacters] = useState([]);
  const [crossAccountCharacters, setCrossAccountCharacters] = useState([]);
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!message) return;
    let cancelled = false;
    setIsLoadingRecipients(true);
    base44.auth.me().then(me => {
      if (!me?.email) return;
      // Narratives also offer characters from other accounts who are already known
      // to the character the narrative belongs to. Plain forwards stay own-only.
      if (message.is_narrative) {
        return resolveNarrativeShareRecipients({ message, me }).then(({ own, crossAccount }) => {
          if (cancelled) return;
          setCharacters(own);
          setCrossAccountCharacters(crossAccount);
        });
      }
      return base44.entities.Character.filter({ status: "active", owner_email: me.email })
        .then(chars => {
          if (cancelled) return;
          setCharacters(chars || []);
          setCrossAccountCharacters([]);
        })
        .catch(() => {});
    }).catch(() => {}).finally(() => {
      if (!cancelled) setIsLoadingRecipients(false);
    });
    return () => { cancelled = true; };
  }, [message]);

  const toggle = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const handleForward = async () => {
    if (selectedIds.length === 0) return;
    setIsSending(true);
    try {
      // If the original message has an image but no stored description, analyze it once
      // before creating any forwarded messages so all recipients get the same description.
      let resolvedImageDescription = message.image_description || null;
      if (message.image_url && !resolvedImageDescription) {
        const analysis = await analyzeImageForCharacterContext({
          imageUrl: message.image_url,
          messageId: null, // don't overwrite the original message — store on each forwarded copy below
          context: "forwarded",
        });
        resolvedImageDescription = analysis.imageDescription || null;
      }

      const allRecipients = [...characters, ...crossAccountCharacters];
      for (const charId of selectedIds) {
        const char = allRecipients.find(c => c.id === charId);
        if (!char) continue;

        // CANONICAL RESOLVER: Use the single authoritative conversation-identity
        // resolver shared with Chat loading and Scene image delivery. This
        // guarantees the forwarded message is written to the same conversation
        // the Chat page will load — no inline duplicate filters, no divergence.
        const me = await base44.auth.me().catch(() => null);
        const ownerEmail = me?.email || null;
        const convoId = await resolveOrCreateConversation({
          characterId: charId,
          characterName: char.name,
          chatType: "direct",
          ownerEmail,
        });

        const isNarrative = !!message.is_narrative;
        const senderLabel = message.character_name || "them";
        const fwdContent = isNarrative
          ? message.content
          : (message.content
            ? `Fwd Message from ${senderLabel}:\n${message.content}`
            : `Fwd Message from ${senderLabel}`);

        const forwardedPayload = {
          conversation_id: convoId,
          sender_type: isNarrative ? "character" : "user",
          character_id: isNarrative ? message.character_id : undefined,
          character_name: isNarrative ? message.character_name : undefined,
          content: fwdContent,
          image_url: message.image_url || undefined,
          timestamp: new Date().toISOString(),
          is_narrative: isNarrative || undefined,
          is_forwarded: !isNarrative,
          forwarded_from: isNarrative ? undefined : senderLabel,
        };

        // CRITICAL: Preserve location_share so the receiving chat renders the card UI
        if (message.location_share) {
          forwardedPayload.location_share = message.location_share;
          forwardedPayload.content = "";
        }

        // Carry image description to receiving character — never leave them blind
        if (message.image_url) {
          if (resolvedImageDescription) {
            forwardedPayload.image_description = resolvedImageDescription;
            forwardedPayload.image_analysis_status = "complete";
          } else {
            // Analysis ran but returned nothing — mark failed visibly, not pending
            forwardedPayload.image_analysis_status = "failed";
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

  const renderRecipient = (char, isCrossAccount = false) => (
    <button
      key={char.id}
      onClick={() => toggle(char.id)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left ${
        selectedIds.includes(char.id)
          ? "bg-primary/10 border-primary/40"
          : isCrossAccount
            ? "bg-secondary/30 border-dashed border-border hover:border-primary/30"
            : "bg-secondary/50 border-border hover:border-primary/30"
      }`}
    >
      <div className="w-8 h-8 rounded-full bg-primary/20 flex-shrink-0 overflow-hidden flex items-center justify-center">
        {char.avatar_url
          ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-primary">{char.name?.[0]}</span>
        }
      </div>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-foreground truncate">{char.name}</span>
        {isCrossAccount && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Globe2 className="w-2.5 h-2.5" /> Other account
          </span>
        )}
      </span>
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
        selectedIds.includes(char.id) ? "bg-primary border-primary" : "border-border"
      }`}>
        {selectedIds.includes(char.id) && <Check className="w-3 h-3 text-white" />}
      </div>
    </button>
  );

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
              <Forward className="w-4 h-4 text-primary" /> {message.is_narrative ? "Share narrative to..." : "Forward to..."}
            </h3>
            <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>

          {/* Preview */}
          <div className="px-3 py-2 rounded-xl bg-secondary border border-border text-xs text-muted-foreground max-h-16 overflow-hidden">
            <span className="font-medium text-foreground">Fwd: </span>
            {message.image_url && !message.content && "📷 Photo"}
            {message.content && message.content.substring(0, 120)}
            {message.content?.length > 120 && "..."}
            {message.image_url && message.content && " 📷"}
          </div>

          {/* Character list — own characters first (A–Z), then known cross-account characters (A–Z) */}
          <div className="max-h-56 overflow-y-auto space-y-1">
            {isLoadingRecipients ? (
              <p className="text-xs text-muted-foreground px-1 py-3 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading recipients...
              </p>
            ) : (
              <>
                {characters.length === 0 && crossAccountCharacters.length === 0 && (
                  <p className="text-xs text-muted-foreground px-1 py-3">No characters available.</p>
                )}

                {characters.map(char => renderRecipient(char))}

                {crossAccountCharacters.length > 0 && (
                  <div className="pt-2 space-y-1">
                    <p className="flex items-center gap-1.5 px-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <Globe2 className="w-3 h-3" /> From other accounts
                    </p>
                    {crossAccountCharacters.map(char => renderRecipient(char, true))}
                  </div>
                )}
              </>
            )}
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
              <><Forward className="w-4 h-4" /> {message.is_narrative ? "Share" : "Forward"} to {selectedIds.length > 0 ? `${selectedIds.length} chat${selectedIds.length > 1 ? "s" : ""}` : "..."}</>
            )}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}