import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
// ── CANONICAL-FIRST ARCHITECTURE ──────────────────────────────────────────────
// This file NO LONGER builds character identity, personality, memory, family,
// relationships, or soap opera context inline. All of that is owned by
// buildCanonicalCharacterContext (backend single source of truth).
//
// This file ONLY adds:
//   - temporal state (live clock, daypart, sleep/wake, continuity)
//   - live needs block
//   - beat progression engine (lexical variation, repetition guard)
//   - scene reaction engine (body language, pacing, positioning)
//   - interaction libraries (flirt, comfort, reassure, etc.)
//   - sleep gate (pre-generation hard block + post-generation validator)
//
// Migration complete: 2026-05-07
// All 5 output routes now use canonical context:
//   Chat/Text → buildSystemPrompt (frontend equivalent)
//   generateNarrative → buildCanonicalCharacterContext ✓
//   generateGroupChatResponse → buildCanonicalCharacterContext ✓
//   generateAutomaticNarrative → buildCanonicalCharacterContext ✓
//   sendProactiveMessageForCharacter → buildCanonicalCharacterContext ✓
//   WorldContactsPopup → buildCanonicalCharacterContext ✓
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateNarrative
 *
 * ════════════════════════════════════════════════════════════════
 * CANONICAL-FIRST NARRATIVE GENERATOR
 * ════════════════════════════════════════════════════════════════
 *
 * Architecture: buildCanonicalCharacterContext owns ALL identity,
 * memory, hard facts, Life Journal, relationships, and soap opera context.
 * This function ONLY adds:
 *   - temporal state (live clock, daypart, sleep, continuity)
 *   - live needs block
 *   - location/schedule enforcement
 *   - beat progression engine (lexical variation, repetition guard)
 *   - scene reaction engine (body language, pacing, positioning)
 *   - interaction libraries (flirt, comfort, reassure, etc.)
 *   - sleep gate (pre- and post-generation)
 *
 * It does NOT build identity, personality, memory, or family independently.
 */

// ── INLINE TEMPORAL STATE ENGINE ─────────────────────────────────────────────

function getDaypartLabel(hourET) {
  const h = ((hourET % 24) + 24) % 24;
  if (h < 4)  return { id: 'deep_night',    label: 'deep night' };
  if (h < 6)  return { id: 'pre_dawn',      label: 'pre-dawn' };
  if (h < 8)  return { id: 'early_morning', label: 'early morning' };
  if (h < 12) return { id: 'morning',       label: 'morning' };
  if (h < 14) return { id: 'midday',        label: 'midday' };
  if (h < 17) return { id: 'afternoon',     label: 'afternoon' };
  if (h < 20) return { id: 'evening',       label: 'evening' };
  if (h < 22) return { id: 'night',         label: 'night' };
  return { id: 'late_night', label: 'late night' };
}

const DAYPART_ENV = {
  deep_night:    { awake: 'The space is dark and quiet, well past midnight. The world is fully still.',    asleep: 'Deep night. The room is dark and still — the hours between midnight and dawn.' },
  pre_dawn:      { awake: 'Pre-dawn quiet. The sky is still dark but the night is winding toward its end.', asleep: 'Pre-dawn stillness. Still dark, but a different quiet than midnight — the night is almost over.' },
  early_morning: { awake: 'Early morning. The first soft gray-blue light is gathering outside.',            asleep: 'Early morning, though they are still asleep. The curtains are catching the first dim light of dawn.' },
  morning:       { awake: 'Morning. Natural light is filling the space and the day is underway.',           asleep: 'Morning now, though they are still asleep. Daylight is pressing at the curtains.' },
  midday:        { awake: 'Midday. The sun is at its peak.',                                               asleep: 'Well into midday. Bright light through the curtains, the world fully active outside.' },
  afternoon:     { awake: 'Mid-afternoon. Warm light, the day in full stride.',                            asleep: 'Afternoon. Golden light through the window — the day is already half-spent.' },
  evening:       { awake: 'Evening. The light is fading, the day winding down.',                           asleep: 'Early evening. The daylight has gone soft outside, fading toward night.' },
  night:         { awake: 'Night. The day is over, the city in its evening rhythm.',                       asleep: 'Night. The room is dim, the world outside in its nighttime pace.' },
  late_night:    { awake: 'Late night. Quiet streets, the hours running toward midnight.',                 asleep: 'Late night. The room is still and dark — well past midnight, deep into the night hours.' },
};

