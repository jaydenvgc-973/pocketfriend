import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import {
  LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceDot
} from "recharts";
import {
  Moon, Sun, Briefcase, Home, MessageCircle, DollarSign,
  Heart, MapPin, BookOpen, Brain, Activity, Phone, Zap,
  Coffee, Music, ShoppingBag, AlertCircle
} from "lucide-react";
import { format, subHours, isAfter, parseISO, subDays } from "date-fns";

// ─── Emotion system ──────────────────────────────────────────────────────────
const EMOTION_COLORS = {
  calm: "#34d399", happy: "#fbbf24", joyful: "#fbbf24", excited: "#fbbf24",
  hopeful: "#a78bfa", affectionate: "#f472b6", reflective: "#38bdf8",
  sad: "#60a5fa", lonely: "#60a5fa", anxious: "#a78bfa", stressed: "#f87171",
  angry: "#f87171", irritated: "#f87171", defensive: "#f87171",
  "emotionally drained": "#94a3b8", exhausted: "#94a3b8", "closed-off": "#94a3b8",
  tense: "#f87171", overwhelmed: "#f87171", content: "#34d399",
};

const EMOTION_SCORES = {
  happy: 88, joyful: 85, excited: 88, hopeful: 75, calm: 70, content: 72,
  affectionate: 80, reflective: 58, lonely: 35, sad: 30, anxious: 38,
  stressed: 32, "emotionally drained": 25, exhausted: 20, angry: 15,
  irritated: 28, defensive: 25, tense: 22, overwhelmed: 18, "closed-off": 30,
};

function ec(state) {
  return EMOTION_COLORS[(state || "calm").toLowerCase()] || "#94a3b8";
}
function es(state) {
  return EMOTION_SCORES[(state || "calm").toLowerCase()] ?? 55;
}

// ─── Timeline accent ─────────────────────────────────────────────────────────
function accent(emotion) {
  const e = (emotion || "").toLowerCase();
  if (["anxious", "stressed", "hopeful", "reflective", "tense"].includes(e))
    return "border-l-violet-500/50 bg-violet-500/5";
  if (["angry", "irritated", "defensive", "overwhelmed"].includes(e))
    return "border-l-red-500/50 bg-red-500/5";
  if (["happy", "joyful", "excited", "content", "calm", "affectionate"].includes(e))
    return "border-l-amber-400/50 bg-amber-400/5";
  if (["sad", "lonely", "exhausted", "emotionally drained", "closed-off"].includes(e))
    return "border-l-blue-500/50 bg-blue-500/5";
  return "border-l-border/50 bg-transparent";
}

function fmtTime(iso) {
  if (!iso) return "";
  try { return format(parseISO(iso), "h:mm aa"); } catch { return ""; }
}

// ─── Humanise timeline text ───────────────────────────────────────────────────
function humaniseMessageEntry(msg, participant, convoType, channel) {
  const e = (msg.emotional_state || "").toLowerCase();
  const isWorldPhone = channel === "world_phone";
  const isGroup = convoType === "group";
  const who = participant && participant !== "Unknown contact" && participant !== "Another character"
    ? `with ${participant}` : "";

  if (["irritated", "defensive", "angry", "tense"].includes(e)) {
    return who ? `Tense exchange ${who}` : "Conflict caused emotional tension";
  }
  if (e === "reflective") {
    return who ? `Reflective conversation ${who}` : "Reached out in a reflective moment";
  }
  if (["sad", "lonely"].includes(e)) {
    return who ? `Reached out while feeling low ${who}` : "Sent a message while feeling withdrawn";
  }
  if (["happy", "joyful", "excited", "content"].includes(e)) {
    return who ? `Positive exchange ${who}` : "Uplifting social interaction";
  }
  if (e === "calm") {
    return who ? `Calm conversation ${who}` : "Quiet social check-in";
  }
  if (e === "anxious") {
    return who ? `Anxious message ${who}` : "Reached out while feeling unsettled";
  }
  if (isWorldPhone) return who ? `World Phone conversation ${who}` : "World Phone message";
  if (isGroup) return "Participated in a group conversation";
  return who ? `Exchanged messages ${who}` : "Quiet social interaction";
}

