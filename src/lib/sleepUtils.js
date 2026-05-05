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

  const missedHours = Math.max(0, scheduledSleepHours - sleptHours);

  return {
    sleep_interrupted_at: now.toISOString(),
    wake_source: 'user_chat',
    sleep_debt_hours: (character.sleep_debt_hours || 0) + Math.round(missedHours * 10) / 10,
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