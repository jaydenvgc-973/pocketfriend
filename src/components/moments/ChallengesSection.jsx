import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CHALLENGES, WILDCARD_CHALLENGES, CHALLENGE_CATEGORIES, PLAYSTYLE_TYPES } from "@/lib/challenges";
import ChallengeBadge from "./ChallengeBadge";

export default function ChallengesSection({ userChallenges = [], messages = [] }) {
  const [expandedCategory, setExpandedCategory] = useState("daily");

  // Map challenge_id to user progress
  const challengeMap = useMemo(() => {
    return userChallenges.reduce((acc, uc) => {
      acc[uc.challenge_id] = uc;
      return acc;
    }, {});
  }, [userChallenges]);

  // Group challenges by type
  const grouped = {
    daily: Object.values(CHALLENGES).filter(c => c.type === "daily"),
    weekly: Object.values(CHALLENGES).filter(c => c.type === "weekly"),
    playstyle: Object.values(CHALLENGES).filter(c => c.type === "playstyle"),
  };

  // Select a random wildcard (in real app, this would be persisted)
  const activeWildcard = useMemo(() => {
    return WILDCARD_CHALLENGES[Math.floor(Math.random() * WILDCARD_CHALLENGES.length)];
  }, []);

  const currentCategory = grouped[expandedCategory];

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">🎮 Challenges</h2>

      {/* Wildcard */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10 border border-primary/30 p-4"
      >
        <div className="absolute top-0 right-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl -mr-10 -mt-10" />
        <div className="relative z-10 flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">{activeWildcard.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">Today's Wild Card</span>
            </div>
            <h3 className="text-sm font-semibold text-foreground">{activeWildcard.title}</h3>
            <p className="text-xs text-muted-foreground mt-1">{activeWildcard.description}</p>
          </div>
        </div>
      </motion.div>

      {/* Category Tabs */}
      <div className="flex gap-2">
        {Object.entries(CHALLENGE_CATEGORIES).map(([key, { label, emoji }]) => (
          <button
            key={key}
            onClick={() => setExpandedCategory(key)}
            className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
              expandedCategory === key
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {emoji} {label}
          </button>
        ))}
      </div>

      {/* Challenges Grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={expandedCategory}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-2 sm:grid-cols-3 gap-2"
        >
          {currentCategory.map(challenge => (
            <ChallengeBadge
              key={challenge.id}
              challenge={challenge}
              userChallenge={challengeMap[challenge.id]}
              playstyleType={challenge.playstyle ? PLAYSTYLE_TYPES[challenge.playstyle] : null}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Playstyle Info */}
      {expandedCategory === "playstyle" && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-muted-foreground bg-card/30 rounded-xl px-3 py-2.5 border border-border/50"
        >
          <p>Try different playstyles to unlock unique experiences. Mix and match for creative moments.</p>
        </motion.div>
      )}
    </div>
  );
}