const WEEKLY_GOALS = [
  { emoji: "❤️", label: "Trigger 5 ❤️ reactions", key: "heart_reactions", target: 5 },
  { emoji: "💬", label: "Maintain 3 active conversations", key: "active_convos", target: 3 },
  { emoji: "🌀", label: "Experience a full life arc", key: "full_arc", target: 1 },
  { emoji: "📸", label: "Receive 3 photos from characters", key: "photos_received", target: 3 },
];

export default function GoalsSection({ characters, messages }) {
  // Compute lightweight progress for each goal from available data
  const heartReactions = messages.filter(m =>
    m.sender_type === "character" && m.reactions?.some(r => r.emoji === "❤️")
  ).length;

  const activeConvos = new Set(
    messages.filter(m => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return m.timestamp && new Date(m.timestamp) > dayAgo;
    }).map(m => m.conversation_id)
  ).size;

  const photosReceived = messages.filter(m => m.sender_type === "character" && m.image_url).length;

  const progress = {
    heart_reactions: Math.min(heartReactions, 5),
    active_convos: Math.min(activeConvos, 3),
    full_arc: 0, // placeholder — would need arc tracking
    photos_received: Math.min(photosReceived, 3),
  };

  const targets = { heart_reactions: 5, active_convos: 3, full_arc: 1, photos_received: 3 };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">🎯 Weekly Goals</h2>
        <span className="text-xs text-muted-foreground">Resets weekly</span>
      </div>
      <div className="space-y-2">
        {WEEKLY_GOALS.map((goal) => {
          const current = progress[goal.key] || 0;
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