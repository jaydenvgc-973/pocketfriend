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

// NPC character types that use forced sleep windows
const NPC_SLEEP_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious', 'npc']);

/**
 * Returns true if this character record is an NPC type that uses forced sleep windows.
 * Exported so locationResolutionEngine and other callers can use it consistently.
 */
export function isNPCCharacterType(character) {
  return NPC_SLEEP_TYPES.has(character?.character_type);
}

/**
 * Computes the sleep window for a character.
 * Schedule-based only. No debt.
 *
 * ONE TRUTH RULE: This is the single canonical sleep-window resolver.
 *
 * SOURCE LABELS (returned as `source` field):
 *   'stored_schedule'     — explicit sleep_start_time + wake_up_time on the record
 *   'npc_forced_default'  — NPC forced 00:00–08:00 window
 *   'overnight_work'      — derived from overnight work shift (work days assigned)
 *   'work_schedule'       — derived from day shift (work days assigned)
 *   'off_day_work_routine'— character has work days but today is an off day; routine sleep still applies
 *   'school_enrollment'   — derived from enrollment override schedule
 *   'school_hours'        — derived from school location operating hours (08:00 default)
 *   'no_structured_timing'— truly no work, school, or explicit schedule of any kind
 *
 * KEY RULES:
 *   - A default schedule is a real schedule. If work_start_time/work_end_time exist with
 *     work_days, the character is a scheduled character — even on off days.
 *   - Off days are NOT "no schedule". They are scheduled off days with a known routine.
 *   - School enrolled characters are scheduled via enrollment override → school hours → fallback.
 *   - Midnight (00:00) appearing as a sleep start is math derived from schedule, not an assumption.
 *     e.g. school starts 08:00 → wake 07:00 → sleep = 07:00 - 7h = 00:00. That is arithmetic.
 *   - Wake time is ALWAYS: sleepStart + SLEEP_DURATION. Never: shiftStart - prepBuffer.
 *     Those are separate concepts (sleepWakeTime vs nextShiftPrepTime vs nextShiftStartTime).
 */
function computeAdaptiveSleepWindow(character) {
  const SLEEP_DURATION_MIN = 7 * 60;  // 7 hours
  const PRE_SHIFT_BUFFER   = 60;       // 1h prep before shift (determines wake time for day workers)
  const DECOMPRESSION_MIN  = 60;       // 1h wind-down after overnight shift
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // PRIORITY 1: Stored explicit schedule — always wins for ALL character types
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, source: 'stored_schedule' };
  }

  // PRIORITY 2 (NPC types only): forced default window 00:00–08:00 ET
  if (isNPCCharacterType(character)) {
    return { sleepStartMin: 0, wakeMin: 8 * 60, source: 'npc_forced_default' };
  }

  // PRIORITY 3: Derive from work schedule (active_created_character)
  // A character with work_days assigned is a scheduled character regardless of what day it is.
  // Off days still belong to a known routine and use the same shift-derived timing.
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const startMin = toMin(character.work_start_time);
    const endMin   = toMin(character.work_end_time);
    if (startMin !== null && endMin !== null) {
      const nowET     = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const today     = nowET.getDay();
      const yesterday = (today + 6) % 7;
      const tomorrow  = (today + 1) % 7;
      const isOvernightShift = endMin < startMin;

      if (isOvernightShift) {
        // Overnight shift (e.g. 22:00–02:00):
        //   sleepStart = shiftEnd + decompression  e.g. 02:00 + 1h = 03:00
        //   sleepWake  = sleepStart + 7h            e.g. 03:00 + 7h = 10:00
        // Apply when yesterday or today is a work day (shift ended this morning or tonight).
        // On a true off day with no adjacent work day, use off_day_work_routine below.
        const workedLastNight = character.work_days.includes(yesterday);
        const worksTonight    = character.work_days.includes(today);
        if (workedLastNight || worksTonight) {
          const sleepStartMin = (endMin + DECOMPRESSION_MIN) % 1440;
          const wakeMin       = (sleepStartMin + SLEEP_DURATION_MIN) % 1440;
          return { sleepStartMin, wakeMin, source: 'overnight_work' };
        }
        // Off day for overnight worker — maintain routine timing
        const sleepStartMin = (endMin + DECOMPRESSION_MIN) % 1440;
        const wakeMin       = (sleepStartMin + SLEEP_DURATION_MIN) % 1440;
        return { sleepStartMin, wakeMin, source: 'off_day_work_routine' };
      } else {
        // Day shift (e.g. 09:00–17:00):
        //   sleepWake  = shiftStart - prepBuffer  e.g. 09:00 - 1h = 08:00
        //   sleepStart = sleepWake - 7h            e.g. 08:00 - 7h = 01:00
        // Apply on work days and the day before (to sleep well for tomorrow).
        const worksToday    = character.work_days.includes(today);
        const worksTomorrow = character.work_days.includes(tomorrow);
        if (worksToday || worksTomorrow) {
          const wakeMin       = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
          const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
          return { sleepStartMin, wakeMin, source: 'work_schedule' };
        }
        // Off day — character has a known routine; use same timing
        const wakeMin       = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
        const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
        return { sleepStartMin, wakeMin, source: 'off_day_work_routine' };
      }
    }
  }

  // PRIORITY 4: School-enrolled character (no work schedule)
  // Resolution order: enrollment override → school location hours → computed fallback
  if (character.student_status === 'enrolled' && character.education_location_id) {
    // 4a: Check for enrollment schedule override (character-specific times)
    const enrollments = character.education_enrollments;
    if (Array.isArray(enrollments) && enrollments.length > 0) {
      const active = enrollments.find(e => e.status === 'active' && e.start_time);
      if (active) {
        const schoolStartMin = toMin(active.start_time);
        if (schoolStartMin !== null) {
          const wakeMin       = (schoolStartMin - 60 + 1440) % 1440; // wake 1h before
          const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
          return { sleepStartMin, wakeMin, source: 'school_enrollment' };
        }
      }
    }
    // 4b: School location operating hours not available here (no location map).
    //     Use school system default: school starts 08:00 → wake 07:00 → sleep 00:00.
    //     Note: 00:00 is arithmetic (07:00 - 7h = 00:00), not a midnight assumption.
    return { sleepStartMin: 0, wakeMin: 7 * 60, source: 'school_hours' };
  }

  // PRIORITY 5: No structured timing source at all.
  // Only reaches here if character has NO work, NO school, NO explicit sleep schedule.
  // 23:00–07:00 is a conservative default, not a universal rule.
  return { sleepStartMin: 23 * 60, wakeMin: 7 * 60, source: 'no_structured_timing' };
}

