import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Check, User } from "lucide-react";
import {
  buildRecipient,
  buildPurchasedPiece,
  buildPurchasedOutfit,
  buildUserPurchaseEntry,
  appendClosetEntry,
} from "@/lib/scenePurchaseCloset";

/**
 * ProductPurchaseModal — the Buy step of the existing Scenes product card.
 *
 * Unchanged responsibilities:
 * - the charge goes through executeSceneTransaction (the only transaction authority),
 * - the product card keeps its image, price, Buy and Pass.
 *
 * New responsibilities (connecting existing systems, not replacing them):
 * - the recipient is chosen explicitly; the closet that receives the purchase is the
 *   recipient's, never the payer's by default,
 * - the payer is chosen separately, so the account holder can buy for a character,
 * - on a successful charge the purchased entry is written straight into the recipient's
 *   existing Character Closet (Items for a piece, Outfits for a complete outfit) with the
 *   product image that was already shown, and only then are its details completed.
 */
export default function ProductPurchaseModal({
  isOpen,
  price,
  productId,
  preview_image_url,
  userBalance,
  userSettings,
  currentUser,
  traveledWithChars = [],
  onClose,
  onPurchased,
  item_label,
  item_category,
  action_id,
  purchase_source,
  location_name,
  item_kind,
  userPresent = true,
}) {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [recipientId, setRecipientId] = useState(null);
  const [payerChoice, setPayerChoice] = useState("user");

  const recipients = traveledWithChars || [];
  // One character present: that is the only possible owner. Never the user by default.
  const defaultRecipient = recipients.length === 1 ? recipients[0].id : null;
  const chosenRecipientId = recipientId ?? defaultRecipient;
  const chosenCharacter = recipients.find((c) => c.id === chosenRecipientId) || null;
  const isOutfit = item_kind === "outfit";
  const canAfford = typeof userBalance === "number" && userBalance >= price;
  const payerIsCharacter = payerChoice === "character" && !!chosenCharacter;
  const blocked = !chosenRecipientId || (payerChoice === "user" && !canAfford);

  const reset = () => {
    setError(null);
    setRecipientId(null);
    setPayerChoice("user");
  };

  const handleBuy = async () => {
    if (isProcessing || blocked) return;
    setIsProcessing(true);
    setError(null);
    try {
      // 1. Charge through the existing transaction authority. Payer decides the account.
      const result = await base44.functions.invoke("executeSceneTransaction", {
        action_class: "purchase",
        is_paid: true,
        cost: price,
        payer_type: payerIsCharacter ? "character" : "user",
        character_id: payerIsCharacter ? chosenCharacter.id : null,
        target_character_id: chosenCharacter?.id || null,
        action_id: action_id || `modal_purchase_${productId || Date.now()}`,
        purchase_source: purchase_source || "store",
        action_label: item_label || "Scene Purchase",
        location_name: location_name || null,
        item_label: item_label || null,
        item_category: item_category || null,
      });

      if (result?.data?.success !== true) {
        setError(result?.data?.error || "Transaction failed — insufficient funds or validation error.");
        return;
      }

      // 2. The purchase is paid: it now becomes an owned entry in the recipient's own
      //    closet, carrying the exact product image from the card. One entry, one charge.
      const recipient = buildRecipient({
        kind: chosenCharacter ? "character" : "user",
        character: chosenCharacter,
        settings: userSettings,
        displayName: currentUser?.full_name || "You",
      });
      const transactionId = result?.data?.transaction_id || null;
      const entry = chosenCharacter
        ? (isOutfit
          ? buildPurchasedOutfit({ label: item_label, imageUrl: preview_image_url, price, transactionId })
          : buildPurchasedPiece({ label: item_label, imageUrl: preview_image_url, price, transactionId }))
        : buildUserPurchaseEntry({ label: item_label, imageUrl: preview_image_url, price, transactionId });

      await appendClosetEntry({ recipient, entry });

      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      if (chosenCharacter) queryClient.invalidateQueries({ queryKey: ["character", chosenCharacter.id] });

      // 3. Hand the completed purchase to Scenes, which opens the closet entry interface
      //    for the recipient. Nothing here charges again.
      onPurchased?.({
        recipient,
        entry,
        kind: isOutfit ? "outfit" : "item",
        price,
        payerName: payerIsCharacter ? chosenCharacter.name : (currentUser?.full_name || "you"),
      });
      reset();
    } catch (err) {
      setError("Purchase failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    reset();
    onClose?.();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-card rounded-t-3xl border-t border-border p-4 space-y-4 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{isOutfit ? "Buy Outfit" : "Purchase Item"}</h3>
              <button onClick={handleClose} disabled={isProcessing} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Product preview — the same image shown on the product card */}
              <div className="flex items-center gap-3 bg-secondary/50 rounded-xl p-3">
                <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {preview_image_url
                    ? <img src={preview_image_url} alt="Item" className="w-full h-full object-cover rounded-lg" />
                    : <span className="text-3xl">🛍️</span>
                  }
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item_label || "Scene purchase"}</p>
                  <p className="text-2xl font-bold text-foreground">${price}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Goes to the {isOutfit ? "Outfits" : "Items"} section of the recipient's closet
                  </p>
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
              )}

              {/* Recipient — whose closet receives it */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Who is this for?</p>
                <div className="flex flex-wrap gap-2">
                  {recipients.map((char) => {
                    const active = chosenRecipientId === char.id;
                    return (
                      <button
                        key={char.id}
                        onClick={() => { setRecipientId(char.id); if (payerChoice === "character" && char.id !== chosenCharacter?.id) setPayerChoice("user"); }}
                        disabled={isProcessing}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-foreground hover:bg-secondary/70"}`}
                      >
                        <span className="w-5 h-5 rounded-full overflow-hidden bg-background flex items-center justify-center flex-shrink-0">
                          {char.avatar_url
                            ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                            : <span className="text-[9px] font-bold">{char.name?.[0]}</span>}
                        </span>
                        {char.name}
                        {active && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                  {/* Watching is not shopping: an observer is not physically here to receive. */}
                  {userPresent && (
                    <button
                      onClick={() => { setRecipientId("user"); setPayerChoice("user"); }}
                      disabled={isProcessing}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${chosenRecipientId === "user" ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-foreground hover:bg-secondary/70"}`}
                    >
                      <User className="w-3.5 h-3.5" /> You
                      {chosenRecipientId === "user" && <Check className="w-3 h-3" />}
                    </button>
                  )}
                </div>
                {!chosenRecipientId && (
                  <p className="text-[11px] text-amber-400">Choose who receives this — it is not assumed.</p>
                )}
              </div>

              {/* Payer — who is charged */}
              {chosenCharacter && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Who pays?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPayerChoice("user")}
                      disabled={isProcessing}
                      className={`flex-1 py-2 rounded-xl border text-xs font-medium transition-colors ${!payerIsCharacter ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-foreground"}`}
                    >
                      You {canAfford ? `($${price})` : "(insufficient funds)"}
                    </button>
                    <button
                      onClick={() => setPayerChoice("character")}
                      disabled={isProcessing}
                      className={`flex-1 py-2 rounded-xl border text-xs font-medium transition-colors ${payerIsCharacter ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-foreground"}`}
                    >
                      {chosenCharacter.name} pays
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handleBuy}
                disabled={blocked || isProcessing}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {chosenRecipientId
                  ? `Pay $${price}${payerIsCharacter ? ` · ${chosenCharacter.name} pays` : ""}`
                  : "Choose a recipient"}
              </button>

              <button
                onClick={handleClose}
                disabled={isProcessing}
                className="w-full py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}