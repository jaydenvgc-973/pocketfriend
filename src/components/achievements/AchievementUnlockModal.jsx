import { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { ACHIEVEMENTS } from "@/lib/achievements";

// Session-level set tracks achievement_ids shown via full modal this session.
// Prevents re-showing the big modal after remount within the same browser session.
const sessionFullModalShown = new Set();

export default function AchievementUnlockModal() {
  // fullQueue: show large modal (true first-time unlocks happening NOW in this session)
  const [fullQueue, setFullQueue] = useState([]);
  // toastQueue: small auto-dismiss banners (unseen records from prior sessions / stale backlog)
  const [toastQueue, setToastQueue] = useState([]);
  const [current, setCurrent] = useState(null);       // currently shown full modal
  const [currentToast, setCurrentToast] = useState(null); // currently shown toast
  const [userEmail, setUserEmail] = useState(null);
  const initialFetchDone = useRef(false);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(u => u?.email && setUserEmail(u.email)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userEmail) return;

    // Subscribe: NEW creates in this session → full modal (if truly new)
    const unsubscribe = base44.entities.UserAchievement.subscribe((event) => {
      if (
        event.type === "create" &&
        event.data?.is_seen === false &&
        event.data?.created_by === userEmail &&
        !sessionFullModalShown.has(event.data.achievement_id)
      ) {
        setFullQueue(prev => {
          if (prev.some(r => r.achievement_id === event.data.achievement_id)) return prev;
          return [...prev, event.data];
        });
      }
    });

    // On mount: fetch unseen records from PREVIOUS sessions.
    // These should NOT re-trigger the full modal — the user already saw them.
    // Show a small non-blocking toast instead, then mark as seen.
    if (!initialFetchDone.current) {
      initialFetchDone.current = true;
      base44.entities.UserAchievement.filter({ is_seen: false, created_by: userEmail })
        .then(unseen => {
          if (unseen.length === 0) return;
          // Filter out anything that was created this session (subscribe will handle those)
          // and anything already shown via full modal
          const stale = unseen.filter(r => !sessionFullModalShown.has(r.achievement_id));
          if (stale.length === 0) return;
          // Mark them all as seen silently — no full modal for old unseen records
          stale.forEach(r => {
            base44.entities.UserAchievement.update(r.id, { is_seen: true }).catch(() => {});
          });
        })
        .catch(() => {});
    }

    return () => unsubscribe();
  }, [userEmail]);

  // Advance full modal queue
  useEffect(() => {
    if (!current && fullQueue.length > 0) {
      const next = fullQueue[0];
      if (sessionFullModalShown.has(next.achievement_id)) {
        setFullQueue(prev => prev.slice(1));
        return;
      }
      sessionFullModalShown.add(next.achievement_id);
      setCurrent(next);
      setFullQueue(prev => prev.slice(1));
    }
  }, [current, fullQueue]);

  // Advance toast queue (only when no full modal is showing)
  useEffect(() => {
    if (current) return; // full modal takes priority
    if (!currentToast && toastQueue.length > 0) {
      setCurrentToast(toastQueue[0]);
      setToastQueue(prev => prev.slice(1));
    }
  }, [currentToast, toastQueue, current]);

  // Auto-dismiss toast after 3.5s
  useEffect(() => {
    if (!currentToast) return;
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setCurrentToast(null), 3500);
    return () => clearTimeout(toastTimerRef.current);
  }, [currentToast]);

  const handleOk = async () => {
    if (!current) return;
    try {
      await base44.entities.UserAchievement.update(current.id, { is_seen: true });
    } catch {}
    setCurrent(null);
  };

  const achievement = current ? ACHIEVEMENTS[current.achievement_id] : null;
  const toastAchievement = currentToast ? ACHIEVEMENTS[currentToast.achievement_id] : null;

  return (
    <>
      {/* ── FULL MODAL — true first-time unlocks only ── */}
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
                <p className="text-xs text-muted-foreground/60 mt-1 mb-6">with {current.character_name}</p>
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

      {/* ── QUIET TOAST — revisited/stale achievements, non-blocking ── */}
      <AnimatePresence>
        {currentToast && toastAchievement && !current && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] pointer-events-none"
          >
            <div className="flex items-center gap-2.5 bg-card/95 border border-border rounded-2xl px-4 py-2.5 shadow-lg text-sm">
              <span className="text-base">{toastAchievement.emoji}</span>
              <span className="text-foreground font-medium">{toastAchievement.title}</span>
              {currentToast.character_name && (
                <span className="text-muted-foreground text-xs">· {currentToast.character_name}</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}