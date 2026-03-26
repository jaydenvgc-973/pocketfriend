import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { TIER_STYLES } from "@/lib/achievements";

export default function AchievementDetailsPopup({ achievement, unlockedRecord, onClose }) {
  const isUnlocked = !!unlockedRecord;
  const tier = unlockedRecord?.tier || "bronze";
  const tierStyle = TIER_STYLES[tier];
  const howTo = achievement.howToUnlock || "Keep interacting and exploring to unlock this achievement.";

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.88, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.88, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl"
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center space-y-3">
          <span className="text-5xl">{achievement.emoji}</span>

          <div className="space-y-1">
            <p className="text-lg font-bold text-foreground">{achievement.title}</p>
            <p className={`text-xs font-semibold uppercase tracking-wider ${isUnlocked ? tierStyle.badge : "text-muted-foreground"}`}>
              {isUnlocked ? `${tierStyle.label} · Unlocked` : "Locked"}
            </p>
          </div>

          <div className="w-full h-px bg-border" />

          <div className="space-y-2 w-full text-left">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">How to unlock</p>
            <p className="text-sm text-foreground leading-relaxed">{howTo}</p>
          </div>

          {isUnlocked && (
            <div className="w-full text-left space-y-0.5 pt-1">
              {unlockedRecord?.unlocked_at && (
                <p className="text-xs text-muted-foreground">
                  Unlocked {new Date(unlockedRecord.unlocked_at).toLocaleDateString()}
                </p>
              )}
              {unlockedRecord?.character_name && (
                <p className="text-xs text-primary/80">with {unlockedRecord.character_name}</p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}