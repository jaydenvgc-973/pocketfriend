import { LOCKED_ACHIEVEMENTS } from "@/lib/achievements";

export default function LockedAchievements() {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">🔒 Hidden Achievements</h2>
      <div className="grid grid-cols-3 gap-3">
        {LOCKED_ACHIEVEMENTS.map((a, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-dashed border-border/40 bg-card/20 opacity-60"
          >
            <span className="text-2xl">{a.emoji}</span>
            <span className="text-xs font-semibold text-muted-foreground text-center">{a.title}</span>
            <span className="text-[10px] text-muted-foreground/60 text-center italic">{a.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}