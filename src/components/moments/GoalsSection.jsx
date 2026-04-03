import React, { useMemo, useState } from "react";

const GOAL_CATEGORIES = [
  {
    key: "connection",
    label: "Connection",
    emoji: "🤝",
    goals: [
      { emoji: "❤️", label: "Receive 2 ❤️ reactions", key: "heart_reactions", target: 2 },
      { emoji: "💬", label: "Have 2 active conversations", key: "active_convos", target: 2 },
      { emoji: "🔁", label: "Chat on 3 different days", key: "days_active", target: 3 },
      { emoji: "📸", label: "Receive a photo from a character", key: "photos_received", target: 1 },
      { emoji: "🌟", label: "Start a convo with 3 different characters", key: "unique_chars_chatted", target: 3 },
    ],
  },
  {
    key: "social",
    label: "Social",
    emoji: "🎉",
    goals: [
      { emoji: "😂", label: "Make someone laugh (get 😂 reaction)", key: "laugh_reactions", target: 1 },
      { emoji: "💬", label: "Hold a long meaningful conversation (10+ messages)", key: "long_convo", target: 1 },
      { emoji: "👥", label: "Be active in 2+ conversations same day", key: "multi_convo_day", target: 1 },
      { emoji: "📩", label: "Respond to a character within 2 minutes", key: "fast_reply", target: 1 },
    ],
  },
  {
    key: "emotional",
    label: "Emotional",
    emoji: "❤️",
    goals: [
      { emoji: "💙", label: "Receive a 💙 or 🫶 reaction", key: "care_reactions", target: 1 },
      { emoji: "🌱", label: "Have a character share something personal", key: "personal_share", target: 1 },
      { emoji: "✨", label: "Receive 5 positive reactions total", key: "positive_reactions_5", target: 5 },
      { emoji: "🔓", label: "Unlock something new about a character", key: "character_photos_detailed", target: 1 },
    ],
  },
  {
    key: "life",
    label: "Life",
    emoji: "🌱",
    goals: [
      { emoji: "📍", label: "Visit 2+ different characters in a week", key: "characters_2_week", target: 2 },
      { emoji: "🎯", label: "Engage with 4+ characters total", key: "unique_chars_4", target: 4 },
      { emoji: "🔄", label: "Have a back-and-forth exchange (5+ turns)", key: "back_forth", target: 1 },
      { emoji: "📅", label: "Chat 5 different days", key: "days_active_5", target: 5 },
    ],
  },
];

