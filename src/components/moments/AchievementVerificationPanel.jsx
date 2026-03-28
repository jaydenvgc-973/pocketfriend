import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const EXPECTED_ACHIEVEMENTS = [
  { id: "first_impression", name: "First Impression", events: ["first_message_to_character"] },
  { id: "method_spree", name: "Method Spree", events: ["message_sent"], threshold: "5 characters" },
  { id: "emoticon_addict", name: "Emoticon Addict", events: ["emoji_reaction"], threshold: "5 reactions" },
  { id: "trigger_two_emojis", name: "Trigger Two Emojis", events: ["emoji_reaction"], threshold: "2 types" },
  { id: "photo_sharer", name: "Photo Sharer", events: ["image_sent"], threshold: "3 images" },
  { id: "the_push", name: "The Push", events: ["message_sent", "message_received"] },
];

export default function AchievementVerificationPanel({ userEmail }) {
  const [expanded, setExpanded] = useState(false);

  const { data: progressRecords = [] } = useQuery({
    queryKey: ["achievementProgress", userEmail],
    queryFn: () => userEmail
      ? base44.entities.UserAchievementProgress.filter({ user_email: userEmail })
      : [],
    enabled: !!userEmail && expanded,
    staleTime: 10000
  });

  const { data: events = [] } = useQuery({
    queryKey: ["achievementEvents", userEmail],
    queryFn: () => userEmail
      ? base44.entities.UserAchievementEvent.filter({ user_email: userEmail }, "-timestamp")
      : [],
    enabled: !!userEmail && expanded,
    staleTime: 10000
  });

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-36 right-4 px-3 py-1.5 rounded-full bg-secondary text-xs text-muted-foreground hover:text-foreground transition-colors z-40"
      >
        ✓ Verify
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="fixed bottom-36 right-4 w-96 max-h-[600px] overflow-y-auto bg-card border border-border rounded-2xl p-4 z-50 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-foreground">Achievement Verification</h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <div className="bg-secondary rounded-lg p-2 space-y-0.5 text-xs">
        <p className="text-muted-foreground">User: {userEmail}</p>
        <p className="text-muted-foreground">{progressRecords.length} progress records</p>
        <p className="text-muted-foreground">{events.length} events</p>
      </div>

      <div className="space-y-2">
        {EXPECTED_ACHIEVEMENTS.map(expected => {
          const progress = progressRecords.find(p => p.achievement_id === expected.id);
          const isUnlocked = progress?.unlocked === true;
          const relevantEvents = events.filter(e => expected.events.includes(e.event_type));

          return (
            <div key={expected.id} className="border border-border rounded-lg p-2 space-y-1">
              <div className="flex items-center gap-2">
                {isUnlocked ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <X className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-foreground">{expected.name}</span>
              </div>

              <div className="text-[10px] text-muted-foreground space-y-0.5 ml-6">
                {progress ? (
                  <>
                    <p>Progress: {progress.current_progress}/{progress.target_progress}</p>
                    <p>Events: {progress.source_event_count}</p>
                    {progress.unlocked && (
                      <p className="text-emerald-500">
                        Unlocked: {new Date(progress.unlocked_at).toLocaleDateString()}
                      </p>
                    )}
                  </>
                ) : (
                  <p>No progress record</p>
                )}
                <p>Qualifying events: {relevantEvents.length}</p>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}