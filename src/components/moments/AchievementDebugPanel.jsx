import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function AchievementDebugPanel({ userEmail }) {
  const [expanded, setExpanded] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["achievementEvents", userEmail],
    queryFn: () => userEmail
      ? base44.entities.UserAchievementEvent.filter({ user_email: userEmail }, "-timestamp", 20)
      : [],
    enabled: !!userEmail && expanded,
    staleTime: 10000
  });

  const { data: progress = [] } = useQuery({
    queryKey: ["achievementProgress", userEmail],
    queryFn: () => userEmail
      ? base44.entities.UserAchievementProgress.filter({ user_email: userEmail })
      : [],
    enabled: !!userEmail && expanded,
    staleTime: 10000
  });

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const result = await base44.functions.invoke('rebuildUserAchievements', {});
      console.log('[AchievementDebug] Rebuild result:', result.data);
      alert(`Rebuilt achievements. Awarded: ${result.data.achievements_awarded.join(', ') || 'none new'}`);
    } catch (err) {
      console.error('[AchievementDebug] Rebuild failed:', err);
      alert('Rebuild failed: ' + err.message);
    } finally {
      setRebuilding(false);
    }
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-24 right-4 px-3 py-1.5 rounded-full bg-secondary text-xs text-muted-foreground hover:text-foreground transition-colors z-40"
      >
        🔧 Debug
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="fixed bottom-24 right-4 w-80 max-h-96 overflow-y-auto bg-card border border-border rounded-2xl p-4 z-50 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-foreground">Achievement Debug</h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Rebuild button */}
      <button
        onClick={handleRebuild}
        disabled={rebuilding}
        className="w-full px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
      >
        {rebuilding ? 'Rebuilding...' : 'Rebuild from History'}
      </button>

      {/* Progress summary */}
      <div className="bg-secondary rounded-lg p-2 space-y-1">
        <p className="text-xs text-muted-foreground font-medium">Progress Records</p>
        <p className="text-xs text-foreground">{progress.length} achievements tracked</p>
        <p className="text-xs text-foreground">{progress.filter(p => p.unlocked).length} unlocked</p>
      </div>

      {/* Recent events */}
      <div className="bg-secondary rounded-lg p-2 space-y-1">
        <p className="text-xs text-muted-foreground font-medium">Recent Events ({events.length})</p>
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {events.slice(0, 5).map((e, i) => (
            <div key={i} className="text-[10px] text-muted-foreground">
              {e.event_type}
            </div>
          ))}
        </div>
      </div>

      {/* Unlocked achievements */}
      <div className="bg-secondary rounded-lg p-2 space-y-1">
        <p className="text-xs text-muted-foreground font-medium">Unlocked</p>
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {progress.filter(p => p.unlocked).map(p => (
            <div key={p.id} className="text-[10px] text-foreground">
              ✓ {p.achievement_id}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}