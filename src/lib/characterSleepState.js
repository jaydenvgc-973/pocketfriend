/**
 * getCharacterSleepState — Evidence-Based Sleep Classification
 * 
 * CRITICAL RULE: Never classify sleep states from needs values alone.
 * Only classify as "valid" with proof:
 * - explicit sleep_state field
 * - explicit sleep_reason field
 * - scheduled sleep window check
 * - active nap record
 * - user-directed sleep
 * - recovery state with proof
 * - illness/injury state with proof
 * 
 * Without proof → "Unverified sleep state — needs diagnosis"
 */

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function computeAdaptiveSleepWindow(character, etTime) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;
  const toMin = toMinutes;
  const dayOfWeek = etTime.getDay();

  // PRIORITY 1: Stored schedule is canonical
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, source: 'stored_schedule' };
  }

  // PRIORITY 2: Derive from work/school only
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

  if (!nextShiftStartMin && character.student_status === 'enrolled') {
    nextShiftStartMin = 8 * 60;
    nextShiftEndMin = 15 * 60;
  }

  const isOvernightShift = nextShiftStartMin !== null && nextShiftEndMin !== null && nextShiftEndMin < nextShiftStartMin;

  if (nextShiftStartMin !== null) {
    if (isOvernightShift) {
      return {
        sleepStartMin: (nextShiftEndMin + 60) % 1440,
        wakeMin: (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440,
        source: 'overnight_work',
      };
    } else {
      const wakeTime = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
      return {
        sleepStartMin: (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440,
        wakeMin: wakeTime,
        source: 'work_schedule',
      };
    }
  }

  // PRIORITY 3: Cannot determine
  return null;
}

function isScheduledSleeping(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

export function getCharacterSleepState(character) {
  if (!character) {
    return {
      isSleeping: false,
      isNapping: false,
      displayLabel: 'unknown',
      contextLabel: null,
      visible_label: 'No character data',
      confirmed_reason: null,
      evidence_source: null,
      confidence: 0,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const status = character.resolved_presence_status || '';
  const reason = character.resolved_source_reason || '';

  // ── SCHEDULE-DRIVEN SLEEP DETECTION (catches stale DB status) ──────────────
  // If the character is within their scheduled sleep window, treat them as asleep
  // regardless of what resolved_presence_status says. This is the primary fix for
  // characters who should be asleep at 5 AM but whose DB status was never updated.
  // Exceptions: characters actively at work, at school, or jailed are not overridden.
  const isConfinedOrWorking = character.is_jailed ||
    status === 'at_work' ||
    status === 'at_school' ||
    status === 'house_arrest';

  if (!isConfinedOrWorking && status !== 'sleeping' && status !== 'napping') {
    const scheduleAsleep = isScheduledSleeping(character, nowET);
    if (scheduleAsleep) {
      const window = computeAdaptiveSleepWindow(character, nowET);
      const wakeMin = window?.wakeMin ?? null;
      const wakeHour = wakeMin !== null ? Math.floor(wakeMin / 60) : null;
      const wakeMinPart = wakeMin !== null ? wakeMin % 60 : null;
      const wakeLabel = wakeHour !== null
        ? `${wakeHour % 12 || 12}:${String(wakeMinPart).padStart(2, '0')} ${wakeHour >= 12 ? 'PM' : 'AM'}`
        : null;
      return {
        isSleeping: true,
        isNapping: false,
        displayLabel: 'sleeping',
        contextLabel: `🌙 sleeping (scheduled window)`,
        visible_label: `🌙 sleeping`,
        wake_label: wakeLabel,
        confirmed_reason: 'scheduled_sleep_window_stale_db',
        evidence_source: `schedule_window_source:${window?.source || 'unknown'}`,
        confidence: 0.85,
        stale_risk: false,
        isLikelyStale: false,
        blockingCondition: null,
        stale_db_detected: true,
      };
    }
  }

  // ── NOT SLEEPING ───────────────────────────────────────────────────────────
  if (status !== 'sleeping' && status !== 'napping') {
    return {
      isSleeping: false,
      isNapping: false,
      displayLabel: 'awake',
      contextLabel: null,
      visible_label: null,
      confirmed_reason: null,
      evidence_source: null,
      confidence: 1,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── SLEEPING: Check if within scheduled window ───────────────────────────────
  const scheduledAsleep = isScheduledSleeping(character, nowET);
  if (scheduledAsleep) {
    return {
      isSleeping: true,
      isNapping: false,
      displayLabel: 'sleeping',
      contextLabel: '🌙 sleeping (scheduled)',
      visible_label: '🌙 sleeping',
      confirmed_reason: 'scheduled_sleep_window',
      evidence_source: 'sleep_schedule',
      confidence: 0.9,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── SLEEPING: Not in window — check for valid oversleep reason ──────────────
  // Valid reasons include: sleep debt, user-directed sleep, recovery, etc.
  const validOversleepReasons = [
    'recovery_nap',
    'user_directed_nap',
    'sleep_debt_recovery',
    'illness_sleep',
    'emotional_crash_recovery',
    'interrupted_sleep_recovery',
  ];

  const hasValidOversleep = (() => {
    if (character.decided_to_stay_up_until && new Date(character.decided_to_stay_up_until) > nowET) return false;
    if (character.sleep_debt_hours && character.sleep_debt_hours > 0) return true;
    if (validOversleepReasons.some(r => reason.includes(r))) return true;
    if (character.health_value !== undefined && character.health_value < 30) return true;
    if (character.mental_value !== undefined && character.mental_value < 25) return true;
    if (character.sleep_interrupted_at && (Date.now() - new Date(character.sleep_interrupted_at).getTime()) / 3600000 < 4) return true;
    return false;
  })();

  if (hasValidOversleep) {
    const proofType = character.sleep_debt_hours > 0 ? 'sleep_debt' :
      character.health_value < 30 ? 'illness' :
      character.mental_value < 25 ? 'emotional_state' :
      character.sleep_interrupted_at ? 'interrupted_sleep' : 'unknown';

    return {
      isSleeping: true,
      isNapping: status === 'napping',
      displayLabel: status === 'napping' ? 'napping' : 'sleeping',
      contextLabel: status === 'napping' ? '💤 napping (recovery)' : '🌙 sleeping (recovery)',
      visible_label: status === 'napping' ? '💤 napping' : '🌙 sleeping',
      confirmed_reason: `valid_oversleep_${proofType}`,
      evidence_source: proofType,
      confidence: 0.85,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── SLEEPING: No valid reason — UNVERIFIED / STALE ──────────────────────────
  // Character is marked sleeping past their window with no proof.
  // This is potentially stale system error unless proven otherwise.
  const minutesPastWake = (() => {
    const wakeMin = toMinutes(character.wake_up_time);
    if (wakeMin === null) return null;
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    let past = nowMin - wakeMin;
    if (past < 0) past += 1440;
    return past;
  })();

  return {
    isSleeping: true,
    isNapping: status === 'napping',
    displayLabel: 'sleeping (unverified)',
    contextLabel: '⚠️ Unverified sleep state',
    visible_label: 'Unverified sleep state',
    confirmed_reason: null,
    evidence_source: null,
    evidence_record_id: null,
    confidence: 0,  // no proof
    stale_risk: true,
    isLikelyStale: true,
    blockingCondition: `past_wake_${minutesPastWake}min`,
    diagnosticClues: {
      db_status: status,
      db_reason: reason,
      scheduled_window: isScheduledSleeping(character, nowET),
      minutes_past_wake: minutesPastWake,
      sleep_debt_hours: character.sleep_debt_hours || 0,
      energy: character.energy_value ?? 75,
      health: character.health_value ?? 100,
      mental: character.mental_value ?? 70,
    },
  };
}

export default getCharacterSleepState;