import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Check, User, Search, PawPrint, Car } from "lucide-react";
import { Input } from "@/components/ui/input";
import CarBelongingsEditor from "@/components/property/CarBelongingsEditor";
import { loadBelongings, saveBelongings } from "@/lib/ownerBelongings";
import {
  buildRecipient,
  buildPurchasedPiece,
  buildPurchasedOutfit,
  buildUserPurchaseEntry,
  appendClosetEntry,
} from "@/lib/scenePurchaseCloset";
import { generateWornPreview } from "@/lib/scenePurchasePreview";

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
  // The individual who chose to perform the shopping activity. They are the payer offered
  // first; the selection stays editable and the recipient is a separate choice.
  defaultPayerId = null,
  // A pet or a vehicle carries its own established details from the product card.
  item_details = null,
}) {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [recipientId, setRecipientId] = useState(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  // The payer starts as the User when they are here shopping. When the user is only
  // viewing, the User is not at the store: the character present is the one buying, so
  // their own funds are offered first and the absent User is never charged by default.
  const [payerId, setPayerId] = useState(() => {
    if (defaultPayerId) return defaultPayerId;
    if (userPresent) return "user";
    const candidate = (traveledWithChars || []).find((c) => c?.id && !onShiftEmployeeIds.includes(c.id));
    return candidate?.id || "user";
  });
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

  // A preselected shopper who cannot pay here (on shift, or no longer present) falls back to
  // the established default instead of charging someone who is not shopping.
  useEffect(() => {
    if (!payerId || payerId === "user") return;
    if (payerCandidates.some((c) => c.id === payerId)) return;
    setPayerId(userPresent ? "user" : (payerCandidates[0]?.id || "user"));
  }, [payerId, payerCandidates.map((c) => c.id).join(","), userPresent]);

  const isOutfit = item_kind === "outfit";
  // A pet and a vehicle are bought through this same modal, but they are never worn: they
  // are registered under the recipient's existing Property / Belongings.
  const isPet = item_category === "pet";
  const isVehicle = item_category === "vehicle";
  const isProperty = isPet || isVehicle;
  // Non-wearable merchandise (home goods, records, books…) is bought, never closeted.
  const producesClosetEntry = !isProperty && (isOutfit || item_wearable !== false);
  const canAfford = typeof userBalance === "number" && userBalance >= price;
  const blocked = !chosenRecipientId || (!paidPurchase && !payerIsCharacter && !canAfford);

  const filteredRecipients = recipientQuery.trim()
    ? recipientOptions.filter((c) => c.name?.toLowerCase().includes(recipientQuery.trim().toLowerCase()))
    : recipientOptions;

  // A pet is named by whoever receives it; a vehicle's four references are prepared here,
  // through the same editor Property / Belongings already uses. Nothing is generated or
  // charged until the user presses it.
  const [petName, setPetName] = useState("");
  const [carDraft, setCarDraft] = useState(null);
  useEffect(() => {
    if (!isOpen || !isVehicle) { setCarDraft(null); return; }
    const d = item_details || {};
    setCarDraft({
      label: [d.manufacturer || d.make, d.model].filter(Boolean).join(" ") || item_label || "",
      color: d.exterior_color || "",
      description: [d.year, String(d.vehicle_type || "").replace(/_/g, " "), d.interior_color].filter(Boolean).join(", "),
      views: {
        // The showroom photograph IS this vehicle's exterior, and a test drive's own picture
        // is the starting point for the driver's seat view. Neither is drawn again here.
        exterior: preview_image_url || "",
        ...(d.test_image_url ? { driver_seat: d.test_image_url } : {}),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isVehicle, preview_image_url, item_details?.test_image_url]);

  // The preview shows the recipient wearing what is being bought — not a flat product
  // shot. Regenerated whenever the recipient changes, before anything is charged.
  const [wornImageUrl, setWornImageUrl] = useState(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  useEffect(() => {
    if (!chosenRecipientId || paidPurchase || !producesClosetEntry) return;
    let cancelled = false;
    setWornImageUrl(null);
    setPreviewError(null);
    setIsGeneratingPreview(true);
    generateWornPreview({
      itemLabel: item_label || "the item",
      itemKind: item_kind || "item",
      wearerKind: recipientIsUser || !chosenCharacter ? "user" : "character",
      characterId: chosenCharacter?.id || null,
      wearerName: recipientIsUser || !chosenCharacter ? (currentUser?.full_name || "the account holder") : chosenCharacter?.name,
      userEmail: currentUser?.email,
      // The card's own image is the exact merchandise. It is the authority for the clothing
      // on every recipient, so changing who receives it never changes what is being bought.
      merchandiseImageUrl: preview_image_url,
    })
      .then((url) => { if (!cancelled) setWornImageUrl(url); })
      .catch(() => { if (!cancelled) setPreviewError("The preview of the item being worn could not be generated — the product image is shown instead."); })
      .finally(() => { if (!cancelled) setIsGeneratingPreview(false); });
    return () => { cancelled = true; };
  }, [chosenRecipientId, item_label, item_kind, paidPurchase, preview_image_url]);

  // The image saved to the closet is the one showing the recipient wearing it.
  const entryImageUrl = wornImageUrl || preview_image_url;

  const reset = () => {
    setError(null);
    setRecipientId(null);
    setRecipientQuery("");
    setPayerId(defaultPayerId || "user");
    setPetName("");
    rememberPaidPurchase(null);
  };

  /** Save the paid purchase into the recipient's existing closet — never charges. */
  const savePaidPurchase = async (purchase) => {
    // A bought pet or vehicle is registered in the recipient's Property / Belongings, in the
    // same record that section already owns. Updating that record can never duplicate it.
    if (purchase.patch) {
      const ownerType = purchase.recipient.kind === "character" ? "character" : "user";
      const existing = await loadBelongings(currentUser?.email, ownerType, purchase.recipient.id);
      await saveBelongings({
        existing,
        ownerType,
        ownerId: purchase.recipient.id,
        ownerEmail: currentUser?.email,
        ownerName: purchase.recipient.name,
        patch: purchase.patch,
      });
      queryClient.invalidateQueries({ queryKey: ["ownerBelongings"] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    }
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
      const details = item_details || {};
      // The exact animal or vehicle that was shown is the one registered: the card's own
      // photograph becomes the pet's image and the vehicle's exterior reference, and a test
      // drive's picture becomes the driver's seat reference.
      const patch = isPet
        ? {
            pet: {
              pet_type: details.pet_type || "other",
              pet_type_custom: details.pet_type_custom || "",
              name: petName.trim(),
              image_url: preview_image_url || "",
              notes: details.description || "",
            },
          }
        : isVehicle
          ? {
              car: {
                label: carDraft?.label || item_label || "",
                color: carDraft?.color || details.exterior_color || "",
                description: carDraft?.description || "",
                views: carDraft?.views || { exterior: preview_image_url || "" },
              },
            }
          : null;
      const entry = !producesClosetEntry
        ? null
        : recipient.kind === "character"
          ? (isOutfit
            ? buildPurchasedOutfit({ label: item_label, imageUrl: entryImageUrl, price, transactionId })
            : buildPurchasedPiece({ label: item_label, imageUrl: entryImageUrl, price, transactionId }))
          : buildUserPurchaseEntry({ label: item_label, imageUrl: entryImageUrl, price, transactionId });

      const paid = {
        recipient,
        entry,
        patch,
        kind: isPet ? "pet" : isVehicle ? "vehicle" : isOutfit ? "outfit" : "item",
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
              <h3 className="text-sm font-semibold text-foreground">{isPet ? "Buy This Pet" : isVehicle ? "Buy This Vehicle" : isOutfit ? "Buy Outfit" : "Purchase Item"}</h3>
              <button onClick={handleClose} disabled={isProcessing} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Preview — the recipient wearing what is being bought */}
              <div className="bg-secondary/50 rounded-xl p-3 space-y-2">
                <div className="w-full h-56 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden relative">
                  {entryImageUrl
                    ? <img src={entryImageUrl} alt={item_label || "Purchase"} className="w-full h-full object-cover" />
                    : <span className="text-4xl">{isPet ? "🐾" : isVehicle ? "🚗" : "🛍️"}</span>
                  }
                  {isGeneratingPreview && (
                    <div className="absolute inset-0 bg-background/75 flex flex-col items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <span className="text-[10px] text-muted-foreground">
                        Showing {recipientIsUser || !chosenCharacter ? "you" : chosenCharacter.name} wearing this…
                      </span>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{item_label || "Scene purchase"}</p>
                    <p className="text-xl font-bold text-foreground">${price}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {isPet
                      ? `Registered as ${recipientIsUser || !chosenCharacter ? "your" : `${chosenCharacter.name}'s`} pet in Property & Belongings`
                      : isVehicle
                        ? `Registered as ${recipientIsUser || !chosenCharacter ? "your" : `${chosenCharacter.name}'s`} vehicle in Property & Belongings`
                        : producesClosetEntry
                          ? `Worn by ${recipientIsUser || !chosenCharacter ? "you" : chosenCharacter.name} — goes to the ${isOutfit ? "Outfits" : "Items"} section of their closet`
                          : "Kept as a purchase — not added to a closet"}
                  </p>
                  {previewError && <p className="text-[10px] text-amber-400 mt-1">{previewError}</p>}
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
              )}

              {/* The animal is named by whoever receives them — optional, as in Property / Belongings. */}
              {isPet && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><PawPrint className="w-3.5 h-3.5" /> Name (optional)</p>
                  <Input
                    value={petName}
                    onChange={(e) => setPetName(e.target.value)}
                    placeholder={item_details?.breed || "What will they be called?"}
                    className="h-8 text-xs rounded-xl"
                    disabled={isProcessing || !!paidPurchase}
                  />
                </div>
              )}

              {/* The vehicle's four references, prepared with the same editor Property / Belongings
                  uses. Generating one never buys anything and never charges the price. */}
              {isVehicle && carDraft && (
                <div className="rounded-xl border border-border bg-secondary/30 p-2 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> Vehicle references</p>
                  <CarBelongingsEditor car={carDraft} onChange={setCarDraft} />
                  <p className="text-[10px] text-muted-foreground">All four views must show this same vehicle. The showroom photo is its exterior.</p>
                </div>
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
                disabled={blocked || isProcessing || isGeneratingPreview}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {chosenRecipientId
                  ? (paidPurchase
                    ? "Finish saving — no charge"
                    : isGeneratingPreview
                      ? "Preparing preview…"
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