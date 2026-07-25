import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shirt, Check, Loader2, User as UserIcon, AlertCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import {
  applyUserManualCategoryOverride,
  applyManualCategoryOverride,
  getTodayUserOverrides,
  getTodayCharacterOverrides,
} from "@/lib/activeOutfitResolver";

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

const TARGET_USER = { type: "user", id: "me" };

/**
 * ChangeClothesModal
 *
 * A single scene-level clothing action with EXPLICIT ownership targeting.
 *
 * Flow:
 *   1. Pick a person — "Me" (authenticated user) or an eligible real character
 *      currently present in the scene.
 *   2. That person's AUTHORITATIVE closet loads (user_closet for Me, character_closet
 *      for a character). Closets never mix — switching target discards the previous
 *      target's data and loads the new target's closet.
 *   3. Pick an outfit — applies the established manual/category override to that
 *      specific owner through that owner's own outfit-authority pathway
 *      (applyUserManualCategoryOverride for Me, applyManualCategoryOverride for a
 *      character). Never infers the target from position, name, or avatar order.
 *   4. On success → notify parent to refresh + regenerate. On failure → show an
 *      actionable error, keep the modal open, do NOT regenerate.
 *
 * Clothing changes do NOT alter occupancy, conversation eligibility, location, or
 * sleep state — the override write only touches outfit selection fields.
 */
export default function ChangeClothesModal({
  isOpen,
  onClose,
  settings,
  presentCharacters,
  onOutfitChanged,
  userAvatar,
  userName,
}) {
  const [selectedTarget, setSelectedTarget] = useState(TARGET_USER);
  const [applyingOutfitId, setApplyingOutfitId] = useState(null);
  const [error, setError] = useState(null);

  // ── SELECTED PERSON: authoritative closet + active outfit (per-target, no mixing) ──
  const owner = useMemo(() => {
    if (selectedTarget.type === "user") {
      const userCloset = (settings?.user_closet || []).filter((o) => o && o.outfit_id);
      const overrides = getTodayUserOverrides(settings);
      const ids = Object.values(overrides || {});
      return {
        type: "user",
        closet: userCloset,
        activeOutfitId: ids.length ? ids[ids.length - 1] : null,
        recordId: settings?.id || null,
        label: userName || settings?.fictional_world_name || "Me",
        avatar: userAvatar || null,
        loading: !settings?.id, // settings query not yet returned
      };
    }
    const char = (presentCharacters || []).find((c) => c.id === selectedTarget.id);
    const charCloset = (char?.character_closet || []).filter((o) => o && o.outfit_id);
    const overrides = getTodayCharacterOverrides(char);
    const ids = Object.values(overrides || {});
    return {
      type: "character",
      closet: charCloset,
      activeOutfitId: ids.length ? ids[ids.length - 1] : null,
      recordId: char?.id || null,
      label: char?.display_name || char?.name || "Character",
      avatar: char?.avatar_url || char?.image_avatar_url || null,
      loading: false, // present characters are already loaded by the parent
    };
  }, [selectedTarget, settings, presentCharacters, userAvatar, userName]);

  const grouped = useMemo(() => {
    const map = {};
    owner.closet.forEach((o) => {
      const cat = o.category || "daily_casual";
      if (!map[cat]) map[cat] = [];
      map[cat].push(o);
    });
    return map;
  }, [owner.closet]);

  if (!isOpen) return null;

  const selectTarget = (target) => {
    setSelectedTarget(target);
    setError(null); // discard previous target's error — do not mix
  };

  const handleWear = async (outfit) => {
    setError(null);
    setApplyingOutfitId(outfit.outfit_id);
    try {
      if (owner.type === "user") {
        if (!owner.recordId) throw new Error("Your settings are still loading — try again in a moment.");
        const patch = applyUserManualCategoryOverride(settings, outfit.category, outfit.outfit_id);
        await base44.entities.UserSettings.update(owner.recordId, patch);
      } else {
        const char = (presentCharacters || []).find((c) => c.id === selectedTarget.id);
        if (!char) throw new Error("That character is no longer in the scene.");
        const patch = applyManualCategoryOverride(char, outfit.category, outfit.outfit_id);
        await base44.entities.Character.update(char.id, patch);
      }
      // Success — parent refreshes the owner's outfit state and regenerates the scene.
      onOutfitChanged?.(owner.type, owner.recordId);
      onClose();
    } catch (e) {
      // Failure: keep the modal open, retain selection, do NOT regenerate.
      setError(e?.message || "Couldn't apply that outfit. Please try again.");
    } finally {
      setApplyingOutfitId(null);
    }
  };

  const eligible = presentCharacters || [];

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
            className="w-full max-w-md bg-card border border-border rounded-2xl overflow-hidden shadow-xl flex flex-col max-h-[85vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Shirt className="w-4 h-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">Change Clothes</h2>
              </div>
              <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Person selector — explicit target. Independent of conversation target. */}
            <div className="px-4 pb-3 flex-shrink-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Who is changing?</p>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {/* Me */}
                <button
                  onClick={() => selectTarget(TARGET_USER)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border flex-shrink-0 transition-colors ${
                    selectedTarget.type === "user" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-secondary border border-border flex items-center justify-center overflow-hidden">
                    {userAvatar ? (
                      <img src={userAvatar} alt="Me" className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-foreground whitespace-nowrap">{userName || "Me"}</span>
                </button>
                {/* Eligible present characters */}
                {eligible.map((c) => {
                  const isSel = selectedTarget.type === "character" && selectedTarget.id === c.id;
                  const avatar = c.avatar_url || c.image_avatar_url;
                  return (
                    <button
                      key={c.id}
                      onClick={() => selectTarget({ type: "character", id: c.id })}
                      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border flex-shrink-0 transition-colors ${
                        isSel ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full bg-secondary border border-border flex items-center justify-center overflow-hidden">
                        {avatar ? (
                          <img src={avatar} alt={c.name} className="w-full h-full object-cover" />
                        ) : (
                          <UserIcon className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <span className="text-[10px] font-medium text-foreground whitespace-nowrap max-w-[64px] truncate">
                        {c.display_name || c.name}
                      </span>
                    </button>
                  );
                })}
                {eligible.length === 0 && (
                  <p className="text-[10px] text-muted-foreground italic px-2 py-2">No other characters present right now.</p>
                )}
              </div>
            </div>

            <div className="px-5 pb-1 text-xs text-muted-foreground flex-shrink-0">
              {owner.label}'s closet — uses the same outfits as the Profile closet.
            </div>

            {/* Error */}
            {error && (
              <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-2 flex-shrink-0">
                <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* Closet body */}
            <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-4">
              {owner.loading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Loading {owner.label}'s closet…</p>
                </div>
              ) : owner.closet.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <Shirt className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No outfits in {owner.label}'s closet yet.</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {owner.type === "user"
                      ? "Add outfits from your Profile to change clothes here."
                      : "Add outfits for this character from their profile to change clothes here."}
                  </p>
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
                          const isActive = outfit.outfit_id === owner.activeOutfitId;
                          return (
                            <button
                              key={outfit.outfit_id}
                              onClick={() => handleWear(outfit)}
                              disabled={!!applyingOutfitId}
                              className={`w-full flex items-center gap-2 text-left rounded-xl border p-2.5 transition-colors ${
                                isActive ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                              } ${applyingOutfitId ? "opacity-60" : ""}`}
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
                              ) : applyingOutfitId === outfit.outfit_id ? (
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