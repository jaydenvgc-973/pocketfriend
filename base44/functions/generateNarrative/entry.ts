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

// ── HOUSEHOLD ACTIVITY INSPIRATION LIBRARY (additive) ──────────────────────────
// Additional narrative-style patterns for common household activities.
// Inspiration examples ONLY — the generator must expand them into complete
// character-specific narrative beats, never copy verbatim. Treated exactly
// like the existing NEED_NARRATIVE / beat libraries: additional options, not scripts.
const HOUSEHOLD_ACTIVITY_EXAMPLES = {
  cooking_meal: ["They spend time in the kitchen preparing food, moving between ingredients, cookware, and the stove until the meal comes together."],
  preparing_breakfast: ["They start the morning by preparing breakfast, taking a few quiet moments to make something to eat before beginning the day."],
  preparing_lunch: ["They put together lunch, taking a break from whatever they were doing before sitting down to eat."],
  preparing_dinner: ["They prepare dinner, taking their time in the kitchen before enjoying the meal they made."],
  making_coffee: ["They make a fresh cup of coffee, taking a moment to enjoy the familiar routine before continuing with the day."],
  making_tea: ["They prepare a cup of tea, letting the quiet routine help them slow down for a few moments."],
  putting_away_groceries: ["After returning from the store, they unpack the groceries and organize the food, household items, and supplies where they belong."],
  meal_prepping: ["They prepare food ahead of time, portioning and organizing meals to make the coming days easier."],
  cleaning_bathroom: ["They clean the bathroom, working through the sink, mirror, shower, and surfaces until everything feels fresh again."],
  cleaning_kitchen: ["They clear the counters, deal with dishes, wipe down the kitchen, and put everything back where it belongs."],
  cleaning_bedroom: ["They straighten the bedroom, organize their belongings, and leave the room noticeably cleaner and more comfortable."],
  doing_laundry: ["They gather dirty clothes, start or finish a load of laundry, and later put everything away once it is clean."],
  folding_laundry: ["They fold clean laundry, organizing everything before putting it away where it belongs."],
  doing_dishes: ["They wash or load the dishes, clean the sink, and leave the kitchen ready to use again."],
  vacuuming: ["They vacuum around the house, moving from room to room until the floors feel noticeably cleaner."],
  sweeping_mopping: ["They spend some time sweeping or mopping the floors, freshening up the house one room at a time."],
  taking_out_trash: ["They gather the household trash and take it outside before replacing the bags and returning inside."],
  making_bed: ["They straighten the bed, smooth the bedding, and leave the room looking more organized."],
  organizing_closet: ["They organize the closet, straightening shelves, hanging clothes, and putting stored items back into order."],
  organizing_paperwork: ["They sort through paperwork, organizing important documents and clearing away unnecessary clutter."],
  checking_mail: ["They check the mailbox, sort through what arrived, and bring everything inside."],
  watching_television: ["They settle in and watch television for a while, taking a chance to relax and unwind."],
  playing_video_games: ["They spend some time playing a video game, focusing on the experience before eventually stepping away."],
  reading_book: ["They settle into a comfortable place and spend some quiet time reading."],
  listening_to_music: ["They turn on some music and let it play while they relax or move through the house."],
  browsing_internet: ["They spend some time browsing the internet, catching up on things that interest them before moving on."],
  using_computer: ["They sit down at the computer for a while, taking care of whatever they wanted to work on."],
  doing_homework: ["They sit down with homework, making steady progress before moving on with the rest of their day."],
  studying: ["They spend time studying, reviewing information and working toward a better understanding of the material."],
  writing_journal: ["They spend a few quiet moments writing in a journal, reflecting on their thoughts before continuing with the day."],
  exercising_home: ["They complete a workout or exercise session at home before cooling down."],
  stretching: ["They spend a few minutes stretching, loosening up and helping themselves feel more comfortable."],
  meditating: ["They take a few quiet moments to meditate, slowing their breathing and clearing their mind."],
  relaxing_home: ["They spend some quiet time relaxing at home before continuing with the rest of their day."],
  brushing_teeth: ["They brush their teeth and freshen up before continuing with the day or preparing for the night."],
  taking_shower: ["They take a shower, cleaning up and giving themselves a chance to reset before moving on."],
  washing_face: ["They wash their face and freshen up before returning to the rest of their routine."],
  grooming_hair: ["They spend a few moments fixing and grooming their hair before continuing with the day."],
  getting_dressed: ["They get dressed for the day or for their next activity, choosing clothing that matches their plans."],
  choosing_outfit: ["They spend a few moments deciding what to wear before settling on an outfit appropriate for the day."],
  getting_ready_bed: ["They begin winding down for the night, finishing the last parts of their evening routine before settling in to sleep."],
  taking_bath: ["They spend some quiet time soaking in a warm bath, using the opportunity to relax and unwind before continuing with the rest of their day or evening."],
  washing_hair: ["They spend a little extra time washing and caring for their hair as part of their normal grooming routine."],
  front_porch: ["They spend some time sitting on the front porch, enjoying the fresh air and watching the neighborhood as the day quietly passes by."],
  backyard: ["They head out into the backyard for a while, enjoying the outdoors and taking a peaceful break from being inside."],
  playing_solitaire: ["They sit down for a quiet game of solitaire, passing the time while enjoying a few moments to themselves."],
};

