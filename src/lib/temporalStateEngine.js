/**
 * TEMPORAL STATE ENGINE — Single Source of Truth for Time
 *
 * All modules (chat, narrative, image, memory) MUST call buildTemporalState()
 * and use the returned object.  Nothing is allowed to re-derive time, daypart,
 * elapsed time, or continuity mode on its own.
 *
 * Exports:
 *   buildTemporalState(character, lastMessageTimestamp?)  → TemporalState
 *   buildTemporalContextBlock(temporalState)             → string (LLM injection)
 *   getDaypart(hourET)                                   → string
 */

// ── DAYPART MAP ───────────────────────────────────────────────────────────────
// Strict, non-overlapping buckets.  Sleep does NOT freeze these.
const DAYPARTS = [
  { id: 'deep_night',     label: 'deep night',     hourStart: 0,  hourEnd: 4  },
  { id: 'pre_dawn',       label: 'pre-dawn',        hourStart: 4,  hourEnd: 6  },
  { id: 'early_morning',  label: 'early morning',   hourStart: 6,  hourEnd: 8  },
  { id: 'morning',        label: 'morning',         hourStart: 8,  hourEnd: 12 },
  { id: 'midday',         label: 'midday',          hourStart: 12, hourEnd: 14 },
  { id: 'afternoon',      label: 'afternoon',       hourStart: 14, hourEnd: 17 },
  { id: 'evening',        label: 'evening',         hourStart: 17, hourEnd: 20 },
  { id: 'night',          label: 'night',           hourStart: 20, hourEnd: 22 },
  { id: 'late_night',     label: 'late night',      hourStart: 22, hourEnd: 24 },
];

/**
 * Returns the daypart bucket for a given 24-hour value (Eastern).
 * CRITICAL: This is recalculated from the live clock every time.
 * Sleep state, prior narratives, and cached descriptors cannot override this.
 */
export function getDaypart(hourET) {
  const h = ((hourET % 24) + 24) % 24; // normalise
  return DAYPARTS.find(d => h >= d.hourStart && h < d.hourEnd) || DAYPARTS[0];
}

// ── ENVIRONMENT DESCRIPTOR ────────────────────────────────────────────────────
// Natural language environment cues keyed by daypart + sleep state.
// Used by narrative engine to get correct lighting/atmosphere language.
const DAYPART_ENV = {
  deep_night: {
    awake:  'The apartment is quiet and dark, well past midnight. The city is still.',
    asleep: 'Deep night. The room is dark and still — the hours between midnight and dawn, the world fully quiet.',
  },
  pre_dawn: {
    awake:  'Pre-dawn quiet. The sky outside is still dark but the first imperceptible shift toward morning has begun.',
    asleep: 'Pre-dawn stillness. The room is dark but the night is winding toward its end — a different kind of quiet than midnight.',
  },
  early_morning: {
    awake:  'Early morning. The first gray-blue light is beginning to gather outside.',
    asleep: 'Early morning, though they are still asleep. The curtains are beginning to catch the first soft gray light of dawn outside.',
  },
  morning: {
    awake:  'Morning. The day is properly underway — natural light is filling the space.',
    asleep: 'Morning now, though they are still asleep. Light is pressing at the curtains and the city outside is fully active.',
  },
  midday: {
    awake:  'Midday. The sun is at its peak and the day is in full stride.',
    asleep: 'Well into midday. The light through the curtains is bright and the world outside is fully active.',
  },
  afternoon: {
    awake:  'Mid-afternoon. The day has momentum and the light is warm.',
    asleep: 'Afternoon. The light coming through is golden — the day is already half-spent.',
  },
  evening: {
    awake:  'Evening. The light is fading and the day is winding down.',
    asleep: 'Early evening. The light has gone soft and golden outside, the day winding toward night.',
  },
  night: {
    awake:  'Night. The day is over and the city has shifted into its evening pace.',
    asleep: 'Night. The room is dim and the world outside has quieted to its nighttime rhythm.',
  },
  late_night: {
    awake:  'Late night. The city has quieted significantly and the hours are running toward midnight.',
    asleep: 'Late night. The room is still and dark, the kind of quiet that only comes well after midnight.',
  },
};

