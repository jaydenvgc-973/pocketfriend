import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import {
  Moon, Sun, Briefcase, Home, Coffee, MessageCircle, Phone,
  DollarSign, TrendingDown, Heart, AlertTriangle, MapPin, Zap,
  BookOpen, Brain, Activity
} from "lucide-react";
import { format, subHours, isAfter, parseISO } from "date-fns";

// ── Emotional state → display colour ────────────────────────────────────────
const EMOTION_COLORS = {
  calm: "#34d399",
  happy: "#fbbf24",
  joyful: "#fbbf24",
  excited: "#fbbf24",
  hopeful: "#a78bfa",
  affectionate: "#f472b6",
  sad: "#60a5fa",
  lonely: "#60a5fa",
  anxious: "#a78bfa",
  stressed: "#f87171",
  angry: "#f87171",
  irritated: "#f87171",
  defensive: "#f87171",
  "emotionally drained": "#94a3b8",
  exhausted: "#94a3b8",
  "closed-off": "#94a3b8",
  reflective: "#38bdf8",
};

function emotionColor(state) {
  return EMOTION_COLORS[(state || "").toLowerCase()] || "#94a3b8";
}

// ── Timeline entry glow / badge colour ──────────────────────────────────────
function entryAccent(emotion) {
  const c = (emotion || "").toLowerCase();
  if (["anxious", "stressed", "hopeful", "reflective"].includes(c)) return "border-l-violet-500/40 bg-violet-500/5";
  if (["angry", "irritated", "defensive", "tense"].includes(c)) return "border-l-red-500/40 bg-red-500/5";
  if (["happy", "joyful", "excited", "calm"].includes(c)) return "border-l-amber-400/40 bg-amber-400/5";
  if (["sad", "lonely", "exhausted", "emotionally drained"].includes(c)) return "border-l-blue-500/40 bg-blue-500/5";
  return "border-l-border bg-transparent";
}

