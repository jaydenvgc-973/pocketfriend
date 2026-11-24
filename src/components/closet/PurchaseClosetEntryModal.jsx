import { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shirt, Package } from "lucide-react";
import { AddPieceForm, AddOutfitForm } from "@/components/character/CharacterClosetPanel";
import { updateClosetEntry } from "@/lib/scenePurchaseCloset";

/**
 * PurchaseClosetEntryModal
 *
 * The Scenes purchase is already paid for and already owned by the time this opens: the
 * closet entry exists in the recipient's real Character Closet, with the product image
 * that was shown on the product card. This modal only completes that entry's details,
 * using the Character Closet's own Items and Outfits forms — never a lookalike form,
 * never a second entry, never another charge.
 *
 * Closing it loses nothing: the entry stays in the closet, and the closet's own
 * "Finish details" / Edit affordances complete it later.
 */
export default function PurchaseClosetEntryModal({ purchase, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  if (!purchase) return null;

  const { recipient, entry, kind, price, payerName } = purchase;
  const entryId = entry?.piece_id || entry?.outfit_id;
  const isOutfits = kind === "outfit" || recipient.kind === "user";
  const ownerLabel = recipient.kind === "character" ? recipient.name : "your closet";

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
            {isOutfits ? (
              <AddOutfitForm
                character={recipient.kind === "character" ? { name: recipient.name } : { name: "you" }}
                initialValues={entry}
                initialImageUrl={entry?.image_url || ""}
                heading="Purchased Outfit"
                submitLabel="Save Outfit"
                onSave={handleSave}
                onCancel={onClose}
              />
            ) : (
              <AddPieceForm
                character={{ name: recipient.name }}
                initialValues={entry}
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