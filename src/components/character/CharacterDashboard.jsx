import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { LineChart, Line, ReferenceLine, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Moon, Sun, Briefcase, Home, MessageCircle, Phone,
  DollarSign, Heart, MapPin, Zap, BookOpen, Brain, Activity
} from "lucide-react";
import TravelHistoryCard from "@/components/character/TravelHistoryCard";
import { format, isAfter, parseISO, subDays } from "date-fns";
import { getCharacterLivePresence } from "@/lib/locationResolutionEngine";

// ── Emotion scoring — direction + intensity, not just impact tier ─────────────
// Scale: 0=most distressed, 50=neutral, 100=most elevated positive
// DESIGN RULE: Positive emotions must be weighted equally to negative emotions at the same intensity.
// Moderate positive ≠ weaker than moderate negative. Symmetry is enforced.
const EMOTION_SCORE = {
  // ── Strongly positive (80–95) ─────────────────────────────────────────────
  joyful: 92, euphoric: 93, elated: 90, happy: 87, excited: 85,
  affectionate: 84, loving: 86, grateful: 82, proud: 83,
  // ── Moderately positive (68–79) ──────────────────────────────────────────
  hopeful: 78, motivated: 76, content: 74, peaceful: 72,
  relieved: 70, comforted: 71, supported: 72, connected: 73,
  encouraged: 75, warm: 72, playful: 74, cheerful: 76, lighthearted: 73,
  // ── Mildly positive / calm (60–67) ───────────────────────────────────────
  calm: 63, serene: 65, amused: 64, flirty: 62,
  // ── True neutral (48–59) ─────────────────────────────────────────────────
  reflective: 52, nostalgic: 50, pensive: 50, bored: 46, conflicted: 48,
  // ── Mildly negative — normal life (38–47) ────────────────────────────────
  // Tired, sleepy, hungry = normal biological states. Small downward pull only.
  tired: 44, sleepy: 45, hungry: 44, busy: 46,
  // ── Moderately negative (28–37) ──────────────────────────────────────────
  lonely: 34, vulnerable: 36, anxious: 34, worried: 32,
  frustrated: 32, stressed: 30, guilty: 28,
  // ── Significantly negative (16–27) ───────────────────────────────────────
  sad: 24, disappointed: 22, irritated: 26, defensive: 24,
  "closed-off": 24, withdrawn: 25, tense: 22,
  // ── Severely negative (6–15) ─────────────────────────────────────────────
  // NOTE: exhausted is 38 here — physical exhaustion after productive activity
  // is a normal life condition, NOT a major emotional failure.
  exhausted: 38, drained: 38, "emotionally drained": 22,
  angry: 14, overwhelmed: 16, devastated: 8, despairing: 6, heartbroken: 10,
};
const eScore = (s) => EMOTION_SCORE[(s || "").toLowerCase()] ?? 52;

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

// ── LifeEvent event_type → emotional direction ────────────────────────────────
// The Life Journal (LifeEvent entity) has structured event_type and valence fields.
// These MUST be the primary emotional source — they are richer than free text.
// event_type is the semantic classifier: conflict_event ≠ supportive_event.
const LIFE_EVENT_EMOTION = {
  // Positive / stabilizing
  supportive_event:         { emotion: "content",      score: 68 },
  bonding_event:            { emotion: "affectionate",  score: 82 },
  healthy_choice_event:     { emotion: "motivated",     score: 76 },
  growth_event:             { emotion: "hopeful",       score: 78 },
  achievement_qualifying_action: { emotion: "happy",   score: 88 },
  celebration_event:        { emotion: "joyful",        score: 92 },
  routine_positive_event:   { emotion: "calm",          score: 65 },
  reconciliation_event:     { emotion: "relieved",      score: 62 },
  recovery_event:           { emotion: "relieved",      score: 60 },
  life_milestone_event:     { emotion: "hopeful",       score: 78 },
  // Mixed / transitional
  emotional_exchange:       { emotion: "reflective",    score: 50 },
  relationship_shift:       { emotion: "anxious",       score: 32 },
  location_change_event:    { emotion: "anxious",       score: 38 },
  npc_incident_event:       { emotion: "stressed",      score: 28 },
  // Negative / destabilizing
  conflict_event:           { emotion: "tense",         score: 18 },
  fight_event:              { emotion: "angry",         score: 12 },
  betrayal_event:           { emotion: "devastated",    score: 8  },
  emotional_outburst_event: { emotion: "overwhelmed",   score: 14 },
  grief_event:              { emotion: "sad",           score: 22 },
  medical_event:            { emotion: "anxious",       score: 30 },
  accident_event:           { emotion: "overwhelmed",   score: 14 },
  legal_or_social_consequence_event: { emotion: "stressed", score: 20 },
  setback_event:            { emotion: "disappointed",  score: 22 },
  risky_decision_event:     { emotion: "anxious",       score: 30 },
  impulsive_decision_event: { emotion: "conflicted",    score: 38 },
  substance_use_event:      { emotion: "stressed",      score: 26 },
  sleep_deprivation_event:  { emotion: "exhausted",     score: 14 },
  routine_negative_event:   { emotion: "frustrated",    score: 26 },
};

