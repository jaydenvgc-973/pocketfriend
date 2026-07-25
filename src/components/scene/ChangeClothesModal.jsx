import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shirt, Check, Loader2, User as UserIcon, AlertCircle } from "lucide-react";
import { createPortal } from "react-dom";
import {
  resolveClothingOwner,
  verifySelectedOutfitActive,
} from "@/lib/clothingOwnerAdapter";

// Canonical approved categories — mirrors UserClosetPanel / CharacterClosetPanel
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

// Operation stages — shown sequentially so the user sees what is happening.
const STAGE = {
  idle: "idle",
  applying: "applying",       // writing the override
  verifying: "verifying",     // reading back via the canonical resolver
  regenerating: "regenerating", // scene image refresh (parent-handled)
  failed: "failed",
};

/**
 * ChangeClothesModal
 *
 * A single scene-level clothing action with EXPLICIT ownership targeting and
 * verification through the established outfit authorities.
 *
 * Flow:
 *   1. Pick a person — "Me" or an eligible persistent character present in the scene.
 *   2. That person's AUTHORITATIVE closet loads through the owner adapter (no field
 *      names leak into the modal; no closet mixing between targets).
 *   3. Pick an outfit → write the override through the owner's own authority
 *      (applyUserManualCategoryOverride / applyManualCategoryOverride).
 *   4. Read the owner back through the canonical backend resolver
 *      (resolveUserOutfitContext / resolveCharacterOutfitContext) and verify the
 *      selected outfit actually won (no uniform / special-occasion / chain-priority
 *      override replaced it).
 *   5. On verified success → notify parent to refresh + regenerate. On mismatch →
 *      keep the modal open, retain the selection, show an actionable error, do NOT
 *      regenerate with fallback clothing.
 *
 * Changing clothes never alters occupancy, conversation targets, location, travel,
 * sleep, relationships, schedules, or character type.
 */
