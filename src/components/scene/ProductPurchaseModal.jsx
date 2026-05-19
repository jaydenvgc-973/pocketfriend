import React from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export default function ProductPurchaseModal({
  isOpen,
  price,
  productId,
  preview_image_url,
  userBalance,
  userSettings,
  currentUser,
  traveledWithChars,
  onClose,
  onPurchased,
}) {
  const queryClient = useQueryClient();

  // Build a closet piece record. Uses the generated scene image as image_url.
  // Saved to Pieces (not Outfits) — accessories and single items go here.
  const buildPieceRecord = (label = "Purchased Item") => ({
    outfit_id: `piece_${productId || Date.now()}`,
    label,
    category: "daily_casual",
    image_url: preview_image_url || null,        // preserve generated image
    full_description: label,
    created_at: new Date().toISOString(),
    is_favorite: false,
    source: "scene_purchase",
    purchase_price: price,
  });

  const handleAddToUserCloset = async () => {
    const newBalance = Math.max(0, (userBalance ?? 6000) - price);
    if (userSettings?.id) {
      await base44.entities.UserSettings.update(userSettings.id, {
        user_balance: newBalance,
        user_closet: [
          ...(userSettings.user_closet || []),
          buildPieceRecord("Scene Purchase"),
        ]
      });
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
    }
    onPurchased(`Added to your closet`);
  };

  const handleGiftToCharacter = async (char) => {
    const newBalance = Math.max(0, (userBalance ?? 6000) - price);
    if (userSettings?.id) {
      await base44.entities.UserSettings.update(userSettings.id, { user_balance: newBalance });
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
    }
    await base44.entities.Character.update(char.id, {
      character_closet: [
        ...(char.character_closet || []),
        buildPieceRecord(`Gift for ${char.name}`),
      ]
    });
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    onPurchased(`Added to ${char.name}'s closet`);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end"
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="w-full bg-card rounded-t-3xl border-t border-border p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Purchase Item</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Product preview — show generated image if available */}
              <div className="flex items-center gap-3 bg-secondary/50 rounded-xl p-3">
                <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {preview_image_url
                    ? <img src={preview_image_url} alt="Item" className="w-full h-full object-cover rounded-lg" />
                    : <span className="text-3xl">🛍️</span>
                  }
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">${price}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Scene purchase</p>
                </div>
              </div>

              {/* Add to user closet */}
              <button
                onClick={handleAddToUserCloset}
                disabled={userBalance < price}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Add to My Closet {userBalance < price ? "(Insufficient funds)" : `($${price})`}
              </button>

              {/* Gift to character */}
              {traveledWithChars.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Give to character:</p>
                  {traveledWithChars.map(char => (
                    <button
                      key={char.id}
                      onClick={() => handleGiftToCharacter(char)}
                      disabled={userBalance < price}
                      className="w-full py-2 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Give to {char.name}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={onClose}
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