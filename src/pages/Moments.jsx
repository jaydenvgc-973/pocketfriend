import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Wrench, Film, Loader2, CheckCircle2 } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import ActiveArcCard from "@/components/moments/ActiveArcCard";
import AchievementBadge from "@/components/moments/AchievementBadge";
import LockedAchievements from "@/components/moments/LockedAchievements";
import GoalsSection from "@/components/moments/GoalsSection";
import ChallengesSection from "@/components/moments/ChallengesSection";
import TroubleshootingPanelMoments from "@/components/moments/TroubleshootingPanelMoments";
import MomentsCalendar from "@/components/moments/MomentsCalendar";
import { ACHIEVEMENTS, CATEGORY_LABELS } from "@/lib/achievements";

const CATEGORIES = Object.keys(CATEGORY_LABELS);

export default function Moments() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [scanning, setScanning] = useState(false);
  const [reelJobStatus, setReelJobStatus] = useState(null); // null | 'processing' | 'complete'
  const [scanResult, setScanResult] = useState(null);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const hasScanned = useRef(false);
  const queryClient = useQueryClient();

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ status: "active", owner_email: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  const { data: unlocked = [], refetch: refetchAchievements } = useQuery({
    queryKey: ["userAchievements", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserAchievement.filter({ owner_email: currentUser.email }, "-unlocked_at")
      : [],
    enabled: !!currentUser?.email,
  });

  // Message entity has no owner_email field — scoping is handled by platform RLS on conversation_id.
  // Do NOT filter by owner_email here (field does not exist on Message, would return 0 records).
  const { data: messages = [] } = useQuery({
    queryKey: ["allMessages", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Message.filter({}, "-created_date", 500)
      : [],
    enabled: !!currentUser?.email,
    staleTime: 2 * 60 * 1000,
  });

  const { data: userChallenges = [] } = useQuery({
    queryKey: ["userChallenges", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserChallenge.filter({})
      : [],
    enabled: !!currentUser?.email,
  });

  const { data: userSettings = null } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserSettings.filter({ owner_email: currentUser.email }, null, 1).then(r => r[0] || null)
      : null,
    enabled: !!currentUser?.email,
  });

  const { data: communityEvents = [] } = useQuery({
    queryKey: ["communityEvents", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.CommunityEvent.filter({ is_active: true }, "-start_date", 100)
      : [],
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
  });

  // Run retroactive achievement scan once per session when user loads Moments
  useEffect(() => {
    if (!currentUser?.email || hasScanned.current) return;
    hasScanned.current = true;

    const runScan = async () => {
      setScanning(true);
      try {
        const res = await base44.functions.invoke('retroactiveAchievementScan', {});
        const granted = res?.data?.granted || 0;
        if (granted > 0) {
          setScanResult(granted);
          // Refresh achievements list
          await refetchAchievements();
          queryClient.invalidateQueries({ queryKey: ["userAchievements"] });
        }
      } catch (err) {
        // Silent fail — scan is a bonus, not critical
        console.warn('[Moments] retroactive scan failed:', err.message);
      } finally {
        setScanning(false);
      }
    };

    runScan();
  }, [currentUser?.email]);

  // Check for active reel job — session-gated, lightweight
  useEffect(() => {
    if (!currentUser?.email) return;
    base44.entities.ReelGenerationJob
      .filter({ owner_email: currentUser.email }, "-created_date", 3)
      .then(jobs => {
        const inProgress = jobs.find(j => ['queued','preparing','animating','assembling','validating'].includes(j.status));
        const complete = jobs.find(j => j.status === 'complete');
        if (inProgress) setReelJobStatus('processing');
        else if (complete) setReelJobStatus('complete');
        else setReelJobStatus(null);
      })
      .catch(() => {});
  }, [currentUser?.email]);

  // Subscribe to real-time achievement unlocks
  useEffect(() => {
    if (!currentUser?.email) return;
    const unsub = base44.entities.UserAchievement.subscribe((event) => {
      if (event.type === 'create') {
        queryClient.invalidateQueries({ queryKey: ["userAchievements"] });
      }
    });
    return unsub;
  }, [currentUser?.email]);

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
    <div className="min-h-screen bg-background pt-28 pb-20">
      {/* Header */}
       <div className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-xl border-b border-border px-4 pt-6 pb-4">
         <div className="flex items-center justify-between">
           <div>
             <h1 className="text-xl font-bold text-foreground">Moments & Impact</h1>
             <p className="text-xs text-muted-foreground mt-0.5">
               {unlockedCount} / {allAchievements.length} achievements unlocked
               {scanning && <span className="ml-2 text-primary/60">• scanning...</span>}
             </p>
           </div>
           <div className="flex items-center gap-2">
             <Link
               to="/memory-reel"
               className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium"
             >
               {reelJobStatus === 'processing'
                 ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Memory Reel processing</>
                 : reelJobStatus === 'complete'
                 ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Memory Reel ready</>
                 : <><Film className="w-3.5 h-3.5" /> Create Memory Reel</>
               }
             </Link>
             <button
               onClick={() => setShowTroubleshooting(true)}
               className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
               title="Troubleshoot Moments page"
             >
               <Wrench className="w-4 h-4" />
             </button>
             {scanResult && (
               <motion.div
                 initial={{ opacity: 0, scale: 0.8 }}
                 animate={{ opacity: 1, scale: 1 }}
                 className="bg-primary/20 text-primary text-xs font-semibold px-3 py-1.5 rounded-full"
               >
                 +{scanResult} unlocked!
               </motion.div>
             )}
           </div>
         </div>
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

      <div className="px-4 py-5 space-y-8 relative z-10">

        {/* Calendar */}
        <MomentsCalendar
          characters={characters}
          userBirthday={userSettings?.user_birthday || null}
          communityEvents={communityEvents}
        />

         {/* Active Arcs — active created characters only (no NPCs) */}
        {characters.filter(c => c.character_type === 'active_created_character').length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">🔥 Active Arcs</h2>
            <div className="space-y-2">
              {characters.filter(c => c.character_type === 'active_created_character').sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => (
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

      <TroubleshootingPanelMoments
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
      />
      <BottomNav />
    </div>
  );
}