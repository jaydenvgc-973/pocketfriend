/**
 * CANONICAL SLEEP PRIORITY ORDER (enforced here and must be matched by all backend copies):
 *
 * PRIORITY 1: character.sleep_start_time + character.wake_up_time (stored schedule — ALWAYS wins)
 * PRIORITY 2: derive from work/school obligation (only when no stored schedule)
 * PRIORITY 3: no determinable schedule — fail safe = awake (return false)
 *
 * This order is duplicated in these backend functions (no local imports in Deno):
 *   - functions/autonomousCharacterMovement (computeAdaptiveSleepWindow)
 *   - functions/scheduledLocationEnforcement (computeAdaptiveSleepWindow)
 *   - functions/enforceCharacterLocationPresence (computeAdaptiveSleepWindow)
 *   - functions/createTravelSession (inline isAsleepBySchedule)
 *
 * Any future change to priority order MUST be applied to ALL locations above.
 * Root cause of Nathan Parker's 1AM/3AM autonomous travel: backend copies had work-schedule
 * BEFORE stored schedule, causing sleep window to start at 01:00 instead of 23:00.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SLEEP STATE TAXONOMY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * VALID (character-driven) — PRESERVE, never auto-clear:
 *   - oversleeping:        past wake time, DB sleeping, character has sleep_debt_hours OR
 *                          last_sleep_start is recent OR no valid reason to be awake yet
 *   - recovery_nap:        sleep_debt_hours > 0 during nap window (13:00–16:00)
 *   - user_directed_nap:   resolved_source_reason === 'user_directed_nap'
 *   - narrative_nap:       resolved_source_reason includes 'nap' and has story context
 *   - shifted_sleep:       decided_to_stay_up_until set and sleep was delayed by user action
 *   - interrupted_sleep:   sleep_interrupted_at within past 4h, still in extended sleep window
 *   - illness_sleep:       health_value < 30 or current_activity includes 'sick'
 *   - emotional_crash:     mental_value < 25 or emotional_state includes extreme values
 *
 * STALE (system-generated) — SAFE TO CLEAR after wake_up_time:
 *   - DB says sleeping/napping
 *   - canonical isCharacterAsleep() returns false
 *   - current time is past wake_up_time by more than STALE_SLEEP_GRACE_MINUTES
 *   - none of the valid reasons above apply
 *   - no active travel session (which would have already woken them)
 *
 * NEVER auto-clear valid sleep. ALWAYS clear stale sleep after grace period.
 */

/** Grace period after wake_up_time before stale sleep is cleared (minutes). */
export const STALE_SLEEP_GRACE_MINUTES = 20;

/**
 * Determines if a character's DB sleeping/napping state is valid (character-driven)
 * or stale (system artifact that should be cleared).
 *
 * Returns an object:
 * {
 *   isStale: boolean,           // true = safe to clear
 *   isValid: boolean,           // true = preserve — character-driven reason exists
 *   reason: string,             // classification of why
 *   consequence_tags: string[], // for stale sleep, what consequences to simulate
 * }
 *
 * Only meaningful when DB says sleeping/napping AND canonical isCharacterAsleep() === false.
 * If canonical returns true (still in sleep window) → not stale, always valid.
 */