export default function ChangeClothesModal({
  isOpen,
  onClose,
  settings,
  isUserSettingsLoading,
  presentCharacters,
  location,
  currentUser,
  onOutfitChanged,
  userAvatar,
  userName,
}) {
  const [selectedTarget, setSelectedTarget] = useState(TARGET_USER);
  const [stage, setStage] = useState(STAGE.idle);
  const [error, setError] = useState(null);
  // Locally track the outfit we just applied so the "Wearing" highlight updates
  // immediately, before the parent's refetch lands.
  const [appliedOutfitId, setAppliedOutfitId] = useState(null);

  // ── SELECTED PERSON: authoritative closet via the owner adapter ──────────────
  const owner = useMemo(
    () => resolveClothingOwner(selectedTarget, { settings, presentCharacters, locationId: location?.id }),
    [selectedTarget, settings, presentCharacters, location?.id]
  );

  // Loading: user target uses the real query loading flag (not !settings.id).
  // Characters are already loaded by the parent (presentCharacters), so a character
  // target is never in a "loading" state — an empty closet is a genuine empty state.
  const isLoading = selectedTarget.type === "user" ? !!isUserSettingsLoading : false;

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
    setError(null);
    setAppliedOutfitId(null);
  };

  const handleWear = async (outfit) => {
    if (stage === STAGE.applying || stage === STAGE.verifying) return;
    setError(null);
    setAppliedOutfitId(null);

    // ── 1. VALIDATE: the outfit belongs to this owner's closet ─────────────────
    const belongs = owner.closet.some((o) => o.outfit_id === outfit.outfit_id);
    if (!belongs) {
      setError("That outfit does not belong to " + owner.label + ".");
      setStage(STAGE.failed);
      return;
    }

    // ── 2. APPLY: write the EXPLICIT scene outfit for this owner ──────────────
    // This writes scene_explicit_outfit (location-scoped) — it does NOT touch
    // category overrides, manual selections, current_outfit, or the closet.
    setStage(STAGE.applying);
    try {
      await owner.applyOverride(outfit, { locationId: location?.id });
    } catch (e) {
      setError(e?.message || "Could not apply that outfit. Please try again.");
      setStage(STAGE.failed);
      return;
    }

    // ── 3. VERIFY: read back through the canonical backend resolver ───────────
    // The resolver now honors scene_explicit_outfit ABOVE all automatic logic.
    // We verify by EXACT outfit_id match — category/text/source are not proof.
    setStage(STAGE.verifying);
    let resolved = null;
    try {
      resolved = await owner.resolveActiveOutfit({
        locationCategory: location?.category || null,
        locationId: location?.id || null,
        ownerEmail: currentUser?.email || null,
      });
    } catch (e) {
      // The write succeeded but the read-back failed. Preserve the outfit change
      // (it is persisted) — report the verification failure without reverting.
      setError("Outfit saved, but the confirmation check failed: " + (e?.message || "unknown error") + ". Your selection is saved — try refreshing the scene.");
      setStage(STAGE.failed);
      return;
    }

    const { verified, mismatchReason } = verifySelectedOutfitActive(resolved, outfit);
    if (!verified) {
      // Real failure only (outfit deleted, record not found). This never blocks
      // on category appropriateness — the explicit scene outfit overrides category.
      setError(mismatchReason || "The selected outfit could not be confirmed as active.");
      setStage(STAGE.failed);
      return;
    }

    // ── 4. SUCCESS: parent refreshes + regenerates (sequenced, no race) ────────
    setAppliedOutfitId(outfit.outfit_id);
    setStage(STAGE.regenerating);
    try {
      onOutfitChanged?.(owner.kind, owner.ownerId);
    } catch (e) {
      // non-blocking — the outfit change is already persisted and verified
    }
    // Close after a beat so the "regenerating" state is visible.
    setTimeout(() => {
      setStage(STAGE.idle);
      onClose();
    }, 400);
  };

  const eligible = presentCharacters || [];
  const busy = stage === STAGE.applying || stage === STAGE.verifying || stage === STAGE.regenerating;

  const stageLabel = (() => {
    switch (stage) {
      case STAGE.applying: return "Applying outfit…";
      case STAGE.verifying: return "Verifying active outfit…";
      case STAGE.regenerating: return "Updating scene…";
      default: return null;
    }
  })();

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-6 sm:pb-0"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
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
              <button onClick={onClose} disabled={busy} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors disabled:opacity-40">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Person selector — explicit target, independent of conversation target */}
            <div className="px-4 pb-3 flex-shrink-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Who is changing?</p>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                <button
                  onClick={() => selectTarget(TARGET_USER)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border flex-shrink-0 transition-colors ${
                    selectedTarget.type === "user" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                  } ${busy ? "opacity-60" : ""}`}
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
                {eligible.map((c) => {
                  const isSel = selectedTarget.type === "character" && selectedTarget.id === c.id;
                  const avatar = c.avatar_url || c.image_avatar_url;
                  return (
                    <button
                      key={c.id}
                      onClick={() => selectTarget({ type: "character", id: c.id })}
                      disabled={busy}
                      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border flex-shrink-0 transition-colors ${
                        isSel ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                      } ${busy ? "opacity-60" : ""}`}
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

            {/* Stage indicator */}
            {stageLabel && (
              <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2 flex-shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                <span className="text-xs text-primary font-medium">{stageLabel}</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-2 flex-shrink-0">
                <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-destructive">{error}</p>
                  {stage === STAGE.failed && (
                    <button
                      onClick={() => { setError(null); setStage(STAGE.idle); }}
                      className="text-[10px] text-destructive/80 hover:text-destructive underline mt-1"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Closet body */}
            <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-4">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Loading {owner.label}'s closet…</p>
                </div>
              ) : owner.closet.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <Shirt className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No outfits in {owner.label}'s closet yet.</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {owner.kind === "user"
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
                          const isActive = outfit.outfit_id === (appliedOutfitId || owner.activeOutfitId);
                          return (
                            <button
                              key={outfit.outfit_id}
                              onClick={() => handleWear(outfit)}
                              disabled={busy}
                              className={`w-full flex items-center gap-2 text-left rounded-xl border p-2.5 transition-colors ${
                                isActive ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                              } ${busy ? "opacity-60" : ""}`}
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
                              ) : busy && stage === STAGE.applying ? null : (
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