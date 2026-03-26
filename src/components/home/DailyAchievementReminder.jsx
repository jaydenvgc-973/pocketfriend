import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { CHALLENGES, WILDCARD_CHALLENGES } from "@/lib/challenges";

const TODAY_KEY = "daily_achievement_reminder_date";
const REMINDER_KEY = "daily_achievement_reminder_data";

function getRandomReminder() {
  // Pool: daily challenges + all achievements + wildcards
  const dailyChallenges = Object.values(CHALLENGES).filter(c => c.type === "daily");
  const achievements = Object.values(ACHIEVEMENTS);
  const wildcards = WILDCARD_CHALLENGES;

  const pool = [
    ...dailyChallenges.map(c => ({ emoji: c.emoji, title: c.title, action: c.description, type: "challenge" })),
    ...achievements.map(a => ({ emoji: a.emoji, title: a.title, action: a.description, type: "achievement" })),
    ...wildcards.map(w => ({ emoji: w.emoji, title: w.title, action: w.description, type: "wildcard" })),
  ];

  return pool[Math.floor(Math.random() * pool.length)];
}

export default function DailyAchievementReminder() {
  const [reminder, setReminder] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const today = new Date().toDateString();
    const lastShown = localStorage.getItem(TODAY_KEY);

    if (lastShown === today) return; // Already shown today

    const saved = localStorage.getItem(REMINDER_KEY);
    let todayReminder;

    if (saved) {
      try {
        todayReminder = JSON.parse(saved);
      } catch {
        todayReminder = getRandomReminder();
      }
    } else {
      todayReminder = getRandomReminder();
    }

    localStorage.setItem(TODAY_KEY, today);
    localStorage.setItem(REMINDER_KEY, JSON.stringify(todayReminder));

    setReminder(todayReminder);

    // Show after a short delay so the page loads first
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => setVisible(false);

  return (
    <AnimatePresence>
      {visible && reminder && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed bottom-20 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
        >
          <div className="pointer-events-auto w-full max-w-sm bg-card border border-primary/30 rounded-2xl shadow-xl shadow-primary/10 p-4 flex items-start gap-3">
            <div className="text-2xl mt-0.5 flex-shrink-0">{reminder.emoji}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Sparkles className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Today's Challenge</span>
              </div>
              <p className="text-sm font-semibold text-foreground leading-tight">{reminder.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{reminder.action}</p>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}