export function classifySleepState(character) {
  const canonicalAsleep = isCharacterAsleep(character);

  // If canonical sleep window is still active → valid, not stale
  if (canonicalAsleep) {
    return { isStale: false, isValid: true, reason: 'within_canonical_sleep_window', consequence_tags: [] };
  }

  // If DB does not say sleeping/napping → not a stale sleep state (nothing to classify)
  const dbSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
  if (!dbSleeping) {
    return { isStale: false, isValid: false, reason: 'not_sleeping_in_db', consequence_tags: [] };
  }

  // Past canonical wake time — check for valid character-driven reasons before clearing

  // 1. Active stay-up decision that shifted sleep (shifted schedule)
  if (character.decided_to_stay_up_until) {
    const stayUntil = new Date(character.decided_to_stay_up_until);
    if (stayUntil > new Date(Date.now() - 8 * 3600 * 1000)) {
      // Stay-up decision was recent — sleep window was shifted; this is valid oversleeping
      return { isStale: false, isValid: true, reason: 'shifted_sleep_stay_up', consequence_tags: ['tired', 'shifted_schedule'] };
    }
  }

  // 2. User-directed nap or narrative-supported nap
  const sleepSource = character.resolved_source_reason || '';
  if (sleepSource === 'user_directed_nap' || sleepSource.includes('nap')) {
    return { isStale: false, isValid: true, reason: 'user_directed_nap', consequence_tags: [] };
  }

  // 3. Recovery nap — sleep debt present
  if ((character.sleep_debt_hours || 0) > 0 && character.resolved_presence_status === 'napping') {
    return { isStale: false, isValid: true, reason: 'recovery_nap', consequence_tags: ['recovering'] };
  }

  // 4. Illness sleep
  if ((character.health_value || 100) < 30) {
    return { isStale: false, isValid: true, reason: 'illness_sleep', consequence_tags: ['sick', 'tired'] };
  }

  // 5. Emotional crash sleep
  if ((character.mental_value || 100) < 25) {
    return { isStale: false, isValid: true, reason: 'emotional_crash_sleep', consequence_tags: ['emotional', 'exhausted'] };
  }

  // 6. Significant sleep debt — character legitimately oversleeping to recover.
  // Threshold is 1.0h (not > 0) to prevent 15-minute debt fragments from triggering valid oversleep.
  // With lightweight recovery ratio (max 2h debt), this means a character needs to have missed
  // at least 4 real hours of sleep before debt keeps them sleeping past their wake time.
  if ((character.sleep_debt_hours || 0) >= 1.0) {
    return { isStale: false, isValid: true, reason: 'oversleeping_sleep_debt', consequence_tags: ['tired', 'oversleeping'] };
  }

  // 7. Interrupted sleep recovery — sleep was interrupted within past 4 hours
  if (character.sleep_interrupted_at) {
    const interruptedAt = new Date(character.sleep_interrupted_at);
    const hoursSince = (Date.now() - interruptedAt.getTime()) / 3600000;
    if (hoursSince < 4) {
      return { isStale: false, isValid: true, reason: 'interrupted_sleep_recovery', consequence_tags: ['tired', 'interrupted'] };
    }
  }

  // 8. Check grace period — give the cron a window before marking stale
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const wakeMin = toMin(character.wake_up_time);
  if (wakeMin !== null) {
    let minutesPastWake = currentMin - wakeMin;
    if (minutesPastWake < 0) minutesPastWake += 1440; // crossed midnight
    if (minutesPastWake < STALE_SLEEP_GRACE_MINUTES) {
      // Still within grace period — too early to call stale
      return { isStale: false, isValid: true, reason: 'within_wake_grace_period', consequence_tags: [] };
    }
  }

  // 9. No valid reason found — this is a system-generated stale sleep state
  // Build consequence tags based on personality + missed obligations
  const consequenceTags = buildOversleeepConsequences(character, nowET);
  return {
    isStale: true,
    isValid: false,
    reason: 'stale_system_sleep',
    consequence_tags: consequenceTags,
  };
}

/**
 * Builds character-specific oversleep consequence tags based on personality traits,
 * quirks, work obligations, and emotional state.
 * These tags feed into narrative generation — not all consequences fire for every character.
 */