const SEASONAL_ACTIVITY_EXAMPLES = {
  new_year: [
    "They spend a quiet New Year's evening at home, letting the night settle in without needing much else.",
    "They prepare a simple New Year's meal, taking their time before the night begins.",
  ],
  valentines: ["They put together something small for Valentine's Day, keeping it low-key but intentional."],
  spring: ["They open the windows to let the spring air in, taking a moment before getting back to the day."],
  summer: [
    "They step outside to watch the fireworks in the night sky, letting the sound carry over the neighborhood.",
    "They watch the holiday fireworks from home, settled somewhere comfortable with a clear view.",
    "They enjoy the warm evening out in the yard, taking a break from being inside.",
  ],
  halloween: ["They sort through a few Halloween decorations, deciding what to put out this year."],
  thanksgiving: ["They start prepping for Thanksgiving dinner early, moving through the kitchen at their own pace."],
  winter_holidays: [
    "They decorate the home for the holidays, working through the familiar pieces one at a time.",
    "They take down the holiday decorations, packing everything away now that the celebration has ended.",
    "They wrap gifts before the holiday, taking their time with each one.",
    "They prepare gifts for family or friends, keeping the details small and thoughtful.",
    "They spend a quiet holiday evening at home, letting the night come on its own terms.",
    "They bake seasonal treats, filling the kitchen with the smell of it for a while.",
    "They put on holiday music in the background while they move through the house.",
    "They settle in to watch a holiday movie, letting the evening slow down around it.",
  ],
};

function getEligibleSeasonalKeysNarrative(etDate) {
  const month = etDate.getMonth() + 1;
  const day = etDate.getDate();
  const keys = [];
  if ((month === 12 && day >= 30) || (month === 1 && day <= 2)) keys.push('new_year');
  if (month === 2 && day >= 12 && day <= 16) keys.push('valentines');
  if (month === 3 || month === 4) keys.push('spring');
  if (month >= 6 && month <= 8) keys.push('summer');
  if (month === 10 && day >= 28) keys.push('halloween');
  if (month === 11) keys.push('thanksgiving');
  if (month === 12) keys.push('winter_holidays');
  return keys;
}

