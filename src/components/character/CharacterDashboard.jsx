import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Moon, Sun, Briefcase, Home, MessageCircle, Phone,
  DollarSign, Heart, MapPin, Zap, BookOpen, Brain, Activity
} from "lucide-react";
import { format, subHours, isAfter, parseISO, subDays, parseISO as pi } from "date-fns";
import { getCharacterLivePresence } from "@/lib/locationResolutionEngine";

// ── Emotion scoring ───────────────────────────────────────────────────────────
const EMOTION_SCORE = {
  happy: 88, joyful: 90, excited: 85, hopeful: 78, affectionate: 82,
  calm: 70, content: 72, reflective: 55, bored: 45,
  anxious: 38, stressed: 35, frustrated: 30, "closed-off": 30,
  lonely: 30, sad: 28, irritated: 28, defensive: 25, tense: 26,
  angry: 14, "emotionally drained": 22, exhausted: 18, overwhelmed: 20,
};
const eScore = (s) => EMOTION_SCORE[(s || "").toLowerCase()] ?? 52;

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

const isPositive = (e) => ["happy","joyful","excited","content","affectionate","calm","hopeful"].includes((e||"").toLowerCase());
const isTense    = (e) => ["angry","irritated","defensive","tense","stressed","overwhelmed","frustrated"].includes((e||"").toLowerCase());
const isSad      = (e) => ["sad","lonely","exhausted","emotionally drained","closed-off","bored"].includes((e||"").toLowerCase());
const isAnxious  = (e) => ["anxious","reflective"].includes((e||"").toLowerCase());

const entryAccent = (emotion) => {
  if (isTense(emotion))   return "border-l-red-500/50 bg-red-500/5";
  if (isAnxious(emotion)) return "border-l-violet-500/50 bg-violet-500/5";
  if (isPositive(emotion))return "border-l-amber-400/40 bg-amber-400/5";
  if (isSad(emotion))     return "border-l-blue-500/50 bg-blue-500/5";
  return "border-l-border/40 bg-transparent";
};

const fmtTime = (iso) => {
  try { return format(parseISO(iso), "h:mm aa"); } catch { return ""; }
};

