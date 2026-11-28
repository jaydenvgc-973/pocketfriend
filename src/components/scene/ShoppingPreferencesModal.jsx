import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Store } from "lucide-react";
import { shoppingSelectorsFor, venueTypeLabel } from "@/lib/shoppingPreferences";

/**
 * ShoppingPreferencesModal — "What are you looking for today?" for the store the scene is
 * actually inside.
 *
 * It states the purpose of the visit and nothing else: confirming it does not buy anything,
 * charge anyone, generate merchandise or assign it to a character. The existing shopping
 * activities then present merchandise that matches what was stated.
 *
 * The categories offered are the app's existing ones — the store's own assigned Venue Types
 * and the established outfit category list. Nothing is invented for a store.
 */
export default function ShoppingPreferencesModal({ open, destination, preferences, onConfirm, onClose }) {
  const { outfitCategories, families } = shoppingSelectorsFor(destination);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedFamilies, setSelectedFamilies] = useState([]);
  const [note, setNote] = useState("");

  // Reopening shows what was already confirmed for this destination.
  useEffect(() => {
    if (!open) return;
    setSelectedCategories(preferences?.categories || []);
    setSelectedFamilies(preferences?.families || []);
    setNote(preferences?.note || "");
  }, [open, destination?.key]);

  const toggle = (list, setList, value) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const confirm = () => {
    onConfirm?.({ categories: selectedCategories, families: selectedFamilies, note: note.trim() });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl border border-border p-4 space-y-3 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">What are you looking for today?</h3>
                <div className="flex items-center gap-1.5 mt-1">
                  <Store className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <p className="text-xs font-medium text-primary truncate">{destination?.storeName}</p>
                </div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* The store's own assigned venue types — never another business's. */}
            {destination?.venueTypes?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {destination.venueTypes.map((type) => (
                  <span key={type} className="text-[10px] px-1.5 py-0.5 rounded-md bg-secondary border border-border text-muted-foreground">
                    {venueTypeLabel(type)}
                  </span>
                ))}
              </div>
            )}

            {/* What the store sells, from its own venue types. */}
            {families.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Shopping for</p>
                <div className="flex flex-wrap gap-1.5">
                  {families.map((family) => {
                    const active = selectedFamilies.includes(family.key);
                    return (
                      <button
                        key={family.key}
                        type="button"
                        onClick={() => toggle(selectedFamilies, setSelectedFamilies, family.key)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${active ? "bg-primary/10 border-primary/50 text-primary" : "bg-secondary border-border text-foreground hover:border-primary/30"}`}
                      >
                        {family.label}
                        {active && <Check className="w-3 h-3 inline ml-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* The existing outfit categories — offered by the stores that sell anything worn. */}
            {outfitCategories.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Style / category</p>
                <div className="flex flex-wrap gap-1.5">
                  {outfitCategories.map((category) => {
                    const active = selectedCategories.includes(category.value);
                    return (
                      <button
                        key={category.value}
                        type="button"
                        onClick={() => toggle(selectedCategories, setSelectedCategories, category.value)}
                        className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${active ? "bg-primary/10 border-primary/50 text-primary" : "bg-secondary border-border text-foreground hover:border-primary/30"}`}
                      >
                        <span className="mr-1">{category.emoji}</span>
                        {category.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/70">Pick as many as you like — or none to just browse.</p>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wider block">Additional information (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Describe what you're looking for today..."
                className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 resize-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={confirm}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Confirm
              </button>
              <button
                onClick={() => { setSelectedCategories([]); setSelectedFamilies([]); setNote(""); }}
                className="px-3 py-2 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
              >
                Clear
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}