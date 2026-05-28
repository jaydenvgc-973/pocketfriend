import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { LineChart, Line, ReferenceLine, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Moon, Sun, Briefcase, Home, MessageCircle, Phone,
  DollarSign, Heart, MapPin, Zap, BookOpen, Brain, Activity
} from "lucide-react";
import { format, subHours, isAfter, parseISO, subDays } from "date-fns";
import { getCharacterLivePresence } from "@/lib/locationResolutionEngine";

// ── Emotion scoring — direction + intensity, not just impact tier ─────────────
// Scale: 0=most distressed, 50=neutral, 100=most elevated positive
const EMOTION_SCORE = {
  joyful: 92, happy: 88, excited: 85, elated: 90, euphoric: 93,
  affectionate: 82, hopeful: 78, motivated: 76, grateful: 80,
  calm: 65, content: 68, peaceful: 66, relieved: 62,
  reflective: 50, nostalgic: 48, pensive: 46, bored: 42,
  lonely: 34, vulnerable: 36, conflicted: 38,
  anxious: 32, worried: 30, stressed: 28, frustrated: 26,
  "closed-off": 28, sad: 24, disappointed: 22, guilty: 20,
  irritated: 22, defensive: 20, tense: 18,
  angry: 12, overwhelmed: 14, "emotionally drained": 16, exhausted: 14,
  devastated: 8, despairing: 6,
};
const eScore = (s) => EMOTION_SCORE[(s || "").toLowerCase()] ?? 50;

// ── Semantic emotion inference ─────────────────────────────────────────────────
// Derives emotional direction and score from text content when no explicit
// emotional_state field exists, or when the field is too generic to be useful.
// This is the core fix: "moderate impact" ≠ emotional direction.
const SEMANTIC_EMOTION_MAP = [
  // Conflict / tension
  { patterns: [/conflict/i, /argument/i, /confrontat/i, /fight/i, /disagree/i, /tension/i, /clash/i, /dishonesty/i, /honesty.*issue/i, /issue.*honesty/i], emotion: "tense", score: 18 },
  // Anger
  { patterns: [/anger/i, /angry/i, /furious/i, /rage/i, /lash(ed)? out/i], emotion: "angry", score: 12 },
  // Stress / pressure / burden
  { patterns: [/stress/i, /burden/i, /overwhelm/i, /pressure/i, /unfinished/i, /overdue/i, /behind/i, /too much/i], emotion: "stressed", score: 26 },
  // Exhaustion / fatigue
  { patterns: [/exhaust/i, /tired/i, /fatigue/i, /drained/i, /worn out/i, /physical.*strain/i, /recovery.*tired/i, /tired.*recovery/i], emotion: "exhausted", score: 14 },
  // Sadness / grief
  { patterns: [/grief/i, /griev/i, /loss/i, /mourn/i, /heartbreak/i, /devastat/i, /despair/i, /empty.*feel/i], emotion: "sad", score: 22 },
  // Anxiety / worry
  { patterns: [/anxious/i, /anxiety/i, /worry/i, /nervous/i, /dread/i, /unsettl/i, /uncertain/i, /fear/i], emotion: "anxious", score: 30 },
  // Loneliness / isolation
  { patterns: [/lone(ly|liness)/i, /isol/i, /disconn/i, /out of place/i, /left out/i, /excluded/i], emotion: "lonely", score: 32 },
  // Vulnerability
  { patterns: [/vulnerab/i, /open(ed)? up/i, /exposed/i, /raw.*feel/i, /feel.*raw/i], emotion: "vulnerable", score: 36 },
  // Conflict with self / internal
  { patterns: [/guilt/i, /regret/i, /shame/i, /disappoint/i, /let.*down/i, /failed/i], emotion: "guilty", score: 20 },
  // Recovery / healing
  { patterns: [/recover/i, /healing/i, /getting better/i, /bouncing back/i, /restor/i], emotion: "relieved", score: 62 },
  // Support / connection
  { patterns: [/support/i, /comfort/i, /reassur/i, /help(ed|ing)/i, /there for/i, /caring/i, /listen(ed|ing)/i], emotion: "content", score: 68 },
  // Love / affection
  { patterns: [/love/i, /affection/i, /mutual.*express/i, /express.*love/i, /closeness/i, /intimacy/i, /bond/i], emotion: "affectionate", score: 82 },
  // Joy / happiness
  { patterns: [/joy/i, /happy/i, /celebrat/i, /excit/i, /thrilled/i, /delight/i, /laugh/i, /fun/i], emotion: "happy", score: 88 },
  // Hope / motivation / purpose
  { patterns: [/hope/i, /motivat/i, /purpose/i, /goal/i, /inspir/i, /forward/i, /ambition/i, /recogni(ze|tion)/i], emotion: "motivated", score: 76 },
  // Calm / peace
  { patterns: [/calm/i, /peace/i, /quiet/i, /relax/i, /settled/i, /stable/i], emotion: "calm", score: 65 },
  // Reflection
  { patterns: [/reflect/i, /ponder/i, /think.*deeply/i, /contemplat/i, /meditat/i], emotion: "reflective", score: 50 },
];