function buildTemporalBlock(char, lastMsgTimestamp, sunriseTime, sunsetTime) {
  const nowET    = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hourET   = nowET.getHours();
  const minET    = nowET.getMinutes();
  const timeStr  = `${hourET % 12 || 12}:${String(minET).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;
  const dayOfWeek = nowET.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr  = nowET.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const dp       = getDaypartLabel(hourET);
  const envCues  = DAYPART_ENV[dp.id] || DAYPART_ENV.deep_night;

  const rp = char?.resolved_presence_status;
  let isAsleep = rp === 'sleeping' || rp === 'napping';
  if (!isAsleep && char?.sleep_start_time && char?.wake_up_time) {
    const sH = parseInt(char.sleep_start_time.split(':')[0], 10);
    const wH = parseInt(char.wake_up_time.split(':')[0], 10);
    isAsleep = sH > wH ? (hourET >= sH || hourET < wH) : (hourET >= sH && hourET < wH);
  }
  const envCue = isAsleep ? envCues.asleep : envCues.awake;

  let elapsedLabel = null;
  let continuityMode = 'immediate';
  let dayChanged = false;
  let sleepOccurred = false;

  if (lastMsgTimestamp) {
    const lastMs = new Date(lastMsgTimestamp).getTime();
    const elapsedMs = Date.now() - lastMs;
    const mins = Math.floor(elapsedMs / 60000);
    const hrs  = Math.floor(elapsedMs / 3600000);
    const days = Math.floor(elapsedMs / 86400000);

    if (elapsedMs < 90000)      elapsedLabel = 'just now';
    else if (mins < 60)         elapsedLabel = `${mins} minutes ago`;
    else if (hrs < 24)          elapsedLabel = `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
    else if (days === 1)        elapsedLabel = 'yesterday';
    else                        elapsedLabel = `${days} days ago`;

    const lastET = new Date(new Date(lastMsgTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    dayChanged = lastET.getDate() !== nowET.getDate() || lastET.getMonth() !== nowET.getMonth();
    sleepOccurred = elapsedMs > 5 * 3600 * 1000 || (dayChanged && elapsedMs > 2 * 3600 * 1000);

    if (dayChanged && elapsedMs > 86400000 * 1.5) continuityMode = 'long_absence';
    else if (dayChanged)        continuityMode = 'next_day';
    else if (sleepOccurred)     continuityMode = 'resumed_after_sleep';
    else if (elapsedMs < 300000) continuityMode = 'immediate';
    else if (elapsedMs < 3600000) continuityMode = 'recent';
    else if (elapsedMs < 21600000) continuityMode = 'same_day_gap';
    else                        continuityMode = 'resumed_after_gap';
  }

  const continuityDesc = {
    immediate:           'Immediate continuation — last exchange was moments ago.',
    recent:              'Recent exchange — under an hour ago, conversation has natural momentum.',
    same_day_gap:        'A few hours have passed — same day but resumed, not continuous.',
    resumed_after_gap:   'Several hours have passed — interaction is resumed, not continued.',
    resumed_after_sleep: 'Sleep occurred since last interaction — this is a new-day resumption.',
    next_day:            "Next day. Yesterday's conversation is memory, not an ongoing moment.",
    long_absence:        'Multiple days have passed. Prior topics are background only.',
  }[continuityMode] || '';

  const sleepLine = isAsleep
    ? `Sleep state: ASLEEP — but the WORLD CLOCK has NOT FROZEN. The current daypart is "${dp.label.toUpperCase()}". Environmental descriptions MUST match this.`
    : `Sleep state: AWAKE`;

  return {
    block: `
════════════════════════════════════
TEMPORAL STATE — AUTHORITATIVE (recalculated from live clock — cannot be overridden)
════════════════════════════════════
Current time:  ${timeStr}
Current day:   ${dayOfWeek}, ${dateStr}
Daypart:       ${dp.label.toUpperCase()}
${sleepLine}
${elapsedLabel ? `Last interaction: ${elapsedLabel}\n` : ''}Continuity:    ${continuityMode.replace(/_/g, ' ')} — ${continuityDesc}

ENVIRONMENT CUE (match this — do not use stale language from a prior scene):
"${envCue}"

HARD RULES:
• 5:00 AM is early morning — NOT midnight. Never write "night sky" language if the clock shows morning.
• If the clock shows morning, use morning atmosphere even if the character is still asleep.
• Day rollover is a real state transition. Do not blend yesterday and today.

⛔ TEMPORAL MISMATCH BLOCKER:
ACTUAL SUNRISE/SUNSET: Sunrise ${sunriseTime} | Sunset ${sunsetTime}
• ONLY use sunrise language in the 30 min window after ${sunriseTime}
• ONLY use sunset language in the 30 min window after ${sunsetTime}
• Outside these windows: NO sun/golden hour/warm light/dusk/dawn language
════════════════════════════════════`,
    isAsleep,
    timeStr,
    timeOfDayDesc: dp.label,
    hourET,
  };
}

// ── LIVE NEEDS BLOCK ──────────────────────────────────────────────────────────
function buildNeedsBlock(char) {
  const BANDS = [
    { label: 'critical', min: 0,  max: 19 },
    { label: 'low',      min: 20, max: 39 },
    { label: 'reduced',  min: 40, max: 59 },
    { label: 'stable',   min: 60, max: 79 },
    { label: 'strong',   min: 80, max: 100 },
  ];
  const getBand = (val) => {
    const v = Math.max(0, Math.min(100, val ?? 70));
    return BANDS.find(b => v >= b.min && v <= b.max)?.label ?? 'stable';
  };
  const nv = {
    hunger:    Math.round(char.hunger_value    ?? 70),
    energy:    Math.round(char.energy_value    ?? 75),
    social:    Math.round(char.social_value    ?? 65),
    health:    Math.round(char.health_value    ?? 80),
    mental:    Math.round(char.mental_value    ?? 70),
    financial: Math.round(char.financial_need_value ?? 60),
    hygiene:   Math.round(char.hygiene_value   ?? 75),
    comfort:   Math.round(char.comfort_value   ?? 70),
  };
  const ns = Object.fromEntries(Object.entries(nv).map(([k, v]) => [k, getBand(v)]));

  const needsCombos = [];
  if ((ns.energy === 'critical' || ns.energy === 'low') && (ns.social === 'stable' || ns.social === 'strong')) needsCombos.push('Physically low but wants social contact.');
  if (ns.energy === 'strong' && (ns.mental === 'low' || ns.mental === 'critical')) needsCombos.push('Physically energized but emotionally strained — restless or brittle.');
  if ((ns.comfort === 'critical' || ns.comfort === 'low') && ns.energy === 'strong') needsCombos.push('Restless and uncomfortable — wants to move or leave.');
  if ((ns.hygiene === 'low' || ns.hygiene === 'critical') && ns.social === 'strong') needsCombos.push('Self-conscious about hygiene despite wanting social contact.');
  if ((ns.financial === 'low' || ns.financial === 'critical') && ns.social === 'strong') needsCombos.push('Wants to socialize but limited by finances.');

  return `
════════════════════════════════════
LIVE NEEDS — FULL STATE TRUTH (authoritative)
════════════════════════════════════
  Hunger:    ${nv.hunger}/100  → ${ns.hunger.toUpperCase()}
  Energy:    ${nv.energy}/100  → ${ns.energy.toUpperCase()}
  Social:    ${nv.social}/100  → ${ns.social.toUpperCase()}
  Health:    ${nv.health}/100  → ${ns.health.toUpperCase()}
  Mental:    ${nv.mental}/100  → ${ns.mental.toUpperCase()}
  Financial: ${nv.financial}/100 → ${ns.financial.toUpperCase()}
  Hygiene:   ${nv.hygiene}/100 → ${ns.hygiene.toUpperCase()}
  Comfort:   ${nv.comfort}/100 → ${ns.comfort.toUpperCase()}
${needsCombos.length > 0 ? '\nCOMBINATION EFFECTS:\n' + needsCombos.map(c => `  • ${c}`).join('\n') : ''}
NARRATIVE MUST REFLECT THESE. Do not describe fatigue if energy is stable. Do not describe financial stress if financial is stable.
════════════════════════════════════`;
}

// ── AGE ENFORCEMENT BLOCK ─────────────────────────────────────────────────────
function buildNarrativeAgeBlock(c) {
  const age = (() => {
    if (c.age && typeof c.age === 'number' && c.age > 0) return c.age;
    if (c.age_range) {
      const r = c.age_range.toLowerCase();
      if (r.includes('early 20')) return 21;
      if (r.includes('mid 20'))   return 25;
      if (r.includes('late 20'))  return 28;
      if (r.includes('early 30')) return 31;
      if (r.includes('mid 30'))   return 35;
      if (r.includes('late 30'))  return 38;
      if (r.includes('40')) return 43;
      if (r.includes('50')) return 53;
    }
    return null;
  })();
  if (!age || age >= 11) return '';
  if (age <= 3) return `\n⛔ AGE ENFORCEMENT — TODDLER (age ${age}):\nThis is a toddler. They do not speak in full sentences. React only: cry, laugh, point, say one word.\n`;
  if (age <= 5) return `\n⛔ AGE ENFORCEMENT — EARLY CHILDHOOD (age ${age}):\nVery simple language only. 4–8 word sentences max. Literal thinking. No complex reasoning.\n`;
  if (age <= 10) return `\n⛔ AGE ENFORCEMENT — CHILD (age ${age}):\nFull simple sentences. Basic reasoning. School-level vocabulary. No adult emotional complexity.\n`;
  return '';
}

// ── SCENE REACTION ENGINE ─────────────────────────────────────────────────────
function buildSceneReactionBlock(char) {
  const bars = {
    user_respect_level: char.user_respect_level ?? 50,
    trust_level: char.trust_level ?? 50,
    friendship_level: char.friendship_level ?? 75,
    romantic_level: char.romantic_level ?? 0,
    attraction_level: char.attraction_level ?? 0,
    relational_jealousy: char.relational_jealousy ?? 0,
  };
  const emotionalState = char.emotional_state || 'calm';

  const bodyLangCues = [];
  if (bars.trust_level >= 70) bodyLangCues.push('posture is open and relaxed');
  else if (bars.trust_level <= 30) bodyLangCues.push('posture stays guarded — arms close, movements measured');
  else bodyLangCues.push('posture is neutral — present but not fully open');

  if (bars.romantic_level >= 65 || bars.attraction_level >= 65) {
    bodyLangCues.push('shifts closer without thinking — proximity feels natural');
  }
  if (bars.relational_jealousy >= 65) bodyLangCues.push('eyes track subtle shifts — reactive posture');
  if (bars.user_respect_level <= 30) bodyLangCues.push('attention drifts');
  else if (bars.user_respect_level >= 75) bodyLangCues.push('turns toward them when they speak');

  const emotionBodyMap = {
    anxious: "small movements — tapping, adjusting things — can't fully settle",
    defensive: 'weight shifts back slightly — body language closes',
    irritated: 'jaw tightens almost imperceptibly',
    reflective: 'quieter in the body — slower movements',
    'closed-off': 'physically present but energy has pulled back',
    flirtatious: 'deliberate proximity — eye contact held a beat longer',
    overwhelmed: 'movements lose usual precision',
    sad: 'posture carries weight',
    excited: 'energy is in the body — harder to stay still',
  };
  if (emotionBodyMap[emotionalState]) bodyLangCues.push(emotionBodyMap[emotionalState]);

  const fastStates = ['irritated', 'excited', 'anxious', 'defensive', 'overwhelmed'];
  const slowStates = ['reflective', 'sad', 'closed-off', 'calm'];
  let pacingDirective = 'pacing is natural — no urgency';
  if (fastStates.includes(emotionalState)) pacingDirective = 'responds quickly — urgency underneath';
  else if (slowStates.includes(emotionalState) || bars.trust_level <= 30) pacingDirective = 'takes a beat before answering — pauses carry weight';

  let positioning = 'neutral distance — just present';
  if ((bars.romantic_level >= 65 || bars.attraction_level >= 65) && bars.trust_level >= 55) {
    positioning = "close proximity — stays within their space";
  } else if (bars.trust_level <= 30 || ['defensive', 'closed-off'].includes(emotionalState)) {
    positioning = 'creates space — distance is chosen';
  }

  return `
════════════════════════════════════
SCENE REACTION ENGINE — AUTHORITATIVE
All physical behavior MUST match these derived states.
════════════════════════════════════
BODY LANGUAGE:
${bodyLangCues.map(c => `  • ${c}`).join('\n')}
PACING: ${pacingDirective}
POSITIONING: ${positioning}
RULE: Show emotion through physical behavior. Do NOT state it directly. Do NOT reuse the same gesture twice.
════════════════════════════════════`;
}

// ── LEXICAL REPETITION GUARD ──────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','of','for','with','is',
  'are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','could','should','may','might','can','it','its','this','that',
  'they','them','their','he','she','his','her','we','you','your','i','me','my',
  'not','no','so','if','as','by','from','into','out','up','down','then','than',
  'when','where','who','which','what','how','there','here','just','like','very',
  'more','some','any','all','one','two','also','even','still','already','again',
]);
const ALWAYS_VARY = new Set([
  'cocoon','chaos','chaotic','whirlwind','swirl','haze','fog','spiral','drift',
  'linger','settle','unravel','pulse','hum','tension','frenzy','blur','stillness',
  'weight','heaviness','quiet','noise','warmth','coldness','brightness','darkness',
  'scattered','fractured','grounded','hollow','raw','electric','sharp','soft',
  'flicker','shadow','glow','echo','silence','rhythm','pattern','texture',
  'anchor','float','sink','rise','fall','crash','lurch','trembling',
]);

