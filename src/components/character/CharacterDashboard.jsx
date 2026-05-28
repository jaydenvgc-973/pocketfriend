import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import {
  LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceDot
} from "recharts";
import {
  Moon, Sun, Briefcase, Home, MessageCircle, Phone,
  DollarSign, Heart, MapPin, Zap, BookOpen, Brain,
  Activity, Coffee, AlertTriangle, Users, Clock
} from "lucide-react";
import { format, subHours, isAfter, parseISO, subDays } from "date-fns";

// ── Emotion → numeric mood score ────────────────────────────────────────────
const EMOTION_SCORE = {
  happy: 88, joyful: 90, excited: 85, hopeful: 78, affectionate: 80,
  calm: 70, content: 72, reflective: 58,
  lonely: 32, sad: 28, anxious: 38, stressed: 35,
  "emotionally drained": 22, exhausted: 18, "closed-off": 30,
  irritated: 30, defensive: 25, angry: 15,
};
const emotionScore = (s) => EMOTION_SCORE[(s || "").toLowerCase()] ?? 55;

// ── Emotion → hex colour ─────────────────────────────────────────────────────
const EMOTION_HEX = {
  calm: "#34d399", happy: "#fbbf24", joyful: "#fbbf24", excited: "#fbbf24",
  hopeful: "#a78bfa", affectionate: "#f472b6", reflective: "#38bdf8",
  content: "#34d399", sad: "#60a5fa", lonely: "#60a5fa",
  anxious: "#a78bfa", stressed: "#f87171", angry: "#f87171",
  irritated: "#f87171", defensive: "#f87171",
  "emotionally drained": "#94a3b8", exhausted: "#94a3b8", "closed-off": "#94a3b8",
};
const eColor = (s) => EMOTION_HEX[(s || "").toLowerCase()] || "#94a3b8";

// ── Timeline entry border/bg glow ────────────────────────────────────────────
const entryAccent = (emotion) => {
  const e = (emotion || "").toLowerCase();
  if (["anxious", "stressed", "hopeful", "reflective"].includes(e)) return "border-l-violet-500/50 bg-violet-500/5";
  if (["angry", "irritated", "defensive"].includes(e)) return "border-l-red-500/50 bg-red-500/5";
  if (["happy", "joyful", "excited", "calm", "content"].includes(e)) return "border-l-amber-400/40 bg-amber-400/5";
  if (["sad", "lonely", "exhausted", "emotionally drained"].includes(e)) return "border-l-blue-500/50 bg-blue-500/5";
  return "border-l-border/40 bg-transparent";
};

// ── Format time ──────────────────────────────────────────────────────────────
const fmtTime = (iso) => {
  if (!iso) return "";
  try { return format(parseISO(iso), "h:mm aa"); } catch { return ""; }
};

// ── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1 py-3">
      <Icon className="w-5 h-5 text-muted-foreground" />
      <span className="text-lg font-bold text-foreground">{value}</span>
      <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Timeline icon map ─────────────────────────────────────────────────────────
const TIMELINE_ICONS = {
  moon: Moon, sun: Sun, briefcase: Briefcase, home: Home,
  mappin: MapPin, heart: Heart, book: BookOpen, dollar: DollarSign,
  message: MessageCircle, phone: Phone, users: Users, activity: Activity,
  coffee: Coffee, alert: AlertTriangle,
};
const TIcon = ({ type, className = "w-3.5 h-3.5" }) => {
  const I = TIMELINE_ICONS[type] || Activity;
  return <I className={className} />;
};

// ── Determine if a memory title/note is meaningful ───────────────────────────
const isMeaningfulMemory = (m) => {
  const title = (m.title || "").trim().toLowerCase();
  const note = (m.note || m.description || m.emotional_impact || "").trim();
  if (!title || title === "memory" || title === "key memory") return false;
  if (title.length < 5) return false;
  return true;
};