export function getDaypartEnvironmentCue(daypartId, isAsleep) {
  const cues = DAYPART_ENV[daypartId] || DAYPART_ENV.deep_night;
  return isAsleep ? cues.asleep : cues.awake;
}

// ── ELAPSED TIME HELPERS ──────────────────────────────────────────────────────

/**
 * Returns a human-readable elapsed time string from a timestamp.
 * e.g. "just now", "12 minutes ago", "3 hours ago", "yesterday", "2 days ago"
 */
export function formatElapsedTime(ms) {
  if (!ms || ms < 0) return 'unknown';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 90)    return 'just now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60)    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24)      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(ms / 86400000);
  if (days === 1)      return 'yesterday';
  return `${days} days ago`;
}

/**
 * Determine continuity mode from elapsed time + whether sleep occurred.
 * Returns one of:
 *   'immediate'           — < 5 minutes
 *   'recent'              — 5–60 minutes
 *   'same_day_gap'        — 1–6 hours, same calendar day
 *   'resumed_after_gap'   — 6–18 hours, possibly same day
 *   'resumed_after_sleep' — sleep occurred between messages
 *   'next_day'            — different calendar day
 *   'long_absence'        — 48+ hours
 */
export function getContinuityMode(elapsedMs, sleepOccurred, dayChanged) {
  if (dayChanged && elapsedMs > 86400000 * 1.5) return 'long_absence';
  if (dayChanged) return 'next_day';
  if (sleepOccurred) return 'resumed_after_sleep';
  if (elapsedMs < 5 * 60 * 1000) return 'immediate';
  if (elapsedMs < 60 * 60 * 1000) return 'recent';
  if (elapsedMs < 6 * 60 * 60 * 1000) return 'same_day_gap';
  return 'resumed_after_gap';
}

// ── MAIN BUILDER ──────────────────────────────────────────────────────────────

/**
 * Builds the authoritative temporal state packet.
 *
 * @param {object} character          — Character record from DB
 * @param {string|null} lastMsgTimestamp — ISO timestamp of the last message in the thread
 * @returns {TemporalState}
 */