function buildHouseholdActivityBlock() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const allKeys = Object.keys(HOUSEHOLD_ACTIVITY_EXAMPLES);
  const shuffled = [...allKeys].sort(() => Math.random() - 0.5).slice(0, 3);
  const householdExamples = shuffled.flatMap(k => (HOUSEHOLD_ACTIVITY_EXAMPLES[k] || []).slice(0, 1)).slice(0, 3);
  const seasonalKeys = getEligibleSeasonalKeysNarrative(nowET);
  const seasonalExamples = seasonalKeys.flatMap(k => (SEASONAL_ACTIVITY_EXAMPLES[k] || []).slice(0, 1)).slice(0, 2);
  const combined = [...householdExamples, ...seasonalExamples];
  if (!combined.length) return '';
  return `
════════════════════════════════════
HOUSEHOLD & SEASONAL ACTIVITY INSPIRATION (use as inspiration — generate a NEW variation, never copy verbatim):
${combined.map(e => `  • ${e}`).join('\n')}

CLOTHING-AWARE NOTE: For wardrobe activities (getting dressed, choosing an outfit, changing clothes, preparing for work/school/an event):
- If Outfit Rotation is enabled and today's outfit is available, use the current scheduled outfit.
- If Character Closet data exists, use the appropriate clothing from the character's closet.
- If neither is available, keep the narrative general — do NOT invent clothing items or wardrobe details not supported by authoritative character data.

MUSIC PREFERENCE NOTE: When authoritative music preference data exists, naturally incorporate the character's favorite artists, genres, styles, or playlists into music narratives. If none exists, keep music narratives general — do NOT invent favorite artists, genres, or musical tastes.
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

    const { characterId, chatHistory, userPresenceLocationId, userPresenceStatus, userWorldName } = await req.json();
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
    const resolvedLocationId = char.resolved_current_location_id || char.current_home_location_id || null;

    // ── CANONICAL ROOM/ZONE AUTHORITY — fetch the actual LocationReference record ──
    // This is the fix for room fabrication: the narrative LLM previously received only
    // the location NAME (a string), which gives it no information about what rooms
    // canonically exist inside that location. Without this, the LLM invents rooms
    // from generic assumptions (e.g. placing a desk in the living room when an Office
    // zone already exists). We now load the canonical zone list and inject it as an
    // authoritative constraint — the narrative must use existing rooms, not invent them.
    let canonicalZoneBlock = '';
    if (resolvedLocationId) {
      try {
        const locList = await base44.asServiceRole.entities.LocationReference.filter(
          { id: resolvedLocationId }, null, 1
        ).catch(() => []);
        const locRecord = locList?.[0] || null;
        if (locRecord) {
          const zones = (locRecord.zones || []).filter(z => z.zone_name);
          if (zones.length > 0) {
            // Activity→zone map with the object that canonically exists in each zone
            const ACTIVITY_ZONE_MAP = [
              { activities: ['desk', 'writing', 'computer', 'homework', 'studying', 'paperwork', 'working from home', 'write', 'reading'], zone: 'office', existingObject: 'desk' },
              { activities: ['sleeping', 'asleep', 'bed', 'waking', 'nap', 'lying down', 'bedroom'], zone: 'bedroom', existingObject: 'bed' },
              { activities: ['cooking', 'kitchen', 'fridge', 'stove', 'oven', 'microwave', 'making food', 'eating at home'], zone: 'kitchen', existingObject: 'kitchen counter/stove' },
              { activities: ['eating', 'dinner', 'dining', 'dining table', 'breakfast', 'lunch'], zone: 'dining room', existingObject: 'dining table' },
              { activities: ['couch', 'sofa', 'watching tv', 'tv', 'lounge', 'living room', 'relaxing'], zone: 'living room', existingObject: 'couch/sofa' },
              { activities: ['shower', 'bathroom', 'brushing teeth', 'getting ready'], zone: 'bathroom', existingObject: 'bathroom fixtures' },
              { activities: ['workout', 'exercise', 'weights', 'treadmill', 'gym', 'training', 'lifting'], zone: 'gym', existingObject: 'gym equipment' },
              { activities: ['laundry', 'washer', 'dryer', 'clothes'], zone: 'laundry', existingObject: 'washer/dryer' },
              { activities: ['backyard', 'patio', 'outside', 'grill', 'garden', 'yard', 'deck'], zone: 'patio', existingObject: 'patio furniture' },
              { activities: ['garage', 'car', 'workshop', 'tools'], zone: 'garage', existingObject: 'workshop tools' },
            ];
            const zoneNames = zones.map(z => z.zone_name);

            // Build zone descriptions including zone description and any known object cues
            const zoneDescriptions = zones.map(z => {
              const desc = z.zone_description ? ` — ${z.zone_description.substring(0, 120)}` : '';
              // Find if this zone has a known canonical object
              const objectEntry = ACTIVITY_ZONE_MAP.find(m =>
                z.zone_name.toLowerCase().includes(m.zone) || m.zone.includes(z.zone_name.toLowerCase())
              );
              const objectCue = objectEntry ? ` [canonical object: ${objectEntry.existingObject}]` : '';
              return `  • ${z.zone_name}${desc}${objectCue}`;
            }).join('\n');

            // Location description as supplementary grounding
            const locationDescCue = locRecord.description
              ? `\nLOCATION DESCRIPTION: ${locRecord.description.substring(0, 200)}`
              : '';

            // Build activity→correct-room mapping with object grounding
            const activityMappings = [];
            const objectGroundingRules = [];
            for (const mapping of ACTIVITY_ZONE_MAP) {
              const matchingZone = zoneNames.find(zn =>
                zn.toLowerCase().includes(mapping.zone) || mapping.zone.includes(zn.toLowerCase())
              );
              if (matchingZone) {
                activityMappings.push(`  • ${mapping.activities.slice(0, 4).join(' / ')} → use the "${matchingZone}" zone`);
                objectGroundingRules.push(`  • "${matchingZone}" already has a canonical ${mapping.existingObject}. Do NOT create another one. Use the existing ${mapping.existingObject}.`);
              }
            }

            canonicalZoneBlock = `