// Infer emotional score from text when no explicit emotion is given
const inferEmotionFromText = (text) => {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const { patterns, emotion, score } of SEMANTIC_EMOTION_MAP) {
    if (patterns.some(p => p.test(t))) return { emotion, score };
  }
  return null;
};

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
    const cutoff3d  = subDays(now, 3).toISOString(); // graph window: today + 2 prior days
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
      const msgs3d   = scopedMsgs.filter(m => m.created_date && isAfter(parseISO(m.created_date), parseISO(cutoff3d)));
      const narrs3d  = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff3d)));
      const txns3d   = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff3d)));

      // Social stats (all msgs in these convos, not just sender_type=character)
      const allSent24h     = msgs24h.filter(m => m.sender_type === "character");
      const msgsSent       = allSent24h.length;
      const positiveInteractions = allSent24h.filter(m => isPositive(m.emotional_state)).length;
      const conflictEvents = allSent24h.filter(m => isTense(m.emotional_state)).length;

      // ── INTRADAY EMOTIONAL GRAPH — 3-day window, per-event semantic scoring ─
      // ARCHITECTURE:
      // 1. Each event gets its own graph point at its real timestamp.
      // 2. Emotional score is derived SEMANTICALLY — not just from the field value.
      //    "emotional_state: calm" on every event → flat line. That was the bug.
      //    Now: we read the event title, description, type, and content to infer direction.
      // 3. Life Journal (character.memories) entries are fully included.
      // 4. A conflict and a supportive moment will produce DIFFERENT y values.

      const curEmotion = character.emotional_state || "calm";
      const cutoff3dMs = parseISO(cutoff3d).getTime();

      // rawEvents: { tsMs, emotion, score, label, source }
      const rawEvents = [];

      const addEvent = (isoTime, emotion, scoreOverride, source) => {
        if (!isoTime) return;
        try {
          const d = parseISO(isoTime);
          const tsMs = d.getTime();
          if (tsMs < cutoff3dMs || tsMs > now.getTime() + 60000) return;
          const em = (emotion || "calm").toLowerCase();
          const score = scoreOverride != null ? scoreOverride : eScore(em);
          const label = format(d, "EEE h:mma");
          rawEvents.push({ tsMs, emotion: em, score, label, source: source || "event" });
        } catch {}
      };

      // ── 1. LIFE JOURNAL ENTRIES (character.memories) ───────────────────────
      // These are the richest emotional source but were NOT being used before.
      // Each entry has a title, description, emotional_impact text, and timestamps.
      // We MUST infer emotional direction semantically — "moderate" is not a direction.
      (character.memories || []).forEach(m => {
        const timestamp = m.created_date || m.updated_date || m.date;
        if (!timestamp) return;
        const text = [m.title, m.description, m.emotional_impact, m.summary].filter(Boolean).join(" ");
        // First: try explicit emotion_state field on the memory
        if (m.emotion_state && EMOTION_SCORE[m.emotion_state?.toLowerCase()] != null) {
          addEvent(timestamp, m.emotion_state, null, "memory");
          return;
        }
        // Second: semantic inference from title + description + emotional_impact
        const inferred = inferEmotionFromText(text);
        if (inferred) {
          addEvent(timestamp, inferred.emotion, inferred.score, "memory");
        } else if (text.length > 0) {
          // Fallback: use neutral-slightly-reflective if we have text but no match
          addEvent(timestamp, "reflective", 50, "memory");
        }
      });

      // ── 2. NARRATIVES (LLM-written — most reliable emotional_state field) ──
      narrs3d.forEach(n => {
        if (!n.timestamp) return;
        // Use narrative's emotional_state if present and meaningful
        if (n.emotional_state && n.emotional_state !== "calm") {
          addEvent(n.timestamp, n.emotional_state, null, "narrative");
          return;
        }
        // Infer from narrative type if emotional_state is generic
        const typeScores = {
          sleep: ["exhausted", 14], wake: ["calm", 65], work_start: ["stressed", 30],
          work_end: ["relieved", 62], social_event: ["content", 68],
          needs_warning: ["stressed", 26], catch_up_summary: ["reflective", 50],
        };
        const ts = typeScores[n.event_type];
        if (ts) { addEvent(n.timestamp, ts[0], ts[1], "narrative"); return; }
        // Semantic fallback from narrative text
        const inf = inferEmotionFromText(n.narrative_text || n.memory_summary);
        if (inf) addEvent(n.timestamp, inf.emotion, inf.score, "narrative");
        else if (n.emotional_state) addEvent(n.timestamp, n.emotional_state, null, "narrative");
      });

      // ── 3. MESSAGES — semantic scoring per message ─────────────────────────
      // If emotional_state is present, use its actual directional score.
      // If missing, infer from message content.
      msgs3d.forEach(m => {
        if (!m.created_date) return;
        if (m.emotional_state && m.emotional_state !== "calm") {
          addEvent(m.created_date, m.emotional_state, null, "message");
        } else if (m.content) {
          const inf = inferEmotionFromText(m.content);
          if (inf) addEvent(m.created_date, inf.emotion, inf.score, "message");
          else if (m.emotional_state) addEvent(m.created_date, m.emotional_state, null, "message");
        }
      });

      // ── 4. FINANCIAL STRESS — scored by amount and direction ───────────────
      txns3d.forEach(t => {
        if (!t.timestamp) return;
        if (t.direction === "expense") {
          // Large expenses create more stress than small ones
          const amt = Math.abs(t.amount || 0);
          const stressScore = amt > 500 ? 18 : amt > 100 ? 24 : 28;
          addEvent(t.timestamp, "stressed", stressScore, "financial");
        } else if (t.direction === "income") {
          addEvent(t.timestamp, "relieved", 62, "financial");
        }
      });

      // ── 5. SLEEP / WAKE LIFECYCLE ──────────────────────────────────────────
      if (character.last_sleep_start) addEvent(character.last_sleep_start, "exhausted", 14, "sleep");
      if (character.alarm_woke_at)    addEvent(character.alarm_woke_at, "calm", 60, "wake");

      // ── 6. NEEDS-DERIVED SIGNALS — stamped at now with real directional scores ─
      // Each need maps to a distinct emotional direction, not all the same score.
      const nowIso = now.toISOString();
      if ((character.mental_value ?? 100) < 35)        addEvent(nowIso, "overwhelmed", 14, "needs");
      else if ((character.mental_value ?? 100) < 55)   addEvent(nowIso, "stressed", 26, "needs");
      if ((character.social_value ?? 100) < 30)        addEvent(nowIso, "lonely", 32, "needs");
      if ((character.energy_value ?? 100) < 20)        addEvent(nowIso, "exhausted", 14, "needs");
      else if ((character.energy_value ?? 100) < 40)   addEvent(nowIso, "tired", 22, "needs");
      if ((character.financial_need_value ?? 0) > 75)  addEvent(nowIso, "stressed", 22, "needs");
      if ((character.hunger_value ?? 100) < 25)        addEvent(nowIso, "frustrated", 26, "needs");

      // ── 7. CURRENT STATE ANCHOR ────────────────────────────────────────────
      addEvent(nowIso, curEmotion, null, "current");

      // Sort chronologically
      rawEvents.sort((a, b) => a.tsMs - b.tsMs);

      // Deduplicate events within 3 minutes of each other — keep most extreme score
      const deduped = [];
      for (const ev of rawEvents) {
        const prev = deduped[deduped.length - 1];
        if (prev && Math.abs(ev.tsMs - prev.tsMs) < 3 * 60 * 1000) {
          // Keep the one furthest from neutral (50)
          if (Math.abs(ev.score - 50) > Math.abs(prev.score - 50)) {
            deduped[deduped.length - 1] = ev;
          }
        } else {
          deduped.push(ev);
        }
      }

      // Build final chart data
      const trendData = deduped.map(e => ({
        label: e.label,
        mood: Math.round(e.score),
        emotion: e.emotion,
        tsMs: e.tsMs,
        source: e.source,
      }));

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

      {/* ── 1. EMOTIONAL TREND GRAPH — per-event intraday points, 3-day window */}
      {trendData.length >= 1 && (
        <div className="rounded-xl overflow-hidden bg-card border border-border">
          <div className="px-4 pt-4 pb-1 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Emotional Movement · Last 3 Days</p>
            <span className="flex items-center gap-1 text-[9px]" style={{ color: moodColor }}>
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: moodColor }} />
              {emotionState}
            </span>
          </div>
          {/* Legend row */}
          <div className="px-4 pb-1 flex items-center gap-3 flex-wrap">
            {[
              { label: "Elevated", color: "#fbbf24" },
              { label: "Neutral",  color: "#94a3b8" },
              { label: "Tension",  color: "#f87171" },
              { label: "Low",      color: "#60a5fa" },
            ].map(({ label, color }) => (
              <span key={label} className="flex items-center gap-1 text-[8px] text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
          <div style={{ height: 160 }} className="px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 12, left: 2, bottom: 4 }}>
                {/* Horizontal reference bands */}
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.4}
                  horizontal={true}
                  vertical={false}
                />
                {/* Emotional zone reference lines */}
                <ReferenceLine y={75} stroke="#fbbf24" strokeOpacity={0.25} strokeDasharray="4 4" />
                <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.3} strokeDasharray="2 4" label={{ value: "neutral", position: "insideTopLeft", fontSize: 7, fill: "hsl(var(--muted-foreground))", dy: -2 }} />
                <ReferenceLine y={25} stroke="#f87171" strokeOpacity={0.25} strokeDasharray="4 4" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 7, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={{ stroke: "hsl(var(--border))", strokeOpacity: 0.5 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 7, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  tickCount={5}
                  tickFormatter={(v) => v === 0 ? "" : v === 100 ? "" : v === 50 ? "mid" : v > 50 ? "+" : "−"}
                  width={22}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 10, padding: "6px 10px" }}
                  formatter={(v, name, props) => {
                    const { emotion, source } = props?.payload || {};
                    const dir = v > 65 ? "elevated" : v > 45 ? "neutral" : v > 25 ? "low" : "distressed";
                    return [`${emotion || "—"} · ${dir}`, source || "event"];
                  }}
                  labelFormatter={(l) => l}
                />
                <Line
                  type="monotone"
                  dataKey="mood"
                  name="Emotional state"
                  stroke={moodColor}
                  strokeWidth={2}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (cx == null || cy == null) return null;
                    const c = eColor(payload?.emotion);
                    const score = payload?.mood ?? 50;
                    // Dot size reflects emotional intensity (distance from neutral)
                    const intensity = Math.abs(score - 50) / 50;
                    const r = 3 + intensity * 3;
                    return (
                      <circle
                        key={`dot-${cx}-${cy}-${payload?.tsMs}`}
                        cx={cx} cy={cy} r={r}
                        fill={c}
                        stroke="hsl(var(--card))"
                        strokeWidth={1}
                      />
                    );
                  }}
                  activeDot={{ r: 6, strokeWidth: 1, stroke: "hsl(var(--card))" }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Score range guide */}
          <div className="px-4 pb-3 flex justify-between text-[7px] text-muted-foreground/60">
            <span>↑ hopeful · joyful · affectionate</span>
            <span>stressed · angry · exhausted ↓</span>
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