export function buildTemporalState(character, lastMsgTimestamp = null) {
  // ── LIVE CLOCK (Eastern Time) ────────────────────────────────────────────
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hourET    = nowET.getHours();
  const minuteET  = nowET.getMinutes();
  const dayOfWeek = nowET.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  const dateStr   = nowET.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const timeStr   = `${hourET % 12 || 12}:${String(minuteET).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;

  // ── DAYPART (always recalculated — never cached) ──────────────────────────
  const daypart = getDaypart(hourET);

  // ── SLEEP STATE ──────────────────────────────────────────────────────────
  const isAsleep = (() => {
    if (!character) return false;
    const rp = character.resolved_presence_status;
    if (rp === 'sleeping' || rp === 'napping') return true;
    if (!character.sleep_start_time || !character.wake_up_time) return false;
    const sleepH = parseInt(character.sleep_start_time.split(':')[0], 10);
    const wakeH  = parseInt(character.wake_up_time.split(':')[0], 10);
    if (sleepH > wakeH) return hourET >= sleepH || hourET < wakeH; // crosses midnight
    return hourET >= sleepH && hourET < wakeH;
  })();

  // ── SLEEP ACCESS STATE (three-way, not binary) ────────────────────────────
  // full_active      — normal daytime; all systems unlocked
  // interaction_awake — woken by chat during sleep hours; responsive but sleep-protected
  // sleep_protected  — asleep; not interacting
  //
  // interaction_awake is set when:
  //   - character was interrupted by user_chat within the last 30 minutes
  //   - AND the clock is still inside the sleep window
  //   - AND no explicit stay-awake decision overrides it
  const sleepAccessState = (() => {
    if (!character) return 'full_active';
    if (!isAsleep) return 'full_active';
    // Check for recent chat interruption
    if (character.sleep_interrupted_at) {
      const interruptedAt = new Date(character.sleep_interrupted_at);
      const minutesSince = (Date.now() - interruptedAt.getTime()) / 60000;
      if (minutesSince < 30 && (character.wake_source === 'user_chat' || !character.wake_source)) {
        return 'interaction_awake';
      }
    }
    return 'sleep_protected';
  })();

  // Minutes remaining in sleep window (helps the LLM know how close to natural wake-up)
  const minutesUntilWake = (() => {
    if (!character?.wake_up_time || !isAsleep) return null;
    const [wakeH, wakeM] = character.wake_up_time.split(':').map(Number);
    const wakeMin = wakeH * 60 + (wakeM || 0);
    const nowMin  = hourET * 60 + minuteET;
    let diff = wakeMin - nowMin;
    if (diff < 0) diff += 1440; // crosses midnight
    return diff;
  })();

  // ── ELAPSED TIME & CONTINUITY ────────────────────────────────────────────
  let elapsedMs         = null;
  let elapsedLabel      = 'unknown';
  let continuityMode    = 'immediate';
  let dayChanged        = false;
  let sleepOccurred     = false;
  let lastInteractionStr = null;

  if (lastMsgTimestamp) {
    const lastMsgDate = new Date(lastMsgTimestamp);
    elapsedMs = Date.now() - lastMsgDate.getTime();
    elapsedLabel = formatElapsedTime(elapsedMs);

    // Check if calendar day changed
    const lastET = new Date(lastMsgDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    dayChanged = lastET.getDate() !== nowET.getDate() ||
                 lastET.getMonth() !== nowET.getMonth() ||
                 lastET.getFullYear() !== nowET.getFullYear();

    // Check if a sleep cycle likely occurred in the gap
    if (character && character.sleep_start_time && elapsedMs > 3 * 3600 * 1000) {
      const sleepH = parseInt(character.sleep_start_time.split(':')[0], 10);
      const lastHour = lastET.getHours();
      // If the gap spans the sleep window start hour, sleep likely occurred
      const hoursSpanned = elapsedMs / 3600000;
      sleepOccurred = hoursSpanned >= 5 || (dayChanged && hoursSpanned > 2);
    }

    continuityMode = getContinuityMode(elapsedMs, sleepOccurred, dayChanged);

    lastInteractionStr = lastET.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'America/New_York',
    });
  }

  // ── ENVIRONMENT CUE ──────────────────────────────────────────────────────
  const environmentCue = getDaypartEnvironmentCue(daypart.id, isAsleep);

  return {
    // Clock
    currentTime:      timeStr,
    currentDay:       dayOfWeek,
    currentDate:      dateStr,
    hourET,
    minuteET,

    // Daypart — the most important temporal signal
    daypartId:        daypart.id,
    daypartLabel:     daypart.label,
    environmentCue,

    // Sleep (binary + access state)
    isAsleep,
    sleepAccessState,   // 'full_active' | 'interaction_awake' | 'sleep_protected'
    minutesUntilWake,   // null if not in sleep window; integer minutes until scheduled wake

    // Elapsed / continuity
    elapsedMs,
    elapsedLabel,
    lastInteractionStr,
    dayChanged,
    sleepOccurred,
    continuityMode,
  };
}

// ── LLM BLOCK BUILDER ─────────────────────────────────────────────────────────

/**
 * Converts a TemporalState into a formatted LLM prompt block.
 * This REPLACES any ad-hoc time/daypart injection in individual prompt builders.
 */
export function buildTemporalContextBlock(ts) {
  if (!ts) return '';

  const continuityDescriptions = {
    immediate:           'This is an immediate continuation — the last exchange was just moments ago.',
    recent:              'The last exchange was recent (under an hour ago) — conversation has natural momentum.',
    same_day_gap:        'A few hours have passed since the last exchange — same day but not immediate.',
    resumed_after_gap:   'Several hours have passed — the interaction is being resumed, not continued.',
    resumed_after_sleep: 'Sleep has occurred since the last interaction — this is a new-day resumption, not a continuation of the prior moment.',
    next_day:            'This is the next day. Yesterday\'s conversation is a memory, not an ongoing moment.',
    long_absence:        'Multiple days have passed. Prior topics are background, not immediate.',
  };

  // ── SLEEP ACCESS STATE BLOCK ────────────────────────────────────────────────
  // Three states: full_active | interaction_awake | sleep_protected
  // interaction_awake = woken by chat during sleep hours — responsive but NOT fully unlocked
  const sleepAccessState = ts.sleepAccessState || (ts.isAsleep ? 'sleep_protected' : 'full_active');
  const wakeCountdown = ts.minutesUntilWake != null
    ? ` (~${ts.minutesUntilWake} minutes until scheduled wake-up)`
    : '';

  const sleepBlock = (() => {
    if (sleepAccessState === 'full_active') {
      return `Sleep state: FULLY ACTIVE — normal waking hours. All behavior, travel, and schedule systems are unrestricted.`;
    }

    if (sleepAccessState === 'interaction_awake') {
      return `Sleep state: INTERACTION-AWAKE (woken by this conversation during sleep hours${wakeCountdown})

You have been briefly woken by this chat. You are responsive — you can think, feel, reason, and communicate.
But you are NOT fully unlocked for the day. You are still inside your sleep window.

WHAT YOU CAN DO:
• Respond intelligently and emotionally
• Express thoughts, feelings, needs, and preferences
• Make small, home-based decisions
• Reference what you need or want
• Reason clearly about situations

WHAT REMAINS LOCKED until sleep window ends or a strong override occurs:
• Unrestricted travel (leaving home, going to bars/coffee shops/stores/errands)
• Full daytime routing and schedule progression
• Autonomous outside-world engagement
• Broad social outings or destination changes

NEED-BASED DECISIONS: If a need arises (hunger, thirst, discomfort), prefer solutions that are:
  → Home-based (e.g. "I made something in the kitchen" NOT "I went out for coffee")
  → Low-effort and quiet
  → Temporary fixes that allow returning to sleep afterward

PRESENCE CONSISTENCY: While interaction-awake, your location remains home/sleep environment.
Do NOT narrate yourself leaving home, starting travel, or beginning your day.
The world outside is not your concern until your sleep window ends.

RETURN TO SLEEP: If this conversation ends without a major override, you will naturally settle back into sleep.`;
    }

    // sleep_protected
    return `Sleep state: ASLEEP — but the WORLD CLOCK has not frozen. The current daypart is "${ts.daypartLabel}" and environmental descriptions must reflect it. Do NOT default to generic "night" language if the real time is morning.`;
  })();

  const elapsedLine = ts.elapsedLabel && ts.elapsedLabel !== 'unknown'
    ? `Last interaction: ${ts.elapsedLabel}${ts.lastInteractionStr ? ` (${ts.lastInteractionStr})` : ''}`
    : '';

  const continuityLine = continuityDescriptions[ts.continuityMode] || '';

  return `
════════════════════════════════════
TEMPORAL STATE — AUTHORITATIVE (recalculated from live clock — cannot be overridden)
════════════════════════════════════
Current time:   ${ts.currentTime}
Current day:    ${ts.currentDay}, ${ts.currentDate}
Daypart:        ${ts.daypartLabel.toUpperCase()}
${sleepBlock}
${elapsedLine ? elapsedLine + '\n' : ''}Continuity:     ${ts.continuityMode.replace(/_/g, ' ')}
${continuityLine}

ENVIRONMENT CUE (must match current time, not prior narrative state):
"${ts.environmentCue}"

HARD RULES:
• 5:00 AM is early morning — NOT midnight. DO NOT write "night sky" or "late-night stillness."
• If the clock shows morning, morning language is required even if the character is asleep.
• If hours have elapsed, the topic from the prior exchange is NOT immediate — treat it as resumed, remembered, or past.
• Day rollover is a real transition. Do not blend yesterday and today into one continuous emotional moment.
• The daypart above is final. Narrative tone, lighting, atmosphere, and character alertness must all match it.
• INTERACTION-AWAKE ≠ FULLY AWAKE. Being responsive to chat does not unlock travel, errands, or full daytime behavior.
════════════════════════════════════`;
}