════════════════════════════════════
CANONICAL ROOM AUTHORITY — "${resolvedLocationName}"
These are the canonical rooms currently available to this generation path. Do not invent additional rooms, zones, furniture, or objects unless explicitly confirmed by canonical data.
════════════════════════════════════
ROOMS THAT EXIST AT THIS LOCATION:
${zoneDescriptions}
${locationDescCue}

EXISTING ROOMS FIRST — MANDATORY:
Before placing a character anywhere, check this list.
If the activity requires a desk → use the room that has one (Office, if it exists).
If the activity requires a bed → use the Bedroom.
If the activity requires cooking equipment → use the Kitchen.
If the activity requires exercise equipment → use the Home Gym, if one exists.
If the activity requires a dining table → use the Dining Room, if one exists.

ACTIVITY → ROOM ROUTING (use canonical rooms — never invent):
${activityMappings.length > 0 ? activityMappings.join('\n') : '  (use the zone list above to determine correct room for any activity)'}

EXISTING OBJECTS FIRST — CRITICAL:
Once the correct room is selected, the canonical objects already in that room are authoritative.
Do NOT create, duplicate, replace, or redesign furniture that already exists in the selected room.
${objectGroundingRules.length > 0 ? objectGroundingRules.join('\n') : ''}

THE SELECTED ROOM IS NOT A BLANK STAGE:
It is an existing canonical space. Compose the character around existing objects.
If framing or description is difficult — adjust the camera angle, pose, or character position.
Do NOT alter the room. Do NOT add new furniture. Do NOT redesign what is already there.

FORBIDDEN:
✗ Placing a desk in the Living Room when an Office exists
✗ Placing or generating a dining table in any room that already has one
✗ Placing gym equipment anywhere when a Home Gym or Gym zone exists
✗ Inventing a room not on the list above
✗ Describing furniture that belongs to one zone while the character is in a different zone
✗ Fabricating furniture on a factory floor, yard, or work area when a proper sleeping/rest room exists
✗ Treating this location as a generic home — it is a specific, documented space