export function buildOversleeepConsequences(character, nowET) {
  const tags = [];
  const dayOfWeek = nowET.getDay();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();

  // Check if they're missing work right now
  const hasWork = character.work_start_time && character.work_end_time &&
    Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek);
  if (hasWork) {
    const workStart = toMin(character.work_start_time);
    if (workStart !== null && currentMin > workStart) {
      tags.push('late_for_work');
      tags.push('missed_shift_start');
    }
  }

  // Check school
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolStart = 8 * 60;
    if (currentMin > schoolStart && [1,2,3,4,5].includes(dayOfWeek)) {
      tags.push('late_for_school');
    }
  }

  // Personality-based consequence tags
  if (character.trait_workaholic || character.archetype === 'workaholic') {
    tags.push('panicking', 'guilty', 'rushing');
  } else if (character.trait_anxious || (character.emotional_state || '').includes('anxious')) {
    tags.push('spiraling', 'rushing', 'apologetic');
  } else if (character.trait_lazy || character.archetype === 'slacker') {
    tags.push('dismissive', 'slow_moving', 'may_call_out');
  } else if (character.trait_rebellious || character.trait_rule_breaker) {
    tags.push('intentional_skip', 'unbothered');
  } else if (character.trait_conscientious) {
    tags.push('rushing', 'apologetic', 'self_critical');
  } else if (character.trait_stubborn || character.trait_self_absorbed) {
    tags.push('blaming_others', 'dismissive');
  } else {
    tags.push('groggy', 'adjusting');
  }

  // Energy-based
  if ((character.energy_value || 75) < 30) tags.push('exhausted');
  if ((character.sleep_debt_hours || 0) > 1) tags.push('sleep_debt_active');

  return tags;
}

/**
 * Returns detailed sleep state — use this instead of a single boolean flag.
 * Distinguishes: asleep | waking | awake | sleep_interrupted | napping
 *
 * sleep_interrupted is set when the character was asleep but was engaged by user chat.
 * This must carry forward into energy recovery and schedule logic.
 */
export function getSleepState(character) {
  const isAsleep = isCharacterAsleep(character);

  // Chat-interrupted sleep
  if (character.sleep_interrupted_at) {
    const interruptedAt = new Date(character.sleep_interrupted_at);
    const minutesSinceInterrupt = (Date.now() - interruptedAt.getTime()) / 60000;
    // If interrupted within the last 30 minutes and still in sleep window, mark as interrupted
    if (minutesSinceInterrupt < 30 && isAsleep) {
      return {
        state: 'sleep_interrupted',
        wake_source: character.wake_source || 'user_chat',
        interrupted_at: character.sleep_interrupted_at,
        sleep_debt_hours: character.sleep_debt_hours || 0,
        can_return_to_sleep: true,
      };
    }
  }

  // Napping state
  if (character.resolved_presence_status === 'napping') {
    return { state: 'napping', sleep_debt_hours: character.sleep_debt_hours || 0 };
  }

  if (isAsleep) {
    return { state: 'asleep', sleep_debt_hours: character.sleep_debt_hours || 0 };
  }

  return { state: 'awake', sleep_debt_hours: character.sleep_debt_hours || 0 };
}

/**
 * Call this when a user sends a message to a sleeping character.
 * Returns the fields to write back to the Character record.
 */
export function buildSleepInterruptionUpdate(character) {
  const now = new Date();
  // Calculate how long they've been asleep (approximate)
  const sleepStart = character.last_sleep_start ? new Date(character.last_sleep_start) : null;
  const sleptHours = sleepStart ? (now.getTime() - sleepStart.getTime()) / 3600000 : 0;

  // Scheduled sleep duration
  const sleepH = parseInt((character.sleep_start_time || '23:00').split(':')[0]);
  const wakeH  = parseInt((character.wake_up_time || '07:00').split(':')[0]);
  const scheduledSleepHours = wakeH > sleepH ? wakeH - sleepH : (24 - sleepH) + wakeH;

  // LIGHTWEIGHT RECOVERY RATIO: 1 hour missed = 15 minutes (0.25h) of debt owed.
  // This prevents sleep debt explosion from 1:1 accumulation causing infinite oversleep loops.
  const missedHours = Math.max(0, scheduledSleepHours - sleptHours);
  const newDebtIncrement = Math.round(missedHours * 0.25 * 10) / 10; // 15 min per hour missed
  const existingDebt = character.sleep_debt_hours || 0;
  // Hard cap: debt never exceeds 2 hours total to prevent endless recovery loops
  const newDebt = Math.min(2.0, Math.round((existingDebt + newDebtIncrement) * 10) / 10);

  return {
    sleep_interrupted_at: now.toISOString(),
    wake_source: 'user_chat',
    sleep_debt_hours: newDebt,
    // Energy recovery is partial — only credit what was actually slept
    energy_value: Math.min(100, (character.energy_value || 50) + Math.round(sleptHours * 8)),
  };
}

