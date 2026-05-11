import { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { ACHIEVEMENTS } from "@/lib/achievements";

// Session-level set: tracks achievement IDs shown this session.
// Prevents re-showing achievements that were already shown after a component remount.
const sessionShownIds = new Set();

export default function AchievementUnlockModal() {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  // Whether we have done the initial unseen fetch — only do it once per mount.
  const initialFetchDone = useRef(false);

  useEffect(() => {
    base44.auth.me().then(u => u?.email && setUserEmail(u.email)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userEmail) return;

    // Subscribe to new UserAchievement records in real-time
    // Only show if: newly created, not yet seen, belongs to this user, not already shown this session
    const unsubscribe = base44.entities.UserAchievement.subscribe((event) => {
      if (
        event.type === "create" &&
        event.data?.is_seen === false &&
        event.data?.created_by === userEmail &&
        !sessionShownIds.has(event.data.achievement_id) // dedupe by achievement_id, not record id
      ) {
        setQueue(prev => {
          if (prev.some(r => r.achievement_id === event.data.achievement_id)) return prev;
          return [...prev, event.data];
        });
      }
    });

    // Fetch unseen achievements ONCE on mount (in case app was closed when earned).
    // Cap at achievements created in the last 24 hours to avoid showing stale backlog.
    // This only runs once per userEmail mount — not on every re-render.
    if (!initialFetchDone.current) {
      initialFetchDone.current = true;
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      base44.entities.UserAchievement.filter({ is_seen: false, created_by: userEmail })
        .then(unseen => {
          if (unseen.length === 0) return;
          // Only show recent ones (last 24h) and ones not already queued/shown this session
          const fresh = unseen.filter(r =>
            !sessionShownIds.has(r.achievement_id) &&
            r.unlocked_at && r.unlocked_at > cutoff
          );
          if (fresh.length === 0) return;
          setQueue(prev => {
            const existingAchIds = new Set(prev.map(r => r.achievement_id));
            return [...prev, ...fresh.filter(r => !existingAchIds.has(r.achievement_id))];
          });
        })
        .catch(() => {});
    }

    return () => unsubscribe();
  }, [userEmail]);

  // Show next in queue when current is cleared
  useEffect(() => {
    if (!current && queue.length > 0) {
      const next = queue[0];
      // Final session guard: don't show if already shown this session
      if (sessionShownIds.has(next.achievement_id)) {
        setQueue(prev => prev.slice(1));
        return;
      }
      sessionShownIds.add(next.achievement_id);
      setCurrent(next);
      setQueue(prev => prev.slice(1));
    }
  }, [current, queue]);

  const handleOk = async () => {
    if (!current) return;
    try {
      await base44.entities.UserAchievement.update(current.id, { is_seen: true });
    } catch {}
    setCurrent(null);
  };

  const achievement = current ? ACHIEVEMENTS[current.achievement_id] : null;

  return (
    <AnimatePresence>
      {current && achievement && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="w-full max-w-sm bg-card border border-border rounded-3xl p-8 flex flex-col items-center text-center shadow-2xl"
          >
            {/* Glow ring */}
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl scale-150" />
              <div className="relative w-24 h-24 rounded-full bg-primary/10 border-2 border-primary/40 flex items-center justify-center text-5xl">
                {achievement.emoji}
              </div>
            </div>

            <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-2">
              Achievement Unlocked
            </p>

            <h2 className="text-xl font-bold text-foreground mb-2">{achievement.title}</h2>
            <p className="text-sm text-muted-foreground mb-1">{achievement.description}</p>

            {current.character_name && (
              <p className="text-xs text-muted-foreground/60 mt-1 mb-6">
                with {current.character_name}
              </p>
            )}
            {!current.character_name && <div className="mb-6" />}

            <button
              onClick={handleOk}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors active:scale-95"
            >
              OK
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}