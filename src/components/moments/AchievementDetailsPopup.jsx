import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { TIER_STYLES } from "@/lib/achievements";

const HOW_TO_OBTAIN = {
  first_impression: "Send your first message to a character.",
  consistent: "Keep chatting across multiple days without long gaps.",
  they_opened_up: "Build enough trust that a character shares something personal with you.",
  inner_circle: "Reach a deep trust level with any character.",
  ride_along: "Stay engaged through a character's full life arc event.",
  the_push: "Encourage a character to take action on something important.",
  voice_of_reason: "Talk a character out of making a bad decision.",
  bad_influence: "Encourage a character toward chaos and have them follow through.",
  clutch_timing: "Show up at exactly the right moment in a character's life.",
  missed_moment: "Leave a character's message unanswered for too long.",
  that_meant_something: "Say or do something that triggers a strong positive emotional reaction.",
  hit_deep: "Reach a character's deep emotional triggers through meaningful conversation.",
  tension: "Cause a conflict or argument with a character.",
  shifted_perspective: "Change how a character thinks about something through your words.",
  seen_it_all: "Receive your first photo from a character.",
  progress_witness: "Witness a character go through a visible before/after change.",
  big_moment: "Be present when a character shares a major life milestone.",
  you_were_there: "Be active during something important in a character's life.",
  messy: "Get involved in drama between characters.",
  he_said_she_said: "Have information spread between characters.",
  in_the_middle: "Find yourself caught between two characters.",
  stirred_the_pot: "Escalate a tense situation rather than defuse it.",
  still_here: "Use the app consistently over multiple days.",
  they_came_back: "Reconnect with a character after a long period of silence.",
  left_on_read: "Ignore a character's message for too long.",
};

export default function AchievementDetailsPopup({ achievement, unlockedRecord, onClose }) {
  const isUnlocked = !!unlockedRecord;
  const tier = unlockedRecord?.tier || "bronze";
  const tierStyle = TIER_STYLES[tier];
  const howTo = HOW_TO_OBTAIN[achievement.id] || "Keep interacting and exploring to unlock this achievement.";

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