CANONICAL LAW: The rooms and objects listed above are authoritative world data.
Use them. Render them. Do not redesign them.
════════════════════════════════════`;
          } else if (locRecord.description) {
            // No zones defined — inject location description as grounding context
            canonicalZoneBlock = `\nLOCATION DESCRIPTION (use as environment grounding):\n${locRecord.description.substring(0, 300)}\n`;
          }
        }
      } catch (locErr) {
        // Non-blocking — narrative still generates, just without zone enforcement
        console.warn(`[generateNarrative] Zone lookup failed (non-blocking): ${locErr.message}`);
      }
    }

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
    const householdActivityBlock = buildHouseholdActivityBlock();

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

    // ── Step 5b: Resolve user presence truth ─────────────────────────────────
    const userIsCoPresent = !!(
      userPresenceStatus === 'present' &&
      userPresenceLocationId &&
      char.resolved_current_location_id &&
      userPresenceLocationId === char.resolved_current_location_id
    );
    const resolvedUserWorldName = userWorldName || worldName || 'the user';

    const userPresenceBlock = userIsCoPresent
      ? `\n════════════════════════════════════
USER PRESENCE — PHYSICALLY CO-PRESENT
════════════════════════════════════
"${resolvedUserWorldName}" is currently AT THE SAME LOCATION as ${characterName}.
Physical co-presence IS confirmed.
• ${characterName} may look at, react to, or physically interact with ${resolvedUserWorldName}
• Shared environmental experiences are valid
════════════════════════════════════`
      : `\n════════════════════════════════════
USER PRESENCE — REMOTE / NOT CO-PRESENT
════════════════════════════════════
"${resolvedUserWorldName}" is NOT physically present with ${characterName} right now.
This is a TEXT or PHONE interaction — the user is REMOTE.

ABSOLUTE PROHIBITIONS (these are generation errors):
✗ "${characterName} glanced over at you"
✗ "You sat together" or "You stood beside him/her"
✗ "${characterName} watched you leave"
✗ Any description implying the user is in the same physical space

ALLOWED — remote-only framing:
✓ ${characterName} thinking about / missing ${resolvedUserWorldName}
✓ Referencing a prior visit or memory involving ${resolvedUserWorldName}
✓ Emotional reaction to the text/call
✓ Environment details of WHERE ${characterName} is without the user
✓ What ${characterName} is doing alone or with others who ARE physically there
════════════════════════════════════`;

    // ── Step 5c: Build narrative continuity block from chatHistory ────────────
    const priorNarrativeBeats = chatHistory
      .filter(m => m.is_narrative && m.content?.trim())
      .slice(-6);
    
    const narrativeContinuityBlock = priorNarrativeBeats.length > 0
      ? `\n════════════════════════════════════
NARRATIVE CONTINUITY — ALREADY IN CANON (read before generating)
These beats already happened. DO NOT repeat, contradict, or reset them.
Continue FROM the state they left the scene in.
════════════════════════════════════
${priorNarrativeBeats.map((m, i) => `BEAT ${i + 1}: "${m.content}"`).join('\n\n')}

