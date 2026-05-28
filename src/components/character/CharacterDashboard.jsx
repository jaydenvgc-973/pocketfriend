import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import {
  LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceDot
} from "recharts";
import {
  Moon, Sun, Briefcase, Home, MessageCircle, Phone,
  DollarSign, Heart, MapPin, Zap, BookOpen, Brain, Activity
} from "lucide-react";
import { format, subHours, isAfter, parseISO, subDays } from "date-fns";
import { getCharacterLivePresence } from "@/lib/locationResolutionEngine";

// ── Emotion → numeric mood score ─────────────────────────────────────────────
const EMOTION_SCORE = {
  happy: 88, joyful: 90, excited: 85, hopeful: 78, affectionate: 82,
  calm: 70, content: 72, reflective: 55,
  lonely: 30, sad: 28, anxious: 38, stressed: 35,
  "emotionally drained": 22, exhausted: 18, "closed-off": 30,
  irritated: 28, defensive: 25, angry: 14, tense: 26, frustrated: 30,
  bored: 45, overwhelmed: 20,
};
const eScore = (s) => EMOTION_SCORE[(s || "").toLowerCase()] ?? 52;

// ── Emotion → hex colour ──────────────────────────────────────────────────────
const EMOTION_HEX = {
  calm: "#34d399", happy: "#fbbf24", joyful: "#fbbf24", excited: "#fbbf24",
  hopeful: "#a78bfa", affectionate: "#f472b6", reflective: "#38bdf8",
  content: "#34d399", sad: "#60a5fa", lonely: "#60a5fa",
  anxious: "#a78bfa", stressed: "#f87171", angry: "#f87171",
  irritated: "#f87171", defensive: "#f87171", tense: "#f87171",
  "emotionally drained": "#94a3b8", exhausted: "#94a3b8", "closed-off": "#94a3b8",
  bored: "#94a3b8", frustrated: "#fb923c", overwhelmed: "#f43f5e",
};
const eColor = (s) => EMOTION_HEX[(s || "").toLowerCase()] || "#94a3b8";

// ── Emotion groups for graph lines ────────────────────────────────────────────
const isPositive = (e) => ["happy","joyful","excited","content","affectionate","calm","hopeful"].includes((e||"").toLowerCase());
const isTense    = (e) => ["angry","irritated","defensive","tense","stressed","overwhelmed","frustrated"].includes((e||"").toLowerCase());
const isSad      = (e) => ["sad","lonely","exhausted","emotionally drained","closed-off","bored"].includes((e||"").toLowerCase());
const isAnxious  = (e) => ["anxious","reflective"].includes((e||"").toLowerCase());

// ── Timeline border accent ────────────────────────────────────────────────────
const entryAccent = (emotion) => {
  const e = (emotion || "").toLowerCase();
  if (isTense(e)) return "border-l-red-500/50 bg-red-500/5";
  if (isAnxious(e)) return "border-l-violet-500/50 bg-violet-500/5";
  if (isPositive(e)) return "border-l-amber-400/40 bg-amber-400/5";
  if (isSad(e)) return "border-l-blue-500/50 bg-blue-500/5";
  return "border-l-border/40 bg-transparent";
};

const fmtTime = (iso) => {
  if (!iso) return "";
  try { return format(parseISO(iso), "h:mm aa"); } catch { return ""; }
};

// ── Human-readable timeline text ──────────────────────────────────────────────
const buildMessageText = (msg, participantName, isGroup, isWorldPhone) => {
  const e = (msg.emotional_state || "").toLowerCase();
  const who = participantName;

  if (isGroup) return "Participated in a group conversation";
  if (isWorldPhone && who) return `World Phone conversation with ${who}`;

  if (isTense(e)) return who ? `Tense exchange with ${who}` : "Conflict caused emotional tension";
  if (e === "reflective") return who ? `Reflective conversation with ${who}` : "Sent a reflective message";
  if (isSad(e)) return who ? `Reached out to ${who} while feeling low` : "Sent a message while feeling withdrawn";
  if (isPositive(e) && e !== "calm") return who ? `Uplifting exchange with ${who}` : "Positive social interaction";
  if (e === "calm") return who ? `Calm conversation with ${who}` : "Quiet check-in";
  if (e === "anxious") return who ? `Anxious message to ${who}` : "Reached out while feeling unsettled";
  if (e === "frustrated") return who ? `Vented to ${who}` : "Released some emotional tension";
  return who ? `Exchanged messages with ${who}` : "Quiet social interaction";
};

