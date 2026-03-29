const WEEKLY_GOALS = [
  { emoji: "❤️", label: "Receive 2 ❤️ reactions", key: "heart_reactions", target: 2 },
  { emoji: "💬", label: "Have 2 active conversations", key: "active_convos", target: 2 },
  { emoji: "📸", label: "Receive 1 photo from a character", key: "photos_received", target: 1 },
  { emoji: "🔁", label: "Chat on 3 different days", key: "days_active", target: 3 },
];

export default function GoalsSection({ characters, messages }) {
  // Heart reactions: character sent ❤️ to user's messages
  const heartReactions = messages.filter(m =>
    m.sender_type === "user" && m.reactions?.some(r => r.reactor_type === "character" && r.emoji === "❤️")
  ).length;

  // Active convos: unique conversation_ids with activity (any message sender)
  const activeConvoIds = new Set(messages.map(m => m.conversation_id).filter(Boolean));
  const activeConvos = activeConvoIds.size;

  // Photos received from characters
  const photosReceived = messages.filter(m => m.sender_type === "character" && m.image_url).length;

  // Days the user sent messages
  const daysActive = new Set(
    messages
      .filter(m => m.sender_type === "user")
      .map(m => new Date(m.created_date || m.timestamp).toDateString())
  ).size;

  const progress = {
    heart_reactions: Math.min(heartReactions, 2),
    active_convos: Math.min(activeConvos, 2),
    photos_received: Math.min(photosReceived, 1),
    days_active: Math.min(daysActive, 3),
  };

  const targets = { heart_reactions: 2, active_convos: 2, photos_received: 1, days_active: 3 };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">🎯 Progress Goals</h2>
      </div>
      <div className="space-y-2">
        {WEEKLY_GOALS.map((goal) => {
          const current = progress[goal.key] || 0;
          const target = targets[goal.key];
          const pct = Math.round((current / target) * 100);
          const done = current >= target;

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
                  <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{current}/{target}</span>
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