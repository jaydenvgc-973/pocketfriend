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
 * Determines if a character is currently asleep based on their personal sleep schedule.
 * If character decided to stay up, they are NOT asleep even during sleep hours.
 * Falls back to a default schedule (23:00 - 07:00) if none is set.
 */
export function isCharacterAsleep(character) {
  // If character decided to stay up, check if that decision is still valid
  if (character?.decided_to_stay_up_until) {
    const stayUpUntil = new Date(character.decided_to_stay_up_until);
    if (new Date() < stayUpUntil) {
      return false; // Character is awake by decision
    }
  }

  const sleepStart = character?.sleep_start_time || "23:00";
  const wakeUp = character?.wake_up_time || "07:00";

  // CRITICAL: Use Eastern Time for sleep schedule checks — sleep times are ET-based
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();

  const [sleepH, sleepM] = sleepStart.split(":").map(Number);
  const [wakeH, wakeM] = wakeUp.split(":").map(Number);

  const sleepMinutes = sleepH * 60 + sleepM;
  const wakeMinutes = wakeH * 60 + wakeM;

  // Sleep window crosses midnight (e.g. 23:00 - 07:00)
  if (sleepMinutes > wakeMinutes) {
    return currentMinutes >= sleepMinutes || currentMinutes < wakeMinutes;
  }

  // Sleep window within same day (e.g. 14:00 - 22:00 for a very early sleeper)
  return currentMinutes >= sleepMinutes && currentMinutes < wakeMinutes;
}