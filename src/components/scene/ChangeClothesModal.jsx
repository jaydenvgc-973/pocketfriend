import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shirt, Check, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { applyUserManualCategoryOverride, getTodayUserOverrides } from "@/lib/activeOutfitResolver";

// Canonical approved categories — mirrors UserClosetPanel / outfitRotationEngine
const CATEGORY_META = {
  lounge: { label: "Lounge / Home", emoji: "🛋️" },
  sleepwear: { label: "Sleepwear", emoji: "😴" },
  bath: { label: "Bath / Robe", emoji: "🛁" },
  daily_casual: { label: "Daily Casual", emoji: "👕" },
  work: { label: "Work", emoji: "👔" },
  school: { label: "School", emoji: "🎒" },
  outdoor: { label: "Outdoor / Errands", emoji: "🌳" },
  nightlife: { label: "Nightlife / Party", emoji: "🌃" },
  formal: { label: "Formal", emoji: "🎩" },
  date_night: { label: "Date Night", emoji: "💘" },
  church: { label: "Church / Religious", emoji: "🛐" },
  special: { label: "Special / Statement", emoji: "✨" },
  gym: { label: "Gym / Workout", emoji: "🏋️" },
  swimwear: { label: "Swimwear", emoji: "🏊" },
};

/**
 * ChangeClothesModal
 *
 * Exposes the user's existing closet/outfit system directly from the Scene page so the
 * player can quickly change their current outfit without leaving the scene. Reuses
 * applyUserManualCategoryOverride (the same authority used by UserClosetPanel) — it does
 * NOT duplicate any clothing logic or introduce a separate outfit management system.
 */
export default function ChangeClothesModal({ isOpen, onClose, settings, onOutfitChanged }) {
  const [applyingId, setApplyingId] = useState(null);

  const closet = useMemo(
    () => (settings?.user_closet || []).filter((o) => o && o.outfit_id),
    [settings]
  );

  const todayOverrides = getTodayUserOverrides(settings);

  // Currently worn outfit = most recent today-override (rotation on) or first manual selection
  const activeOutfitId = useMemo(() => {
    const ids = Object.values(todayOverrides || {});
    return ids.length ? ids[ids.length - 1] : null;
  }, [todayOverrides]);

  const grouped = useMemo(() => {
    const map = {};
    closet.forEach((o) => {
      const cat = o.category || "daily_casual";
      if (!map[cat]) map[cat] = [];
      map[cat].push(o);
    });
    return map;
  }, [closet]);

  if (!isOpen || !settings) return null;

  const handleWear = async (outfit) => {
    setApplyingId(outfit.outfit_id);
    try {
      const patch = applyUserManualCategoryOverride(settings, outfit.category, outfit.outfit_id);
      if (settings.id) {
        await base44.entities.UserSettings.update(settings.id, patch);
      }
    } catch (e) {
      console.error("[ChangeClothes] failed to apply outfit:", e?.message || e);
    } finally {
      setApplyingId(null);
    }
    onOutfitChanged?.();
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-6 sm:pb-0"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="w-full max-w-md bg-card border border-border rounded-2xl overflow-hidden shadow-xl flex flex-col max-h-[80vh]"
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Shirt className="w-4 h-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">Change Clothes</h2>
              </div>
              <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="px-5 pb-2 text-xs text-muted-foreground flex-shrink-0">
              Pick an outfit to wear right now. Uses your existing closet — the same outfits you manage in your profile.
            </p>

            <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-4">
              {closet.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <Shirt className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No outfits in your closet yet.</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Add outfits from your Profile to change clothes here.</p>
                </div>
              ) : (
                Object.keys(grouped).map((cat) => {
                  const meta = CATEGORY_META[cat] || { label: cat, emoji: "👕" };
                  return (
                    <div key={cat}>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                        {meta.emoji} {meta.label}
                      </p>
                      <div className="space-y-1.5">
                        {grouped[cat].map((outfit) => {
                          const isActive = outfit.outfit_id === activeOutfitId;
                          return (
                            <button
                              key={outfit.outfit_id}
                              onClick={() => handleWear(outfit)}
                              disabled={!!applyingId}
                              className={`w-full flex items-center gap-2 text-left rounded-xl border p-2.5 transition-colors ${
                                isActive ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                              } ${applyingId ? "opacity-60" : ""}`}
                            >
                              <div className="w-10 h-10 rounded-lg bg-secondary border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                                {outfit.image_url ? (
                                  <img src={outfit.image_url} alt={outfit.label} className="w-full h-full object-cover" />
                                ) : (
                                  <Shirt className="w-4 h-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{outfit.label || "Outfit"}</p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {[outfit.top, outfit.bottom, outfit.shoes].filter(Boolean).join(" · ") || "—"}
                                </p>
                              </div>
                              {isActive ? (
                                <span className="text-[9px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
                                  <Check className="w-2.5 h-2.5" /> Wearing
                                </span>
                              ) : applyingId === outfit.outfit_id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0" />
                              ) : (
                                <span className="text-[10px] text-primary font-medium flex-shrink-0">Wear</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}