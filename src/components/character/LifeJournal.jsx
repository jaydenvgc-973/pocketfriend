import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ChevronUp, Heart, AlertTriangle, Star, Zap, Scale } from "lucide-react";
import { format } from "date-fns";

const EVENT_CONFIG = {
  // Positive
  supportive_event: { emoji: "🤝", color: "text-green-400", bg: "bg-green-400/10 border-green-400/20" },
  bonding_event: { emoji: "💞", color: "text-pink-400", bg: "bg-pink-400/10 border-pink-400/20" },
  achievement_qualifying_action: { emoji: "⭐", color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/20" },
  life_milestone_event: { emoji: "🏆", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
  celebration_event: { emoji: "🎉", color: "text-primary", bg: "bg-primary/10 border-primary/20" },
  reconciliation_event: { emoji: "🕊️", color: "text-teal-400", bg: "bg-teal-400/10 border-teal-400/20" },
  healthy_choice_event: { emoji: "💪", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" },
  growth_event: { emoji: "🌱", color: "text-lime-400", bg: "bg-lime-400/10 border-lime-400/20" },
  recovery_event: { emoji: "💊", color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/20" },
  // Negative
  conflict_event: { emoji: "⚡", color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/20" },
  legal_or_social_consequence_event: { emoji: "⚖️", color: "text-red-400", bg: "bg-red-400/10 border-red-400/20" },
  betrayal_event: { emoji: "🗡️", color: "text-red-500", bg: "bg-red-500/10 border-red-500/20" },
  grief_event: { emoji: "🖤", color: "text-slate-400", bg: "bg-slate-400/10 border-slate-400/20" },
  accident_event: { emoji: "🚨", color: "text-red-400", bg: "bg-red-400/10 border-red-400/20" },
  setback_event: { emoji: "📉", color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/20" },
  risky_decision_event: { emoji: "🎲", color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20" },
  // Neutral/other
  emotional_exchange: { emoji: "💬", color: "text-violet-400", bg: "bg-violet-400/10 border-violet-400/20" },
  relationship_shift: { emoji: "🔄", color: "text-sky-400", bg: "bg-sky-400/10 border-sky-400/20" },
  location_change_event: { emoji: "📍", color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/20" },
  routine_positive_event: { emoji: "☀️", color: "text-yellow-300", bg: "bg-yellow-300/10 border-yellow-300/20" },
  routine_negative_event: { emoji: "🌧️", color: "text-slate-400", bg: "bg-slate-400/10 border-slate-400/20" },
};

const DEFAULT_CONFIG = { emoji: "📌", color: "text-muted-foreground", bg: "bg-secondary border-border" };

const SEVERITY_ORDER = { major: 0, significant: 1, moderate: 2, minor: 3 };

function JournalEntry({ event }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = EVENT_CONFIG[event.event_type] || DEFAULT_CONFIG;
  const date = event.timestamp ? format(new Date(event.timestamp), "MMM d, yyyy") : null;

  return (
    <div className={`border rounded-xl p-3 space-y-1.5 ${cfg.bg}`}>
      <div className="flex items-start gap-2">
        <span className="text-base flex-shrink-0 leading-none mt-0.5">{cfg.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs font-semibold ${cfg.color} leading-snug`}>{event.title}</p>
            {date && <span className="text-[10px] text-muted-foreground flex-shrink-0">{date}</span>}
          </div>
          {event.severity && (
            <span className={`text-[9px] uppercase tracking-wider font-bold ${cfg.color} opacity-70`}>{event.severity}</span>
          )}
        </div>
        {event.description && (
          <button onClick={() => setExpanded(v => !v)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {expanded && event.description && (
        <p className="text-xs text-muted-foreground pl-6 leading-relaxed">{event.description}</p>
      )}
      {expanded && event.emotional_impact && (
        <p className="text-[10px] text-muted-foreground/70 pl-6 italic">Emotional impact: {event.emotional_impact}</p>
      )}
    </div>
  );
}

export default function LifeJournal({ characterId, character }) {
  const [showAll, setShowAll] = useState(false);
  const PREVIEW_COUNT = 5;

  const { data: lifeEvents = [], isLoading } = useQuery({
    queryKey: ["lifeEvents", characterId],
    queryFn: () => base44.entities.LifeEvent.filter({ character_id: characterId }, "-timestamp", 50),
    enabled: !!characterId,
  });

  // Derive debt status from character data
  const isJailed = character?.is_jailed;
  const jailRelease = character?.jail_release_date;

  // Sort by severity then timestamp
  const sorted = [...lifeEvents].sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  const visible = showAll ? sorted : sorted.slice(0, PREVIEW_COUNT);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary" />
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Life Journal</p>
        {lifeEvents.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{lifeEvents.length} entries</span>
        )}
      </div>

      {/* Jail / Debt alert */}
      {isJailed && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <Scale className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-400">Currently Serving Jail Time</p>
            {jailRelease && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Release: {format(new Date(jailRelease), "MMM d, yyyy 'at' h:mm a")}
              </p>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading journal entries...</p>
      ) : lifeEvents.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No life events recorded yet. Events are automatically logged as {character?.name || "this character"} goes through experiences.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map(event => (
            <JournalEntry key={event.id} event={event} />
          ))}
          {sorted.length > PREVIEW_COUNT && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-xl transition-colors"
            >
              {showAll ? "Show less" : `Show ${sorted.length - PREVIEW_COUNT} more entries`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}