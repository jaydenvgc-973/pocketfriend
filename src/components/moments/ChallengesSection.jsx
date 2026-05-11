import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CHALLENGES, WILDCARD_CHALLENGES, CHALLENGE_CATEGORIES, PLAYSTYLE_TYPES } from "@/lib/challenges";
import ChallengeBadge from "./ChallengeBadge";

export default function ChallengesSection({ userChallenges = [], messages = [] }) {
  const [expandedCategory, setExpandedCategory] = useState("daily");

  // Stored UserChallenge records (backend-persisted completions)
  const storedMap = useMemo(() => {
    return userChallenges.reduce((acc, uc) => {
      acc[uc.challenge_id] = uc;
      return acc;
    }, {});
  }, [userChallenges]);

  // Compute live progress from messages for challenges that can be measured client-side
  const liveProgress = useMemo(() => {
    if (!messages.length) return {};
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const userMsgs = messages.filter(m => m.sender_type === 'user');
    const charMsgs = messages.filter(m => m.sender_type === 'character');
    const weekUserMsgs = userMsgs.filter(m => new Date(m.created_date || m.timestamp).getTime() > weekAgo);
    const weekCharMsgs = charMsgs.filter(m => new Date(m.created_date || m.timestamp).getTime() > weekAgo);

    // send_5_messages: distinct characters messaged today
    const todayStr = new Date().toDateString();
    const todayUserMsgs = userMsgs.filter(m => new Date(m.created_date || m.timestamp).toDateString() === todayStr);
    const send_5_messages = todayUserMsgs.length;

    // reply_quickly: replied within 2 minutes ever
    const reply_quickly = charMsgs.slice(0, 100).some(cm => {
      const cmTime = new Date(cm.created_date || cm.timestamp).getTime();
      return userMsgs.some(um => {
        const umTime = new Date(um.created_date || um.timestamp).getTime();
        return umTime > cmTime && umTime - cmTime < 2 * 60 * 1000;
      });
    }) ? 1 : 0;

    // react_to_photos: user reacted to character image messages (messages with reactions from user)
    const react_to_photos = messages.filter(m =>
      m.sender_type === 'character' && m.image_url &&
      (m.reactions || []).some(r => r.reactor_type === 'user')
    ).length;

    // trigger_reactions: character emoji reactions on user messages today
    const trigger_reactions = todayUserMsgs.reduce((acc, m) =>
      acc + (m.reactions || []).filter(r => r.reactor_type === 'character').length, 0);

    // start_new_convo: new conversation started today
    const todayConvos = new Set(todayUserMsgs.map(m => m.conversation_id).filter(Boolean));
    const olderConvos = new Set(
      userMsgs.filter(m => new Date(m.created_date || m.timestamp).toDateString() !== todayStr)
        .map(m => m.conversation_id).filter(Boolean)
    );
    const start_new_convo = [...todayConvos].some(id => !olderConvos.has(id)) ? 1 : 0;

    // reconnect: messaged a character after 3+ day gap
    const reconnect = (() => {
      const byChar = {};
      userMsgs.forEach(m => {
        const chars = charMsgs.filter(c => c.conversation_id === m.conversation_id).map(c => c.character_id);
        chars.forEach(cid => {
          if (!byChar[cid]) byChar[cid] = [];
          byChar[cid].push(new Date(m.created_date || m.timestamp).getTime());
        });
      });
      return Object.values(byChar).some(times => {
        const sorted = times.sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] - sorted[i - 1] > 3 * 24 * 60 * 60 * 1000) return true;
        }
        return false;
      }) ? 1 : 0;
    })();

    // active_10_min: user sent messages spanning 10+ minutes in one day
    const active_10_min = (() => {
      const byDay = {};
      userMsgs.forEach(m => {
        const day = new Date(m.created_date || m.timestamp).toDateString();
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(new Date(m.created_date || m.timestamp).getTime());
      });
      return Object.values(byDay).some(times => {
        const sorted = times.sort((a, b) => a - b);
        return (sorted[sorted.length - 1] - sorted[0]) >= 10 * 60 * 1000;
      }) ? 1 : 0;
    })();

    // progress_life_arc: at least 1 narrative message from a character in the week + user responded
    const progress_life_arc = weekCharMsgs.some(m => m.is_narrative) &&
      weekUserMsgs.length > 0 ? 1 : 0;

    // multi_storyline: involved in 2+ distinct conversations this week
    const weekConvos = new Set(weekUserMsgs.map(m => m.conversation_id).filter(Boolean));
    const multi_storyline = weekConvos.size;

    // heart_reactions_week: ❤️ reactions on user messages this week
    const heart_reactions_week = weekUserMsgs.reduce((acc, m) =>
      acc + (m.reactions || []).filter(r => r.reactor_type === 'character' && r.emoji === '❤️').length, 0);

    // major_life_event: narrative message in the week
    const major_life_event = weekCharMsgs.some(m => m.is_narrative) ? 1 : 0;

    // consistent_character: same character messaged across 3+ different days this week
    const consistent_character = (() => {
      const charDays = {};
      weekUserMsgs.forEach(m => {
        const day = new Date(m.created_date || m.timestamp).toDateString();
        const chars = charMsgs.filter(c => c.conversation_id === m.conversation_id).map(c => c.character_id);
        chars.forEach(cid => {
          if (!charDays[cid]) charDays[cid] = new Set();
          charDays[cid].add(day);
        });
      });
      return Object.values(charDays).some(days => days.size >= 3) ? 1 : 0;
    })();

    // repair_conflict: character sent message with emotional_state that changed from defensive/irritated to calm/reflective
    const repair_conflict = (() => {
      const byConvo = {};
      charMsgs.filter(m => m.emotional_state).forEach(m => {
        if (!byConvo[m.conversation_id]) byConvo[m.conversation_id] = [];
        byConvo[m.conversation_id].push(m);
      });
      return Object.values(byConvo).some(msgs => {
        const sorted = msgs.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        let hadConflict = false;
        for (const m of sorted) {
          if (['irritated', 'defensive', 'angry'].includes(m.emotional_state)) hadConflict = true;
          if (hadConflict && ['calm', 'reflective', 'content'].includes(m.emotional_state)) return true;
        }
        return false;
      }) ? 1 : 0;
    })();

    // multiple_hearts: 3+ ❤️ reactions on user messages
    const allHearts = userMsgs.reduce((acc, m) =>
      acc + (m.reactions || []).filter(r => r.reactor_type === 'character' && r.emoji === '❤️').length, 0);
    const multiple_hearts = allHearts;

    // help_through_crisis: character messaged with emotional_state of distressed/grief/crisis and user replied
    const help_through_crisis = charMsgs.some(cm =>
      ['sad', 'grief', 'distressed', 'defensive'].includes(cm.emotional_state) &&
      userMsgs.some(um => um.conversation_id === cm.conversation_id &&
        new Date(um.created_date || um.timestamp) > new Date(cm.created_date || cm.timestamp))
    ) ? 1 : 0;

    // strategic_influence: character had 3+ emotional_state changes in conversations user was active in
    const strategic_influence = (() => {
      const activeConvos = new Set(userMsgs.map(m => m.conversation_id).filter(Boolean));
      const stateChanges = new Set();
      charMsgs.filter(m => activeConvos.has(m.conversation_id) && m.emotional_state && m.character_id).forEach(m => {
        stateChanges.add(`${m.conversation_id}::${m.emotional_state}`);
      });
      return stateChanges.size;
    })();

    // balance_conversations: 3+ distinct conversations with messages sent
    const balance_conversations = new Set(userMsgs.map(m => m.conversation_id).filter(Boolean)).size;

    return {
      send_5_messages, reply_quickly, react_to_photos, trigger_reactions,
      start_new_convo, reconnect, active_10_min,
      progress_life_arc, multi_storyline, heart_reactions_week, major_life_event,
      consistent_character, repair_conflict,
      multiple_hearts, help_through_crisis, strategic_influence, balance_conversations,
    };
  }, [messages]);

  // Merge: stored UserChallenge records take precedence for completion; live progress fills the gap
  const challengeMap = useMemo(() => {
    const merged = { ...storedMap };
    Object.entries(liveProgress).forEach(([challengeId, progress]) => {
      if (!merged[challengeId]) {
        const challenge = Object.values(CHALLENGES).find(c => c.id === challengeId);
        if (!challenge) return;
        const completed = progress >= challenge.target;
        merged[challengeId] = { challenge_id: challengeId, progress, completed, _computed: true };
      }
    });
    return merged;
  }, [storedMap, liveProgress]);

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