/**
 * Computes the sleep window for a character.
 *
 * PRIORITY ORDER (source of truth rule):
 * 1. Stored sleep_start_time + wake_up_time on the character record — ALWAYS wins if present.
 *    This is the explicitly configured schedule. Never override it with derived logic.
 * 2. If NO stored schedule exists: derive from next work/school obligation (adaptive fallback).
 * 3. If neither: return null (cannot assume sleep — fail safe = awake).
 *
 * Returns { sleepStartMin, wakeMin } in minutes-since-midnight (ET), or null.
 */
function computeAdaptiveSleepWindow(character) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // PRIORITY 1: Stored schedule is the source of truth — use it directly.
  // A character with sleep_start_time = "02:00" and wake_up_time = "10:00"
  // must use those values regardless of their work schedule.
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w };
  }

  // PRIORITY 2: No stored schedule — derive from work/school obligation only.
  // This adaptive path is only for characters who have NO explicit sleep schedule set.
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nowET.getDay();

  let nextShiftStartMin = null;
  let nextShiftEndMin = null;

  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    const isWorkDayToday = character.work_days.includes(dayOfWeek);
    const isWorkDayTomorrow = character.work_days.includes((dayOfWeek + 1) % 7);
    if (isWorkDayToday || isWorkDayTomorrow) {
      nextShiftStartMin = toMin(character.work_start_time);
      nextShiftEndMin = toMin(character.work_end_time);
    }
  }

  if (!nextShiftStartMin && character.student_status === 'enrolled' && character.education_location_id) {
    nextShiftStartMin = 8 * 60;
    nextShiftEndMin = 15 * 60;
  }

  const isOvernightShift = nextShiftStartMin !== null && nextShiftEndMin !== null && nextShiftEndMin < nextShiftStartMin;

  if (nextShiftStartMin !== null) {
    if (isOvernightShift) {
      return {
        sleepStartMin: (nextShiftEndMin + 60) % 1440,
        wakeMin: (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440,
      };
    } else {
      const wakeTime = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
      return {
        sleepStartMin: (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440,
        wakeMin: wakeTime,
      };
    }
  }

  // PRIORITY 3: Nothing determinable — fail safe (return null = treat as awake).
  return null;
}

/**
 * Determines if a character is currently asleep based on their adaptive sleep schedule.
 * For active_created_character: sleep is planned around work/school obligations.
 * If character decided to stay up, they are NOT asleep even during sleep hours.
 * Falls back to default window (23:00–10:00) if no schedule is determinable.
 */
export function isCharacterAsleep(character) {
  // If character decided to stay up, check if that decision is still valid
  if (character?.decided_to_stay_up_until) {
    const stayUpUntil = new Date(character.decided_to_stay_up_until);
    if (new Date() < stayUpUntil) {
      return false; // Character is awake by decision
    }
  }

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();

  const window = computeAdaptiveSleepWindow(character);
  // No determinable sleep schedule — cannot assume sleep. Return false.
  if (!window) return false;

  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) {
    return currentMinutes >= sleepStartMin || currentMinutes < wakeMin;
  }
  return currentMinutes >= sleepStartMin && currentMinutes < wakeMin;
}