import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shirt, Package, Loader2 } from "lucide-react";
import { AddPieceForm, AddOutfitForm } from "@/components/character/CharacterClosetPanel";
import { updateClosetEntry } from "@/lib/scenePurchaseCloset";
import {
  analyzeClosetImage,
  nextOutfitRotationNumber,
  loadFreshCloset,
  mergePrefill,
} from "@/lib/closetImageAutofill";

/**
 * PurchaseClosetEntryModal
 *
 * The Scenes purchase is already paid for and already owned by the time this opens: the
 * closet entry exists in the recipient's real Character Closet, with the product image
 * that was shown on the product card. This modal only completes that entry's details,
 * using the Character Closet's own Items and Outfits forms — never a lookalike form,
 * never a second entry, never another charge.
 *
 * The entry's own image is read as it opens: what the photo actually shows fills the
 * top, bottom, shoes, outerwear, accessories and hair fields, and the rotation number
 * is placed after however many outfits the owner already has. Nothing already written
 * on the entry is replaced.
 *
 * Closing it loses nothing: the entry stays in the closet, and the closet's own
 * "Finish details" / Edit affordances complete it later.
 */
export default function PurchaseClosetEntryModal({ purchase, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [prefill, setPrefill] = useState({});

  const entryId = purchase?.entry?.piece_id || purchase?.entry?.outfit_id || null;
  const isOutfits = purchase
    ? purchase.kind === "outfit" || purchase.recipient.kind === "user"
    : false;
  const imageUrl = purchase?.entry?.image_url || "";

  // Read the entry's own image and the owner's current closet once, as the modal opens.
  useEffect(() => {
    if (!purchase) return;
    let cancelled = false;
    setReading(true);
    setPrefill({});
    (async () => {
      const [closet, analysis] = await Promise.all([
        loadFreshCloset(purchase.recipient).catch(() => purchase.recipient.closet || []),
        analyzeClosetImage({ imageUrl, isOutfit: isOutfits }).catch(() => ({})),
      ]);
      if (cancelled) return;
      const values = { ...analysis };
      if (isOutfits) {
        values.rotation_number = nextOutfitRotationNumber(closet, entryId);
      }
      setPrefill(values);
      setReading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [purchase, entryId, isOutfits, imageUrl]);

  if (!purchase) return null;

  const { recipient, entry, kind, price, payerName } = purchase;
  const ownerLabel = recipient.kind === "character" ? recipient.name : "your closet";
  const initialValues = mergePrefill(entry, prefill);

  const handleSave = async (saved) => {
    if (saving) return;
    setSaving(true);
    try {
      await updateClosetEntry({ recipient, entryId, updates: saved });
      if (recipient.kind === "character") {
        queryClient.invalidateQueries({ queryKey: ["character", recipient.id] });
        queryClient.invalidateQueries({ queryKey: ["characters"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      }
      onSaved?.(saved);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-background border-t border-border rounded-t-3xl max-h-[90vh] overflow-y-auto"
        >
          <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              {isOutfits ? <Shirt className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" /> : <Package className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {isOutfits ? "Outfits" : "Items"} — {ownerLabel}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {price != null ? `Paid $${price}` : "Purchased"}{payerName ? ` by ${payerName}` : ""} · saved to {recipient.kind === "character" ? `${recipient.name}'s closet` : "your closet"}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4">
            <p className="text-[11px] text-muted-foreground mb-3">
              This is already yours — the purchase is paid and in the closet. Add the details now, or close and finish them later from the closet.
            </p>
            {reading ? (
              <div className="flex items-center gap-3 border border-border rounded-xl bg-secondary/20 p-4">
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt="Purchased item"
                    className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                  />
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Reading the photo to fill in the details…
                </div>
              </div>
            ) : isOutfits ? (
              <AddOutfitForm
                character={recipient.kind === "character" ? { name: recipient.name } : { name: "you" }}
                initialValues={initialValues}
                initialImageUrl={entry?.image_url || ""}
                heading="Purchased Outfit"
                submitLabel="Save Outfit"
                onSave={handleSave}
                onCancel={onClose}
              />
            ) : (
              <AddPieceForm
                character={{ name: recipient.name }}
                initialValues={initialValues}
                initialImageUrl={entry?.image_url || ""}
                heading="Purchased Item"
                submitLabel="Save Item"
                onSave={handleSave}
                onCancel={onClose}
              />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}