function extractDistinctiveWords(texts) {
  const freq = {};
  for (const text of texts) {
    const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
    for (const w of words) {
      if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .filter(([w, c]) => c > 1 || ALWAYS_VARY.has(w))
    .map(([w]) => w)
    .slice(0, 20);
}

// ── BEAT PROGRESSION ENGINE ───────────────────────────────────────────────────
function buildBeatProgressionBlock(recentNarratives) {
  if (recentNarratives.length === 0) return '';
  const lastBeat = recentNarratives[recentNarratives.length - 1] || null;
  const prevBeat = recentNarratives[recentNarratives.length - 2] || null;
  const extractAnchor = (text) => text?.match(/^[^.!?]*[.!?]/)?.[0]?.trim() || text?.substring(0, 100);
  const INTENSITY_MARKERS = ['kiss','kissed','touch','touched','pulled','grabbed','held','embraced','breath','breathless','leaned in','pressed','lips','burst','froze','tears','crying','shaking'];
  const isIntense = lastBeat ? INTENSITY_MARKERS.some(m => lastBeat.toLowerCase().includes(m)) : false;

  return `
════════════════════════════════════
BEAT PROGRESSION ENGINE — MANDATORY
This is NOT the first narrative. A scene is already in motion.
Each output is ONE NEW BEAT — something changes.

LAST BEAT (DO NOT repeat):
${lastBeat ? `"${extractAnchor(lastBeat)}"` : 'No prior beat.'}
${prevBeat ? `\nBEAT BEFORE THAT:\n"${extractAnchor(prevBeat)}"` : ''}

BEAT STRUCTURE: CAUSE → EFFECT → SHIFT → NEXT POSITION. Then STOP.

MANDATORY:
  ✗ Do NOT re-describe the same action
  ✗ Do NOT re-anchor to the same body part or gesture
  ✗ Do NOT freeze the scene — something must change
${isIntense ? '\n⚑ INTENSITY DETECTED: Insert a micro-pause beat first. Allow breath before new action.' : ''}

SHIFT at least ONE: physical position / emotional tone / energy level / control dynamic / environment detail
════════════════════════════════════`;
}

// ── HOME ACTIVITY OVERUSE GUARD ───────────────────────────────────────────────
const HOME_ACTIVITY_ANCHORS = [
  { term: 'coffee', label: 'coffee/making coffee' },
  { term: 'window', label: 'looking out the window' },
  { term: 'stares out', label: 'staring outside' },
  { term: 'gazes out', label: 'gazing outside' },
  { term: 'looks out', label: 'looking outside' },
  { term: 'mug', label: 'mug/cup' },
];

function buildHomeActivityGuard(recentNarratives) {
  const text = recentNarratives.join(' ').toLowerCase();
  const overused = HOME_ACTIVITY_ANCHORS
    .filter(({ term }) => (text.match(new RegExp(term, 'g')) || []).length >= 2)
    .map(({ label }) => label);
  if (overused.length === 0) return '';
  return `
════════════════════════════════════
HOME ACTIVITY OVERUSE DETECTED — MANDATORY ROTATION
These activities have appeared too frequently. Do NOT use them:
${overused.map(a => `  ✗ "${a}"`).join('\n')}
Choose a DIFFERENT home activity. Repeating a blocked activity is a generation failure.
════════════════════════════════════`;
}

// ── INTERACTION LIBRARIES (scene-specific — not identity) ─────────────────────
const INTERACTION_LIBRARIES = `
════════════════════════════════════
MANDATORY NARRATIVE ENGINE — EXECUTE BEFORE WRITING
════════════════════════════════════
STEP 1 — IDENTIFY INTERACTION TYPE: FLIRT | COMFORT | REASSURE | REDIRECT | ENCOURAGE | DISTANCE | REVEAL | NEUTRAL
STEP 2 — SELECT ONE PATTERN:
  FLIRT: close without touching / playful challenge / accidental contact / low voice / testing the line / shared recognition / inside language / confidence shift / energy matching / subtle claim
  COMFORT: quiet presence / soft redirect / protective energy / validation without fixing / physical reassurance / seen without explaining / identity affirmation / after a long day / protective check-in / rebuilding after hurt
  REASSURE: validation + grounding + reframing + slow pace + safety through presence
  ENCOURAGE: affirm capability + past strengths + future language + small push
  DISTANCE: controlled withdrawal + calm boundary + reduced closeness
  REVEAL: personal truth + tone shift + emotional risk + relationship shift
  NEUTRAL: environmental interaction + micro-behaviors + silent action
STEP 3 — APPLY ONE VARIATION HOOK (required): interruption / hesitation / uneven awareness / escalation then pullback / misread signal / timing mismatch / unexpected vulnerability / humor deflection / external pressure
STEP 4 — EMBED ONE ROOT THEME (naturally — never stated): unspoken tension / timing mismatch / power shift / memory callback / environment pressure / expectation vs reality / control vs vulnerability / guardedness giving way / micro-validation / chosen family energy
STEP 5 — WRITE. Only after steps 1–4.

LGBTQ+ MANDATORY: All patterns apply identically across all gender/identity combinations. No simplification. No heteronormative defaults. Attraction is never assumed — only expressed if already established.

IDENTITY AND PRONOUN LOCK:
CHARACTER GENDER: {GENDER}
PRONOUNS: {PRONOUNS}
• Use ONLY these pronouns — no switching mid-narrative
• No heteronormative defaults — do not assume opposite-gender attraction
• If gender unknown: use they/them ONLY
════════════════════════════════════`;

const SLEEP_GATE_SUFFIX = `

════════════════════════════════════
⛔ SLEEP STATE HARD GATE — HIGHEST PRIORITY — OVERRIDES ALL OTHER INSTRUCTIONS
════════════════════════════════════
THIS CHARACTER IS ASLEEP. This is a locked state.

ALLOWED (EXHAUSTIVE LIST):
  ✓ Describing the room, ambient environment (light quality, temperature, sound)
  ✓ Stillness, breathing, physical rest
  ✓ Dreams or half-conscious impressions (1 clause max, clearly framed as sleep)
  ✓ Environmental atmosphere matching the current daypart

HARD BLOCKED — ANY OF THESE INVALIDATES THE NARRATIVE:
  ✗ Eating, drinking, coffee, tea, water
  ✗ Moving between rooms or leaving the bed
  ✗ Looking out windows intentionally
  ✗ Picking up or interacting with any object
  ✗ Having a conversation or responding to anyone
  ✗ Any physical activity whatsoever
  ✗ Thinking about future plans as if awake and deciding

IF YOU CANNOT WRITE A VALID NARRATIVE WITHIN THESE CONSTRAINTS,
write one sentence describing the ambient environment and the character's stillness.
That is always valid.
════════════════════════════════════`;

const SLEEP_VIOLATION_TERMS = [
  'coffee','tea','drink','drank','sip','brew','kitchen','stove','kettle','mug','cup of',
  'window','looks out','looked out','gazes out','stares out',
  'gets up','got up','stands up','stood up','sits up','sat up',
  'walks to','walked to','steps into','stepped into','moves to','moved to',
  'bathroom','stretches','stretching','shower','brushes',
  'phone','checks','scrolls','opens','picks up',
  'leaves','heads out','goes to','went to',
  'eats','eating','food','breakfast','snack',
];

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, chatHistory } = await req.json();
    if (!characterId || !chatHistory) {
      return Response.json({ error: 'characterId and chatHistory are required' }, { status: 400 });
    }

    const diagLog = [];
    diagLog.push({ step: 'init', route: 'narrative', characterId, ownerEmail: user.email });

    // ── Step 1: Call canonical context — SINGLE SOURCE OF TRUTH ──────────────
    // This replaces ALL inline identity/memory/family/relationship building.
    // Only scene/time/beat formatting is added below.
    let canonicalData = null;
    let canonicalLoaded = false;
    let fallbackUsed = false;

    try {
      const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId,
        interactionContext: 'narrative',
        topKMemories: 10,
      });
      canonicalData = ctxRes?.data || ctxRes;
      if (canonicalData?.systemPrompt && canonicalData?.character) {
        canonicalLoaded = true;
      }
    } catch (ctxErr) {
      diagLog.push({ step: 'canonical_load', status: 'error', error: ctxErr.message });
    }

    // VISIBLE FALLBACK — never silently shallow
    if (!canonicalLoaded || !canonicalData?.character) {
      const reason = canonicalData?.error || 'canonical context service unavailable';
      console.error(
        `[generateNarrative] CANONICAL CONTEXT FAILED — route=narrative` +
        ` | characterId=${characterId} | owner=${user.email}` +
        ` | reason=${reason}` +
        ` | canonical_loaded=false | fallback_used=true`
      );
      diagLog.push({ step: 'canonical_load', status: 'failed', reason, fallback_used: true });

      // Return visible error — do NOT generate narrative with no identity
      return Response.json({
        error: `Narrative generation blocked: canonical context unavailable for character ${characterId}. Reason: ${reason}`,
        diagLog,
        fallbackUsed: true,
        fallbackReason: reason,
      }, { status: 503 });
    }

    const char = canonicalData.character;
    const characterName = char.name;
    const hardFactsLoaded = !!(canonicalData.hardFacts?.length > 0);
    const lifeJournalCount = canonicalData.lifeJournalEntries?.length ?? 0;
    const memoryCount = canonicalData.memories?.length ?? 0;
    const relationshipLoaded = !!(canonicalData.relationshipContext?.length > 0);

    // ── FULL DIAGNOSTIC LOG ───────────────────────────────────────────────────
    console.log(
      `[generateNarrative] route=narrative` +
      ` | character=${characterName} (${characterId})` +
      ` | owner=${user.email}` +
      ` | canonical_loaded=${canonicalLoaded}` +
      ` | hard_facts_loaded=${hardFactsLoaded}` +
      ` | life_journal_count=${lifeJournalCount}` +
      ` | memory_count=${memoryCount}` +
      ` | relationship_context_loaded=${relationshipLoaded}` +
      ` | fallback_used=false`
    );

    diagLog.push({
      step: 'canonical_load',
      status: 'ok',
      canonical_loaded: canonicalLoaded,
      hard_facts_loaded: hardFactsLoaded,
      life_journal_count: lifeJournalCount,
      memory_count: memoryCount,
      relationship_context_loaded: relationshipLoaded,
      fallback_used: false,
    });

    // ── Step 2: Resolve weather/temporal data ─────────────────────────────────
    // owner_email scoped — no created_by fallback
    const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email }).catch(() => []);
    const settings = settingsList?.[0] || {};
    const cachedWeather = settings?.daily_weather_cache || {};
    const sunriseTime = cachedWeather.sunrise || '06:15';
    const sunsetTime = cachedWeather.sunset || '19:45';
    const worldName = settings?.fictional_world_name || null;

    // ── Step 3: Build temporal state ──────────────────────────────────────────
    const lastMsg = chatHistory?.length > 0 ? chatHistory[chatHistory.length - 1] : null;
    const lastMsgTimestamp = lastMsg?.timestamp || lastMsg?.created_date || null;
    const temporal = buildTemporalBlock(char, lastMsgTimestamp, sunriseTime, sunsetTime);
    const { isAsleep, timeStr, timeOfDayDesc, hourET } = temporal;

    // ── Step 4: Resolve current location (from canonical character record) ────
    const resolvedLocationName = char.resolved_current_location_name || null;
    const resolvedPresenceStatus = char.resolved_presence_status || null;

    const locationContext = resolvedLocationName
      ? `Current location: ${resolvedLocationName}`
      : 'Current location: unknown';
    const sleepContext = isAsleep
      ? `Sleep status: ASLEEP (${timeOfDayDesc} — ${timeStr})`
      : `Sleep status: AWAKE`;
    const presenceContext = resolvedPresenceStatus
      ? `Presence status: ${resolvedPresenceStatus.replace(/_/g, ' ')}`
      : '';
    const activityContext = char.current_activity
      ? `Current activity: ${char.current_activity}`
      : '';

    // ── Step 5: Build scene-only blocks ───────────────────────────────────────
    const needsBlock = buildNeedsBlock(char);
    const ageBlock = buildNarrativeAgeBlock(char);
    const sceneReactionBlock = buildSceneReactionBlock(char);

    const recentNarratives = chatHistory
      .slice(-20)
      .filter(m => m.is_narrative && m.content?.trim())
      .map(m => m.content);
    const recentCharMsgs = chatHistory
      .slice(-15)
      .filter(m => m.sender_type !== 'user' && !m.is_narrative && m.content?.trim())
      .map(m => m.content);
    const overusedWords = extractDistinctiveWords([...recentNarratives, ...recentCharMsgs]);
    const beatBlock = buildBeatProgressionBlock(recentNarratives);
    const homeGuardBlock = buildHomeActivityGuard(recentNarratives);

    const repetitionGuardBlock = overusedWords.length > 0
      ? `\n════════════════════════════════════\nLEXICAL REPETITION GUARD — MANDATORY\nDo NOT use these recently overused words:\n${overusedWords.map(w => `  ✗ "${w}"`).join('\n')}\nRephrase the entire idea rather than substituting synonyms.\n════════════════════════════════════`
      : '';

    // Interaction libraries with gender filled in
    const charGender = char.gender || 'unknown';
    const charPronouns = charGender === 'male' ? 'he/him' : charGender === 'female' ? 'she/her' : 'they/them';
    const interactionLibraries = INTERACTION_LIBRARIES
      .replace('{GENDER}', charGender)
      .replace('{PRONOUNS}', charPronouns);

    // ── Step 6: Resolve actor label ───────────────────────────────────────────
    const recentUserMsgs = chatHistory.filter(m => m.sender_type === 'user').slice(-5);
    const playedAsName = recentUserMsgs.map(m => m.played_as_character_name).filter(Boolean).pop() || null;
    const actorLabel = playedAsName || worldName || 'them';

    const formattedChatHistory = chatHistory
      .map(m => {
        if (m.sender_type === 'user') {
          const label = m.played_as_character_name || worldName || 'You';
          return `"${label}": "${m.content}"`;
        }
        return `"${characterName}": "${m.content}"`;
      })
      .join('\n');

    // ── Step 7: Build the full prompt — canonical identity + scene formatting ──
    // canonicalData.systemPrompt owns: identity, personality, family, relationships,
    // memory, Life Journal, hard facts, soap opera life context.
    // Everything below is scene/time/beat formatting ONLY.
    const prompt = `${canonicalData.systemPrompt}

════════════════════════════════════
NARRATIVE GENERATION CONTEXT — SCENE AND TIME STATE
These facts are locked. The narrative MUST reflect all of them exactly.
════════════════════════════════════
Character: ${characterName}
${ageBlock}${locationContext}
${sleepContext}
${presenceContext ? presenceContext + '\n' : ''}${activityContext ? activityContext + '\n' : ''}Current time: ${timeStr} (${timeOfDayDesc})
════════════════════════════════════
${temporal.block}
${needsBlock}
${sceneReactionBlock}
${interactionLibraries}
${homeGuardBlock}
${repetitionGuardBlock}

IDENTITY AND POV RULE:
The person interacting with ${characterName} is: ${actorLabel}
${playedAsName ? `They are currently playing as "${playedAsName}" — use that name in the narrative, NOT "the user".` : `Use "${actorLabel}" or natural pronouns — NEVER "the user", "the player", or "the account holder".`}
IF the output contains "the user" → replace with "${actorLabel}".

EMOTIONAL BALANCE — MANDATORY:
Characters are full human beings — struggle AND joy, stress AND relief.
If recent messages have expressed continuous negativity — introduce variation.
Positive states (enjoyment, humor, calm, connection, curiosity) must occur naturally.

GRIEF GATING:
Grief is only valid if ${characterName} had a DIRECT personal relationship with the person lost.
Hearing about someone else's grief → ${characterName} shows SUPPORT, not personal grief.

LOCATION AND SCHEDULE ENFORCEMENT:
The current location is a truth source. If at work, reflect work. If at gym, reflect gym. If at home, reflect home.
HOME-STYLE NARRATIVES ARE BLOCKED when character is confirmed at a non-home location.

STORY CONTINUITY RULE:
The character is already mid-scene. They are not arriving or resetting.
Narratives must continue what is already happening — a living timeline, not isolated snapshots.

OUTPUT REJECTION CONDITIONS:
Reject if: narrative does not match confirmed location, ignores schedule, restarts a scene, contradicts recent events, or ignores time of day.

Chat History:
${formattedChatHistory}

Generate a narrative of 2 to 4 sentences. It must feel like a live continuation of ${characterName}'s day — a NEW BEAT, not a repetition of the last one. Time-aware, location-accurate, emotionally continuous, and specific to this exact moment.

${recentNarratives.length > 0 ? beatBlock : ''}

Narrative:`;

    // ── Step 8: Pre-generation sleep gate ────────────────────────────────────
    const finalPrompt = isAsleep ? prompt + SLEEP_GATE_SUFFIX : prompt;

    let response = await base44.integrations.Core.InvokeLLM({
      prompt: finalPrompt,
      model: 'gemini_3_flash',
    });

    // ── Step 9: Post-generation sleep validator ───────────────────────────────
    if (isAsleep && response) {
      const respLower = response.toLowerCase();
      const hasViolation = SLEEP_VIOLATION_TERMS.some(term => respLower.includes(term));
      if (hasViolation) {
        console.warn(`[generateNarrative] Sleep violation detected — regenerating`);
        response = await base44.integrations.Core.InvokeLLM({
          prompt: `${characterName} is fully asleep at ${timeStr} (${timeOfDayDesc}).
Write 1-2 sentences describing ONLY the ambient environment of the room and the character's physical stillness.
No movement. No objects. No actions. No dialogue. Just the room and the quiet.
Current time: ${timeStr}. Location: ${resolvedLocationName || 'home'}.

Narrative:`,
          model: 'gemini_3_flash',
        });
      }
    }

    return Response.json({ success: true, narrative: response, diagLog });

  } catch (error) {
    console.error('[generateNarrative] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});