// ── Needs bar ────────────────────────────────────────────────────────────────
function NeedsBar({ label, value, colorClass }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">{v}%</span>
      </div>
      <div className="h-1 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

// ── Tiny icon stat ────────────────────────────────────────────────────────────
function StatChip({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-0.5 flex-1">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span className="text-base font-semibold text-foreground">{value}</span>
      <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Format time ──────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return "";
  try { return format(parseISO(iso), "h:mm aa"); } catch { return ""; }
}

export default function CharacterDashboard({ character }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Lazy-load: only fetch when mounted (parent already gates render until expanded)
  useEffect(() => {
    if (loaded || loading) return;
    if (!character?.id) return;

    setLoading(true);
    const charId = character.id;
    const ownerEmail = character.owner_email;
    const cutoff = subHours(new Date(), 24).toISOString();

    Promise.allSettled([
      // Recent messages (past 24h) — for social stats & timeline
      base44.entities.Message.filter(
        { character_id: charId },
        "-created_date",
        80
      ),
      // Recent financial transactions (past 24h)
      base44.entities.FinancialTransaction.filter(
        { character_id: charId },
        "-timestamp",
        20
      ),
      // Recent memories
      base44.entities.CharacterMemory
        ? base44.entities.CharacterMemory.filter({ character_id: charId }, "-created_date", 10).catch(() => [])
        : Promise.resolve([]),
      // Automatic narratives (past 7 days for emotional trend)
      base44.entities.AutomaticNarrative
        ? base44.entities.AutomaticNarrative.filter({ character_id: charId }, "-timestamp", 50).catch(() => [])
        : Promise.resolve([]),
      // Conversations this character is in — needed to resolve participant names
      ownerEmail
        ? base44.entities.Conversation.filter({ owner_email: ownerEmail, character_ids: [charId] }, "-updated_date", 60).catch(() => [])
        : Promise.resolve([]),
    ]).then(([msgsR, txR, memsR, narrR, convosR]) => {
      const msgs = msgsR.status === "fulfilled" ? (msgsR.value || []) : [];
      const txns = txR.status === "fulfilled" ? (txR.value || []) : [];
      const mems = memsR.status === "fulfilled" ? (memsR.value || []) : [];
      const narrs = narrR.status === "fulfilled" ? (narrR.value || []) : [];
      const convos = convosR.status === "fulfilled" ? (convosR.value || []) : [];

      // ── Build conversation lookup: convoId → resolved display name ────────
      // Resolution priority:
      //   1. conversation.title (if it's a real human-readable title, not a system key)
      //   2. character_name on messages in that convo (the other participant)
      //   3. played_as_character_name / sender_character_id from world phone messages
      //   4. Safe fallback: "Another character", "Group conversation", "Unknown contact"
      const convoNameMap = {};
      const isSystemTitle = (t) => !t || t.startsWith("npc_chat__") || t.startsWith("bilateral_") || t.startsWith("world_phone_") || /^[a-f0-9-]{36}/.test(t);

      convos.forEach(c => {
        if (!isSystemTitle(c.title)) {
          convoNameMap[c.id] = c.title;
        } else if (c.type === "group") {
          convoNameMap[c.id] = "Group conversation";
        } else {
          convoNameMap[c.id] = null; // resolve from messages below
        }
      });

      // For convos without a clean title, try to extract the other participant's name
      // from messages: look for character_name on messages NOT sent by charId
      msgs.forEach(m => {
        if (convoNameMap[m.conversation_id] !== null && convoNameMap[m.conversation_id] !== undefined) return;
        // Use character_name stored on the message (the character who sent it)
        // For world phone: receiver_character_id messages carry character_name of the sender
        const otherName = m.sender_type === "character" && m.character_id !== charId
          ? m.character_name || null
          : null;
        // Also check played_as_character_name for user-sent world phone messages
        const playedAsName = m.played_as_character_name && m.played_as_character_id !== charId
          ? m.played_as_character_name
          : null;
        const resolved = otherName || playedAsName;
        if (resolved) convoNameMap[m.conversation_id] = resolved;
      });

      // For still-unresolved convos, check fictional_relationships as final lookup
      const relNameMap = {};
      (character.fictional_relationships || []).forEach(r => {
        if (r.related_character_id) relNameMap[r.related_character_id] = r.person_name;
      });
      convos.forEach(c => {
        if (convoNameMap[c.id]) return;
        // Try matching other character IDs in this convo against fictional_relationships
        const otherIds = (c.character_ids || []).filter(id => id !== charId);
        for (const id of otherIds) {
          if (relNameMap[id]) { convoNameMap[c.id] = relNameMap[id]; break; }
        }
        // Final fallback
        if (!convoNameMap[c.id]) {
          convoNameMap[c.id] = c.type === "group" ? "Group conversation" : "Another character";
        }
      });

      // Helper: resolve a participant label for a message
      const resolveParticipant = (msg) => {
        // If message carries the other character's name directly
        if (msg.character_name && msg.character_id !== charId) return msg.character_name;
        // world phone: sender_character_id / receiver_character_id
        if (msg.sender_character_id && msg.sender_character_id !== charId) {
          const rel = relNameMap[msg.sender_character_id];
          if (rel) return rel;
        }
        if (msg.receiver_character_id && msg.receiver_character_id !== charId) {
          const rel = relNameMap[msg.receiver_character_id];
          if (rel) return rel;
        }
        // Fall back to conversation-level name
        return convoNameMap[msg.conversation_id] || "Unknown contact";
      };

      // Helper: build a narrative-style message label
      const messageSummary = (msg) => {
        const participant = resolveParticipant(msg);
        const emotion = (msg.emotional_state || "").toLowerCase();
        const channel = convos.find(c => c.id === msg.conversation_id)?.channel || "";
        const isWorldPhone = channel === "world_phone";

        if (["irritated", "defensive", "angry"].includes(emotion)) {
          return `Had a tense exchange with ${participant}`;
        }
        if (emotion === "reflective") {
          return `Sent a reflective message to ${participant}`;
        }
        if (["happy", "joyful", "excited"].includes(emotion)) {
          return `Positive exchange with ${participant}`;
        }
        if (isWorldPhone) {
          return `World Phone message with ${participant}`;
        }
        return `Messaged ${participant}`;
      };

      // ── Filter to past 24h ───────────────────────────────────────────────
      const recent24hMsgs = msgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff)));
      const recent24hTxns = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff)));

      // ── Social stats ─────────────────────────────────────────────────────
      const msgsSent = recent24hMsgs.filter(m => m.sender_type === "character").length;
      const positiveInteractions = recent24hMsgs.filter(m =>
        m.sender_type === "character" && ["calm", "happy", "joyful", "excited"].includes((m.emotional_state || "").toLowerCase())
      ).length;
      const conflictEvents = recent24hMsgs.filter(m =>
        m.sender_type === "character" && ["irritated", "defensive", "angry"].includes((m.emotional_state || "").toLowerCase())
      ).length;

      // ── Build 24h timeline entries from real data ─────────────────────────
      const timelineEntries = [];

      // Sleep/wake from character fields
      if (character.last_sleep_start) {
        timelineEntries.push({
          time: character.last_sleep_start,
          icon: "moon",
          text: "Went to sleep",
          emotion: "exhausted",
          sub: null,
        });
      }
      if (character.alarm_woke_at) {
        timelineEntries.push({
          time: character.alarm_woke_at,
          icon: "sun",
          text: "Woke up",
          emotion: "calm",
          sub: null,
        });
      }

      // Narrative events
      narrs
        .filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff)))
        .forEach(n => {
          const iconMap = {
            sleep: "moon", wake: "sun", work_start: "briefcase", work_end: "home",
            travel_arrival: "mappin", travel_departure: "mappin",
            social_event: "heart", catch_up_summary: "book",
          };
          timelineEntries.push({
            time: n.timestamp,
            icon: iconMap[n.event_type] || "activity",
            text: n.narrative_text?.substring(0, 90) || n.event_type?.replace(/_/g, " "),
            emotion: n.emotional_state || character.emotional_state || "calm",
            sub: null,
          });
        });

      // Financial events
      recent24hTxns.forEach(t => {
        timelineEntries.push({
          time: t.timestamp,
          icon: "dollar",
          text: t.description || (t.direction === "income" ? "Received money" : "Spent money"),
          emotion: t.direction === "expense" ? "stressed" : "calm",
          sub: t.location_name || null,
        });
      });

      // Message interactions — deduplicated per conversation, with real participant names
      // Group by conversation_id and pick the most emotionally significant message per convo
      const convoMsgMap = {};
      recent24hMsgs
        .filter(m => m.sender_type === "character" && m.emotional_state)
        .forEach(m => {
          const existing = convoMsgMap[m.conversation_id];
          if (!existing) { convoMsgMap[m.conversation_id] = m; return; }
          // Prefer conflict/tension messages as they're more narratively significant
          const priority = { angry: 3, irritated: 3, defensive: 3, reflective: 2, sad: 2, anxious: 2, happy: 1, calm: 1 };
          const ep = (s) => priority[(s || "").toLowerCase()] || 0;
          if (ep(m.emotional_state) > ep(existing.emotional_state)) convoMsgMap[m.conversation_id] = m;
        });

      Object.values(convoMsgMap).slice(0, 6).forEach(m => {
        timelineEntries.push({
          time: m.created_date,
          icon: "message",
          text: messageSummary(m),
          emotion: m.emotional_state,
          sub: null,
        });
      });

      // Sort by time
      timelineEntries.sort((a, b) => {
        try { return new Date(a.time) - new Date(b.time); } catch { return 0; }
      });

      // ── Emotional trend (7 days) from narratives + messages ──────────────
      // Build daily emotional score from narratives grouping by day
      const sevenDaysAgo = subHours(new Date(), 7 * 24).toISOString();
      const recentNarrs = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(sevenDaysAgo)));

      // Map emotion strings → numeric score
      const emotionScore = (s) => {
        const m = { happy: 90, joyful: 85, excited: 88, hopeful: 75, calm: 70, affectionate: 80, reflective: 60, lonely: 35, sad: 30, anxious: 40, stressed: 35, "emotionally drained": 25, exhausted: 20, angry: 15, irritated: 30, defensive: 25 };
        return m[(s || "").toLowerCase()] ?? 55;
      };

      // Group by date → average score
      const byDay = {};
      recentNarrs.forEach(n => {
        try {
          const day = format(parseISO(n.timestamp), "MM/dd");
          if (!byDay[day]) byDay[day] = [];
          byDay[day].push(emotionScore(n.emotional_state || character.emotional_state));
        } catch {}
      });

      // Also sprinkle in current emotional state for today
      const today = format(new Date(), "MM/dd");
      if (!byDay[today]) byDay[today] = [];
      byDay[today].push(emotionScore(character.emotional_state));

      const trendData = Object.entries(byDay)
        .map(([day, scores]) => ({
          day,
          value: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        }))
        .sort((a, b) => {
          try { return new Date("2025/" + a.day) - new Date("2025/" + b.day); } catch { return 0; }
        })
        .slice(-7);

      // ── Pattern insights from real data ──────────────────────────────────
      const insights = [];
      if (conflictEvents > 0 && character.work_start_time) {
        insights.push("Emotional tension tends to appear on or after work days.");
      }
      if (character.social_value !== undefined && character.social_value < 40) {
        insights.push("Social needs are low — isolation may be building.");
      }
      if (character.sleep_debt_hours > 2) {
        insights.push("Sleep schedule is becoming unstable.");
      }
      if (character.mental_value !== undefined && character.mental_value < 40) {
        insights.push("Mental health is under strain. Rest and connection may help.");
      }
      if (character.financial_need_value !== undefined && character.financial_need_value > 70) {
        insights.push("Financial stress is elevated and may be affecting mood.");
      }
      if (positiveInteractions > conflictEvents * 2) {
        insights.push("Positive social interactions are outweighing conflict right now.");
      }
      if (character.emotional_state === "calm" && character.energy_value > 60) {
        insights.push("Currently in a stable, functional emotional state.");
      }

      // ── Recent memory highlights ──────────────────────────────────────────
      // Use character.memories array (inline) + CharacterMemory entities
      const inlineMemories = (character.memories || []).slice(0, 3).map(m => ({
        title: m.title || "Memory",
        note: m.emotional_impact || m.description || null,
        date: null,
        active: !!m.emotional_impact,
      }));
      const entityMemories = mems.slice(0, 3).map(m => ({
        title: m.title || m.summary || "Memory",
        note: m.emotional_impact || m.description || null,
        date: m.timestamp || m.created_date || null,
        active: m.is_active !== false,
      }));
      const allMemoryHighlights = [...entityMemories, ...inlineMemories].slice(0, 4);

      setData({
        trendData,
        timelineEntries: timelineEntries.slice(0, 12),
        socialStats: { msgsSent, positiveInteractions, conflictEvents },
        insights: insights.slice(0, 4),
        memoryHighlights: allMemoryHighlights,
      });
      setLoaded(true);
      setLoading(false);
    });
  }, [character?.id]); // eslint-disable-line

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const { trendData, timelineEntries, socialStats, insights, memoryHighlights } = data;
  const emotionState = character.emotional_state || "calm";
  const now = format(new Date(), "h:mm aa");

  // Icon renderer for timeline
  const TimelineIcon = ({ type }) => {
    const cls = "w-3.5 h-3.5";
    const icons = {
      moon: <Moon className={cls} />,
      sun: <Sun className={cls} />,
      briefcase: <Briefcase className={cls} />,
      home: <Home className={cls} />,
      mappin: <MapPin className={cls} />,
      heart: <Heart className={cls} />,
      book: <BookOpen className={cls} />,
      dollar: <DollarSign className={cls} />,
      message: <MessageCircle className={cls} />,
      activity: <Activity className={cls} />,
    };
    return icons[type] || <Activity className={cls} />;
  };

  return (
    <div className="space-y-5">

      {/* ── 1. Emotional Trend ─────────────────────────────────────────────── */}
      {trendData.length > 1 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Emotional Trend · This Week</p>
          <div className="bg-secondary/30 rounded-xl p-3" style={{ height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" hide />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 10 }}
                  formatter={(v) => [`${v}%`, "Mood"]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={emotionColor(emotionState)}
                  strokeWidth={1.5}
                  dot={{ r: 2, fill: emotionColor(emotionState), strokeWidth: 0 }}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── 2. Past 24 Hours Timeline ─────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Past 24 Hours</p>
        {timelineEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No recorded activity in the past 24 hours.</p>
        ) : (
          <div className="space-y-1">
            {timelineEntries.map((entry, i) => (
              <div
                key={i}
                className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg border-l-2 ${entryAccent(entry.emotion)}`}
              >
                <div className="mt-0.5 flex-shrink-0 text-muted-foreground">
                  <TimelineIcon type={entry.icon} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-snug">{entry.text}</p>
                  {entry.sub && <p className="text-[10px] text-muted-foreground">{entry.sub}</p>}
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
                  {entry.time && (
                    <span className="text-[9px] text-muted-foreground">{fmtTime(entry.time)}</span>
                  )}
                  {entry.emotion && (
                    <span className="text-[9px] font-medium capitalize" style={{ color: emotionColor(entry.emotion) }}>
                      {entry.emotion}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 3. Current State ──────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Current State</p>
        <div className="bg-secondary/30 rounded-xl p-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            { label: "Emotion", value: emotionState, colored: true },
            { label: "Energy", value: character.energy_value !== undefined ? `${character.energy_value}%` : "—" },
            { label: "Stress", value: character.mental_value !== undefined ? `${100 - character.mental_value}%` : "—" },
            { label: "Hunger", value: character.hunger_value !== undefined ? `${character.hunger_value}%` : "—" },
            { label: "Social Need", value: character.social_value !== undefined ? `${character.social_value}%` : "—" },
            { label: "Location", value: character.resolved_current_location_name || "—" },
            { label: "Time", value: now },
          ].map(({ label, value, colored }) => (
            <div key={label} className="flex items-center justify-between gap-2 col-span-1">
              <span className="text-[10px] text-muted-foreground">{label}</span>
              <span
                className="text-[10px] font-medium capitalize text-right"
                style={colored ? { color: emotionColor(value) } : {}}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. Social Activity ────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Social Activity · Past 24h</p>
        <div className="flex gap-1">
          <StatChip icon={MessageCircle} label="Messages Sent" value={socialStats.msgsSent} />
          <StatChip icon={Heart} label="Positive Interactions" value={socialStats.positiveInteractions} />
          <StatChip icon={Zap} label="Conflict Events" value={socialStats.conflictEvents} />
        </div>
      </div>

      {/* ── 5. Pattern Insights ───────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Pattern Insights</p>
          <div className="space-y-1.5">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-primary/5 border border-primary/10">
                <Brain className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-foreground/80 leading-snug">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 6. Recent Memory Highlights ───────────────────────────────────── */}
      {memoryHighlights.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Recent Memory Highlights</p>
          <div className="space-y-1.5">
            {memoryHighlights.map((mem, i) => (
              <div key={i} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg bg-secondary/30 border border-border">
                <BookOpen className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{mem.title}</p>
                  {mem.note && <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{mem.note}</p>}
                </div>
                {mem.active && (
                  <span className="text-[8px] text-amber-400 font-medium whitespace-nowrap flex-shrink-0 mt-0.5">Still affecting mood</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}