// ── Stat chip ─────────────────────────────────────────────────────────────────
function StatChip({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1 py-3">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span className="text-lg font-bold text-foreground">{value}</span>
      <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Timeline icon renderer ────────────────────────────────────────────────────
const ICON_MAP = {
  moon: Moon, sun: Sun, briefcase: Briefcase, home: Home,
  mappin: MapPin, heart: Heart, book: BookOpen, dollar: DollarSign,
  message: MessageCircle, phone: Phone, activity: Activity,
};
const TIcon = ({ type }) => {
  const I = ICON_MAP[type] || Activity;
  return <I className="w-3.5 h-3.5" />;
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
      base44.entities.Message.filter({ character_id: charId }, "-created_date", 150),
      base44.entities.FinancialTransaction.filter({ character_id: charId }, "-timestamp", 20),
      base44.entities.AutomaticNarrative
        ? base44.entities.AutomaticNarrative.filter({ character_id: charId }, "-timestamp", 60).catch(() => [])
        : Promise.resolve([]),
      ownerEmail
        ? base44.entities.Conversation.filter({ owner_email: ownerEmail, character_ids: [charId] }, "-updated_date", 100).catch(() => [])
        : Promise.resolve([]),
      ownerEmail
        ? base44.functions.invoke("fetchAllLocationsForUser", { owner_email: ownerEmail }).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
    ]).then(([msgsR, txR, narrR, convosR, locsR]) => {
      const msgs = msgsR.status === "fulfilled" ? (msgsR.value || []) : [];
      const txns = txR.status === "fulfilled" ? (txR.value || []) : [];
      const narrs = narrR.status === "fulfilled" ? (narrR.value || []) : [];
      const convos = convosR.status === "fulfilled" ? (convosR.value || []) : [];
      const locsArr = locsR.status === "fulfilled" ? (locsR.value?.data || locsR.value || []) : [];

      // ── Location map for getCharacterLivePresence ─────────────────────────
      const locationMap = {};
      (Array.isArray(locsArr) ? locsArr : []).forEach(l => { if (l?.id) locationMap[l.id] = l; });

      // ── Canonical live presence (same source as CharacterCard) ─────────────
      const livePresence = getCharacterLivePresence(character, locationMap);
      const liveLocationDisplay = livePresence.sublabel || livePresence.label || "—";
      const liveStatus = livePresence.status;

      // ── Conversation → participant name map ───────────────────────────────
      const relNameById = {};
      (character.fictional_relationships || []).forEach(r => {
        if (r.related_character_id) relNameById[r.related_character_id] = r.person_name;
      });
      (character.family_members || []).forEach(m => {
        if (m.character_id) relNameById[m.character_id] = m.name;
      });

      const isSystemTitle = (t) =>
        !t || t.startsWith("npc_chat__") || t.startsWith("bilateral_") ||
        t.startsWith("world_phone_") || /^[a-f0-9-]{36}/.test(t);

      const convoParticipant = {}; // convoId → { name, isGroup, isWorldPhone }
      convos.forEach(c => {
        const isGroup = c.type === "group";
        const isWorldPhone = c.channel === "world_phone";
        if (isGroup) { convoParticipant[c.id] = { name: null, isGroup: true, isWorldPhone: false }; return; }
        let name = null;
        if (!isSystemTitle(c.title)) { name = c.title; }
        if (!name) {
          const others = (c.character_ids || []).filter(id => id !== charId);
          for (const id of others) { if (relNameById[id]) { name = relNameById[id]; break; } }
        }
        convoParticipant[c.id] = { name, isGroup: false, isWorldPhone };
      });

      // Enrich from message fields
      msgs.forEach(m => {
        if (convoParticipant[m.conversation_id]?.name) return;
        const n = m.character_name && m.character_id !== charId ? m.character_name
          : m.played_as_character_name && m.played_as_character_id !== charId ? m.played_as_character_name
          : null;
        if (n && convoParticipant[m.conversation_id]) convoParticipant[m.conversation_id].name = n;
        else if (n) convoParticipant[m.conversation_id] = { name: n, isGroup: false, isWorldPhone: false };
      });

      // ── Filter to time windows ────────────────────────────────────────────
      const msgs24h = msgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff24h)));
      const txns24h = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff24h)));
      const narrs7d = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff7d)));
      const narrs24h = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff24h)));
      const msgs7d = msgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff7d)));

      // ── Social stats ──────────────────────────────────────────────────────
      const charMsgs24h = msgs24h.filter(m => m.sender_type === "character");
      const msgsSent = charMsgs24h.length;
      const positiveInteractions = charMsgs24h.filter(m => isPositive(m.emotional_state)).length;
      const conflictEvents = charMsgs24h.filter(m => isTense(m.emotional_state)).length;

      // ── Emotional trend graph ─────────────────────────────────────────────
      // Each data point: scores across 4 dimensions, per day
      // We accumulate signal arrays and average per day
      const dayMap = {}; // "MM/dd" → { mood: [], tension: [], sadness: [], anxious: [] }

      const addSignal = (isoTime, emotion, weight = 1) => {
        if (!isoTime || !emotion) return;
        try {
          const day = format(parseISO(isoTime), "MM/dd");
          if (!dayMap[day]) dayMap[day] = { mood: [], tension: [], sadness: [], anxious: [] };
          const s = eScore(emotion);
          // Mood = general wellbeing (all signals contribute)
          dayMap[day].mood.push(s);
          // Specific dimension scoring
          if (isTense(emotion)) dayMap[day].tension.push(Math.min(100, 100 - s + 40)); // tension is inverse
          if (isSad(emotion))   dayMap[day].sadness.push(Math.min(100, 100 - s + 30));
          if (isAnxious(emotion)) dayMap[day].anxious.push(Math.min(100, 100 - s + 20));
        } catch {}
      };

      // Seed from narratives (high confidence)
      narrs7d.forEach(n => {
        const e = n.emotional_state || character.emotional_state;
        addSignal(n.timestamp, e, 2);
      });

      // Seed from messages (each message's emotional state = real emotional signal)
      msgs7d.filter(m => m.sender_type === "character" && m.emotional_state)
        .forEach(m => addSignal(m.created_date, m.emotional_state, 1));

      // Financial stress signals
      txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff7d)) && t.direction === "expense")
        .forEach(t => addSignal(t.timestamp, "stressed", 1));

      // Character's current emotional state → today
      const today = format(new Date(), "MM/dd");
      if (!dayMap[today]) dayMap[today] = { mood: [], tension: [], sadness: [], anxious: [] };
      const curEmotion = character.emotional_state || "calm";
      dayMap[today].mood.push(eScore(curEmotion));
      if (isTense(curEmotion)) dayMap[today].tension.push(Math.min(100, 100 - eScore(curEmotion) + 40));
      if (isSad(curEmotion))   dayMap[today].sadness.push(Math.min(100, 100 - eScore(curEmotion) + 30));
      if (isAnxious(curEmotion)) dayMap[today].anxious.push(Math.min(100, 100 - eScore(curEmotion) + 20));

      // Additional signals from character needs
      if ((character.mental_value ?? 100) < 50) addSignal(new Date().toISOString(), "stressed");
      if ((character.social_value ?? 100) < 35) addSignal(new Date().toISOString(), "lonely");
      if ((character.energy_value ?? 100) < 25) addSignal(new Date().toISOString(), "exhausted");
      if ((character.financial_need_value ?? 0) > 70) addSignal(new Date().toISOString(), "stressed");

      // ── If we still have very sparse data (e.g. only 1 day), synthesize prior days
      // from character's emotional history fields and memory signals
      if (Object.keys(dayMap).length < 3) {
        // Use memory emotional impact to infer prior emotional states
        (character.memories || []).filter(m => m.emotional_impact || m.emotion_state).forEach((m, i) => {
          const daysAgo = Math.min(i + 2, 6);
          const syntheticDate = format(subDays(new Date(), daysAgo), "MM/dd");
          const e = m.emotion_state || (m.emotional_impact?.toLowerCase().includes("pain") ? "sad" : "reflective");
          addSignal(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(), e);
        });
        // Seed with current state drifts across the week if still sparse
        if (Object.keys(dayMap).length < 2) {
          for (let d = 6; d >= 1; d--) {
            const synDate = format(subDays(new Date(), d), "MM/dd");
            if (!dayMap[synDate]) {
              dayMap[synDate] = { mood: [], tension: [], sadness: [], anxious: [] };
            }
            // Use current emotion with slight variation based on day distance
            dayMap[synDate].mood.push(Math.max(10, Math.min(90, eScore(curEmotion) + (d % 3 === 0 ? 10 : d % 2 === 0 ? -8 : 5))));
          }
        }
      }

      const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

      const trendData = Object.entries(dayMap)
        .map(([day, dims]) => ({
          day,
          mood: avg(dims.mood),
          tension: avg(dims.tension),
          sadness: avg(dims.sadness),
          anxious: avg(dims.anxious),
        }))
        .sort((a, b) => {
          try { return new Date("2026/" + a.day) - new Date("2026/" + b.day); } catch { return 0; }
        })
        .slice(-7);

      const activeLines = {
        mood: trendData.some(d => d.mood != null),
        tension: trendData.some(d => d.tension != null),
        sadness: trendData.some(d => d.sadness != null),
        anxious: trendData.some(d => d.anxious != null),
      };

      // ── Timeline entries ──────────────────────────────────────────────────
      const timelineEntries = [];

      // Sleep events
      if (character.last_sleep_start && isAfter(parseISO(character.last_sleep_start), parseISO(cutoff24h))) {
        timelineEntries.push({ time: character.last_sleep_start, icon: "moon", text: "Went to sleep", emotion: "exhausted" });
      }
      if (character.alarm_woke_at && isAfter(parseISO(character.alarm_woke_at), parseISO(cutoff24h))) {
        timelineEntries.push({ time: character.alarm_woke_at, icon: "sun", text: "Woke up", emotion: "calm" });
      }

      // Narratives — already human-written by LLM
      narrs24h.forEach(n => {
        const iconMap = { sleep: "moon", wake: "sun", work_start: "briefcase", work_end: "home",
          travel_arrival: "mappin", travel_departure: "mappin", social_event: "heart",
          catch_up_summary: "book", location_change: "mappin", passive_time: "activity" };
        const text = (n.narrative_text || "").substring(0, 100);
        if (text) {
          timelineEntries.push({
            time: n.timestamp, icon: iconMap[n.event_type] || "activity",
            text, emotion: n.emotional_state || character.emotional_state || "calm",
          });
        }
      });

      // Financial events
      txns24h.forEach(t => {
        if (!t.description) return;
        timelineEntries.push({
          time: t.timestamp, icon: "dollar",
          text: t.description,
          emotion: t.direction === "expense" ? "stressed" : "calm",
          sub: t.location_name || null,
        });
      });

      // Messages — one per convo, most emotionally significant, with clean human text
      const convoMsgMap = {};
      charMsgs24h.filter(m => m.emotional_state).forEach(m => {
        const priority = { angry: 5, tense: 5, irritated: 5, defensive: 5, sad: 4, anxious: 3, reflective: 2, happy: 1, calm: 1 };
        const p = (s) => priority[(s || "").toLowerCase()] || 0;
        const existing = convoMsgMap[m.conversation_id];
        if (!existing || p(m.emotional_state) > p(existing.emotional_state)) convoMsgMap[m.conversation_id] = m;
      });

      Object.values(convoMsgMap).slice(0, 7).forEach(m => {
        const info = convoParticipant[m.conversation_id] || { name: null, isGroup: false, isWorldPhone: false };
        const text = buildMessageText(m, info.name, info.isGroup, info.isWorldPhone);
        timelineEntries.push({ time: m.created_date, icon: "message", text, emotion: m.emotional_state });
      });

      timelineEntries.sort((a, b) => { try { return new Date(a.time) - new Date(b.time); } catch { return 0; } });

      // ── Pattern insights from real signals ────────────────────────────────
      const insights = [];
      if (conflictEvents > 0 && character.work_start_time) insights.push("Tension tends to surface on or around work days.");
      if ((character.social_value ?? 100) < 40) insights.push("Social needs are low — isolation may be building up.");
      if ((character.sleep_debt_hours ?? 0) > 2 || (character.energy_value ?? 100) < 30) insights.push("Rest is disrupted — exhaustion is affecting emotional stability.");
      if ((character.mental_value ?? 100) < 40) insights.push("Mental health is under strain. Connection and rest may help.");
      if ((character.financial_need_value ?? 0) > 70) insights.push("Financial pressure is elevated and shaping mood.");
      if (positiveInteractions > conflictEvents * 2 && positiveInteractions > 1) insights.push("Positive interactions are currently outweighing conflict.");
      if (conflictEvents > positiveInteractions && conflictEvents > 0) insights.push("More conflict than connection recently — emotional cost may be accumulating.");
      if (msgsSent === 0) insights.push("No communication in the past 24 hours — social withdrawal may be present.");
      if (liveStatus === "at_school") insights.push("Academic schedule is currently active.");
      if (liveStatus === "at_work") insights.push("Work schedule is currently active.");

      // ── Memory highlights — skip generic titles ────────────────────────────
      const memoryHighlights = (character.memories || [])
        .filter(m => {
          const t = (m.title || "").trim().toLowerCase();
          return t.length > 5 && t !== "memory" && t !== "key memory" && t !== "a memory" && t !== "untitled";
        })
        .filter(m => !!(m.emotional_impact || m.description))
        .slice(0, 4)
        .map(m => ({
          title: m.title,
          note: m.emotional_impact || m.description || null,
          active: !!m.emotional_impact,
        }));

      setData({
        liveLocationDisplay,
        liveStatus,
        trendData,
        activeLines,
        timelineEntries: timelineEntries.slice(0, 12),
        socialStats: { msgsSent, positiveInteractions, conflictEvents },
        insights: insights.slice(0, 4),
        memoryHighlights,
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

  const { liveLocationDisplay, trendData, activeLines, timelineEntries, socialStats, insights, memoryHighlights } = data;
  const emotionState = character.emotional_state || "calm";
  const now = format(new Date(), "h:mm aa");

  const LINE_DEFS = [
    { key: "mood",    name: "Mood",    color: eColor(emotionState) },
    { key: "tension", name: "Tension", color: "#f87171" },
    { key: "sadness", name: "Sadness", color: "#60a5fa" },
    { key: "anxious", name: "Anxious", color: "#a78bfa" },
  ].filter(l => activeLines[l.key]);

  return (
    <div className="space-y-4">

      {/* ── 1. EMOTIONAL TREND GRAPH ──────────────────────────────────────── */}
      {trendData.length >= 2 && (
        <div className="rounded-xl overflow-hidden bg-card border border-border">
          <div className="px-4 pt-4 pb-1 flex items-center justify-between flex-wrap gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Emotional Trend · This Week</p>
            <div className="flex items-center gap-3 flex-wrap">
              {LINE_DEFS.map(l => (
                <span key={l.key} className="flex items-center gap-1 text-[9px]" style={{ color: l.color }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: l.color }} />
                  {l.name}
                </span>
              ))}
            </div>
          </div>
          <div style={{ height: 148 }} className="px-1 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 10, left: -22, bottom: 4 }}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 10, padding: "6px 10px" }}
                  formatter={(v, name) => v != null ? [`${v}%`, name] : [null, name]}
                />
                {LINE_DEFS.map(l => (
                  <Line
                    key={l.key}
                    type="monotone"
                    dataKey={l.key}
                    name={l.name}
                    stroke={l.color}
                    strokeWidth={l.key === "mood" ? 2 : 1.5}
                    dot={{ r: 3, fill: l.color, strokeWidth: 0 }}
                    activeDot={{ r: 4.5, strokeWidth: 0 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── 2. TWO-COLUMN: TIMELINE + CURRENT STATE ──────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">

        {/* Past 24 Hours */}
        <div className="sm:col-span-3 rounded-xl overflow-hidden bg-card border border-border">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Past 24 Hours</p>
          </div>
          {timelineEntries.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground italic">No recorded activity in the past 24 hours.</p>
          ) : (
            <div className="divide-y divide-border/40">
              {timelineEntries.map((entry, i) => (
                <div key={i} className={`flex items-start gap-2.5 px-4 py-2.5 border-l-2 ${entryAccent(entry.emotion)}`}>
                  <div className="mt-0.5 flex-shrink-0 text-muted-foreground"><TIcon type={entry.icon} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-snug">{entry.text}</p>
                    {entry.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{entry.sub}</p>}
                  </div>
                  <div className="flex-shrink-0 text-right ml-1">
                    {entry.time && <p className="text-[9px] text-muted-foreground whitespace-nowrap">{fmtTime(entry.time)}</p>}
                    {entry.emotion && (
                      <p className="text-[9px] font-medium capitalize whitespace-nowrap" style={{ color: eColor(entry.emotion) }}>{entry.emotion}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Current State + Social */}
        <div className="sm:col-span-2 flex flex-col gap-4">
          <div className="rounded-xl overflow-hidden bg-card border border-border">
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
                // ← Uses getCharacterLivePresence — same canonical source as CharacterCard
                { label: "Location", value: liveLocationDisplay },
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

          <div className="rounded-xl overflow-hidden bg-card border border-border">
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
        {insights.length > 0 && (
          <div className="rounded-xl overflow-hidden bg-card border border-border">
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

        {memoryHighlights.length > 0 && (
          <div className="rounded-xl overflow-hidden bg-card border border-border">
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
                    <span className="text-[8px] text-amber-400 font-medium whitespace-nowrap flex-shrink-0 mt-1">Still affecting mood</span>
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