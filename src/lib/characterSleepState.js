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

  // ── DB TRUTH FIRST: if DB says sleeping/napping, trust it — same source Travel/Text use ──
  // Do NOT override a sleeping DB status with energy checks. The DB is the one truth.
  // enforceSlowdownSleep writes sleeping into DB; this must respect that write.
  if (status === 'sleeping') {
    return {
      isSleeping: true,
      isNapping: false,
      displayLabel: 'sleeping',
      contextLabel: 'Asleep',
      visible_label: 'Asleep',
      confirmed_reason: reason || 'db_sleeping',
      evidence_source: 'resolved_presence_status',
      confidence: 1,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  if (status === 'napping') {
    return {
      isSleeping: true,
      isNapping: true,
      displayLabel: 'napping',
      contextLabel: 'Resting',
      visible_label: 'Resting',
      confirmed_reason: reason || 'db_napping',
      evidence_source: 'resolved_presence_status',
      confidence: 1,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── NOT SLEEPING: Route by character type ──────────────────────────────────
  if (status !== 'sleeping' && status !== 'napping') {
    const isActiveCreated = character.character_type === 'active_created_character';
    const isConfinedOrWorking = character.is_jailed ||
      status === 'at_work' ||
      status === 'at_school' ||
      status === 'house_arrest';

    if (!isConfinedOrWorking) {
      if (isActiveCreated) {
        // ACTIVE CREATED CHARACTERS: autonomous sleep only — never forced by schedule window alone.
        // Check for autonomous sleep evidence during the app's late-night/early-morning slowdown (midnight–6 AM ET).
        // Evidence = tiredness/energy threshold, sleep debt, explicit awake override expired.
        const nowHour = nowET.getHours();
        const isSlowdownHour = nowHour >= 0 && nowHour < 6;
        const hasAwakeOverride = character.decided_to_stay_up_until &&
          new Date(character.decided_to_stay_up_until) > nowET;

        if (isSlowdownHour && !hasAwakeOverride) {
          const energyLow = character.energy_value !== undefined && character.energy_value < 30;
          const tiredEnough = character.energy_value !== undefined && character.energy_value < 45;

          if (energyLow || tiredEnough) {
            // Autonomous evidence supports sleep — treat as asleep, flag that DB status is stale
            return {
              isSleeping: true,
              isNapping: false,
              displayLabel: 'sleeping',
              contextLabel: '🌙 sleeping (autonomous — stale DB)',
              visible_label: '🌙 sleeping',
              confirmed_reason: 'autonomous_sleep_stale_db',
              evidence_source: energyLow ? 'energy_low' : 'tiredness_threshold',
              confidence: 0.8,
              stale_risk: false,
              isLikelyStale: false,
              blockingCondition: null,
              stale_db_detected: true,
              active_created_sleep_model: true,
            };
          }

          // No autonomous evidence — awake with no exception during slowdown. Flag for diagnostics.
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
            diagnostic_flag: 'active_created_character_awake_during_expected_sleep_window',
          };
        }

        // Outside slowdown hours or has awake override — normal awake
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
      } else {
        // NPC / FAMILY / UNTYPED: schedule-window override is appropriate for these character types.
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
            contextLabel: '🌙 sleeping (scheduled window)',
            visible_label: '🌙 sleeping',
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
    }

    // Confined/working or no sleep evidence — awake
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
  // Valid reasons include: user-directed sleep, recovery, etc.
  const validOversleepReasons = [
    'user_directed_nap',
    'illness_sleep',
    'emotional_crash_recovery',
    'interrupted_sleep_recovery',
  ];

  const hasValidOversleep = (() => {
    if (character.decided_to_stay_up_until && new Date(character.decided_to_stay_up_until) > nowET) return false;
    if (validOversleepReasons.some(r => reason.includes(r))) return true;
    if (character.health_value !== undefined && character.health_value < 30) return true;
    if (character.mental_value !== undefined && character.mental_value < 25) return true;
    return false;
  })();

  if (hasValidOversleep) {
    const proofType = character.health_value < 30 ? 'illness' :
      character.mental_value < 25 ? 'emotional_state' : 'unknown';

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
      energy: character.energy_value ?? 75,
      health: character.health_value ?? 100,
      mental: character.mental_value ?? 70,
    },
  };
}

export default getCharacterSleepState;