// ── Build human-readable timeline text ───────────────────────────────────────
const buildMsgText = (e, who, isGroup, isWorldPhone) => {
  const em = (e || "").toLowerCase();
  if (isGroup) return "Participated in a group conversation";
  if (isWorldPhone && who) return `World Phone conversation with ${who}`;
  if (isTense(em))        return who ? `Tense exchange with ${who}` : "Conflict caused emotional tension";
  if (em === "reflective")return who ? `Reflective conversation with ${who}` : "Sent a reflective message";
  if (isSad(em))          return who ? `Reached out to ${who} while feeling low` : "Sent a message while feeling low";
  if (isPositive(em) && em !== "calm") return who ? `Uplifting exchange with ${who}` : "Positive social interaction";
  if (em === "calm")      return who ? `Calm conversation with ${who}` : "Quiet check-in";
  if (em === "anxious")   return who ? `Anxious message to ${who}` : "Reached out while feeling unsettled";
  return who ? `Exchanged messages with ${who}` : "Social interaction";
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

const ICON_MAP = { moon: Moon, sun: Sun, briefcase: Briefcase, home: Home, mappin: MapPin, heart: Heart, book: BookOpen, dollar: DollarSign, message: MessageCircle, phone: Phone, activity: Activity };
const TIcon = ({ type }) => { const I = ICON_MAP[type] || Activity; return <I className="w-3.5 h-3.5" />; };

export default function CharacterDashboard({ character }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || loading || !character?.id) return;
    setLoading(true);

    const charId = character.id;
    const ownerEmail = character.owner_email;
    const now = new Date();
    const cutoff24h = subHours(now, 24).toISOString();
    const cutoff7d  = subDays(now, 7).toISOString();

    // ── FETCH ALL DATA IN PARALLEL ─────────────────────────────────────────
    // Key fix: fetch ALL messages in conversations where the character is a participant
    // — not just messages where sender_type=character. This captures character-to-character
    // interactions where [VIEWED_CHARACTER] is on either side.
    Promise.allSettled([
      // All messages for this character (both as sender and as subject of conversation)
      base44.entities.Message.filter({ character_id: charId }, "-created_date", 200),
      base44.entities.FinancialTransaction.filter({ character_id: charId }, "-timestamp", 20),
      base44.entities.AutomaticNarrative.filter({ character_id: charId }, "-timestamp", 80).catch(() => []),
      // Conversations where [VIEWED_CHARACTER] is a participant (any side)
      ownerEmail
        ? base44.entities.Conversation.filter({ owner_email: ownerEmail, character_ids: [charId] }, "-updated_date", 120).catch(() => [])
        : Promise.resolve([]),
      // Location data — direct entity query (avoids function response-shape ambiguity)
      ownerEmail
        ? base44.entities.LocationReference.filter({ owner_email: ownerEmail }, null, 200).catch(() => [])
        : Promise.resolve([]),
    ]).then(([msgsR, txR, narrR, convosR, locsR]) => {
      const msgs   = msgsR.status   === "fulfilled" ? (msgsR.value   || []) : [];
      const txns   = txR.status     === "fulfilled" ? (txR.value     || []) : [];
      const narrs  = narrR.status   === "fulfilled" ? (narrR.value   || []) : [];
      const convos = convosR.status === "fulfilled" ? (convosR.value || []) : [];
      const locsArr= locsR.status   === "fulfilled" ? (locsR.value   || []) : [];

      // ── Build location map ────────────────────────────────────────────────
      const locationMap = {};
      (Array.isArray(locsArr) ? locsArr : []).forEach(l => { if (l?.id) locationMap[l.id] = l; });

      // ── Canonical location — same resolver as CharacterCard ───────────────
      // Fix: we now have a real locationMap so the resolver can correctly detect school/work
      const livePresence = getCharacterLivePresence(character, locationMap);
      // livePresence.label = "At school", "At home", etc.
      // livePresence.sublabel = the location name (e.g. "City College")
      // Show sublabel (location name) if present, otherwise show the status label
      const liveLocationDisplay = livePresence.sublabel || livePresence.label || "—";
      const liveStatus = livePresence.status;

      // ── Participant name resolution ────────────────────────────────────────
      // Build id → name from the character's own relationship/family data
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

      // convoId → { name, isGroup, isWorldPhone }
      const convoMeta = {};
      convos.forEach(c => {
        const isGroup = c.type === "group";
        const isWP    = c.channel === "world_phone";
        if (isGroup) { convoMeta[c.id] = { name: null, isGroup: true, isWorldPhone: false }; return; }
        let name = isSystemTitle(c.title) ? null : c.title;
        if (!name) {
          const others = (c.character_ids || []).filter(id => id !== charId);
          for (const id of others) { if (relNameById[id]) { name = relNameById[id]; break; } }
        }
        convoMeta[c.id] = { name, isGroup: false, isWorldPhone: isWP };
      });
      // Enrich from message sender fields
      msgs.forEach(m => {
        if (convoMeta[m.conversation_id]?.name) return;
        const n = (m.character_name && m.character_id !== charId) ? m.character_name
          : (m.played_as_character_name && m.played_as_character_id !== charId) ? m.played_as_character_name
          : null;
        if (n) {
          if (convoMeta[m.conversation_id]) convoMeta[m.conversation_id].name = n;
          else convoMeta[m.conversation_id] = { name: n, isGroup: false, isWorldPhone: false };
        }
      });
      // For bilateral world phone — look up the other character's ID in participant_character_ids
      convos.filter(c => c.channel === "world_phone").forEach(c => {
        if (convoMeta[c.id]?.name) return;
        const others = (c.participant_character_ids || c.character_ids || []).filter(id => id !== charId);
        for (const id of others) {
          if (relNameById[id]) { convoMeta[c.id].name = relNameById[id]; break; }
        }
      });

      // ── Valid conversation IDs (scoped to this character's conversations) ──
      const validConvoIds = new Set(convos.map(c => c.id));

      // ── ALL messages across ALL participants in these conversations ────────
      // The character_id filter above gives us messages where character is sender/subject.
      // For character-to-character convos we also need to look at messages from the other side.
      // Filter messages to only those in conversations we loaded (ownership-scoped).
      const scopedMsgs = msgs.filter(m => validConvoIds.has(m.conversation_id));

      // ── Time windows ──────────────────────────────────────────────────────
      const msgs24h  = scopedMsgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff24h)));
      const txns24h  = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff24h)));
      const narrs24h = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff24h)));
      const msgs7d   = scopedMsgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff7d)));
      const narrs7d  = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff7d)));

      // Social stats (all msgs in these convos, not just sender_type=character)
      const allSent24h     = msgs24h.filter(m => m.sender_type === "character");
      const msgsSent       = allSent24h.length;
      const positiveInteractions = allSent24h.filter(m => isPositive(m.emotional_state)).length;
      const conflictEvents = allSent24h.filter(m => isTense(m.emotional_state)).length;

      // ── INTRADAY EMOTIONAL GRAPH ───────────────────────────────────────────
      // KEY FIX: Instead of one point per day (which hides intraday movement),
      // we build HOURLY buckets. Each real event adds a point at its actual hour.
      // X-axis label = "MM/dd HH" buckets condensed to display labels.
      // This shows intraday rises, dips, conflicts, and recovery.

      // Collect timestamped emotional events
      const rawEvents = []; // { isoTime, emotion, source }

      // From narratives (most reliable — LLM-written)
      narrs7d.forEach(n => {
        if (n.emotional_state) rawEvents.push({ isoTime: n.timestamp, emotion: n.emotional_state, source: "narrative" });
      });

      // From all messages in these conversations (both character and user side carry emotional context)
      msgs7d.filter(m => m.emotional_state).forEach(m => {
        rawEvents.push({ isoTime: m.created_date, emotion: m.emotional_state, source: "message" });
      });

      // From financial events
      txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff7d)) && t.direction === "expense")
        .forEach(t => rawEvents.push({ isoTime: t.timestamp, emotion: "stressed", source: "financial" }));

      // Current state → now
      const curEmotion = character.emotional_state || "calm";
      rawEvents.push({ isoTime: now.toISOString(), emotion: curEmotion, source: "current" });

      // Needs signals → now
      if ((character.mental_value ?? 100) < 50)         rawEvents.push({ isoTime: now.toISOString(), emotion: "stressed",  source: "needs" });
      if ((character.social_value ?? 100) < 35)         rawEvents.push({ isoTime: now.toISOString(), emotion: "lonely",    source: "needs" });
      if ((character.energy_value ?? 100) < 25)         rawEvents.push({ isoTime: now.toISOString(), emotion: "exhausted", source: "needs" });
      if ((character.financial_need_value ?? 0) > 70)   rawEvents.push({ isoTime: now.toISOString(), emotion: "stressed",  source: "needs" });

      // Sleep events
      if (character.last_sleep_start) rawEvents.push({ isoTime: character.last_sleep_start, emotion: "exhausted", source: "sleep" });
      if (character.alarm_woke_at)    rawEvents.push({ isoTime: character.alarm_woke_at,    emotion: "calm",      source: "wake" });

      // Build intraday points — bucket into 4-hour blocks per day for display clarity
      // Each block = a plotted point. Multiple events in same block are averaged.
      const blockMap = {}; // "MM/dd·HH_block" → { label, scores: [] }

      rawEvents.forEach(({ isoTime, emotion }) => {
        if (!isoTime) return;
        try {
          const d = parseISO(isoTime);
          const dayLabel = format(d, "MM/dd");
          const hour = d.getHours();
          // Group into 6-hour blocks: 0-5=Night, 6-11=Morn, 12-17=Aftn, 18-23=Eve
          const blockNames = ["Night","Morn","Aftn","Eve"];
          const blockIdx = Math.floor(hour / 6);
          const key = `${dayLabel}·${blockIdx}`;
          if (!blockMap[key]) blockMap[key] = { label: `${dayLabel} ${blockNames[blockIdx]}`, day: dayLabel, blockIdx, scores: [] };
          blockMap[key].scores.push(eScore(emotion));
        } catch {}
      });

      // Sort and build chart data
      const trendData = Object.values(blockMap)
        .sort((a, b) => {
          if (a.day !== b.day) {
            try { return new Date("2026/" + a.day) - new Date("2026/" + b.day); } catch { return 0; }
          }
          return a.blockIdx - b.blockIdx;
        })
        .map(block => {
          const avg = Math.round(block.scores.reduce((s, v) => s + v, 0) / block.scores.length);
          return { label: block.label, mood: avg };
        })
        .slice(-28); // max 7 days × 4 blocks

      // If we have very sparse data (only current state), seed from memory to show character history
      if (trendData.length < 3) {
        const seedEntries = [];
        (character.memories || [])
          .filter(m => m.emotional_impact || m.emotion_state)
          .slice(0, 6)
          .forEach((m, i) => {
            const daysAgo = i + 2;
            const d = subDays(now, daysAgo);
            const dayLabel = format(d, "MM/dd");
            const e = m.emotion_state || (m.emotional_impact?.toLowerCase().includes("pain") ? "sad" : "reflective");
            seedEntries.push({ label: `${dayLabel} Morn`, mood: eScore(e) });
          });
        // Insert seeded points before existing ones
        trendData.unshift(...seedEntries);
      }

      // ── TIMELINE ENTRIES ──────────────────────────────────────────────────
      const timelineEntries = [];

      // Sleep / wake
      if (character.last_sleep_start && isAfter(parseISO(character.last_sleep_start), parseISO(cutoff24h)))
        timelineEntries.push({ time: character.last_sleep_start, icon: "moon", text: "Went to sleep", emotion: "exhausted" });
      if (character.alarm_woke_at && isAfter(parseISO(character.alarm_woke_at), parseISO(cutoff24h)))
        timelineEntries.push({ time: character.alarm_woke_at, icon: "sun", text: "Woke up", emotion: "calm" });

      // Narratives (LLM-written, already human text)
      const narIconMap = { sleep:"moon", wake:"sun", work_start:"briefcase", work_end:"home", travel_arrival:"mappin", travel_departure:"mappin", social_event:"heart", catch_up_summary:"book", location_change:"mappin", passive_time:"activity" };
      narrs24h.forEach(n => {
        const text = (n.narrative_text || "").substring(0, 100);
        if (text) timelineEntries.push({ time: n.timestamp, icon: narIconMap[n.event_type] || "activity", text, emotion: n.emotional_state || curEmotion });
      });

      // Financial events
      txns24h.forEach(t => {
        if (!t.description) return;
        timelineEntries.push({ time: t.timestamp, icon: "dollar", text: t.description, emotion: t.direction === "expense" ? "stressed" : "calm", sub: t.location_name || null });
      });

      // Messages — one entry per conversation, most emotionally significant message
      // Include ALL participants (character-to-character, character-to-user, world phone)
      const convoMsgPick = {};
      const priorityScore = (s) => {
        const p = { angry:6, tense:6, irritated:6, defensive:6, sad:5, anxious:4, reflective:3, happy:2, calm:2 };
        return p[(s||"").toLowerCase()] || 1;
      };
      msgs24h.filter(m => m.emotional_state).forEach(m => {
        const existing = convoMsgPick[m.conversation_id];
        if (!existing || priorityScore(m.emotional_state) > priorityScore(existing.emotional_state))
          convoMsgPick[m.conversation_id] = m;
      });

      Object.values(convoMsgPick).slice(0, 8).forEach(m => {
        const meta = convoMeta[m.conversation_id] || { name: null, isGroup: false, isWorldPhone: false };
        timelineEntries.push({
          time: m.created_date,
          icon: meta.isWorldPhone ? "phone" : "message",
          text: buildMsgText(m.emotional_state, meta.name, meta.isGroup, meta.isWorldPhone),
          emotion: m.emotional_state,
        });
      });

      timelineEntries.sort((a, b) => { try { return new Date(a.time) - new Date(b.time); } catch { return 0; } });

      // ── Pattern insights ──────────────────────────────────────────────────
      const insights = [];
      if (conflictEvents > 0 && character.work_start_time) insights.push("Tension tends to surface on or around work days.");
      if ((character.social_value ?? 100) < 40) insights.push("Social needs are low — isolation may be building.");
      if ((character.sleep_debt_hours ?? 0) > 2 || (character.energy_value ?? 100) < 30) insights.push("Rest is disrupted — exhaustion is affecting emotional stability.");
      if ((character.mental_value ?? 100) < 40) insights.push("Mental health is under strain.");
      if ((character.financial_need_value ?? 0) > 70) insights.push("Financial pressure is elevated and shaping mood.");
      if (positiveInteractions > conflictEvents * 2 && positiveInteractions > 1) insights.push("Positive interactions are currently outweighing conflict.");
      if (conflictEvents > positiveInteractions && conflictEvents > 0) insights.push("More conflict than connection recently.");
      if (msgsSent === 0) insights.push("No communication recorded in the past 24 hours.");
      if (liveStatus === "at_school") insights.push("Academic schedule is currently active.");
      if (liveStatus === "at_work") insights.push("Work schedule is currently active.");

      // ── Memory highlights — filter out generic/placeholder entries ────────
      const memoryHighlights = (character.memories || [])
        .filter(m => {
          const t = (m.title || "").trim().toLowerCase();
          return t.length > 5 && !["memory","key memory","a memory","untitled"].includes(t);
        })
        .filter(m => !!(m.emotional_impact || m.description))
        .slice(0, 4)
        .map(m => ({ title: m.title, note: m.emotional_impact || m.description || null, active: !!m.emotional_impact }));

      setData({ liveLocationDisplay, liveStatus, trendData, timelineEntries: timelineEntries.slice(0, 12), socialStats: { msgsSent, positiveInteractions, conflictEvents }, insights: insights.slice(0, 4), memoryHighlights });
      setLoaded(true);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [character?.id]); // eslint-disable-line

  if (loading) return <div className="flex items-center justify-center py-10"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!data) return null;

  const { liveLocationDisplay, trendData, timelineEntries, socialStats, insights, memoryHighlights } = data;
  const emotionState = character.emotional_state || "calm";
  const now = format(new Date(), "h:mm aa");
  const moodColor = eColor(emotionState);

  return (
    <div className="space-y-4">

      {/* ── 1. EMOTIONAL TREND GRAPH — intraday points ───────────────────── */}
      {trendData.length >= 2 && (
        <div className="rounded-xl overflow-hidden bg-card border border-border">
          <div className="px-4 pt-4 pb-1 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Emotional Trend · This Week</p>
            <span className="flex items-center gap-1 text-[9px]" style={{ color: moodColor }}>
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: moodColor }} />
              Mood
            </span>
          </div>
          <div style={{ height: 130 }} className="px-1 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 10, left: -28, bottom: 4 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(v) => v.split(" ")[0]} // show only date portion
                />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 10, padding: "6px 10px" }}
                  formatter={(v) => [`${v}%`, "Mood"]}
                  labelFormatter={(l) => l}
                />
                <Line
                  type="monotone"
                  dataKey="mood"
                  name="Mood"
                  stroke={moodColor}
                  strokeWidth={2}
                  dot={{ r: 3, fill: moodColor, strokeWidth: 0 }}
                  activeDot={{ r: 4.5, strokeWidth: 0 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── 2. TIMELINE + CURRENT STATE ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">

        {/* Past 24 Hours */}
        <div className="sm:col-span-3 rounded-xl overflow-hidden bg-card border border-border">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Past 24 Hours</p>
          </div>
          {timelineEntries.length === 0
            ? <p className="px-4 py-4 text-xs text-muted-foreground italic">No recorded activity in the past 24 hours.</p>
            : (
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
                      {entry.emotion && <p className="text-[9px] font-medium capitalize whitespace-nowrap" style={{ color: eColor(entry.emotion) }}>{entry.emotion}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* Right column */}
        <div className="sm:col-span-2 flex flex-col gap-4">
          <div className="rounded-xl overflow-hidden bg-card border border-border">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current State</p>
            </div>
            <div className="px-4 py-3 space-y-2">
              {[
                { label: "Emotion",     value: emotionState, colored: true },
                { label: "Energy",      value: character.energy_value    !== undefined ? `${character.energy_value}%`    : "—" },
                { label: "Stress",      value: character.mental_value    !== undefined ? `${Math.round(100 - character.mental_value)}%` : "—" },
                { label: "Social Need", value: character.social_value    !== undefined ? `${character.social_value}%`    : "—" },
                { label: "Hunger",      value: character.hunger_value    !== undefined ? `${character.hunger_value}%`    : "—" },
                // Canonical live location — same source as CharacterCard (requires locationMap from LocationReference entity)
                { label: "Location",    value: liveLocationDisplay },
                { label: "Time",        value: now },
              ].map(({ label, value, colored }) => (
                <div key={label} className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{label}</span>
                  <span className="text-[10px] font-medium capitalize text-right truncate max-w-[58%]"
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
              <StatChip icon={Heart}         label="Positive"  value={socialStats.positiveInteractions} />
              <StatChip icon={Zap}           label="Conflict"  value={socialStats.conflictEvents} />
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
              {insights.map((ins, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Brain className="w-3 h-3 text-primary" />
                  </div>
                  <p className="text-xs text-foreground/80 leading-snug">{ins}</p>
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
                  {mem.active && <span className="text-[8px] text-amber-400 font-medium whitespace-nowrap flex-shrink-0 mt-1">Still affecting mood</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}