RULE: Begin from AFTER the last beat resolves. Maintain established emotional/physical tone unless a clear in-story event justifies a shift.
════════════════════════════════════`
      : '';

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
${canonicalZoneBlock}
${temporal.block}
${needsBlock}
${sceneReactionBlock}
${householdActivityBlock}
${interactionLibraries}

════════════════════════════════════
SCENE DESCRIPTION AND SEMANTIC INTERPRETATION — MANDATORY
════════════════════════════════════

The objective is to faithfully represent the character's lived experience using accurate, context-grounded language.

Generated narrative text may become memory, journal history, emotional context, activity context, image-prompt context, or future character grounding. Therefore, descriptions must accurately reflect what is actually happening rather than imposing a fixed emotional framing on environmental state.

1. NEUTRAL DESCRIPTOR PRINCIPLE
Complex, dense, busy, chaotic, crowded, high-energy, or multi-person environments are NOT inherently negative.

These words are neutral descriptors of environmental state. They describe what is happening. They do not prescribe emotional meaning.

Interpret each scene according to the actual evidence:
- character state
- traits
- relationships
- current circumstances
- event facts
- outcome

A busy Saturday night crowd may be vibrant, exciting, lucrative, stressful, overwhelming, or joyful — depending on what is actually happening and who the character is.
A chaotic moment may be playful, dangerous, creative, disorganized, stressful, or joyful — depending on context.
A complex situation may be enriching, challenging, confusing, layered, or growth-producing — depending on the character and events.

2. ACCURATE VOCABULARY
Choose words because they accurately describe reality — not because particular words are discouraged.

The model is free to describe environments as:
- chaotic, orderly, busy, quiet, vibrant, crowded, complex, peaceful, stressful, joyful, dangerous, playful
- or any other accurate descriptor when supported by the scene.

Do not avoid a word because it sounds intense. Do not prefer a word because it sounds soft.
Use the word that fits.

3. RESTRICTED CRUTCH
"Heavy" is restricted as emotional shorthand.

Do not use "heavy" to vaguely mean important, emotional, stressful, meaningful, complicated, sad, or serious.

Literal physical use is allowed only when it means actual weight or mass.

For emotional or narrative significance, describe the specific reality instead:
- what made it meaningful
- what made it difficult
- what made it serious
- what made it joyful
- what made it painful
- what made it worth remembering

4. MEANING PRESERVATION
Do not overwrite the accurate meaning of an event with vague negative language.

If an event is joyful, proud, loving, intimate, successful, healing, funny, exciting, or growth-producing, preserve that meaning unless the grounded character context clearly changes it.

If an event is painful, disappointing, frightening, harmful, exhausting, tense, or unresolved, preserve that meaning when the grounded context supports it.

Do not force positivity.
Do not force negativity.
Do not "balance" a positive event by injecting destabilizing language.
Do not let unrelated past negativity bleed into a new positive event unless canonically relevant.

5. IDENTITY PROTECTION
Do not promote situational descriptors into identity labels.

A busy event does not mean the character creates disorder.
A difficult moment does not mean the character is toxic.
A painful experience does not mean the memory is negative.
A mistake does not become a permanent personality trait unless canon and repeated demonstrated behavior support it.

Do not write recurring identity claims such as "he creates chaos," "she is chaotic," or equivalent labels unless explicitly supported by canonical character data.

6. GROUNDED EMOTIONAL COLORING
Emotional tone must emerge from the full grounded context:
- character type
- traits
- quirks
- goals
- motivations
- relationships
- current circumstances
- prior memory
- event facts
- outcome

Narrative must describe what happened and how the character experienced it. It must not prescribe a false emotional meaning through vague labels.

7. REINFORCEMENT FAIRNESS
Characters are designed to learn from repeated narrative and memory context.

Do not over-reinforce negative interpretations by mislabeling positive or meaningful experiences with destabilizing language.

Positive experiences should preserve positive reinforcement.
Negative experiences should preserve negative reinforcement when accurate.
Complex experiences should preserve their actual complexity.

The goal is accurate learning, not forced optimism or forced negativity.
════════════════════════════════════
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
${userPresenceBlock}
${narrativeContinuityBlock}

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

    // Whitespace normalization only — no lexical replacement.
    // The model's chosen vocabulary is preserved. Scene descriptors (complex, busy,
    // chaotic, vibrant, crowded, etc.) are interpreted by context, not replaced.
    if (typeof response === 'string') {
      response = response
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    return Response.json({ success: true, narrative: response, diagLog });

  } catch (error) {
    console.error('[generateNarrative] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});