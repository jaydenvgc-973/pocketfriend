/**
 * SLEEP UTILITIES - DEBT SYSTEM REMOVED
 *
 * CRITICAL: Sleep debt has been completely removed as an active system.
 * - No debt calculation
 * - No debt storage
 * - No debt-driven availability logic
 * - No debt-driven napping or forced returns
 * - No sleep_debt_hours reads or writes
 * - No sleep_interrupted_at writes
 *
 * Sleep now operates through:
 * - Explicit schedule (sleep_start_time + wake_up_time)
 * - Adaptive schedule (derived from work/school)
 * - Chat interruption (energy recovery only, no debt accrual)
 * - Story/presence logic (user-controlled or schedule-controlled, never debt)
 */

export const STALE_SLEEP_GRACE_MINUTES = 20;

/**
 * Determines if a character's DB sleeping/napping state is valid (character-driven)
 * or stale (system artifact that should be cleared).
 *
 * REMOVED: Sleep debt classification completely removed.
 * Only explicit story/schedule sleep is valid now.
 */
export function classifySleepState(character) {
  const canonicalAsleep = isCharacterAsleep(character);

  if (canonicalAsleep) {
    return { isStale: false, isValid: true, reason: 'within_canonical_sleep_window', consequence_tags: [] };
  }

  const dbSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
  if (!dbSleeping) {
    return { isStale: false, isValid: false, reason: 'not_sleeping_in_db', consequence_tags: [] };
  }

  // Past canonical wake time — only story-based stay-up decisions keep sleep valid
  if (character.decided_to_stay_up_until) {
    const stayUntil = new Date(character.decided_to_stay_up_until);
    if (stayUntil > new Date(Date.now() - 8 * 3600 * 1000)) {
      return { isStale: false, isValid: true, reason: 'shifted_sleep_stay_up', consequence_tags: ['tired', 'shifted_schedule'] };
    }
  }

  const sleepSource = character.resolved_source_reason || '';
  if (sleepSource === 'user_directed_nap' || sleepSource.includes('nap')) {
    return { isStale: false, isValid: true, reason: 'user_directed_nap', consequence_tags: [] };
  }

  // Illness sleep
  if ((character.health_value || 100) < 30) {
    return { isStale: false, isValid: true, reason: 'illness_sleep', consequence_tags: ['sick', 'tired'] };
  }

  // Emotional crash sleep
  if ((character.mental_value || 100) < 25) {
    return { isStale: false, isValid: true, reason: 'emotional_crash_sleep', consequence_tags: ['emotional', 'exhausted'] };
  }

  // Check grace period
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const wakeMin = toMin(character.wake_up_time);
  if (wakeMin !== null) {
    let minutesPastWake = currentMin - wakeMin;
    if (minutesPastWake < 0) minutesPastWake += 1440;
    if (minutesPastWake < STALE_SLEEP_GRACE_MINUTES) {
      return { isStale: false, isValid: true, reason: 'within_wake_grace_period', consequence_tags: [] };
    }
  }

  // Stale — no valid story reason
  return { isStale: true, isValid: false, reason: 'stale_system_sleep', consequence_tags: ['groggy'] };
}

/**
 * REMOVED: All sleep debt consequence tags removed.
 * Oversleep consequences are now only story-based (personality, emotional state).
 */
export function buildOversleepConsequences(character, nowET) {
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

  // Personality-based only (no debt tags)
  if (character.trait_workaholic) {
    tags.push('panicking', 'guilty', 'rushing');
  } else if (character.trait_anxious || (character.emotional_state || '').includes('anxious')) {
    tags.push('spiraling', 'rushing', 'apologetic');
  } else if (character.trait_lazy) {
    tags.push('dismissive', 'slow_moving', 'may_call_out');
  } else if (character.trait_rebellious || character.trait_rule_breaker) {
    tags.push('intentional_skip', 'unbothered');
  } else if (character.trait_conscientious) {
    tags.push('rushing', 'apologetic', 'self_critical');
  } else if (character.trait_stubborn) {
    tags.push('blaming_others', 'dismissive');
  } else {
    tags.push('groggy', 'adjusting');
  }

  // Energy-based (no debt)
  if ((character.energy_value || 75) < 30) tags.push('exhausted');

  return tags;
}

/**
 * Returns detailed sleep state — wake from chat with energy recovery only.
 * REMOVED: No sleep debt calculation.
 */
export function getSleepState(character) {
  const isAsleep = isCharacterAsleep(character);

  // Napping state
  if (character.resolved_presence_status === 'napping') {
    return { state: 'napping' };
  }

  if (isAsleep) {
    return { state: 'asleep' };
  }

  return { state: 'awake' };
}

/**
 * Call this when a user sends a message to a sleeping character.
 * REMOVED: Sleep debt completely. Energy recovery only.
 */
export function buildSleepInterruptionUpdate(character) {
  const now = new Date();
  
  // Calculate how long they've been asleep
  const sleepStart = character.last_sleep_start ? new Date(character.last_sleep_start) : null;
  const sleptHours = sleepStart ? (now.getTime() - sleepStart.getTime()) / 3600000 : 0;

  return {
    // REMOVED: no sleep_debt_hours, no sleep_interrupted_at
    // Energy recovery only
    energy_value: Math.min(100, (character.energy_value || 50) + Math.round(sleptHours * 8)),
  };
}

/**
 * Computes the sleep window for a character.
 * Schedule-based only. No debt.
 */
function computeAdaptiveSleepWindow(character) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // PRIORITY 1: Stored schedule
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w };
  }

  // PRIORITY 2: Derive from work/school
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

  return null;
}

/**
 * Determines if a character is currently asleep based on schedule only.
 * REMOVED: Sleep debt completely.
 */
export function isCharacterAsleep(character) {
  // If character decided to stay up, they're awake
  if (character?.decided_to_stay_up_until) {
    const stayUpUntil = new Date(character.decided_to_stay_up_until);
    if (new Date() < stayUpUntil) {
      return false;
    }
  }

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();

  const window = computeAdaptiveSleepWindow(character);
  if (!window) return false;

  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) {
    return currentMinutes >= sleepStartMin || currentMinutes < wakeMin;
  }
  return currentMinutes >= sleepStartMin && currentMinutes < wakeMin;
}