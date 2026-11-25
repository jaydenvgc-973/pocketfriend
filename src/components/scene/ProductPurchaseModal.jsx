import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Check, User, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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
 * Roles are separate choices:
 * - payer     — the User or a character actually here shopping (a cashier on shift is
 *               working, not shopping, so they are never offered),
 * - recipient — any character on the account, present or elsewhere. A gift never requires
 *               the recipient to be at the store, and never moves them.
 *
 * On a successful charge the purchased entry is written into the recipient's existing
 * Character Closet (Items for a piece, Outfits for a complete outfit) with the product
 * image that was already shown. Merchandise that is not wearable is purchased and
 * confirmed, but never forced into a closet.
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
  accountCharacters = [],
  onShiftEmployeeIds = [],
  onClose,
  onPurchased,
  item_label,
  item_category,
  item_wearable = true,
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
  const [recipientQuery, setRecipientQuery] = useState("");
  const [payerId, setPayerId] = useState("user");
  // A purchase whose payment already succeeded but whose closet handoff did not.
  // While this is set, Buy finishes that step only — it never charges again.
  // The ref is the synchronous authority (the catch below must know, in the same tick,
  // that money was already taken); the state only drives the UI.
  const paidRef = useRef(null);
  const [paidPurchase, setPaidPurchase] = useState(null);
  const rememberPaidPurchase = (purchase) => {
    paidRef.current = purchase;
    setPaidPurchase(purchase);
  };

  const presentPeople = traveledWithChars || [];
  // Recipients: the account's own character records, present or not. The people in this
  // scene are always included even if the wider list has not loaded.
  const recipientOptions = (accountCharacters.length > 0 ? accountCharacters : presentPeople)
    .filter((c, i, arr) => c?.id && arr.findIndex((x) => x.id === c.id) === i);
  // One character present: that is the only possible owner. Never the user by default.
  const defaultRecipient = presentPeople.length === 1 ? presentPeople[0].id : null;
  const chosenRecipientId = recipientId ?? defaultRecipient;
  const recipientIsUser = chosenRecipientId === "user";
  const chosenCharacter = recipientOptions.find((c) => c.id === chosenRecipientId)
    || presentPeople.find((c) => c.id === chosenRecipientId)
    || null;

  // Payers: only people actually here shopping. Someone on shift at this business is
  // working — an off-shift employee here as a customer is still eligible.
  const payerCandidates = presentPeople.filter((c) => !onShiftEmployeeIds.includes(c.id));
  const payerCharacter = payerCandidates.find((c) => c.id === payerId) || null;
  const payerIsCharacter = !!payerCharacter;

  const isOutfit = item_kind === "outfit";
  // Non-wearable merchandise (home goods, records, books…) is bought, never closeted.
  const producesClosetEntry = isOutfit || item_wearable !== false;
  const canAfford = typeof userBalance === "number" && userBalance >= price;
  const blocked = !chosenRecipientId || (!paidPurchase && !payerIsCharacter && !canAfford);

  const filteredRecipients = recipientQuery.trim()
    ? recipientOptions.filter((c) => c.name?.toLowerCase().includes(recipientQuery.trim().toLowerCase()))
    : recipientOptions;

  const reset = () => {
    setError(null);
    setRecipientId(null);
    setRecipientQuery("");
    setPayerId("user");
    rememberPaidPurchase(null);
  };

  /** Save the paid purchase into the recipient's existing closet — never charges. */
  const savePaidPurchase = async (purchase) => {
    if (purchase.entry) {
      await appendClosetEntry({ recipient: purchase.recipient, entry: purchase.entry });
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      if (purchase.recipient.kind === "character") {
        queryClient.invalidateQueries({ queryKey: ["character", purchase.recipient.id] });
      }
    }
    onPurchased?.(purchase);
  };

  const handleBuy = async () => {
    if (isProcessing || blocked) return;
    setIsProcessing(true);
    setError(null);
    try {
      // A payment that already succeeded is never charged a second time: Buy finishes
      // only the closet handoff that failed after the money was taken.
      if (paidRef.current) {
        await savePaidPurchase(paidRef.current);
        reset();
        return;
      }

      // 1. Charge through the existing transaction authority. Payer decides the account.
      const result = await base44.functions.invoke("executeSceneTransaction", {
        action_class: "purchase",
        is_paid: true,
        cost: price,
        payer_type: payerIsCharacter ? "character" : "user",
        character_id: payerIsCharacter ? payerCharacter.id : null,
        target_character_id: chosenCharacter?.id || null,
        target_character_name: chosenCharacter?.name || null,
        action_id: action_id || `modal_purchase_${productId || Date.now()}`,
        purchase_source: purchase_source || "store",
        action_label: item_label || "Scene Purchase",
        location_name: location_name || null,
        item_label: item_label || null,
        item_category: item_category || null,
      });

      if (result?.data?.success !== true) {
        setError(result?.data?.error || "The payment was declined — insufficient funds or a validation error.");
        return;
      }

      // 2. The purchase is paid: it now becomes an owned entry in the recipient's own
      //    closet, carrying the exact product image from the card. One entry, one charge.
      //    Merchandise that is not wearable is confirmed without a closet entry.
      const recipient = buildRecipient({
        kind: recipientIsUser || !chosenCharacter ? "user" : "character",
        character: chosenCharacter,
        settings: userSettings,
        displayName: currentUser?.full_name || "You",
      });
      const transactionId = result?.data?.transaction_id || null;
      const entry = !producesClosetEntry
        ? null
        : recipient.kind === "character"
          ? (isOutfit
            ? buildPurchasedOutfit({ label: item_label, imageUrl: preview_image_url, price, transactionId })
            : buildPurchasedPiece({ label: item_label, imageUrl: preview_image_url, price, transactionId }))
          : buildUserPurchaseEntry({ label: item_label, imageUrl: preview_image_url, price, transactionId });

      const paid = {
        recipient,
        entry,
        kind: isOutfit ? "outfit" : "item",
        price,
        itemLabel: item_label || null,
        transactionId,
        payerName: payerIsCharacter ? payerCharacter.name : (currentUser?.full_name || "you"),
      };

      // The charge is recorded before the closet write, so a failed save can never
      // cause a second charge and is never mistaken for a failed payment.
      rememberPaidPurchase(paid);
      await savePaidPurchase(paid);

      // 3. Hand the completed purchase to Scenes, which opens the closet entry interface
      //    for the recipient. Nothing here charges again.
      reset();
    } catch (err) {
      const reason = err?.response?.data?.error || err?.data?.error || err?.message;
      if (paidRef.current) {
        setError(`Payment succeeded — $${price} was charged once. Saving it to the closet failed${reason ? ` (${reason})` : ""}. Press Buy again to finish saving — you will not be charged again.`);
      } else {
        setError(reason || "The purchase could not be completed. Nothing was charged.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = async () => {
    if (isProcessing) return;
    // Closing must not throw away a purchase that was already paid for: finish its
    // closet save once more (the entry is idempotent, so this can never duplicate it).
    if (paidRef.current) {
      try { await savePaidPurchase(paidRef.current); } catch { /* user has been told */ }
    }
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
                    {producesClosetEntry
                      ? `Goes to the ${isOutfit ? "Outfits" : "Items"} section of the recipient's closet`
                      : "Kept as a purchase — not added to a closet"}
                  </p>
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
              )}

              {/* Recipient — whose it becomes, present or not */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Who is this for?</p>
                {recipientOptions.length > 6 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <Input
                      value={recipientQuery}
                      onChange={(e) => setRecipientQuery(e.target.value)}
                      placeholder="Search anyone on your account…"
                      className="h-8 pl-8 rounded-xl text-xs"
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  {filteredRecipients.map((char) => {
                    const active = chosenRecipientId === char.id;
                    return (
                      <button
                        key={char.id}
                        onClick={() => setRecipientId(char.id)}
                        disabled={isProcessing || !!paidPurchase}
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
                      onClick={() => setRecipientId("user")}
                      disabled={isProcessing || !!paidPurchase}
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

              {/* Payer — who is charged. Independent of the recipient. */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Who pays?</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setPayerId("user")}
                    disabled={isProcessing || !!paidPurchase}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium transition-colors ${!payerIsCharacter ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-foreground"}`}
                  >
                    You {canAfford ? `($${price})` : "(insufficient funds)"}
                  </button>
                  {payerCandidates.map((char) => {
                    const active = payerId === char.id;
                    return (
                      <button
                        key={char.id}
                        onClick={() => setPayerId(char.id)}
                        disabled={isProcessing || !!paidPurchase}
                        className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-foreground"}`}
                      >
                        {char.name} pays
                      </button>
                    );
                  })}
                </div>
                {presentPeople.length > payerCandidates.length && (
                  <p className="text-[10px] text-muted-foreground">
                    Staff on shift here are working, not shopping — they aren't offered as payers.
                  </p>
                )}
              </div>

              <button
                onClick={handleBuy}
                disabled={blocked || isProcessing}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {chosenRecipientId
                  ? (paidPurchase
                    ? "Finish saving — no charge"
                    : `Pay $${price}${payerIsCharacter ? ` · ${payerCharacter.name} pays` : ""}`)
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