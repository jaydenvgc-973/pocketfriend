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
 * ONE TRUTH RULE: This is the single canonical sleep-window resolver used by
 * isCharacterAsleep, locationResolutionEngine, getCharacterLivePresence, and
 * getCharacterSleepState (via characterSleepState.js which mirrors this logic).
 *
 * Priority:
 *   1. Explicit sleep_start_time + wake_up_time on the character record
 *   2. NPC types → forced 00:00–08:00 ET
 *   3. active_created_character → derive from next upcoming work shift (any work day)
 *      Overnight shifts: sleep window starts 1h after shift ends
 *      Day shifts: sleep window is 7h before (shiftStart - 1h buffer)
 *   4. School-only character → wake at 07:00, sleep at 00:00
 *   5. No schedule at all → safe default 23:00–07:00 (conservative, not midnight)
 *
 * CRITICAL: Do NOT assume midnight for characters with late or overnight work.
 * If a character's work ends at 02:00 AM, their sleep starts at ~03:00 AM.
 */
function computeAdaptiveSleepWindow(character) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // PRIORITY 1: Stored explicit schedule — works for ALL character types
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w };
  }

  // PRIORITY 2 (NPC types only): forced default window 00:00–08:00 ET
  if (isNPCCharacterType(character)) {
    return { sleepStartMin: 0, wakeMin: 8 * 60 }; // 00:00–08:00
  }

  // PRIORITY 3 (active_created_character): Derive from work schedule
  // Find the next upcoming shift across ANY work day — not just today/tomorrow.
  // This ensures characters with late/overnight shifts never get an incorrect window.
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const startMin = toMin(character.work_start_time);
    const endMin   = toMin(character.work_end_time);
    if (startMin !== null && endMin !== null) {
      const isOvernightShift = endMin < startMin;
      if (isOvernightShift) {
        // Overnight: sleep starts 1h after shift ends, wake 1h before shift starts
        return {
          sleepStartMin: (endMin + 60) % 1440,
          wakeMin: (startMin - PRE_SHIFT_BUFFER + 1440) % 1440,
        };
      } else {
        // Day shift: wake 1h before start, sleep 7h before wake
        const wakeTime = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
        return {
          sleepStartMin: (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440,
          wakeMin: wakeTime,
        };
      }
    }
  }

  // PRIORITY 4 (active_created_character with school, no work)
  if (character.student_status === 'enrolled' && character.education_location_id) {
    // School starts ~8 AM, wake at 7 AM, sleep at midnight
    return { sleepStartMin: 0, wakeMin: 7 * 60 };
  }

  // PRIORITY 5: No schedule at all — safe character-specific default
  // 23:00–07:00 ET. NOT midnight. This is a conservative default for characters
  // with no schedule information. It is NOT a universal midnight rule.
  // Characters with schedules (work/school/explicit) always use those instead.
  return { sleepStartMin: 23 * 60, wakeMin: 7 * 60 };
}

/**
 * Determines if a character is currently asleep based on schedule only.
 * ONE TRUTH: This is the canonical sleep gate used by locationResolutionEngine,
 * getCharacterLivePresence, and travelPresenceResolver.
 *
 * Guards (in order):
 *   1. decided_to_stay_up_until override → awake
 *   2. Currently on active work shift → awake (never asleep during own shift)
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

  // Guard 2: live work shift check — never asleep during own active shift
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const dayOfWeek = nowET.getDay();
    if (character.work_days.includes(dayOfWeek)) {
      const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
      const startMin = toMin(character.work_start_time);
      const endMin   = toMin(character.work_end_time);
      const onShift = endMin < startMin
        ? (currentMinutes >= startMin || currentMinutes < endMin)   // overnight
        : (currentMinutes >= startMin && currentMinutes < endMin);  // day
      if (onShift) return false;
    }
  }

  // Guard 3: sleep window
  const window = computeAdaptiveSleepWindow(character);
  if (!window) return false;

  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) {
    return currentMinutes >= sleepStartMin || currentMinutes < wakeMin;
  }
  return currentMinutes >= sleepStartMin && currentMinutes < wakeMin;
}