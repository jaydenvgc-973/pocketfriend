import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";

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
  // Additional context passed from SceneProductCard / pendingPurchase state
  item_label,
  item_category,
  action_id,
  purchase_source,
  location_name,
}) {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  // Build a closet piece record for saving after transaction succeeds.
  // Never deducts balance — transaction authority handles that.
  const buildPieceRecord = (label = "Purchased Item") => ({
    outfit_id: `piece_${productId || Date.now()}`,
    label,
    category: "daily_casual",
    image_url: preview_image_url || null,
    full_description: label,
    created_at: new Date().toISOString(),
    is_favorite: false,
    source: "scene_purchase",
    purchase_price: price,
  });

  // Route the balance deduction through the authoritative transaction function.
  // Returns true on success, false on failure.
  const executeTransaction = async (targetCharacterId = null) => {
    const result = await base44.functions.invoke('executeSceneTransaction', {
      action_class: 'purchase',
      is_paid: true,
      cost: price,
      payer_type: 'user',
      action_id: action_id || `modal_purchase_${productId || Date.now()}`,
      purchase_source: purchase_source || 'store',
      action_label: item_label || 'Scene Purchase',
      location_name: location_name || null,
      item_label: item_label || null,
      item_category: item_category || null,
      target_character_id: targetCharacterId || null,
    });
    return result?.data?.success === true;
  };

  const handleAddToUserCloset = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      const success = await executeTransaction(null);
      if (!success) {
        setError("Transaction failed — insufficient funds or validation error.");
        return;
      }
      // Transaction succeeded — now save the closet item (no balance write here)
      if (userSettings?.id) {
        await base44.entities.UserSettings.update(userSettings.id, {
          user_closet: [
            ...(userSettings.user_closet || []),
            buildPieceRecord("Scene Purchase"),
          ]
        });
        queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      }
      onPurchased(`Added to your closet`);
    } catch (err) {
      setError("Purchase failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGiftToCharacter = async (char) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      const success = await executeTransaction(char.id);
      if (!success) {
        setError("Transaction failed — insufficient funds or validation error.");
        return;
      }
      // Transaction succeeded — now save the closet item to the character (no balance write here)
      await base44.entities.Character.update(char.id, {
        character_closet: [
          ...(char.character_closet || []),
          buildPieceRecord(`Gift for ${char.name}`),
        ]
      });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      onPurchased(`Added to ${char.name}'s closet`);
    } catch (err) {
      setError("Purchase failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const canAfford = typeof userBalance === 'number' && userBalance >= price;

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
              <button onClick={onClose} disabled={isProcessing} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Product preview */}
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

              {/* Error state */}
              {error && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
              )}

              {/* Add to user closet */}
              <button
                onClick={handleAddToUserCloset}
                disabled={!canAfford || isProcessing}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Add to My Closet {!canAfford ? "(Insufficient funds)" : `($${price})`}
              </button>

              {/* Gift to character */}
              {traveledWithChars.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Give to character:</p>
                  {traveledWithChars.map(char => (
                    <button
                      key={char.id}
                      onClick={() => handleGiftToCharacter(char)}
                      disabled={!canAfford || isProcessing}
                      className="w-full py-2 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                      {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Give to {char.name}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={onClose}
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