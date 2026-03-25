import { motion } from "framer-motion";
import { format } from "date-fns";

export default function ChallengeBadge({ challenge, userChallenge, playstyleType }) {
  const isCompleted = userChallenge?.completed;
  const progress = userChallenge?.progress || 0;
  const target = challenge.target || 1;
  const progressPercent = Math.min(100, (progress / target) * 100);

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
        isCompleted
          ? "bg-primary/15 border-primary/40 shadow-lg"
          : "bg-card border-border hover:border-primary/30"
      }`}
    >
      {/* Completion indicator */}
      {isCompleted && (
        <div className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
          <span className="text-[10px] font-bold text-primary-foreground">✓</span>
        </div>
      )}

      {/* Emoji */}
      <span className="text-2xl">{challenge.emoji}</span>

      {/* Playstyle badge if applicable */}
      {playstyleType && (
        <span className={`text-[9px] font-bold uppercase tracking-wider ${playstyleType.color}`}>
          {playstyleType.emoji} {playstyleType.label}
        </span>
      )}

      {/* Title */}
      <span className="text-xs font-semibold text-foreground text-center leading-tight">
        {challenge.title}
      </span>

      {/* Description */}
      <span className="text-[10px] text-muted-foreground text-center leading-tight">
        {challenge.description}
      </span>

      {/* Progress bar */}
      <div className="w-full mt-1">
        <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={`h-full rounded-full ${isCompleted ? "bg-primary" : "bg-primary/60"}`}
          />
        </div>
        <div className="text-[9px] text-muted-foreground mt-1 text-center">
          {progress}/{target}
        </div>
      </div>

      {/* Completion date */}
      {isCompleted && userChallenge?.completed_at && (
        <span className="text-[9px] text-primary/70 mt-0.5">
          {format(new Date(userChallenge.completed_at), "MMM d")}
        </span>
      )}
    </motion.div>
  );
}