import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import BottomNav from "@/components/BottomNav";
import ActiveArcCard from "@/components/moments/ActiveArcCard";
import AchievementBadge from "@/components/moments/AchievementBadge";
import LockedAchievements from "@/components/moments/LockedAchievements";
import GoalsSection from "@/components/moments/GoalsSection";
import ChallengesSection from "@/components/moments/ChallengesSection";
import { ACHIEVEMENTS, CATEGORY_LABELS } from "@/lib/achievements";

const CATEGORIES = Object.keys(CATEGORY_LABELS);

export default function Moments() {
  const [activeCategory, setActiveCategory] = useState("all");

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ status: "active", created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  const { data: unlocked = [] } = useQuery({
    queryKey: ["userAchievements", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserAchievement.filter({ created_by: currentUser.email }, "-unlocked_at")
      : [],
    enabled: !!currentUser?.email,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["recentMessages", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Message.filter({ created_by: currentUser.email }, "-created_date", 200)
      : [],
    enabled: !!currentUser?.email,
  });

  const { data: userChallenges = [] } = useQuery({
    queryKey: ["userChallenges", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserChallenge.filter({ created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  // Map achievement_id -> unlocked record (most recent)
  const unlockedMap = unlocked.reduce((acc, r) => {
    if (!acc[r.achievement_id]) acc[r.achievement_id] = r;
    return acc;
  }, {});

  const allAchievements = Object.values(ACHIEVEMENTS);
  const filtered = activeCategory === "all"
    ? allAchievements
    : allAchievements.filter(a => a.category === activeCategory);

  const unlockedCount = allAchievements.filter(a => unlockedMap[a.id]).length;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-xl border-b border-border px-4 pt-6 pb-4">
        <h1 className="text-xl font-bold text-foreground">Moments & Impact</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {unlockedCount} / {allAchievements.length} achievements unlocked
        </p>
        {/* Progress bar */}
        <div className="mt-3 h-1 w-full rounded-full bg-secondary overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(unlockedCount / allAchievements.length) * 100}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full rounded-full bg-primary"
          />
        </div>
      </div>

      <div className="px-4 py-5 space-y-8">

        {/* Active Arcs */}
        {characters.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">🔥 Active Arcs</h2>
            <div className="space-y-2">
              {characters.map(c => (
                <ActiveArcCard key={c.id} character={c} />
              ))}
            </div>
          </section>
        )}

        {/* Goals */}
        <GoalsSection characters={characters} messages={messages} />

        {/* Challenges */}
        <ChallengesSection userChallenges={userChallenges} messages={messages} />

        {/* Achievements */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">🏆 Achievements</h2>

          {/* Category filter tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setActiveCategory("all")}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                activeCategory === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {CATEGORY_LABELS[cat].emoji} {CATEGORY_LABELS[cat].label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-2 sm:grid-cols-3 gap-3"
            >
              {filtered.map(achievement => (
                <AchievementBadge
                  key={achievement.id}
                  achievement={achievement}
                  unlockedRecord={unlockedMap[achievement.id]}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        </section>

        {/* Locked / Hidden */}
        <LockedAchievements />

      </div>

      <BottomNav />
    </div>
  );
}