// ── Human-readable timeline text from message data ───────────────────────────
const buildMessageText = (msg, convoNameMap, convos, charId) => {
  const emotion = (msg.emotional_state || "").toLowerCase();
  const convo = convos.find(c => c.id === msg.conversation_id);
  const channel = convo?.channel || "";
  const isWorldPhone = channel === "world_phone";
  const isGroup = convo?.type === "group";
  const participant = convoNameMap[msg.conversation_id];

  // Pick human phrasing based on emotion + context
  if (isGroup) return "Participated in a group conversation";
  if (isWorldPhone && participant) return `World Phone exchange with ${participant}`;

  if (!participant) {
    if (emotion === "reflective") return "Sent a reflective message";
    if (["angry", "irritated", "defensive"].includes(emotion)) return "Had a tense exchange";
    if (["sad", "lonely"].includes(emotion)) return "Reached out while feeling low";
    if (["happy", "joyful", "excited"].includes(emotion)) return "Had an uplifting conversation";
    if (emotion === "anxious") return "Messaged someone while feeling anxious";
    return "Sent a message";
  }

  if (["angry", "irritated", "defensive"].includes(emotion)) return `Conflict caused tension with ${participant}`;
  if (emotion === "reflective") return `Had a reflective conversation with ${participant}`;
  if (["sad", "lonely"].includes(emotion)) return `Reached out to ${participant} while feeling low`;
  if (["happy", "joyful", "excited"].includes(emotion)) return `Uplifting exchange with ${participant}`;
  if (["calm", "content"].includes(emotion)) return `Had a calm conversation with ${participant}`;
  if (emotion === "anxious") return `Messaged ${participant} while feeling anxious`;
  return `Exchanged messages with ${participant}`;
};

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
      base44.entities.FinancialTransaction.filter({ character_id: charId }, "-timestamp", 20),
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

      // ── Build conversation → participant name map ─────────────────────────
      const relNameMap = {};
      (character.fictional_relationships || []).forEach(r => {
        if (r.related_character_id) relNameMap[r.related_character_id] = r.person_name;
      });

      const isSystemTitle = (t) =>
        !t || t.startsWith("npc_chat__") || t.startsWith("bilateral_") ||
        t.startsWith("world_phone_") || /^[a-f0-9-]{36}/.test(t);

      const convoNameMap = {};
      convos.forEach(c => {
        if (c.type === "group") { convoNameMap[c.id] = "a group"; return; }
        if (!isSystemTitle(c.title)) { convoNameMap[c.id] = c.title; return; }
        // Try other character IDs in this convo
        const otherIds = (c.character_ids || []).filter(id => id !== charId);
        for (const id of otherIds) {
          if (relNameMap[id]) { convoNameMap[c.id] = relNameMap[id]; break; }
        }
      });

      // Enrich from message fields
      msgs.forEach(m => {
        if (convoNameMap[m.conversation_id]) return;
        if (m.character_name && m.character_id !== charId) {
          convoNameMap[m.conversation_id] = m.character_name;
        } else if (m.played_as_character_name && m.played_as_character_id !== charId) {
          convoNameMap[m.conversation_id] = m.played_as_character_name;
        }
      });

      // ── Filter to 24h / 7d ───────────────────────────────────────────────
      const msgs24h = msgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff24h)));
      const txns24h = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff24h)));
      const narrs7d = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff7d)));
      const narrs24h = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff24h)));

      // ── Social stats ─────────────────────────────────────────────────────
      const charMsgs24h = msgs24h.filter(m => m.sender_type === "character");
      const msgsSent = charMsgs24h.length;
      const positiveInteractions = charMsgs24h.filter(m =>
        ["calm", "happy", "joyful", "excited", "content", "affectionate"].includes((m.emotional_state || "").toLowerCase())
      ).length;
      const conflictEvents = charMsgs24h.filter(m =>
        ["irritated", "defensive", "angry"].includes((m.emotional_state || "").toLowerCase())
      ).length;

      // ── Build emotional trend data (7 days, multi-signal) ─────────────────
      // We track: mood (happy/calm), tension (angry/stressed), sadness, anxiety
      const dayBuckets = {}; // day → { events: [{emotion, score, type}] }

      const addToBucket = (isoTime, emotion, type) => {
        if (!isoTime) return;
        try {
          const day = format(parseISO(isoTime), "MM/dd");
          if (!dayBuckets[day]) dayBuckets[day] = [];
          dayBuckets[day].push({ emotion, score: emotionScore(emotion), type });
        } catch {}
      };

      // From narratives
      narrs7d.forEach(n => addToBucket(n.timestamp, n.emotional_state || character.emotional_state, "narrative"));
      // From messages
      msgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff7d)))
        .filter(m => m.sender_type === "character" && m.emotional_state)
        .forEach(m => addToBucket(m.created_date, m.emotional_state, "message"));
      // From transactions (financial stress)
      txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff7d)) && t.direction === "expense")
        .forEach(t => addToBucket(t.timestamp, "stressed", "financial"));

      // Today — anchor from current character state
      const today = format(new Date(), "MM/dd");
      if (!dayBuckets[today]) dayBuckets[today] = [];
      dayBuckets[today].push({ emotion: character.emotional_state || "calm", score: emotionScore(character.emotional_state), type: "current" });

      // Sleep disruption signal
      if (character.sleep_debt_hours > 2) {
        dayBuckets[today].push({ emotion: "exhausted", score: 20, type: "sleep" });
      }
      // Financial stress signal
      if (character.financial_need_value > 70) {
        dayBuckets[today].push({ emotion: "stressed", score: 30, type: "financial" });
      }

      // Build trend points per day: average mood, also compute calm/tension split
      const trendData = Object.entries(dayBuckets)
        .map(([day, events]) => {
          const all = events.map(e => e.score);
          const positiveEvts = events.filter(e => emotionScore(e.emotion) >= 65);
          const tensionEvts = events.filter(e => ["angry","irritated","defensive","stressed"].includes((e.emotion||"").toLowerCase()));
          const sadEvts = events.filter(e => ["sad","lonely","exhausted","emotionally drained"].includes((e.emotion||"").toLowerCase()));
          const anxEvts = events.filter(e => ["anxious","hopeful","reflective"].includes((e.emotion||"").toLowerCase()));

          const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

          return {
            day,
            mood: avg(all),
            calm: positiveEvts.length ? avg(positiveEvts.map(e => e.score)) : null,
            tension: tensionEvts.length ? avg(tensionEvts.map(e => e.score)) + 20 : null,
            sad: sadEvts.length ? avg(sadEvts.map(e => e.score)) + 15 : null,
            anxious: anxEvts.length ? avg(anxEvts.map(e => e.score)) + 10 : null,
            eventCount: events.length,
          };
        })
        .sort((a, b) => {
          try { return new Date("2026/" + a.day) - new Date("2026/" + b.day); } catch { return 0; }
        })
        .slice(-7);

      // ── Event markers for graph (spikes/notable moments) ──────────────────
      const graphMarkers = [];
      narrs24h.forEach(n => {
        try {
          const day = format(parseISO(n.timestamp), "MM/dd");
          const idx = trendData.findIndex(d => d.day === day);
          if (idx >= 0 && n.emotional_state) {
            graphMarkers.push({ x: day, y: emotionScore(n.emotional_state), emotion: n.emotional_state, label: n.event_type?.replace(/_/g, " ") });
          }
        } catch {}
      });

      // ── Build timeline entries ────────────────────────────────────────────
      const timelineEntries = [];

      // Sleep events
      if (character.last_sleep_start && isAfter(parseISO(character.last_sleep_start), parseISO(cutoff24h))) {
        timelineEntries.push({ time: character.last_sleep_start, icon: "moon", text: "Went to sleep", emotion: "exhausted", sub: null });
      }
      if (character.alarm_woke_at && isAfter(parseISO(character.alarm_woke_at), parseISO(cutoff24h))) {
        timelineEntries.push({ time: character.alarm_woke_at, icon: "sun", text: "Woke up", emotion: "calm", sub: null });
      }

      // Narrative events — use the narrative text directly (it's already human-readable)
      narrs24h.forEach(n => {
        const iconMap = {
          sleep: "moon", wake: "sun", work_start: "briefcase", work_end: "home",
          travel_arrival: "mappin", travel_departure: "mappin",
          social_event: "heart", catch_up_summary: "book", location_change: "mappin",
          needs_warning: "alert", passive_time: "activity",
        };
        // Use the narrative text — it's written by the LLM, so it's already human-readable
        const rawText = n.narrative_text?.substring(0, 100);
        timelineEntries.push({
          time: n.timestamp,
          icon: iconMap[n.event_type] || "activity",
          text: rawText || n.event_type?.replace(/_/g, " "),
          emotion: n.emotional_state || character.emotional_state || "calm",
          sub: null,
        });
      });

      // Financial events
      txns24h.forEach(t => {
        timelineEntries.push({
          time: t.timestamp,
          icon: "dollar",
          text: t.description || (t.direction === "income" ? "Received money" : "Spent money"),
          emotion: t.direction === "expense" ? "stressed" : "calm",
          sub: t.location_name || null,
        });
      });

      // Message events — deduplicated per conversation, human phrasing, no raw field exposure
      const convoMsgMap = {};
      charMsgs24h.filter(m => m.emotional_state).forEach(m => {
        const existing = convoMsgMap[m.conversation_id];
        if (!existing) { convoMsgMap[m.conversation_id] = m; return; }
        const priority = { angry: 4, irritated: 4, defensive: 4, sad: 3, anxious: 3, reflective: 2, happy: 1, calm: 1 };
        const p = s => priority[(s || "").toLowerCase()] || 0;
        if (p(m.emotional_state) > p(existing.emotional_state)) convoMsgMap[m.conversation_id] = m;
      });

      Object.values(convoMsgMap).slice(0, 7).forEach(m => {
        timelineEntries.push({
          time: m.created_date,
          icon: "message",
          text: buildMessageText(m, convoNameMap, convos, charId),
          emotion: m.emotional_state,
          sub: null,
        });
      });

      // Sort all by time
      timelineEntries.sort((a, b) => {
        try { return new Date(a.time) - new Date(b.time); } catch { return 0; }
      });

      // ── Pattern insights ──────────────────────────────────────────────────
      const insights = [];
      if (conflictEvents > 0 && character.work_start_time) insights.push("Emotional tension tends to appear around work-related stress.");
      if ((character.social_value ?? 100) < 40) insights.push("Social needs are low — isolation may be building up.");
      if ((character.sleep_debt_hours ?? 0) > 2) insights.push("Sleep pattern is becoming unstable. Rest and recovery needed.");
      if ((character.mental_value ?? 100) < 40) insights.push("Mental health is under strain. Connection and rest may help.");
      if ((character.financial_need_value ?? 0) > 70) insights.push("Financial stress is elevated and may be shaping mood.");
      if (positiveInteractions > conflictEvents * 2 && positiveInteractions > 0) insights.push("Positive social interactions are outweighing conflict right now.");
      if (character.emotional_state === "calm" && (character.energy_value ?? 0) > 60) insights.push("Currently in a stable emotional state.");
      if ((character.energy_value ?? 100) < 25) insights.push("Energy is critically low — exhaustion is likely affecting behavior.");
      if (msgsSent === 0) insights.push("No communication activity in the past 24 hours. Social withdrawal possible.");

      // ── Memory highlights — skip generic/placeholder entries ──────────────
      const rawMemories = [
        ...(character.memories || []).map(m => ({
          title: m.title || "",
          note: m.emotional_impact || m.description || "",
          active: !!m.emotional_impact,
          date: null,
        })),
      ].filter(isMeaningfulMemory).slice(0, 4);

      setData({
        trendData,
        graphMarkers,
        timelineEntries: timelineEntries.slice(0, 12),
        socialStats: { msgsSent, positiveInteractions, conflictEvents },
        insights: insights.slice(0, 4),
        memoryHighlights: rawMemories,
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

  const { trendData, graphMarkers, timelineEntries, socialStats, insights, memoryHighlights } = data;
  const emotionState = character.emotional_state || "calm";
  const now = format(new Date(), "h:mm aa");

  // Lines to draw — only draw a line if there's at least one non-null value
  const hasCalm = trendData.some(d => d.calm != null);
  const hasTension = trendData.some(d => d.tension != null);
  const hasSad = trendData.some(d => d.sad != null);
  const hasAnxious = trendData.some(d => d.anxious != null);
  const hasMood = trendData.some(d => d.mood != null);

  // Always show graph if we have at least 2 data points
  const showGraph = trendData.length >= 2;

  return (
    <div className="space-y-4">

      {/* ── 1. EMOTIONAL TREND GRAPH ──────────────────────────────────────── */}
      {showGraph && (
        <div className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <div className="px-4 pt-4 pb-1 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Emotional Trend · This Week</p>
            <div className="flex items-center gap-3">
              {hasCalm && <span className="flex items-center gap-1 text-[9px] text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Mood</span>}
              {hasTension && <span className="flex items-center gap-1 text-[9px] text-red-400"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Tension</span>}
              {hasSad && <span className="flex items-center gap-1 text-[9px] text-blue-400"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Sadness</span>}
              {hasAnxious && <span className="flex items-center gap-1 text-[9px] text-violet-400"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />Anxious</span>}
            </div>
          </div>
          <div style={{ height: 140 }} className="px-1 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 8, fontSize: 10, padding: "6px 10px",
                  }}
                  formatter={(v, name) => v != null ? [`${v}%`, name] : [null, name]}
                  labelFormatter={(l) => `${l}`}
                />
                {/* Main mood line — always show if we have mood */}
                {hasMood && (
                  <Line type="monotone" dataKey="mood" name="Overall"
                    stroke={eColor(emotionState)} strokeWidth={2}
                    dot={{ r: 3, fill: eColor(emotionState), strokeWidth: 0 }}
                    activeDot={{ r: 4 }} connectNulls />
                )}
                {hasCalm && (
                  <Line type="monotone" dataKey="calm" name="Mood"
                    stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="0"
                    dot={{ r: 2.5, fill: "#fbbf24", strokeWidth: 0 }}
                    activeDot={{ r: 3.5 }} connectNulls />
                )}
                {hasTension && (
                  <Line type="monotone" dataKey="tension" name="Tension"
                    stroke="#f87171" strokeWidth={1.5}
                    dot={{ r: 2.5, fill: "#f87171", strokeWidth: 0 }}
                    activeDot={{ r: 3.5 }} connectNulls />
                )}
                {hasSad && (
                  <Line type="monotone" dataKey="sad" name="Sadness"
                    stroke="#60a5fa" strokeWidth={1.5}
                    dot={{ r: 2.5, fill: "#60a5fa", strokeWidth: 0 }}
                    activeDot={{ r: 3.5 }} connectNulls />
                )}
                {hasAnxious && (
                  <Line type="monotone" dataKey="anxious" name="Anxious"
                    stroke="#a78bfa" strokeWidth={1.5}
                    dot={{ r: 2.5, fill: "#a78bfa", strokeWidth: 0 }}
                    activeDot={{ r: 3.5 }} connectNulls />
                )}
                {/* Event markers */}
                {graphMarkers.slice(0, 5).map((m, i) => (
                  <ReferenceDot key={i} x={m.x} y={m.y}
                    r={4} fill={eColor(m.emotion)} stroke="hsl(var(--background))" strokeWidth={1.5} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── 2. TWO-COLUMN: TIMELINE + CURRENT STATE ──────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">

        {/* Past 24 Hours — wider column */}
        <div className="sm:col-span-3 rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Past 24 Hours</p>
          </div>
          {timelineEntries.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground italic">No recorded activity in the past 24 hours.</p>
          ) : (
            <div className="divide-y divide-border/40">
              {timelineEntries.map((entry, i) => (
                <div key={i} className={`flex items-start gap-2.5 px-4 py-2.5 border-l-2 ${entryAccent(entry.emotion)}`}>
                  <div className="mt-0.5 flex-shrink-0 text-muted-foreground">
                    <TIcon type={entry.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-snug">{entry.text}</p>
                    {entry.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{entry.sub}</p>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {entry.time && <p className="text-[9px] text-muted-foreground">{fmtTime(entry.time)}</p>}
                    {entry.emotion && (
                      <p className="text-[9px] font-medium capitalize" style={{ color: eColor(entry.emotion) }}>
                        {entry.emotion}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Current State + Social Activity */}
        <div className="sm:col-span-2 flex flex-col gap-4">

          {/* Current State */}
          <div className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current State</p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {[
                { label: "Emotion", value: emotionState, colored: true },
                { label: "Energy", value: character.energy_value !== undefined ? `${character.energy_value}%` : "—" },
                { label: "Stress", value: character.mental_value !== undefined ? `${Math.round(100 - character.mental_value)}%` : "—" },
                { label: "Social Need", value: character.social_value !== undefined ? `${character.social_value}%` : "—" },
                { label: "Hunger", value: character.hunger_value !== undefined ? `${character.hunger_value}%` : "—" },
                { label: "Location", value: character.resolved_current_location_name || "—" },
                { label: "Time", value: now },
              ].map(({ label, value, colored }) => (
                <div key={label} className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{label}</span>
                  <span className="text-[10px] font-medium capitalize text-right truncate max-w-[55%]"
                    style={colored ? { color: eColor(value) } : {}}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Social Activity */}
          <div className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Social Activity · 24h</p>
            </div>
            <div className="flex divide-x divide-border/40">
              <StatChip icon={MessageCircle} label="Messages" value={socialStats.msgsSent} />
              <StatChip icon={Heart} label="Positive" value={socialStats.positiveInteractions} />
              <StatChip icon={Zap} label="Conflict" value={socialStats.conflictEvents} />
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. PATTERN INSIGHTS + MEMORY HIGHLIGHTS ──────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Pattern Insights */}
        {insights.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pattern Insights</p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {insights.map((insight, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Brain className="w-3 h-3 text-primary" />
                  </div>
                  <p className="text-xs text-foreground/80 leading-snug">{insight}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Memory Highlights — only meaningful entries */}
        {memoryHighlights.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recent Memory Highlights</p>
            </div>
            <div className="divide-y divide-border/40">
              {memoryHighlights.map((mem, i) => (
                <div key={i} className="flex items-start gap-2.5 px-4 py-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <BookOpen className="w-3 h-3 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground leading-snug">{mem.title}</p>
                    {mem.note && <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{mem.note}</p>}
                  </div>
                  {mem.active && (
                    <span className="text-[8px] text-amber-400 font-medium whitespace-nowrap flex-shrink-0 mt-1">
                      Still affecting mood
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}