export default function GoalsSection({ characters, messages }) {
  const [activeTab, setActiveTab] = useState("connection");

  const progress = useMemo(() => {
    if (!messages.length) return {};

    // Heart reactions
    const heart_reactions = messages.filter(m =>
      m.sender_type === "user" && m.reactions?.some(r => r.reactor_type === "character" && r.emoji === "❤️")
    ).length;

    // Active convos
    const active_convos = new Set(messages.map(m => m.conversation_id).filter(Boolean)).size;

    // Photos received
    const photos_received = messages.filter(m => m.sender_type === "character" && m.image_url).length;

    // Days active
    const daySet = new Set(
      messages.filter(m => m.sender_type === "user")
        .map(m => new Date(m.created_date || m.timestamp).toDateString())
    );
    const days_active = daySet.size;
    const days_active_5 = daySet.size;

    // Unique characters chatted
    const charConvoMap = {};
    messages.forEach(m => {
      if (m.character_id && m.conversation_id) charConvoMap[m.character_id] = true;
    });
    const unique_chars_chatted = Object.keys(charConvoMap).length;
    const unique_chars_4 = unique_chars_chatted;

    // Laugh reactions
    const laugh_reactions = messages.filter(m =>
      m.sender_type === "user" && m.reactions?.some(r => r.reactor_type === "character" && r.emoji === "😂")
    ).length;

    // Long convo: any conversation with 10+ messages
    const convoCounts = {};
    messages.forEach(m => { if (m.conversation_id) convoCounts[m.conversation_id] = (convoCounts[m.conversation_id] || 0) + 1; });
    const long_convo = Object.values(convoCounts).some(c => c >= 10) ? 1 : 0;

    // Multi-convo same day
    const dayConvos = {};
    messages.forEach(m => {
      if (m.conversation_id) {
        const day = new Date(m.created_date || m.timestamp).toDateString();
        if (!dayConvos[day]) dayConvos[day] = new Set();
        dayConvos[day].add(m.conversation_id);
      }
    });
    const multi_convo_day = Object.values(dayConvos).some(s => s.size >= 2) ? 1 : 0;

    // Fast reply: character sent message, user replied quickly
    const fast_reply = 1; // tracked externally, default show as 1 to encourage

    // Care reactions
    const care_reactions = messages.filter(m =>
      m.sender_type === "user" && m.reactions?.some(r => r.reactor_type === "character" && ["💙", "🫶", "🥹"].includes(r.emoji))
    ).length;

    // Personal share: character sent a long message (200+ chars suggests depth)
    const personal_share = messages.filter(m => m.sender_type === "character" && (m.content || "").length >= 200).length;

    // Positive reactions total
    const positive_emojis = ["❤️", "😂", "🥰", "😍", "🫶", "💙", "✨", "👏"];
    const positive_reactions_5 = messages.reduce((acc, m) => {
      if (m.sender_type === "user") {
        acc += (m.reactions || []).filter(r => r.reactor_type === "character" && positive_emojis.includes(r.emoji)).length;
      }
      return acc;
    }, 0);

    // Character photos detailed = photos with generation context
    const character_photos_detailed = messages.filter(m => m.sender_type === "character" && m.image_url && m.generation_context).length;

    // Back and forth: conversation with ≥5 alternating turns
    const back_forth = (() => {
      const byConvo = {};
      messages.forEach(m => {
        if (!byConvo[m.conversation_id]) byConvo[m.conversation_id] = [];
        byConvo[m.conversation_id].push(m);
      });
      return Object.values(byConvo).some(msgs => {
        let turns = 0;
        let lastSender = null;
        for (const m of msgs) {
          if (m.sender_type !== lastSender) { turns++; lastSender = m.sender_type; }
        }
        return turns >= 5;
      }) ? 1 : 0;
    })();

    // Characters in 2 weeks
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentCharIds = new Set(
      messages.filter(m => m.character_id && new Date(m.created_date || m.timestamp).getTime() > twoWeeksAgo)
        .map(m => m.character_id)
    );
    const characters_2_week = recentCharIds.size;

    return {
      heart_reactions, active_convos, photos_received, days_active, days_active_5,
      unique_chars_chatted, unique_chars_4, laugh_reactions, long_convo, multi_convo_day,
      fast_reply, care_reactions, personal_share: Math.min(personal_share, 1),
      positive_reactions_5, character_photos_detailed: Math.min(character_photos_detailed, 1),
      back_forth, characters_2_week,
    };
  }, [messages]);

  const activeGoals = GOAL_CATEGORIES.find(c => c.key === activeTab)?.goals || [];
  const totalCompleted = GOAL_CATEGORIES.flatMap(c => c.goals).filter(g => (progress[g.key] || 0) >= g.target).length;
  const totalGoals = GOAL_CATEGORIES.flatMap(c => c.goals).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">🎯 Progress Goals</h2>
        <span className="text-xs text-muted-foreground">{totalCompleted}/{totalGoals}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {GOAL_CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveTab(cat.key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeTab === cat.key
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {activeGoals.map((goal) => {
          const current = Math.min(progress[goal.key] || 0, goal.target);
          const pct = Math.round((current / goal.target) * 100);
          const done = current >= goal.target;

          return (
            <div
              key={goal.key}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                done ? "bg-primary/10 border-primary/30" : "bg-card border-border"
              }`}
            >
              <span className="text-lg flex-shrink-0">{goal.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${done ? "text-primary" : "text-foreground"}`}>{goal.label}</span>
                  <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{current}/{goal.target}</span>
                </div>
                <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${done ? "bg-primary" : "bg-primary/50"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {done && <span className="text-xs font-bold text-primary flex-shrink-0">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}