/**
 * Determines if a character is currently asleep based on schedule only.
 * ONE TRUTH: This is the canonical sleep gate used by locationResolutionEngine,
 * getCharacterLivePresence, and travelPresenceResolver.
 *
 * OBLIGATION GUARD RULE:
 * Any active scheduled obligation blocks sleep classification entirely.
 * Obligations are resolved before any sleep window or fallback is evaluated.
 * This includes: work shift, school attendance, travel commitment, active confinement.
 *
 * Guards (in order):
 *   1. decided_to_stay_up_until override → awake
 *   2. Active obligation (work shift, school, travel, confinement) → awake
 *   3. Sleep window check via computeAdaptiveSleepWindow → asleep/awake
 */
export function isCharacterAsleep(character) {
  if (!character) return false;

  // Guard 1: explicit stay-up override
  if (character.decided_to_stay_up_until) {
    const stayUpUntil = new Date(character.decided_to_stay_up_until);
    if (new Date() < stayUpUntil) return false;
  }

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
  const dayOfWeek = nowET.getDay();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // Guard 2a: live work shift — never asleep during own active shift
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    if (character.work_days.includes(dayOfWeek)) {
      const startMin = toMin(character.work_start_time);
      const endMin   = toMin(character.work_end_time);
      if (startMin !== null && endMin !== null) {
        const onShift = endMin < startMin
          ? (currentMinutes >= startMin || currentMinutes < endMin)
          : (currentMinutes >= startMin && currentMinutes < endMin);
        if (onShift) return false;
      }
    }
  }

  // Guard 2b: school attendance window — enrolled students are not asleep during school hours
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const weekday = [1, 2, 3, 4, 5].includes(dayOfWeek);
    if (weekday) {
      // Use enrollment override if present, otherwise 08:00–15:00 default
      let schoolStart = 8 * 60;
      let schoolEnd   = 15 * 60;
      const enrollments = character.education_enrollments;
      if (Array.isArray(enrollments) && enrollments.length > 0) {
        const active = enrollments.find(e => e.status === 'active' && e.start_time);
        if (active) {
          const s = toMin(active.start_time);
          const e = active.end_time ? toMin(active.end_time) : null;
          if (s !== null) { schoolStart = s; if (e !== null) schoolEnd = e; }
        }
      }
      const inSchool = currentMinutes >= schoolStart && currentMinutes < schoolEnd;
      if (inSchool) return false;
    }
  }

  // Guard 2c: active travel commitment or travel session in progress → awake
  if (character.travel_status && character.travel_status !== 'not_traveling') return false;

  // Guard 2d: confinement — jailed or house arrest characters follow facility schedule, not sleep
  if (character.is_jailed || character.house_arrest_active) return false;

  // Guard 3: sleep window
  const window = computeAdaptiveSleepWindow(character);
  if (!window) return false;

  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) {
    return currentMinutes >= sleepStartMin || currentMinutes < wakeMin;
  }
  return currentMinutes >= sleepStartMin && currentMinutes < wakeMin;
}