// ─── Stat chip ───────────────────────────────────────────────────────────────
function StatChip({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1 py-2">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span className="text-lg font-bold text-foreground leading-none">{value}</span>
      <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Custom tooltip for trend graph ──────────────────────────────────────────
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-[10px] shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground">{p.name}: {p.value}%</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CharacterDashboard({ character }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || loading || !character?.id) return;
    setLoading(true);

    const charId = character.id;
    const ownerEmail = character.owner_email;
    const cutoff24h = subHours(new Date(), 24).toISOString();
    const cutoff7d = subDays(new Date(), 7).toISOString();

    Promise.allSettled([
      base44.entities.Message.filter({ character_id: charId }, "-created_date", 100),
      base44.entities.FinancialTransaction.filter({ character_id: charId }, "-timestamp", 30),
      base44.entities.AutomaticNarrative
        ? base44.entities.AutomaticNarrative.filter({ character_id: charId }, "-timestamp", 60).catch(() => [])
        : Promise.resolve([]),
      ownerEmail
        ? base44.entities.Conversation.filter({ owner_email: ownerEmail, character_ids: [charId] }, "-updated_date", 80).catch(() => [])
        : Promise.resolve([]),
    ]).then(([msgsR, txR, narrR, convosR]) => {
      const msgs = msgsR.status === "fulfilled" ? (msgsR.value || []) : [];
      const txns = txR.status === "fulfilled" ? (txR.value || []) : [];
      const narrs = narrR.status === "fulfilled" ? (narrR.value || []) : [];
      const convos = convosR.status === "fulfilled" ? (convosR.value || []) : [];

      // ── Conversation lookup map ──────────────────────────────────────────
      const convoMap = {};
      convos.forEach(c => { convoMap[c.id] = c; });

      // ── Relationship name lookup from character data ──────────────────────
      const relById = {};
      (character.fictional_relationships || []).forEach(r => {
        if (r.related_character_id && r.person_name) relById[r.related_character_id] = r.person_name;
      });
      (character.family_members || []).forEach(m => {
        if (m.character_id && m.name) relById[m.character_id] = m.name;
      });

      // ── Resolve participant name for a message ────────────────────────────
      const resolveParticipant = (msg) => {
        // Direct name on message (the other character's name field)
        if (msg.character_name && msg.character_id !== charId) return msg.character_name;
        // World phone fields
        if (msg.sender_character_id && msg.sender_character_id !== charId && relById[msg.sender_character_id])
          return relById[msg.sender_character_id];
        if (msg.receiver_character_id && msg.receiver_character_id !== charId && relById[msg.receiver_character_id])
          return relById[msg.receiver_character_id];
        // From conversation title (non-system titles only)
        const convo = convoMap[msg.conversation_id];
        if (convo) {
          const t = convo.title || "";
          const isSystem = !t || t.startsWith("npc_chat__") || t.startsWith("bilateral_") || /^[a-f0-9-]{36}/.test(t);
          if (!isSystem) return t;
          if (convo.type === "group") return null; // group — no single name
          // Try other character IDs in convo
          const others = (convo.character_ids || []).filter(id => id !== charId);
          for (const id of others) { if (relById[id]) return relById[id]; }
        }
        return null;
      };

      // ── Filter to time windows ───────────────────────────────────────────
      const msgs24h = msgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff24h)));
      const txns24h = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff24h)));
      const narrs24h = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff24h)));
      const narrs7d = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff7d)));
      const msgs7d = msgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff7d)));

      // ── Social stats ─────────────────────────────────────────────────────
      const charMsgs24h = msgs24h.filter(m => m.sender_type === "character");
      const msgsSent = charMsgs24h.length;
      const positiveInteractions = charMsgs24h.filter(m =>
        ["calm", "happy", "joyful", "excited", "content", "affectionate"].includes((m.emotional_state || "").toLowerCase())
      ).length;
      const conflictEvents = charMsgs24h.filter(m =>
        ["irritated", "defensive", "angry", "tense"].includes((m.emotional_state || "").toLowerCase())
      ).length;

      // ── Build 24h timeline ───────────────────────────────────────────────
      const raw = [];

      // Sleep / wake
      if (character.last_sleep_start && isAfter(parseISO(character.last_sleep_start), parseISO(cutoff24h))) {
        raw.push({ time: character.last_sleep_start, icon: "moon", text: "Went to sleep", emotion: "exhausted", sub: null });
      }
      if (character.alarm_woke_at && isAfter(parseISO(character.alarm_woke_at), parseISO(cutoff24h))) {
        raw.push({ time: character.alarm_woke_at, icon: "sun", text: "Woke up", emotion: "calm", sub: null });
      }

      // Narratives (use narrative_text directly — it's already human-written)
      narrs24h.forEach(n => {
        const iconMap = { sleep: "moon", wake: "sun", work_start: "briefcase", work_end: "home",
          travel_arrival: "mappin", travel_departure: "mappin", social_event: "heart", catch_up_summary: "book" };
        const text = n.narrative_text?.substring(0, 100);
        if (!text) return;
        raw.push({
          time: n.timestamp, icon: iconMap[n.event_type] || "activity",
          text, emotion: n.emotional_state || character.emotional_state || "calm", sub: null,
        });
      });

      // Financial events
      txns24h.forEach(t => {
        const desc = t.description;
        if (!desc) return;
        raw.push({
          time: t.timestamp, icon: "dollar",
          text: desc,
          emotion: t.direction === "expense" ? "stressed" : "calm",
          sub: t.location_name || null,
        });
      });

      // Message interactions — one entry per conversation, most significant message
      const convoMsgMap = {};
      msgs24h.filter(m => m.sender_type === "character" && m.emotional_state).forEach(m => {
        const existing = convoMsgMap[m.conversation_id];
        const priority = { angry: 4, irritated: 4, defensive: 4, tense: 4, anxious: 3, sad: 3, lonely: 3, reflective: 2, happy: 1, calm: 1 };
        const p = (s) => priority[(s || "").toLowerCase()] || 0;
        if (!existing || p(m.emotional_state) > p(existing.emotional_state)) convoMsgMap[m.conversation_id] = m;
      });
      Object.values(convoMsgMap).slice(0, 7).forEach(m => {
        const convo = convoMap[m.conversation_id];
        const participant = resolveParticipant(m);
        const text = humaniseMessageEntry(m, participant, convo?.type, convo?.channel);
        raw.push({ time: m.created_date, icon: "message", text, emotion: m.emotional_state, sub: null });
      });

      // Sort chronologically
      raw.sort((a, b) => { try { return new Date(a.time) - new Date(b.time); } catch { return 0; } });
      const timelineEntries = raw.slice(0, 12);

      // ── Emotional trend graph (7 days, multi-line) ────────────────────────
      // Build per-day emotional signals from messages + narratives
      const dayEmotions = {}; // { "MM/dd": { happy: [], calm: [], anxious: [], sad: [], angry: [] } }
      const emotionGroups = {
        happy: ["happy", "joyful", "excited", "content", "affectionate"],
        calm: ["calm", "hopeful", "reflective"],
        anxious: ["anxious", "stressed", "overwhelmed"],
        sad: ["sad", "lonely", "emotionally drained", "exhausted", "closed-off"],
        angry: ["angry", "irritated", "defensive", "tense"],
      };
      const groupColors = {
        happy: "#fbbf24", calm: "#34d399", anxious: "#a78bfa", sad: "#60a5fa", angry: "#f87171"
      };

      const addEmotionToDay = (isoDate, emotionState) => {
        if (!isoDate || !emotionState) return;
        try {
          const day = format(parseISO(isoDate), "MM/dd");
          if (!dayEmotions[day]) dayEmotions[day] = { happy: [], calm: [], anxious: [], sad: [], angry: [] };
          const e = emotionState.toLowerCase();
          for (const [group, members] of Object.entries(emotionGroups)) {
            if (members.includes(e)) { dayEmotions[day][group].push(es(e)); break; }
          }
        } catch {}
      };

      narrs7d.forEach(n => addEmotionToDay(n.timestamp, n.emotional_state || character.emotional_state));
      msgs7d.filter(m => m.emotional_state).forEach(m => addEmotionToDay(m.created_date, m.emotional_state));

      // Ensure today always has at least a current state data point
      const today = format(new Date(), "MM/dd");
      if (!dayEmotions[today]) dayEmotions[today] = { happy: [], calm: [], anxious: [], sad: [], angry: [] };
      const currentE = (character.emotional_state || "calm").toLowerCase();
      for (const [group, members] of Object.entries(emotionGroups)) {
        if (members.includes(currentE)) { dayEmotions[today][group].push(es(currentE)); break; }
      }

      // Convert to chart data
      const trendData = Object.entries(dayEmotions)
        .map(([day, groups]) => {
          const point = { day };
          for (const [group, values] of Object.entries(groups)) {
            point[group] = values.length > 0
              ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
              : undefined;
          }
          return point;
        })
        .sort((a, b) => { try { return new Date("2026/" + a.day) - new Date("2026/" + b.day); } catch { return 0; } })
        .slice(-7);

      // Only show groups that have any data
      const activeGroups = Object.keys(emotionGroups).filter(g =>
        trendData.some(d => d[g] !== undefined)
      );

      // ── Pattern insights from real signals ───────────────────────────────
      const insights = [];
      if (conflictEvents > 0 && (character.work_start_time || character.occupation)) {
        insights.push("Tension tends to surface on or around work days.");
      }
      if ((character.social_value ?? 100) < 40) {
        insights.push("Social needs are running low — isolation may be building.");
      }
      if ((character.sleep_debt_hours ?? 0) > 2 || (character.energy_value ?? 100) < 30) {
        insights.push("Sleep is becoming disrupted — energy and mood are affected.");
      }
      if ((character.mental_value ?? 100) < 40) {
        insights.push("Mental health is under strain. Rest and connection may help.");
      }
      if ((character.financial_need_value ?? 0) > 65) {
        insights.push("Financial pressure is elevated and likely affecting emotional state.");
      }
      if (positiveInteractions > 0 && positiveInteractions > conflictEvents) {
        insights.push("Positive interactions are currently outweighing conflict.");
      }
      if (conflictEvents > positiveInteractions && conflictEvents > 0) {
        insights.push("More conflict than positive connection recently — emotional cost may be accumulating.");
      }
      if ((character.hunger_value ?? 100) < 30) {
        insights.push("Physical needs like hunger are unmet, adding emotional strain.");
      }
      if (character.is_jailed) {
        insights.push("Current confinement is likely affecting emotional state and social access.");
      }

      // ── Memory highlights — skip generic/empty entries ────────────────────
      const inlineMemories = (character.memories || [])
        .filter(m => {
          const title = (m.title || "").toLowerCase().trim();
          if (!title || title === "memory" || title === "a memory" || title === "untitled") return false;
          return !!(m.emotional_impact || m.description);
        })
        .slice(0, 3)
        .map(m => ({ title: m.title, note: m.emotional_impact || m.description || null, active: !!m.emotional_impact }));

      setData({
        trendData,
        activeGroups,
        groupColors,
        timelineEntries,
        socialStats: { msgsSent, positiveInteractions, conflictEvents },
        insights: insights.slice(0, 4),
        memoryHighlights: inlineMemories,
      });
      setLoaded(true);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [character?.id]); // eslint-disable-line

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  const { trendData, activeGroups, groupColors, timelineEntries, socialStats, insights, memoryHighlights } = data;
  const emotionState = character.emotional_state || "calm";
  const now = format(new Date(), "h:mm aa");
  const hasTrend = trendData.length >= 2 && activeGroups.length > 0;

  const TimelineIcon = ({ type }) => {
    const cls = "w-3.5 h-3.5";
    const map = {
      moon: <Moon className={cls} />, sun: <Sun className={cls} />,
      briefcase: <Briefcase className={cls} />, home: <Home className={cls} />,
      mappin: <MapPin className={cls} />, heart: <Heart className={cls} />,
      book: <BookOpen className={cls} />, dollar: <DollarSign className={cls} />,
      message: <MessageCircle className={cls} />, activity: <Activity className={cls} />,
      phone: <Phone className={cls} />,
    };
    return map[type] || <Activity className={cls} />;
  };

  // Stress is inverse of mental_value
  const stressVal = character.mental_value !== undefined ? 100 - character.mental_value : undefined;
  const needsLabel = (val, thresholds) => {
    if (val === undefined) return "—";
    if (val >= thresholds[0]) return "Good";
    if (val >= thresholds[1]) return "Medium";
    return "Low";
  };
  const stressLabel = (val) => {
    if (val === undefined) return "—";
    if (val < 30) return "Low";
    if (val < 60) return "Moderate";
    return "Elevated";
  };

  return (
    <div className="space-y-4">

      {/* ── 1. Emotional Trend Graph ────────────────────────────────────────── */}
      <div className="rounded-xl bg-card/60 border border-border overflow-hidden">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Emotional Trend · This Week</p>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {activeGroups.map(g => (
              <div key={g} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: groupColors[g] }} />
                <span className="text-[9px] text-muted-foreground capitalize">{g}</span>
              </div>
            ))}
          </div>
        </div>
        {hasTrend ? (
          <div style={{ height: 120 }} className="px-1 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} hide />
                <Tooltip content={<TrendTooltip />} />
                {activeGroups.map(g => (
                  <Line
                    key={g}
                    type="monotone"
                    dataKey={g}
                    name={g.charAt(0).toUpperCase() + g.slice(1)}
                    stroke={groupColors[g]}
                    strokeWidth={1.5}
                    dot={{ r: 2.5, fill: groupColors[g], strokeWidth: 0 }}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="px-4 pb-4 pt-1">
            <p className="text-xs text-muted-foreground italic">
              Emotional trend builds as activity is recorded. Check back after more interactions.
            </p>
          </div>
        )}
      </div>

      {/* ── 2. Past 24 Hours + Current State (side-by-side on larger, stacked on mobile) ── */}
      <div className="grid grid-cols-1 gap-4">

        {/* Timeline */}
        <div className="rounded-xl bg-card/60 border border-border">
          <div className="px-4 pt-3 pb-2 border-b border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Past 24 Hours</p>
          </div>
          {timelineEntries.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground italic">No recorded activity in the past 24 hours.</p>
          ) : (
            <div className="divide-y divide-border/30">
              {timelineEntries.map((entry, i) => (
                <div key={i} className={`flex items-start gap-3 px-3 py-2.5 border-l-2 ${accent(entry.emotion)}`}>
                  <div className="flex-shrink-0 mt-0.5 text-muted-foreground">
                    <TimelineIcon type={entry.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-snug">{entry.text}</p>
                    {entry.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{entry.sub}</p>}
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-0.5 ml-2">
                    {entry.time && <span className="text-[9px] text-muted-foreground whitespace-nowrap">{fmtTime(entry.time)}</span>}
                    {entry.emotion && (
                      <span className="text-[9px] font-semibold capitalize whitespace-nowrap" style={{ color: ec(entry.emotion) }}>
                        {entry.emotion}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Current State */}
        <div className="rounded-xl bg-card/60 border border-border">
          <div className="px-4 pt-3 pb-2 border-b border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current State</p>
          </div>
          <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
            {[
              { label: "Emotion", value: emotionState, colored: true },
              { label: "Energy", value: character.energy_value !== undefined ? `${character.energy_value}%` : "—" },
              { label: "Stress", value: stressLabel(stressVal) },
              { label: "Social Need", value: needsLabel(character.social_value, [60, 35]) },
              { label: "Hunger", value: character.hunger_value !== undefined ? `${character.hunger_value}%` : "—" },
              { label: "Location", value: character.resolved_current_location_name || "—" },
              { label: "Time", value: now },
            ].map(({ label, value, colored }) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">{label}</span>
                <span
                  className="text-[10px] font-semibold capitalize text-right"
                  style={colored ? { color: ec(value) } : { color: "hsl(var(--foreground))" }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* Social stats inside current state card — matches reference layout */}
          <div className="border-t border-border/50 px-4 pt-2 pb-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Social Activity · Past 24h</p>
            <div className="flex gap-0">
              <StatChip icon={MessageCircle} label="Messages Sent" value={socialStats.msgsSent} />
              <StatChip icon={Heart} label="Positive Interactions" value={socialStats.positiveInteractions} />
              <StatChip icon={Zap} label="Conflict Events" value={socialStats.conflictEvents} />
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Pattern Insights + Memory Highlights ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-4">

        {/* Pattern Insights */}
        {insights.length > 0 && (
          <div className="rounded-xl bg-card/60 border border-border">
            <div className="px-4 pt-3 pb-2 border-b border-border/50">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pattern Insights</p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {insights.map((insight, i) => (
                <div key={i} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg bg-primary/5 border border-primary/10">
                  <Brain className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground/80 leading-snug">{insight}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Memory Highlights */}
        {memoryHighlights.length > 0 && (
          <div className="rounded-xl bg-card/60 border border-border">
            <div className="px-4 pt-3 pb-2 border-b border-border/50">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recent Memory Highlights</p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {memoryHighlights.map((mem, i) => (
                <div key={i} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg bg-secondary/40 border border-border/60">
                  <BookOpen className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground leading-snug">{mem.title}</p>
                    {mem.note && <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{mem.note}</p>}
                  </div>
                  {mem.active && (
                    <span className="text-[8px] text-amber-400 font-semibold whitespace-nowrap flex-shrink-0 mt-0.5">Still affecting mood</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {memoryHighlights.length === 0 && insights.length === 0 && (
          <p className="text-xs text-muted-foreground italic px-1">
            More behavioral patterns will appear as activity is recorded.
          </p>
        )}
      </div>

    </div>
  );
}