// Apply valence modifier: if event says "positive" but type maps negative, blend toward positive
const lifeEventScore = (eventType, valence, severity) => {
  const base = LIFE_EVENT_EMOTION[eventType] || { emotion: "reflective", score: 50 };
  let score = base.score;
  // Severity amplifies distance from neutral (50)
  const amplify = { minor: 0.7, moderate: 1.0, significant: 1.2, major: 1.4 }[severity] ?? 1.0;
  score = 50 + (score - 50) * amplify;
  // Valence override: if strongly positive valence on a neutral/negative type, lift score
  if (valence === "positive" && score < 55) score = Math.max(score, 60);
  if (valence === "negative" && score > 45) score = Math.min(score, 35);
  return { emotion: base.emotion, score: Math.round(Math.max(0, Math.min(100, score))) };
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

// ── Sentiment classification — shared vocabulary for graph, timeline, AND social activity counters ──
// RULE: These sets must be identical everywhere. The Social Activity card and the graph/timeline
// must never use incompatible buckets.
//
// POSITIVE: warm, connected, hopeful, relieved, loving, supportive, proud, grateful, calm
// CONFLICT: tense, angry, hurt, disappointed, sad, anxious, stressed, guilty, overwhelmed, lonely
// NEUTRAL:  reflective, pensive, bored, nostalgic, conflicted — not counted in either bucket
const POSITIVE_EMOTIONS = new Set([
  "happy","joyful","excited","elated","euphoric",
  "affectionate","loving","content","calm","peaceful","serene",
  "hopeful","motivated","grateful","proud","encouraged",
  "relieved","supported","comforted","connected","warm",
  "playful","flirty","amused","lighthearted","cheerful",
]);
const CONFLICT_EMOTIONS = new Set([
  "angry","furious","rage",
  "irritated","defensive","tense","hostile",
  "stressed","overwhelmed","frustrated","bitter",
  "sad","hurt","disappointed","devastated","heartbroken","despairing",
  "anxious","worried","nervous","fearful","dread",
  "guilty","ashamed","regretful",
  "lonely","isolated","abandoned","neglected",
  "exhausted","drained","emotionally drained",
  "jealous","envious","resentful",
  "closed-off","withdrawn","shut down",
]);

const isPositive = (e) => POSITIVE_EMOTIONS.has((e||"").toLowerCase());
const isTense    = (e) => CONFLICT_EMOTIONS.has((e||"").toLowerCase());
const isSad      = (e) => ["sad","lonely","exhausted","emotionally drained","closed-off","bored","drained","withdrawn"].includes((e||"").toLowerCase());
const isAnxious  = (e) => ["anxious","worried","nervous","reflective","fearful","dread"].includes((e||"").toLowerCase());

const entryAccent = (emotion) => {
  if (isTense(emotion))   return "border-l-red-500/50 bg-red-500/5";
  if (isAnxious(emotion)) return "border-l-violet-500/50 bg-violet-500/5";
  if (isPositive(emotion))return "border-l-amber-400/40 bg-amber-400/5";
  if (isSad(emotion))     return "border-l-blue-500/50 bg-blue-500/5";
  return "border-l-border/40 bg-transparent";
};

// fmtDayTime — shows day context + time for multi-day lists.
// "Today · 9:07 AM" / "Yesterday · 6:57 PM" / "Mon · 5:15 PM"
// A user can immediately tell BOTH the day and time without inferring from order.
const fmtDayTime = (iso) => {
  try {
    const d = parseISO(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const twoDaysAgo = new Date(today.getTime() - 2 * 86400000);
    const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const timeStr = format(d, "h:mm aa");
    if (itemDay.getTime() === today.getTime()) return `Today · ${timeStr}`;
    if (itemDay.getTime() === yesterday.getTime()) return `Yesterday · ${timeStr}`;
    if (itemDay.getTime() >= twoDaysAgo.getTime()) return `${format(d, "EEE")} · ${timeStr}`;
    return `${format(d, "MMM d")} · ${timeStr}`;
  } catch { return ""; }
};

// ── People-facing occupation detection ───────────────────────────────────────
// Determines if a character's job involves significant social/customer interaction.
// Returns an object with: { isSocial, isHighVolume, isEmotionallyDemanding, isCollaborative }
const SOCIAL_OCCUPATION_PATTERNS = [
  // High-volume public-facing: bartender, server, receptionist, cashier, retail
  { pattern: /bartend|server|waitress|waiter|restaurant|barista|cafe|coffee|retail|cashier|checkout|front\s*desk|receptionist|host(ess)?|concierge/i, type: 'high_volume_public' },
  // Emotionally demanding: social worker, case manager, counselor, therapist, nurse, healthcare
  { pattern: /social\s*work|case\s*manag|counsel|therapist|nurse|nursing|healthcare|care\s*worker|outreach|crisis|hotline|mental\s*health/i, type: 'emotionally_demanding' },
  // Teaching / education
  { pattern: /teach|tutor|instructor|professor|educator|coach|trainer|school|faculty|aide/i, type: 'teaching' },
  // Fitness / wellness
  { pattern: /personal\s*train|fitness|gym\s*staff|yoga|pilates|wellness|spin\s*class/i, type: 'fitness' },
  // Salon / beauty
  { pattern: /salon|barber|stylist|esthetician|nail\s*tech|beauty/i, type: 'salon' },
  // Event / entertainment / club
  { pattern: /event|entertai|club\s*staff|bar\s*staff|venue|promoter|dj|bouncer|usher/i, type: 'event_entertainment' },
  // Community / organizing
  { pattern: /community\s*organiz|organiz|coordinator|advocate|outreach|liaison|program\s*direct/i, type: 'community' },
  // Customer service
  { pattern: /customer\s*service|call\s*cent|support\s*rep|help\s*desk|client\s*service/i, type: 'customer_service' },
  // Medical / emergency
  { pattern: /doctor|physician|paramedic|emt|emergency|urgent\s*care|clinic|hospital\s*staff|medical\s*assist/i, type: 'medical' },
];

const detectOccupationSocialType = (occupation) => {
  if (!occupation) return null;
  for (const { pattern, type } of SOCIAL_OCCUPATION_PATTERNS) {
    if (pattern.test(occupation)) return type;
  }
  return null;
};

// Returns social impact description based on occupation type + personality
const getOccupationSocialContext = (character) => {
  const occType = detectOccupationSocialType(character.occupation || '');
  if (!occType) return null;

  const isIntrovert = ['introvert', 'mostly_introvert'].includes(character.social_energy || '');
  const isExtrovert = ['extrovert', 'mostly_extrovert'].includes(character.social_energy || '');
  const isStressed = (character.mental_value ?? 70) < 45;
  const isBurntOut = (character.energy_value ?? 70) < 30;
  const occName = character.occupation || 'job';

  const contextByType = {
    high_volume_public: isIntrovert
      ? `Working as a ${occName} involves constant customer interaction — socially stimulating but potentially draining for someone with an introverted nature.`
      : `Working as a ${occName} brings regular social contact through customer interactions throughout the shift.`,
    emotionally_demanding: isStressed
      ? `Working in ${occName} is emotionally taxing — client-facing work is ongoing even when personal stress is high.`
      : `Working in ${occName} involves meaningful client/patient interaction, which counts as significant social engagement.`,
    teaching: isBurntOut
      ? `Teaching and managing students all day is socially active even when exhaustion is setting in.`
      : `Time spent teaching and working with students and staff reflects consistent social engagement throughout the day.`,
    fitness: `Personal training and fitness instruction involves direct one-on-one client contact throughout the shift.`,
    salon: `Salon work involves close personal conversation with clients for extended periods — a socially active environment.`,
    event_entertainment: isStressed
      ? `Working events and venues means high social exposure even under pressure.`
      : `Event and venue work brings constant social stimulation — a high-contact environment by nature.`,
    community: `Community organizing and coordination involves ongoing relationship-based interaction with residents, partners, and stakeholders.`,
    customer_service: `Customer service work involves consistent verbal and social interaction throughout the shift, whether in person or remotely.`,
    medical: `Medical and clinical work involves continuous patient and team interaction — a socially and emotionally active environment.`,
  };

  return contextByType[occType] || null;
};

// ── Internal / non-name values that must never appear as participant names ─────
const INTERNAL_CHANNEL_TYPES = new Set(['direct', 'phone', 'world_phone', 'scene', 'group', 'npc']);
const isInternalValue = (v) =>
  !v ||
  INTERNAL_CHANNEL_TYPES.has(v.toLowerCase()) ||
  v.startsWith('world_phone::') ||
  v.startsWith('npc_chat__') ||
  v.startsWith('bilateral_') ||
  /^[a-f0-9]{20,}/.test(v) || // raw MongoDB-style ID
  /^[a-f0-9-]{36}$/.test(v);  // UUID

// ── Resolve participant name from a world_phone canonical key or IDs ──────────
// canonical key format: "world_phone::sortedIdA::sortedIdB"
// RULE: NEVER return the viewed character's own name. Always remove viewedCharId from candidates first.
const resolveOtherParticipantName = (convo, viewedCharId, viewedCharName, relNameById) => {
  // Helper: accept a name only if it is not the viewed character and not an internal value
  const accept = (name) => {
    if (!name) return null;
    if (isInternalValue(name)) return null;
    if (viewedCharName && name.trim().toLowerCase() === viewedCharName.trim().toLowerCase()) return null;
    return name;
  };

  // Source 1: participant_character_ids — most reliable, explicit list
  const participants = convo.participant_character_ids || convo.character_ids || [];
  const otherIds = participants.filter(id => id && id !== viewedCharId);
  for (const id of otherIds) {
    const n = accept(relNameById[id]);
    if (n) return n;
  }

  // Source 2: shared_conversation_key: "world_phone::idA::idB"
  const key = convo.shared_conversation_key || '';
  if (key.startsWith('world_phone::')) {
    const parts = key.replace('world_phone::', '').split('::');
    for (const part of parts) {
      if (part && part !== viewedCharId) {
        const n = accept(relNameById[part]);
        if (n) return n;
      }
    }
  }

  // Source 3: conversation title — only if it is a clean human name (not a channel type, not an ID, not viewed char's own name)
  const title = convo.title || '';
  if (title && !isInternalValue(title)) {
    const n = accept(title);
    if (n) return n;
  }

  return null;
};

// ── Build human-readable timeline text ───────────────────────────────────────
const buildMsgText = (e, who, isGroup, isWorldPhone, beatType) => {
  const em = (e || "").toLowerCase();

  if (isGroup) return "Group conversation";

  // Autonomous beat types — use natural social language
  if (beatType === 'community_event_followup') return who ? `Followed up with ${who} after a community event` : "Followed up after a community event";
  if (beatType === 'housemate_checkin')        return who ? `Checked in with ${who}` : "Quick check-in with a housemate";
  if (beatType === 'coworker_checkin')         return who ? `Touched base with ${who}` : "Touched base with a coworker";
  if (beatType === 'family_checkin')           return who ? `Reached out to ${who}` : "Family check-in";
  if (beatType === 'supportive_checkin')       return who ? `Reached out to ${who}` : "Supportive message sent";
  if (beatType === 'resolve_tension')          return who ? `Reached out to ${who} to clear the air` : "Reached out to clear tension";
  if (beatType === 'casual_catchup')           return who ? `Caught up with ${who}` : "Casual catch-up";
  if (beatType === 'social_checkin')           return who ? `Checked in with ${who}` : "Reached out to reconnect";
  if (beatType === 'brief_acknowledgment')     return who ? `Sent a quick message to ${who}` : "Brief message sent";

  // Emotion-based fallback (direct messages)
  if (isTense(em))         return who ? `Tense exchange with ${who}` : "Conflict caused emotional tension";
  if (em === "reflective") return who ? `Reflective conversation with ${who}` : "Sent a reflective message";
  if (isSad(em))           return who ? `Reached out to ${who} while feeling low` : "Sent a message while feeling low";
  if (isPositive(em) && em !== "calm") return who ? `Uplifting exchange with ${who}` : "Positive social interaction";
  if (em === "calm")       return who ? `Conversation with ${who}` : "Quiet check-in";
  if (em === "anxious")    return who ? `Reached out to ${who}` : "Reached out while feeling unsettled";
  return who ? `Conversation with ${who}` : "Social interaction";
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

// Session-level cache — persists across remounts within the same tab session.
// Prevents re-running 8 parallel entity queries when navigating away and back to the same profile.
// Key: characterId → dashboard data object.
// VERSION stamp: bump this whenever the data shape or classification logic changes so
// stale pre-fix cached entries are automatically discarded on next load.
const DASHBOARD_CACHE_VERSION = 19; // added timelineSourcesComplete flag
const dashboardCache = {};
const dashboardCacheVersion = {};

// ── LIVE CHARACTER SNAPSHOT ──────────────────────────────────────────────
// Built from current Character fields. Used to validate cache freshness.
// If ANY of these fields differ between cache time and now, cache is stale.
const SNAPSHOT_FIELDS = [
  'id', 'updated_date',
  'resolved_current_location_id', 'resolved_presence_status',
  'resolved_source_reason', 'resolved_location_type',
  'travel_status', 'current_activity',
  'energy_value', 'hunger_value', 'hygiene_value',
  'comfort_value', 'social_value', 'mental_value',
  'health_value', 'financial_need_value',
  'emotional_state', 'last_sleep_start',
  'sleep_interrupted_at', 'alarm_woke_at',
];

function buildLiveCharacterSnapshot(character) {
  const snap = {};
  for (const field of SNAPSHOT_FIELDS) {
    snap[field] = character[field] ?? null;
  }
  return snap;
}

function snapshotsMatch(cached, live) {
  for (const field of SNAPSHOT_FIELDS) {
    if (cached[field] !== live[field]) return false;
  }
  return true;
}

// Public cache invalidation — call from CharacterNeedsPanel or anywhere that
// writes to Character fields (manual bar edits, location changes, etc.)
export function discardDashboardCacheForCharacter(characterId) {
  delete dashboardCache[characterId];
  delete dashboardCacheVersion[characterId];
}

export default function CharacterDashboard({ character, allCharacters = [] }) {
  const charId = character?.id;

  // Track the active request's charId so stale async responses from a
  // previous character are discarded instead of overwriting the current one.
  const activeRequestRef = useRef(null);

  // State — initialized null/false. The useEffect below handles ALL transitions:
  // cache hit, cache miss, and charId change (reset + refetch).
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ── SINGLE EFFECT — triggered ONLY by charId change ──────────────────────
  // On every charId change this effect re-evaluates the cache for the NEW character,
  // resets stale state from any previous character, and either uses cached data
  // or starts a fresh fetch. No `loaded` or `loading` dependency → no loops.
  // A useRef guards the async pipeline so a stale response from character A
  // can never write into character B's state or cache.
  useEffect(() => {
    if (!charId) {
      setData(null);
      setLoaded(false);
      setLoading(false);
      return;
    }

    // Re-evaluate cache for the CURRENT charId (may have changed since last render)
    const requestCharId = charId;
    activeRequestRef.current = requestCharId;

    const cachedData = dashboardCache[charId];
    const cachedVersion = dashboardCacheVersion[charId];
    const cacheValid = cachedData && cachedVersion === DASHBOARD_CACHE_VERSION;

    // ── CACHE READ WITH LIVE SNAPSHOT VALIDATION ──────────────────────────
    // Cache is a display optimization only — never authoritative.
    // Cache hit requires: charId match, version match, AND live snapshot match.
    // If any live Character field changed since cache was written, discard + recompute.
    const liveSnapshot = buildLiveCharacterSnapshot(character);
    const snapshotsValid = cacheValid && cachedData.liveSnapshot &&
      snapshotsMatch(cachedData.liveSnapshot, liveSnapshot);

    if (cacheValid && cachedData.charId === requestCharId && snapshotsValid) {
      console.log(`[CharacterDashboard] CACHE HIT for ${charId} — live snapshot validated, skipping full compute`);
      setData(cachedData);
      setLoaded(true);
      setLoading(false);
      return;
    }

    if (cacheValid && cachedData.charId === requestCharId && !snapshotsValid) {
      console.log(`[CharacterDashboard] CACHE STALE for ${charId} — live fields changed since cache written, discarding and recomputing`);
      discardDashboardCacheForCharacter(charId);
    }

    // No valid cache. Reset any stale data from a previous character and fetch.
    setData(null);
    setLoaded(false);
    setLoading(true);

    console.log(`[CharacterDashboard] EFFECT START | charId=${charId} | name="${character?.name || '?'}" | ownerEmail=${character?.owner_email || 'MISSING'} | fetching fresh (cache disabled)`);

    const ownerEmail = character.owner_email;
    const now = new Date();
    const cutoff3d  = subDays(now, 3).toISOString();

    // ── FETCH ALL DATA IN PARALLEL ─────────────────────────────────────────
    // IMPORTANT: All 8 queries use .catch(() => []) so a single 429 cannot
    // fail the entire Promise.allSettled. The outer .catch() is only for
    // catastrophic failures (e.g. the Promise.allSettled itself throws).
    // This means the graph and timeline always render with whatever data loads,
    // even under rate-limit pressure — partial data is shown, not a blank screen.
    Promise.allSettled([
      // Messages where viewed character is sender (character_id = charId)
      base44.entities.Message.filter({ character_id: charId }, "-created_date", 200).catch(() => []),
      base44.entities.FinancialTransaction.filter({ character_id: charId }, "-timestamp", 20).catch(() => []),
      base44.entities.AutomaticNarrative.filter({ character_id: charId }, "-timestamp", 80).catch(() => []),
      // CharacterAutomaticNarrative — need-fulfillment and corrective-action durable proof records
      base44.entities.CharacterAutomaticNarrative.filter({ character_id: charId }, "-timestamp", 80).catch(() => []),
      // Conversations where [VIEWED_CHARACTER] is a participant (any side)
      ownerEmail
        ? base44.entities.Conversation.filter({ owner_email: ownerEmail, character_ids: [charId] }, "-updated_date", 120).catch(() => [])
        : Promise.resolve([]),
      // Location data
      ownerEmail
        ? base44.entities.LocationReference.filter({ owner_email: ownerEmail }, null, 200).catch(() => [])
        : Promise.resolve([]),
      base44.entities.LifeEvent.filter({ character_id: charId }, "-timestamp", 100).catch(() => []),
      // Messages where viewed character is RECEIVER — autonomous beats have character_id = sender, receiver_character_id = viewed char
      base44.entities.Message.filter({ receiver_character_id: charId }, "-created_date", 100).catch(() => []),
      // Location history — recent places visited
      ownerEmail
        ? base44.entities.LocationHistory.filter({ character_id: charId, owner_email: ownerEmail }, "-arrival_time", 30).catch(() => [])
        : Promise.resolve([]),
      // All characters for this owner — seed from CharacterProfile's React Query cache (allCharacters prop)
      // to avoid redundant network request. Only fetch from DB if cache is empty.
      allCharacters.length > 0
        ? Promise.resolve(allCharacters)
        : ownerEmail
          ? base44.entities.Character.filter({ owner_email: ownerEmail }, null, 200).catch(() => [])
          : Promise.resolve([]),
      // EventParticipation — community events this character attended
      ownerEmail
        ? base44.entities.EventParticipation.filter({ character_id: charId, owner_email: ownerEmail }, "-participation_date", 30).catch(() => [])
        : Promise.resolve([]),
    ]).then(([msgsR, txR, narrR, charNarrR, convosR, locsR, lifeEventsR, rcvMsgsR, locHistR, allCharsR, eventPartR]) => {
      const msgs       = msgsR.status       === "fulfilled" ? (msgsR.value       || []) : [];
      const txns       = txR.status         === "fulfilled" ? (txR.value         || []) : [];
      const narrs      = narrR.status       === "fulfilled" ? (narrR.value       || []) : [];
      const charNarrs  = charNarrR.status   === "fulfilled" ? (charNarrR.value   || []) : [];
      const convos     = convosR.status     === "fulfilled" ? (convosR.value     || []) : [];
      const locsArr    = locsR.status       === "fulfilled" ? (locsR.value       || []) : [];
      const lifeEvents = lifeEventsR.status === "fulfilled" ? (lifeEventsR.value || []) : [];
      // Messages sent TO the viewed character — autonomous beats: character_id = sender, receiver_character_id = viewed char
      const rcvMsgs    = rcvMsgsR.status    === "fulfilled" ? (rcvMsgsR.value    || []) : [];
      // All characters — used to resolve receiver IDs → names for outgoing messages
      // Location history — recent places visited
      const locHistory = locHistR?.status   === "fulfilled" ? (locHistR.value    || []) : [];
      const allChars   = allCharsR.status   === "fulfilled" ? (allCharsR.value   || []) : [];
      // Event participation — community events the character attended
      const eventParts = eventPartR?.status === "fulfilled" ? (eventPartR.value  || []) : [];
      // Recent Activity timeline completeness — true ONLY if every timeline-authoritative
      // source query fulfilled. A silent 429 on any of these must NOT render as "no activity"
      // (the empty-placeholder bug) nor as a partial timeline. locHistR is optional-gated.
      const timelineSourcesComplete =
        narrR.status === "fulfilled" &&
        charNarrR.status === "fulfilled" &&
        lifeEventsR.status === "fulfilled" &&
        (locHistR == null || locHistR.status === "fulfilled");
      // Combine for full picture — deduplicated by id
      const allMsgIds = new Set(msgs.map(m => m.id));
      const allMsgs   = [...msgs, ...rcvMsgs.filter(m => !allMsgIds.has(m.id))];

      // Build complete id → name map from all characters (authoritative, covers all participants)
      const charNameById = {};
      allChars.forEach(c => {
        if (c.id && c.id !== charId) {
          charNameById[c.id] = c.name || c.display_name || c.primary_name || '';
        }
      });

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
      // Build id → name map from ALL available sources in priority order.
      // This is the critical fix: autonomous beats involve characters NOT in
      // fictional_relationships or family_members, so we must also harvest
      // names directly from message fields (character_name, character_id pairs).
      const relNameById = {};

      const viewedCharName = character.name || character.display_name || character.primary_name || '';

      // Source 1: Character entity lookup — authoritative, covers all participants by ID
      Object.assign(relNameById, charNameById);

      // Source 2: fictional_relationships on the viewed character
      (character.fictional_relationships || []).forEach(r => {
        if (r.related_character_id && r.person_name && r.related_character_id !== charId)
          relNameById[r.related_character_id] = r.person_name;
      });

      // Source 3: family_members on the viewed character
      (character.family_members || []).forEach(m => {
        if (m.character_id && m.name && m.character_id !== charId)
          relNameById[m.character_id] = m.name;
      });

      // Source 4: ALL messages — harvest sender/receiver IDs and names
      // CRITICAL: only index IDs that are NOT the viewed character — never self-index.
      allMsgs.forEach(m => {
        // character_id + character_name on the message = the sender character
        if (m.character_id && m.character_name && m.character_id !== charId && !isInternalValue(m.character_name)) {
          if (!relNameById[m.character_id]) relNameById[m.character_id] = m.character_name;
        }
        // sender_character_id — name comes from character_name when sender sent the message
        if (m.sender_character_id && m.sender_character_id !== charId && m.character_name && !isInternalValue(m.character_name)) {
          if (!relNameById[m.sender_character_id]) relNameById[m.sender_character_id] = m.character_name;
        }
        // receiver_character_id — resolve via charNameById (from Character entity)
        if (m.receiver_character_id && m.receiver_character_id !== charId && !relNameById[m.receiver_character_id]) {
          const rName = charNameById[m.receiver_character_id];
          if (rName && !isInternalValue(rName)) relNameById[m.receiver_character_id] = rName;
        }
      });

      console.log(`[CharacterDashboard] Name map: ${Object.keys(relNameById).length} IDs resolved for charId=${charId} | rcvMsgs=${rcvMsgs.length}`);

      const isInternalTitle = (t) =>
        !t ||
        t.startsWith("npc_chat__") ||
        t.startsWith("bilateral_") ||
        t.startsWith("world_phone_") ||
        t.startsWith("world_phone::") ||
        /^[a-f0-9-]{36}/.test(t);

      // convoId → { name, isGroup, isWorldPhone, beatType }
      const convoMeta = {};
      convos.forEach(c => {
        const isGroup = c.type === "group";
        const isWP    = c.channel === "world_phone";
        if (isGroup) { convoMeta[c.id] = { name: null, isGroup: true, isWorldPhone: false }; return; }

        // Resolve participant name — never expose raw IDs, channel types, or viewed character's own name
        let name = isInternalTitle(c.title) ? null : c.title;
        // Reject title if it is the viewed character's own name
        if (name && viewedCharName && name.trim().toLowerCase() === viewedCharName.trim().toLowerCase()) name = null;
        if (!name) {
          name = resolveOtherParticipantName(c, charId, viewedCharName, relNameById);
        }

        convoMeta[c.id] = { name, isGroup: false, isWorldPhone: isWP };
      });

      // Enrich convoMeta from ALL messages (both sides of the conversation)
      // CRITICAL: never set the viewed character's own name as the conversation participant name
      const acceptName = (n) => {
        if (!n || isInternalValue(n)) return null;
        if (viewedCharName && n.trim().toLowerCase() === viewedCharName.trim().toLowerCase()) return null;
        return n;
      };
      allMsgs.forEach(m => {
        if (convoMeta[m.conversation_id]?.name) return;
        const n = acceptName(m.character_id !== charId ? m.character_name : null)
          || acceptName(m.played_as_character_id !== charId ? m.played_as_character_name : null);
        if (n) {
          if (convoMeta[m.conversation_id]) convoMeta[m.conversation_id].name = n;
          else convoMeta[m.conversation_id] = { name: n, isGroup: false, isWorldPhone: false };
        }
      });

      // Enrich beat type from trigger_source on all messages
      allMsgs.forEach(m => {
        if (!m.trigger_source || m.trigger_source !== 'autonomous_social_beat') return;
        if (convoMeta[m.conversation_id]) {
          convoMeta[m.conversation_id].isAutonomousBeat = true;
        }
      });

      // ── Valid conversation IDs (scoped to this character's conversations) ──
      const validConvoIds = new Set(convos.map(c => c.id));

      // scopedMsgs: all messages (both sides) in conversations we loaded.
      // CRITICAL FALLBACK: if Conversation query returned 0 results (array-filter failure or 429),
      // do NOT discard all messages — use allMsgs directly so graph and timeline still populate.
      // The convoMeta name resolution will still work for any messages we have.
      const scopedMsgs = validConvoIds.size > 0
        ? allMsgs.filter(m => validConvoIds.has(m.conversation_id))
        : allMsgs;

      // ── Time windows — unified 3-day window for ALL dashboard metrics ─────
      // cutoff24h is kept only for legacy reference. No UI metric uses it.
      const msgs3d  = scopedMsgs.filter(m => { const d = m.timestamp || m.created_date; return d && isAfter(parseISO(d), parseISO(cutoff3d)); });
      const narrs3d    = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff3d)));
      const charNarrs3d = charNarrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff3d)));
      const txns3d     = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff3d)));

      // ── SOCIAL ACTIVITY STATS — scoped to last 3 days ───────────────────────
      // msgsSent = ALL messages in the 3-day window across scoped conversations.
      // Use allMsgs filtered to 3d directly when scopedMsgs is empty (Conversation query fallback).
      // This ensures message counts are never 0 just because the Conversation filter failed.
      const msgs3dFallback = msgs3d.length > 0 ? msgs3d
        : allMsgs.filter(m => { const d = m.timestamp || m.created_date; return d && isAfter(parseISO(d), parseISO(cutoff3d)); });
      const msgsSent = msgs3dFallback.length;

      // ── LEGACY-SAFE sentiment classification ──────────────────────────────
      // Priority: 1. emotional_state field  2. semantic inference from content (display only)
      // CRITICAL: inferEmotionFromText results are NEVER written back to Message records.
      const resolveMessageSentiment = (m) => {
        if (m.emotional_state) return m.emotional_state.toLowerCase();
        if (m.content) {
          const inf = inferEmotionFromText(m.content);
          if (inf) return inf.emotion.toLowerCase();
        }
        return null;
      };

      // ── SOCIAL ACTIVITY STATS — Message records only, last 3 days ────────
      // SOURCE: msgs3d exclusively. No LifeEvent, no narratives, no timelineEntries.
      // Messages count = all messages in scoped conversations (both sides) in 3-day window.
      // Positive / Conflict = classified per message emotional_state or inferred content.
      // CRITICAL: inferEmotionFromText results are NEVER written back to Message records.
      let positiveInteractions = 0;
      let conflictEvents = 0;
      let unclassifiedCount = 0;
      const sentimentBuckets = {};

      msgs3dFallback.forEach(m => {
        if (m.is_narrative === true) return; // autonomous narratives are not conversations
        const sentiment = resolveMessageSentiment(m);
        const bucket = sentiment || "unclassified";
        sentimentBuckets[bucket] = (sentimentBuckets[bucket] || 0) + 1;
        if (sentiment === null) {
          unclassifiedCount++;
        } else if (isPositive(sentiment)) {
          positiveInteractions++;
        } else if (isTense(sentiment)) {
          conflictEvents++;
        }
        // neutral/reflective: tallied in buckets only, not in positive or conflict
      });

      // Debug: full bucket distribution so classification issues are immediately visible
      const topBuckets = Object.entries(sentimentBuckets)
        .sort(([,a],[,b]) => b - a).slice(0, 15)
        .map(([k,v]) => `${k}:${v}`).join(', ');
      console.log(
        `[CharacterDashboard] SOCIAL ACTIVITY (msgs only) | msgs3d=${msgs3d.length}` +
        ` | positive=${positiveInteractions} | conflict=${conflictEvents} | unclassified=${unclassifiedCount}` +
        ` | buckets=[${topBuckets}]`
      );

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

      // ── Smart label formatter — only show day name when day changes ─────────
      // Tracks the last day seen so the label only includes "EEE" prefix on day-change.
      let lastLabelDay = "";
      const makeTrendLabel = (d) => {
        const dayStr = format(d, "EEE");
        const timeStr = format(d, "h:mma");
        if (dayStr !== lastLabelDay) {
          lastLabelDay = dayStr;
          return `${dayStr} ${timeStr}`;
        }
        return timeStr;
      };

      const addEvent = (isoTime, emotion, scoreOverride, source) => {
        if (!isoTime) return;
        try {
          const d = parseISO(isoTime);
          const tsMs = d.getTime();
          if (tsMs < cutoff3dMs || tsMs > now.getTime() + 60000) return;
          const em = (emotion || "calm").toLowerCase();
          const score = scoreOverride != null ? scoreOverride : eScore(em);
          rawEvents.push({ tsMs, emotion: em, score, source: source || "event" });
        } catch {}
      };

      // ── 1. LIFE JOURNAL — LifeEvent entity (the ACTUAL structured Life Journal) ─
      // event_type is the authoritative emotional classifier.
      // "supportive_event" and "conflict_event" produce DIFFERENT scores by design.
      // valence + severity further modulate the score.
      // We use created_date (when the record was written) OR timestamp field.
      lifeEvents.forEach(le => {
        const ts = le.timestamp || le.created_date;
        if (!ts) return;
        // Primary: use structured event_type for semantic score
        if (le.event_type && LIFE_EVENT_EMOTION[le.event_type]) {
          const { emotion, score } = lifeEventScore(le.event_type, le.valence, le.severity);
          addEvent(ts, emotion, score, `life:${le.event_type}`);
          return;
        }
        // Secondary: semantic inference from title + description + emotional_impact text
        const text = [le.title, le.description, le.emotional_impact].filter(Boolean).join(" ");
        const inferred = inferEmotionFromText(text);
        if (inferred) {
          addEvent(ts, inferred.emotion, inferred.score, "life:inferred");
        } else if (le.valence === "positive") {
          addEvent(ts, "content", 65, "life:positive");
        } else if (le.valence === "negative") {
          addEvent(ts, "stressed", 28, "life:negative");
        } else {
          addEvent(ts, "reflective", 50, "life:neutral");
        }
      });

      // ── 1b. character.memories[] — legacy inline array on Character record ──
      // These are older-format memories that may have emotion_state or free text.
      // Kept for backward compatibility but LifeEvent is now primary.
      (character.memories || []).forEach(m => {
        const timestamp = m.created_date || m.updated_date || m.date;
        if (!timestamp) return;
        if (m.emotion_state && EMOTION_SCORE[m.emotion_state?.toLowerCase()] != null) {
          addEvent(timestamp, m.emotion_state, null, "memory");
          return;
        }
        const text = [m.title, m.description, m.emotional_impact].filter(Boolean).join(" ");
        const inferred = inferEmotionFromText(text);
        if (inferred) addEvent(timestamp, inferred.emotion, inferred.score, "memory");
      });

      // ── 2. NARRATIVES (LLM-written — most reliable emotional_state field) ──
      narrs3d.forEach(n => {
        if (!n.timestamp) return;
        // Use narrative's emotional_state if present and meaningful
        if (n.emotional_state && n.emotional_state !== "calm") {
          addEvent(n.timestamp, n.emotional_state, null, "narrative");
          return;
        }
        // Infer from narrative type — CORRECTED weights:
        // Sleep/wake = normal life cycles, not emotional crises.
        // Work events = neutral-to-mild, not stress signals.
        const typeScores = {
          sleep:             ["tired",      44],  // normal end-of-day rest
          wake:              ["calm",       63],  // fresh start
          work_start:        ["calm",       60],  // going to work = normal, not stressed
          work_end:          ["relieved",   68],  // shift done = mild positive
          social_event:      ["content",    72],  // social = positive
          needs_warning:     ["stressed",   30],  // genuine stress signal
          catch_up_summary:  ["reflective", 52],
          passive_time:      ["calm",       60],
          location_change:   ["calm",       58],
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
      // Use msgs3dFallback so this doesn't return 0 if Conversation filter failed.
      msgs3dFallback.forEach(m => {
        if (m.is_narrative === true) return; // autonomous narratives are not conversations
        const mDate = m.timestamp || m.created_date;
        if (!mDate) return;
        if (m.emotional_state && m.emotional_state !== "calm") {
          addEvent(mDate, m.emotional_state, null, "message");
        } else if (m.content) {
          const inf = inferEmotionFromText(m.content);
          if (inf) addEvent(mDate, inf.emotion, inf.score, "message");
          else if (m.emotional_state) addEvent(mDate, m.emotional_state, null, "message");
        }
      });

      // ── 4. FINANCIAL SIGNALS — only meaningful financial events ──────────────
      // Small routine expenses (groceries, utilities) are not emotional events.
      // Only large unexpected expenses or income create graph points.
      txns3d.forEach(t => {
        if (!t.timestamp) return;
        if (t.direction === "expense") {
          const amt = Math.abs(t.amount || 0);
          // Only add if it's a significant expense — routine small purchases are not stress events
          if (amt > 300) addEvent(t.timestamp, "stressed", 28, "financial");
          else if (amt > 100) addEvent(t.timestamp, "stressed", 36, "financial"); // mild concern
          // Small expenses omitted — not emotionally significant
        } else if (t.direction === "income") {
          // Getting paid = positive
          addEvent(t.timestamp, "relieved", 70, "financial");
        }
      });

      // ── 4b. CHARACTER AUTOMATIC NARRATIVES — need-fulfillment durable proof ──
      // event_type 'need_fulfillment' records are the durable proof that corrective
      // actions (ate, showered, slept, etc.) completed. Score based on event_type.
      charNarrs3d.forEach(n => {
        if (!n.timestamp) return;
        const typeScores = {
          need_fulfillment:  ["calm",       65],  // ate/showered/slept = positive completion
          sleep:             ["tired",      44],
          wake:              ["calm",       63],
          work_start:        ["calm",       60],
          work_end:          ["relieved",   68],
          social_event:      ["content",    72],
          needs_warning:     ["stressed",   30],
          catch_up_summary:  ["reflective", 52],
          passive_time:      ["calm",       60],
          location_change:   ["calm",       58],
        };
        const ts = typeScores[n.event_type];
        if (ts) { addEvent(n.timestamp, ts[0], ts[1], "char_narrative"); return; }
        if (n.emotional_state) addEvent(n.timestamp, n.emotional_state, null, "char_narrative");
      });

      // ── 5. SLEEP / WAKE LIFECYCLE ──────────────────────────────────────────
      // Sleep = normal wind-down, NOT a crisis. Score it as tired (normal).
      // Wake = fresh start, mild positive.
      if (character.last_sleep_start) addEvent(character.last_sleep_start, "tired", 44, "sleep");
      if (character.alarm_woke_at)    addEvent(character.alarm_woke_at, "calm", 63, "wake");

      // ── 6. NEEDS-DERIVED SIGNALS — reduced influence, only genuine distress ─
      // RULE: Normal biological states (tired, hungry, busy) must NOT dominate.
      // Only add needs signals when they reach a genuinely distressing threshold.
      // These are background context — they must not overpower social/life events.
      const nowIso = now.toISOString();
      if ((character.mental_value ?? 100) < 30)        addEvent(nowIso, "overwhelmed", 18, "needs");
      else if ((character.mental_value ?? 100) < 45)   addEvent(nowIso, "stressed",   32, "needs");
      if ((character.social_value ?? 100) < 25)        addEvent(nowIso, "lonely",     34, "needs");
      if ((character.energy_value ?? 100) < 15)        addEvent(nowIso, "exhausted",  30, "needs"); // severe only
      // NOTE: tired/hungry are normal life states — NOT added as graph signals
      if ((character.financial_need_value ?? 0) > 80)  addEvent(nowIso, "stressed",   28, "needs");
      // hunger below 15 only (extreme, not just peckish)
      if ((character.hunger_value ?? 100) < 15)        addEvent(nowIso, "frustrated", 32, "needs");

      // ── 7. CURRENT STATE ANCHOR ────────────────────────────────────────────
      addEvent(nowIso, curEmotion, null, "current");

      // ── 8. PERIODIC DENSITY FILL — ensure multiple points per day ────────────
      // If there are large gaps (> 4 hours) in the 3-day window, insert periodic
      // emotional baseline anchors using the character's current emotional state.
      // This prevents the graph from collapsing to 1 point per day.
      // These are low-priority fills — real events will replace them during dedup.
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      const windowStart = cutoff3dMs;
      const windowEnd = now.getTime();
      for (let t = windowStart + FOUR_HOURS_MS; t < windowEnd - FOUR_HOURS_MS; t += FOUR_HOURS_MS) {
        addEvent(new Date(t).toISOString(), curEmotion, null, "periodic");
      }

      // Sort chronologically
      rawEvents.sort((a, b) => a.tsMs - b.tsMs);

      // Deduplication — source-priority based, with different windows per source type.
      // RULE: A positive social event must NOT be replaced by a nearby biological need signal.
      // Source priority: life > message/memory > narrative > financial > current/sleep/needs > periodic
      const SOURCE_PRIORITY = { 'life': 7, 'message': 6, 'memory': 5, 'narrative': 4, 'char_narrative': 4, 'financial': 3, 'current': 2, 'sleep': 2, 'wake': 2, 'needs': 2, 'periodic': 0 };
      const srcPri = (src) => { if (!src) return 0; for (const [k, v] of Object.entries(SOURCE_PRIORITY)) { if (src.startsWith(k)) return v; } return 1; };

      // Periodic fills use a 3-hour dedup window; real events use 5 minutes.
      const dedupWindow = (src) => src === 'periodic' ? 3 * 60 * 60 * 1000 : 5 * 60 * 1000;

      const deduped = [];
      for (const ev of rawEvents) {
        const prev = deduped[deduped.length - 1];
        const window = Math.max(dedupWindow(ev.source), prev ? dedupWindow(prev.source) : 0);
        if (prev && Math.abs(ev.tsMs - prev.tsMs) < window) {
          // Prefer higher-priority source
          const evPri = srcPri(ev.source);
          const prevPri = srcPri(prev.source);
          if (evPri > prevPri) {
            deduped[deduped.length - 1] = ev;
          } else if (evPri === prevPri && ev.score > prev.score) {
            deduped[deduped.length - 1] = ev;
          }
          // Otherwise keep existing
        } else {
          deduped.push(ev);
        }
      }

      // ── MOMENTUM SMOOTHING ────────────────────────────────────────────────
      // Prevent emotional whiplash. Each point is blended with its neighbors
      // using a weighted average: 20% prev + 60% current + 20% next.
      // This preserves meaningful peaks and valleys while dampening single-event spikes.
      // Needs/sleep signals that fall between positive events won't create cliff drops.
      const smoothed = deduped.map((ev, i) => {
        if (deduped.length < 3) return ev;
        const prev = deduped[i - 1];
        const next = deduped[i + 1];
        if (!prev && !next) return ev;
        const prevScore = prev ? prev.score : ev.score;
        const nextScore = next ? next.score : ev.score;
        const blended = Math.round(prevScore * 0.20 + ev.score * 0.60 + nextScore * 0.20);
        return { ...ev, score: blended };
      });

      // Build final chart data — assign labels NOW (after sort+dedup+smooth) so
      // day-change detection is correct and "Tuesday" only appears once per day.
      lastLabelDay = ""; // reset for label pass
      const trendData = smoothed.map(e => ({
        label: makeTrendLabel(new Date(e.tsMs)),
        mood: Math.round(e.score),
        emotion: e.emotion,
        tsMs: e.tsMs,
        source: e.source,
      }));

      // ── TIMELINE ENTRIES ──────────────────────────────────────────────────
      const timelineEntries = [];

      // Sleep / wake — last 3 days
      if (character.last_sleep_start && isAfter(parseISO(character.last_sleep_start), parseISO(cutoff3d)))
        timelineEntries.push({ time: character.last_sleep_start, icon: "moon", text: "Went to sleep", emotion: "exhausted" });
      if (character.alarm_woke_at && isAfter(parseISO(character.alarm_woke_at), parseISO(cutoff3d)))
        timelineEntries.push({ time: character.alarm_woke_at, icon: "sun", text: "Woke up", emotion: "calm" });

      // Life Journal entries in last 3 days
      const lifeEventIconMap = {
        supportive_event: "heart", bonding_event: "heart", celebration_event: "heart",
        conflict_event: "activity", fight_event: "activity", betrayal_event: "activity",
        grief_event: "book", recovery_event: "book", growth_event: "book",
        work_start: "briefcase", sleep_deprivation_event: "moon",
        location_change_event: "mappin",
      };
      lifeEvents.filter(le => {
        const ts = le.timestamp || le.created_date;
        return ts && isAfter(parseISO(ts), parseISO(cutoff3d));
      }).forEach(le => {
        const ts = le.timestamp || le.created_date;
        const { emotion } = le.event_type && LIFE_EVENT_EMOTION[le.event_type]
          ? lifeEventScore(le.event_type, le.valence, le.severity)
          : { emotion: "reflective" };
        timelineEntries.push({
          time: ts,
          icon: lifeEventIconMap[le.event_type] || "activity",
          text: le.title || le.description?.substring(0, 80) || "Life event",
          emotion,
          sub: le.severity ? `${le.severity} · ${le.valence || ""}` : null,
        });
      });

      // Narratives (LLM-written, already human text) — last 3 days
      const narIconMap = { sleep:"moon", wake:"sun", work_start:"briefcase", work_end:"home", travel_arrival:"mappin", travel_departure:"mappin", social_event:"heart", catch_up_summary:"book", location_change:"mappin", passive_time:"activity", need_fulfillment:"activity" };
      narrs3d.forEach(n => {
        const text = (n.narrative_text || "").substring(0, 100);
        if (text) timelineEntries.push({ time: n.timestamp, icon: narIconMap[n.event_type] || "activity", text, emotion: n.emotional_state || curEmotion });
      });

      // CharacterAutomaticNarrative — durable proof records from simulation corrective actions
      const charNarIconMap = { need_fulfillment:"activity", sleep:"moon", wake:"sun", work_start:"briefcase", work_end:"home", travel_arrival:"mappin", travel_departure:"mappin", social_event:"heart", catch_up_summary:"book", location_change:"mappin", passive_time:"activity" };
      charNarrs3d.forEach(n => {
        const text = (n.narrative_text || "").substring(0, 100);
        const subtitle = n.event_type === 'need_fulfillment' ? 'Need fulfilled' : null;
        if (text) timelineEntries.push({ time: n.timestamp, icon: charNarIconMap[n.event_type] || "activity", text, emotion: n.emotional_state || curEmotion, sub: subtitle });
      });

      // Financial events — last 3 days
      txns3d.forEach(t => {
        if (!t.description) return;
        timelineEntries.push({ time: t.timestamp, icon: "dollar", text: t.description, emotion: t.direction === "expense" ? "stressed" : "calm", sub: t.location_name || null });
      });

      // Location history — recent places visited in last 3 days
      locHistory.filter(h => h.arrival_time && isAfter(parseISO(h.arrival_time), parseISO(cutoff3d))).forEach(h => {
        const locCat = h.location_category || '';
        const icon = locCat === 'home' ? 'home' : locCat === 'work' ? 'briefcase' : locCat === 'gym' ? 'activity' : locCat === 'food_drink' ? 'dollar' : locCat === 'social' ? 'heart' : 'mappin';
        const reasonText = h.travel_reason || h.event_type || 'Visited';
        timelineEntries.push({
          time: h.arrival_time,
          icon,
          text: h.location_name ? `${reasonText} · ${h.location_name}` : reasonText,
          emotion: locCat === 'gym' ? 'motivated' : locCat === 'food_drink' ? 'content' : locCat === 'social' ? 'content' : 'calm',
          sub: h.duration_minutes ? `${h.duration_minutes} min` : null,
        });
      });

      // Event Participation — community events the character attended
      eventParts.filter(ep => ep.participation_date && isAfter(parseISO(ep.participation_date), parseISO(cutoff3d))).forEach(ep => {
        const tone = ep.emotional_tone || 'neutral';
        const emotion = tone === 'enjoyed' || tone === 'energized' ? 'happy' : tone === 'uncomfortable' || tone === 'drained' ? 'stressed' : 'calm';
        timelineEntries.push({
          time: ep.participation_date,
          icon: 'activity',
          text: ep.event_name ? `Attended: ${ep.event_name}` : 'Attended a community event',
          emotion,
          sub: ep.participation_type ? `${ep.participation_type} · ${tone}` : tone,
        });
      });

      // Messages — one entry per conversation, most emotionally significant message
      // Include ALL participants (character-to-character, character-to-user, world phone)
      const convoMsgPick = {};
      const priorityScore = (s) => {
        const p = { angry:6, tense:6, irritated:6, defensive:6, sad:5, anxious:4, reflective:3, happy:2, calm:2 };
        return p[(s||"").toLowerCase()] || 1;
      };
      // Include ALL messages in last 3 days — legacy messages without emotional_state use inferred sentiment for priority
      msgs3dFallback.forEach(m => {
        if (m.is_narrative === true) return; // autonomous narratives are not conversations — no "Conversation with" entry
        const resolvedEmotion = m.emotional_state || (m.content ? inferEmotionFromText(m.content)?.emotion : null) || null;
        const existing = convoMsgPick[m.conversation_id];
        if (!existing || priorityScore(resolvedEmotion) > priorityScore(existing._resolvedEmotion))
          convoMsgPick[m.conversation_id] = { ...m, _resolvedEmotion: resolvedEmotion };
      });

      Object.values(convoMsgPick).slice(0, 8).forEach(m => {
        const meta = convoMeta[m.conversation_id] || { name: null, isGroup: false, isWorldPhone: false };

        // Last-chance name resolution — strict: never accept viewed character's own name or internal values
        let resolvedName = acceptName(meta.name);

        if (!resolvedName) {
          // Priority 1: message.character_id is the other character (sender case)
          resolvedName = acceptName(m.character_id !== charId ? m.character_name : null);
        }
        if (!resolvedName) {
          // Priority 2: receiver_character_id is the other participant
          if (m.receiver_character_id && m.receiver_character_id !== charId) {
            resolvedName = acceptName(relNameById[m.receiver_character_id] || null);
          }
        }
        if (!resolvedName) {
          // Priority 3: sender_character_id is the other participant
          if (m.sender_character_id && m.sender_character_id !== charId) {
            resolvedName = acceptName(relNameById[m.sender_character_id] || null);
          }
        }
        if (!resolvedName) {
          // Priority 4: participant_character_ids on the message itself
          const msgParticipants = m.participant_character_ids || [];
          for (const pid of msgParticipants) {
            if (pid !== charId && relNameById[pid]) {
              const n = acceptName(relNameById[pid]);
              if (n) { resolvedName = n; break; }
            }
          }
        }
        if (!resolvedName) {
          // Priority 5: parse shared_conversation_key on the message
          const msgKey = m.shared_conversation_key || '';
          if (msgKey.startsWith('world_phone::')) {
            const parts = msgKey.replace('world_phone::', '').split('::');
            for (const part of parts) {
              if (part && part !== charId && relNameById[part]) {
                const n = acceptName(relNameById[part]);
                if (n) { resolvedName = n; break; }
              }
            }
          }
        }

        // Full diagnostic log for every entry — always log so failures are visible
        console.log(
          `[CharacterDashboard] RESOLVE | viewed_character_id=${charId} viewed_name="${viewedCharName}"` +
          ` | msg_id=${m.id || 'none'} | conv_id=${m.conversation_id}` +
          ` | conv_type=${convos.find(c=>c.id===m.conversation_id)?.type || 'none'} | channel=${m.channel || 'none'}` +
          ` | msg.character_id=${m.character_id || 'none'} | msg.character_name="${m.character_name || ''}"` +
          ` | sender_character_id=${m.sender_character_id || 'none'}` +
          ` | receiver_character_id=${m.receiver_character_id || 'none'}` +
          ` | participant_character_ids=${JSON.stringify(m.participant_character_ids || [])}` +
          ` | shared_key=${m.shared_conversation_key || 'none'}` +
          ` | meta.name="${meta.name || ''}"` +
          ` | resolved_other_name="${resolvedName || 'UNRESOLVED'}"` +
          ` | name_map_size=${Object.keys(relNameById).length}`
        );
        if (!resolvedName) {
          console.warn(
            `[CharacterDashboard] PARTICIPANT_UNRESOLVED — falling back to null | conv_id=${m.conversation_id}` +
            ` | name_map_keys=[${Object.keys(relNameById).slice(0, 15).join(', ')}]`
          );
        }

        const beatType = (m.trigger_source === 'autonomous_social_beat' || meta.isAutonomousBeat)
          ? 'social_checkin'
          : null;

        timelineEntries.push({
          time: m.timestamp || m.created_date,
          icon: meta.isWorldPhone || meta.isAutonomousBeat ? "phone" : "message",
          text: buildMsgText(m._resolvedEmotion || m.emotional_state, resolvedName, meta.isGroup, meta.isWorldPhone, beatType),
          emotion: m._resolvedEmotion || m.emotional_state,
          _unresolved: !resolvedName, // internal flag — never shown in UI
        });
      });

            timelineEntries.sort((a, b) => { try { return new Date(b.time) - new Date(a.time); } catch { return 0; } });

      // Add character's current live status to the timeline if it provides new information.
      const cardStatusText = livePresence.sublabel ? `${livePresence.label} · ${livePresence.sublabel}` : livePresence.label;
      const mostRecentText = timelineEntries[0]?.text;

      // Only add the current status if it's different from the most recent historical event.
      if (cardStatusText && cardStatusText !== '—' && cardStatusText !== mostRecentText) {
        const statusIconMap = { at_work: "briefcase", at_school: "book", home: "home", sleeping: "moon", napping: "moon", visiting: "mappin", traveling: "mappin", under_supervision: "activity" };
        timelineEntries.unshift({ // Add to the beginning of the already-sorted array
            time: character.resolved_last_updated_at || character.updated_date,
            icon: statusIconMap[liveStatus] || "activity",
            text: cardStatusText,
            emotion: character.emotional_state || "calm",
        });
      }



      // ── Occupation social context ──────────────────────────────────────────
      const occSocialContext = getOccupationSocialContext(character);
      const hasPeopleJob = !!occSocialContext;

      // ── Pattern insights ──────────────────────────────────────────────────
      const insights = [];
      if (conflictEvents > 0 && character.work_start_time) insights.push("Tension tends to surface on or around work days.");

      // Social need insight — context-aware: don't say "isolation" for someone with a people-facing job
      const socialVal = character.social_value ?? 100;
      if (socialVal < 40) {
        if (hasPeopleJob && (liveStatus === 'at_work' || character.work_start_time)) {
          // Work provides social exposure — distinguish from true isolation
          insights.push("Social fulfillment is lower than work exposure alone would suggest — meaningful personal connection may still be missing.");
        } else {
          insights.push("Social needs are low — isolation may be building.");
        }
      }

      if ((character.sleep_debt_hours ?? 0) > 2 || (character.energy_value ?? 100) < 30) insights.push("Rest is disrupted — exhaustion is affecting emotional stability.");
      if ((character.mental_value ?? 100) < 40) insights.push("Mental health is under strain.");
      if ((character.financial_need_value ?? 0) > 70) insights.push("Financial pressure is elevated and shaping mood.");
      if (positiveInteractions > conflictEvents * 2 && positiveInteractions > 1) insights.push("Positive interactions are currently outweighing conflict.");
      if (conflictEvents > positiveInteractions && conflictEvents > 0) insights.push("More conflict than connection recently.");

      // "No communication" — only show if character does NOT have a people-facing occupation
      // A bartender who worked a full shift is NOT socially inactive even if no messages were sent
      if (msgsSent === 0) {
        if (hasPeopleJob) {
          insights.push(`No direct messages recorded in the last 3 days, but ${character.occupation || 'the job'} involves ongoing social interaction during work hours.`);
        } else {
          insights.push("No direct communication recorded in the last 3 days.");
        }
      }

      // Occupation social context — add as a dedicated insight when relevant
      if (occSocialContext && (liveStatus === 'at_work' || msgsSent === 0)) {
        insights.push(occSocialContext);
      }

      if (liveStatus === "at_school") insights.push("Academic schedule is currently active.");
      if (liveStatus === "at_work") insights.push("Work schedule is currently active.");

      // Employment / income source — resolve dynamically from character data
      const workLocationName = character.occupation_location_name ||
        (character.occupation_location_id && locationMap[character.occupation_location_id]?.name) ||
        null;
      const hasEmploymentData = !!(character.occupation && (workLocationName || character.current_work_location_id));
      if (hasEmploymentData && workLocationName) {
        insights.push(`Employed at ${workLocationName}${character.occupation ? ` as ${character.occupation}` : ''}.`);
      } else if (character.occupation && !workLocationName) {
        insights.push(`Occupation: ${character.occupation}. Work location not yet linked.`);
      }

      // ── Life Journal highlights — from LifeEvent entity (not character.memories) ─
      // Show the most emotionally significant recent LifeEvents as the highlight panel.
      const memoryHighlights = lifeEvents
        .filter(le => le.title && le.title.trim().length > 3)
        .slice(0, 4)
        .map(le => {
          const { emotion } = le.event_type && LIFE_EVENT_EMOTION[le.event_type]
            ? lifeEventScore(le.event_type, le.valence, le.severity)
            : { emotion: "reflective" };
          return {
            title: le.title,
            note: le.emotional_impact || le.description?.substring(0, 120) || null,
            active: le.valence === "negative" || le.severity === "significant" || le.severity === "major",
            emotion,
            time: le.timestamp || le.created_date || null,
          };
        });

      // ── Work / income summary for Current State panel ─────────────────────
      const workDisplay = workLocationName
        ? `${workLocationName}${character.occupation ? ` · ${character.occupation}` : ''}`
        : character.occupation || null;

      // ── PIPELINE DEBUG TRACE — temporary, remove after verification ──────────
      console.log(
        `[CharacterDashboard] PIPELINE TRACE | requestCharId=${requestCharId} | name="${character.name || '?'}"` +
        ` | outgoingMsgs=${msgs.length} | receivedMsgs=${rcvMsgs.length} | combinedMsgs=${allMsgs.length}` +
        ` | validConvos=${validConvoIds.size} | scopedMsgs=${scopedMsgs.length}` +
        ` | msgs3d=${msgs3d.length} | msgs3dFallback=${msgs3dFallback.length}` +
        ` | lifeEvents=${lifeEvents.length} | autoNarrs=${narrs.length} | charAutoNarrs=${charNarrs.length}` +
        ` | finTxns=${txns.length} | locHistory=${locHistory.length} | eventParts=${eventParts.length}` +
        ` | timelineEntries=${timelineEntries.length} | trendData=${trendData.length}` +
        ` | socialStats={msgsSent:${msgsSent},positive:${positiveInteractions},conflict:${conflictEvents},unclassified:${unclassifiedCount}}` +
        ` | ownerEmail=${ownerEmail || 'MISSING'} | allChars=${allChars.length}` +
        ` | activeRequestRef=${activeRequestRef.current}`
      );

      const dashData = { charId: requestCharId, liveSnapshot: buildLiveCharacterSnapshot(character), liveLocationDisplay, liveStatus, timelineSourcesComplete, trendData, timelineEntries: timelineEntries.slice(0, 20), socialStats: { msgsSent, positiveInteractions, conflictEvents, unclassifiedCount }, insights: insights.slice(0, 5), memoryHighlights, workDisplay, hasPeopleJob, occSocialContext };
      // Guard: only write if this charId is still the active request
      if (requestCharId !== activeRequestRef.current) {
        console.log(`[CharacterDashboard] STALE — discarding result for ${requestCharId}, active is ${activeRequestRef.current}`);
        return;
      }
      // Write cache under REQUEST charId — but ONLY when the timeline-authoritative
      // queries all fulfilled. A partial result (transient 429 on a timeline-critical
      // query) must NOT be cached, so the next profile open refetches instead of
      // serving an incomplete record as if it were authoritative.
      if (timelineSourcesComplete) {
        dashboardCache[requestCharId] = dashData;
        dashboardCacheVersion[requestCharId] = DASHBOARD_CACHE_VERSION;
      }
      setData(dashData);
      setLoaded(timelineSourcesComplete);
      setLoading(false);
    }).catch((err) => {
      if (requestCharId !== activeRequestRef.current) return;
      console.error('[CharacterDashboard] Fatal fetch error:', err?.message);
      // Set minimal fallback data so the dashboard renders with what it has.
      // IMPORTANT: Do NOT cache this fallback — a 429 or transient failure is
      // temporary. Caching empty fallback would suppress the graph and timeline
      // for the entire session on this character. Let it retry on next open.
      const fallbackData = {
        liveLocationDisplay: character?.resolved_current_location_name || '—',
        liveStatus: character?.resolved_presence_status || 'home',
        timelineSourcesComplete: false,
        trendData: [],
        timelineEntries: [],
        socialStats: { msgsSent: 0, positiveInteractions: 0, conflictEvents: 0, unclassifiedCount: 0 },
        insights: [],
        memoryHighlights: [],
        workDisplay: character?.occupation_location_name || character?.occupation || null,
        hasPeopleJob: false,
        occSocialContext: null,
      };
      // Do NOT write to dashboardCache here — keep loaded=false so next open retries
      setData(fallbackData);
      setLoaded(false); // allows retry on next profile open
      setLoading(false);
    });
  }, [charId]); // eslint-disable-line

  if (loading) return <div className="flex items-center justify-center py-10"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  // NEVER return null — always render the dashboard shell even if data is minimal
  if (!data) return <div className="flex items-center justify-center py-10"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;

  const { liveLocationDisplay, liveStatus, timelineSourcesComplete, trendData, timelineEntries, socialStats, insights, memoryHighlights, workDisplay } = data;
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

        {/* Recent Activity — Last 3 Days */}
        <div className="sm:col-span-3 rounded-xl overflow-hidden bg-card border border-border">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recent Activity · Last 3 Days</p>
          </div>
          {!timelineSourcesComplete
            ? (
              <div className="px-4 py-6 flex items-center gap-2.5">
                <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin flex-shrink-0" />
                <p className="text-xs text-muted-foreground">Loading recent activity…</p>
              </div>
            )
            : timelineEntries.length === 0
              ? <p className="px-4 py-4 text-xs text-muted-foreground italic">No recorded activity in the last 3 days.</p>
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
                        {entry.time && <p className="text-[9px] text-muted-foreground whitespace-nowrap">{fmtDayTime(entry.time)}</p>}
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
                { label: "Mental Well-being", value: character.mental_value !== undefined ? `${character.mental_value}%` : "—" },
                { label: "Social Need", value: character.social_value    !== undefined ? `${character.social_value}%`    : "—" },
                { label: "Hunger",      value: character.hunger_value    !== undefined ? `${character.hunger_value}%`    : "—" },
                // Canonical live location — same source as CharacterCard (requires locationMap from LocationReference entity)
                { label: "Location",    value: liveLocationDisplay },
                ...(workDisplay ? [{ label: "Work", value: workDisplay }] : []),
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Social Activity · Last 3 Days</p>
            </div>
            <div className="flex divide-x divide-border/40">
              <StatChip icon={MessageCircle} label="Messages" value={socialStats.msgsSent} />
              <StatChip icon={Heart}         label="Positive"  value={socialStats.positiveInteractions} />
              <StatChip icon={Zap}           label="Conflict"  value={socialStats.conflictEvents} />
            </div>
            {socialStats.unclassifiedCount > 0 && (
              <p className="px-4 pb-2 text-[9px] text-muted-foreground/60">
                +{socialStats.unclassifiedCount} message{socialStats.unclassifiedCount !== 1 ? 's' : ''} without sentiment data
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── 3. PATTERN INSIGHTS + MEMORY HIGHLIGHTS + TRAVEL HISTORY ─────── */}
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
                    {mem.time && <p className="text-[9px] text-muted-foreground/70 mt-0.5">{fmtDayTime(mem.time)}</p>}
                    {mem.note && <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{mem.note}</p>}
                  </div>
                  {mem.active && <span className="text-[8px] font-medium whitespace-nowrap flex-shrink-0 mt-1" style={{ color: eColor(mem.emotion || "stressed") }}>Still active</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Travel History — in the same grid row as Memory Highlights */}
        <TravelHistoryCard characterId={character?.id} ownerEmail={character?.owner_email} character={character} />
      </div>

    </div>
  );
}