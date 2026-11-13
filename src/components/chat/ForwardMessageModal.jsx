import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Forward, Check, Loader2, Globe2, User as UserIcon } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { analyzeImageForCharacterContext } from "@/lib/analyzeImageForCharacterContext";
import { resolveOrCreateConversation } from "@/lib/conversationResolver";
import { resolveNarrativeShareRecipients } from "@/lib/narrativeShareRecipients";

export default function ForwardMessageModal({ message, onClose, chatType = "direct", originCharacter = null }) {
  const [characters, setCharacters] = useState([]);
  const [crossAccountCharacters, setCrossAccountCharacters] = useState([]);
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  // Sender identity for image forwards: "user" (World Name) or "character".
  const [senderMode, setSenderMode] = useState("user");
  // The character whose Chat/Text page this is — the origin of the contact graph
  // and the identity offered as "send as character". Falls back to the route.
  const [originChar, setOriginChar] = useState(originCharacter || null);

  useEffect(() => {
    if (!message) return;
    let cancelled = false;
    setIsLoadingRecipients(true);
    base44.auth.me().then(me => {
      if (!me?.email) return;
      // Resolve the chat page's character when it was not passed in as a prop:
      // an image sent by the USER carries no character_id, so the route is the
      // authoritative source for which character's page this is.
      const resolveOrigin = async () => {
        if (originCharacter?.id) return originCharacter;
        if (message.character_id) {
          const byMessage = await base44.entities.Character.get(message.character_id).catch(() => null);
          if (byMessage) return byMessage;
        }
        const routeId = window.location.pathname.match(/\/(?:chat|text)\/([^/?#]+)/)?.[1];
        if (!routeId) return null;
        return base44.entities.Character.get(routeId).catch(() => null);
      };

      return resolveOrigin().then(origin => {
        if (cancelled) return;
        if (origin) setOriginChar(origin);
        // Image forwards and narrative shares offer other accounts' characters,
        // through the same contact graph. A plain text forward stays own-only so
        // its existing delivery path is unchanged.
        const wantsCrossAccount = !!message.is_narrative || !!message.image_url;
        return resolveNarrativeShareRecipients({
          message,
          me,
          originCharacter: wantsCrossAccount ? origin : null,
        });
      }).then(({ own, crossAccount } = {}) => {
        if (cancelled || !own) return;
        setCharacters(own);
        setCrossAccountCharacters(crossAccount);
      }).catch(() => {});
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
    setError(null);
    let undelivered = 0;
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

      const isNarrativeShare = !!message.is_narrative;
      // A shared narrative lands on the receiving character's page for the SAME
      // channel it was shared from: Chat → Chat (direct), Text → Text (phone).
      const channel = isNarrativeShare && chatType === "phone" ? "phone" : "direct";

      const me = await base44.auth.me().catch(() => null);
      const allRecipients = [...characters, ...crossAccountCharacters];

      const isImageForward = !!message.image_url && !message.is_narrative;
      const sendAsCharacter = isImageForward && senderMode === "character" && !!originChar?.id;

      for (const charId of selectedIds) {
        const char = allRecipients.find(c => c.id === charId);
        if (!char) continue;

        const isCrossAccount = crossAccountCharacters.some(c => c.id === charId);

        // ── IMAGE FORWARD — delivered over World Phone as the chosen identity ──
        // Forward is only the action. The received message is a normal World Phone
        // image from the selected sender: no forwarded label, no forward wording.
        if (isImageForward) {
          if (sendAsCharacter) {
            if (charId === originChar.id) continue; // a character cannot message itself
            const res = await base44.functions.invoke("sendWorldPhoneMessage", {
              sender_character_id: originChar.id,
              recipient_identifier: charId,
              requested_message: "",
              image_url: message.image_url,
              image_description: resolvedImageDescription || "",
              image_analysis_status: resolvedImageDescription ? "complete" : "failed",
              message_type: "image",
              source: "image_forward",
              owner_email: me?.email || null,
            }).catch(err => ({ data: { success: false, error: err?.message } }));
            if (!res?.data?.success) {
              undelivered += 1;
              console.error(`[Forward] Character image send failed for ${char.name}:`, res?.data?.error);
            }
            continue;
          }

          if (isCrossAccount) {
            // User identity on another account's World Phone — delivered under the
            // user's World Name, never as the chat character.
            const res = await base44.functions.invoke("sendUserWorldPhoneMessage", {
              recipient_character_id: charId,
              content: "",
              image_url: message.image_url,
              image_description: resolvedImageDescription || undefined,
              message_type: "image",
              source: "image_forward_user",
              generate_reply: false,
            }).catch(err => ({ data: { success: false, error: err?.message } }));
            if (!res?.data?.success) {
              undelivered += 1;
              console.error(`[Forward] User image send failed for ${char.name}:`, res?.data?.error);
            }
            continue;
          }
        }

        // Cross-account narratives are delivered into the receiving character's
        // own thread on their own account, so they appear on their Chat/Text page.
        if (isNarrativeShare && isCrossAccount) {
          try {
            await base44.functions.invoke("shareNarrativeToCharacter", {
              source_message_id: message.id,
              recipient_character_id: charId,
              channel,
            });
          } catch (err) {
            undelivered += 1;
            console.error(`[Share] Cross-account delivery failed for ${char.name}:`, err?.message);
          }
          continue;
        }

        // CANONICAL RESOLVER: Use the single authoritative conversation-identity
        // resolver shared with Chat loading and Scene image delivery. This
        // guarantees the forwarded message is written to the same conversation
        // the Chat page will load — no inline duplicate filters, no divergence.
        const convoId = await resolveOrCreateConversation({
          characterId: charId,
          characterName: char.name,
          chatType: channel,
          ownerEmail: me?.email || null,
        });

        const isNarrative = isNarrativeShare;
        const senderLabel = message.character_name || "them";
        // An image forward arrives as a normal image message — the Forward action
        // is only how it was sent, never how it is presented.
        const fwdContent = isImageForward
          ? ""
          : isNarrative
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
          is_forwarded: isNarrative || isImageForward ? undefined : true,
          forwarded_from: isNarrative || isImageForward ? undefined : senderLabel,
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
      if (undelivered > 0) {
        setError(`Could not deliver to ${undelivered} character${undelivered > 1 ? "s" : ""} on another account.`);
        return;
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
        {char.avatar_url || char.image_avatar_url
          ? <img src={char.avatar_url || char.image_avatar_url} alt={char.name} className="w-full h-full object-cover" />
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

          {/* Sender identity — image forwards only */}
          {message.image_url && !message.is_narrative && (
            <div className="space-y-1.5">
              <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Send image as</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSenderMode("user")}
                  aria-pressed={senderMode === "user"}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-medium transition-colors ${
                    senderMode === "user"
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-secondary/50 border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  <UserIcon className="w-3.5 h-3.5" /> You
                </button>
                {originChar?.id && (
                  <button
                    onClick={() => setSenderMode("character")}
                    aria-pressed={senderMode === "character"}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-medium transition-colors truncate ${
                      senderMode === "character"
                        ? "bg-primary/10 border-primary/40 text-foreground"
                        : "bg-secondary/50 border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0 bg-primary/20 flex items-center justify-center">
                      {(originChar.avatar_url || originChar.image_avatar_url)
                        ? <img src={originChar.avatar_url || originChar.image_avatar_url} alt={originChar.name} className="w-full h-full object-cover" />
                        : <span className="text-[8px] font-bold text-primary">{originChar.name?.[0]}</span>
                      }
                    </span>
                    <span className="truncate">{originChar.name}</span>
                  </button>
                )}
              </div>
              <p className="px-1 text-[10px] text-muted-foreground">
                {senderMode === "character"
                  ? `Arrives in their World Phone as a normal image from ${originChar?.name}.`
                  : "Arrives in their World Phone as a normal image from your World Name."}
              </p>
            </div>
          )}

          {error && (
            <p className="px-1 text-xs text-destructive">{error}</p>
          )}

          <button
            onClick={handleForward}
            disabled={selectedIds.length === 0 || isSending || sent}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {sent ? (
              <><Check className="w-4 h-4" /> {message.is_narrative ? "Shared!" : "Forwarded!"}</>
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