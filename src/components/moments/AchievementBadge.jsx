import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TIER_STYLES } from "@/lib/achievements";
import { format } from "date-fns";
import AchievementDetailsPopup from "./AchievementDetailsPopup";

export default function AchievementBadge({ achievement, unlockedRecord, isNew = false }) {
  const [showPopup, setShowPopup] = useState(false);
  const tier = unlockedRecord?.tier || "bronze";
  const tierStyle = TIER_STYLES[tier];
  const isUnlocked = !!unlockedRecord;

  return (
    <>
    <motion.div
      initial={isNew ? { scale: 0.7, opacity: 0 } : false}
      animate={isNew ? { scale: 1, opacity: 1 } : false}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      onClick={() => setShowPopup(true)}
      className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all cursor-pointer hover:scale-[1.03] ${
        isUnlocked
          ? `bg-card border-border shadow-lg ${tierStyle.glow}`
          : "bg-card/30 border-border/30 opacity-40 grayscale"
      }`}
    >
      {/* Glow effect for unlocked */}
      {isUnlocked && (
        <div className={`absolute inset-0 rounded-2xl blur-xl opacity-20 ${
          tier === "neon" ? "bg-primary" :
          tier === "gold" ? "bg-yellow-400" :
          tier === "silver" ? "bg-slate-300" : "bg-amber-600"
        }`} />
      )}

      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <span className="text-2xl">{achievement.emoji}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isUnlocked ? tierStyle.badge : "text-muted-foreground"}`}>
          {isUnlocked ? tierStyle.label : "Locked"}
        </span>
        <span className="text-xs font-semibold text-foreground text-center leading-tight">{achievement.title}</span>
        <span className="text-[10px] text-muted-foreground text-center leading-tight">{achievement.description}</span>
        {isUnlocked && unlockedRecord?.unlocked_at && (
          <span className="text-[9px] text-muted-foreground/60 mt-0.5">
            {format(new Date(unlockedRecord.unlocked_at), "MMM d")}
          </span>
        )}
        {isUnlocked && unlockedRecord?.character_name && (
          <span className="text-[10px] text-primary/70 font-medium">
            with {unlockedRecord.character_name}
          </span>
        )}
      </div>
    </motion.div>
    <AnimatePresence>
      {showPopup && (
        <AchievementDetailsPopup
          achievement={achievement}
          unlockedRecord={unlockedRecord}
          onClose={() => setShowPopup(false)}
        />
      )}
    </AnimatePresence>
    </>
  );
}