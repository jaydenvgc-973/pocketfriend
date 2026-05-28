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

const NPC_SLEEP_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious', 'npc']);

function computeAdaptiveSleepWindow(character, etTime) {
  const SLEEP_DURATION_MIN = 7 * 60;   // 7 hours
  const PRE_SHIFT_BUFFER   = 60;        // 1 hour prep before shift
  const DECOMPRESSION_MIN  = 60;        // 1 hour wind-down after overnight shift
  const toMin = toMinutes;

  // PRIORITY 1: Stored schedule is canonical — always wins for ALL character types
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, source: 'stored_schedule' };
  }

  // PRIORITY 2 (NPC types): forced default window 00:00–08:00 ET
  if (NPC_SLEEP_TYPES.has(character.character_type)) {
    return { sleepStartMin: 0, wakeMin: 8 * 60, source: 'npc_forced_default' };
  }

  // PRIORITY 3 (active_created_character): Derive from work schedule with day awareness.
  // Three separate times are tracked:
  //   sleepWakeTime     = sleepStart + SLEEP_DURATION  (when character naturally wakes)
  //   nextShiftPrepTime = shiftStart - PRE_SHIFT_BUFFER (when they prep for work)
  //   nextShiftStart    = actual shift start
  // sleepWakeTime is NEVER set to nextShiftPrepTime. That would cause all-day sleeping.
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const startMin = toMin(character.work_start_time);
    const endMin   = toMin(character.work_end_time);
    if (startMin !== null && endMin !== null) {
      const today     = etTime.getDay();
      const yesterday = (today + 6) % 7;
      const tomorrow  = (today + 1) % 7;
      const isOvernightShift = endMin < startMin;

      if (isOvernightShift) {
        // Overnight shift (e.g. 22:00–02:00):
        //   sleepStart = shiftEnd + decompression  → 03:00
        //   sleepWake  = sleepStart + 7h            → 10:00  ← NOT shiftStart - 1h
        // Day-aware: apply when yesterday or today is a work day.
        const workedLastNight = character.work_days.includes(yesterday);
        const worksTonight    = character.work_days.includes(today);
        if (workedLastNight || worksTonight) {
          const sleepStartMin = (endMin + DECOMPRESSION_MIN) % 1440;
          const wakeMin       = (sleepStartMin + SLEEP_DURATION_MIN) % 1440;
          return { sleepStartMin, wakeMin, source: 'overnight_work' };
        }
      } else {
        // Day shift (e.g. 09:00–17:00):
        //   sleepWake  = shiftStart - prep buffer  → 08:00
        //   sleepStart = sleepWake - 7h             → 01:00
        // Day-aware: apply on work days and the day before.
        const worksToday    = character.work_days.includes(today);
        const worksTomorrow = character.work_days.includes(tomorrow);
        if (worksToday || worksTomorrow) {
          const wakeMin       = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
          const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
          return { sleepStartMin, wakeMin, source: 'work_schedule' };
        }
      }
    }
  }

  // PRIORITY 4 (school only, no work)
  // School ~08:00 → wake 07:00 → sleep 00:00
  if (character.student_status === 'enrolled' && character.education_location_id) {
    return { sleepStartMin: 0, wakeMin: 7 * 60, source: 'school_schedule' };
  }

  // PRIORITY 5: No schedule — safe default 23:00–07:00.
  // Only for characters with no explicit sleep schedule, no work, no school.
  return { sleepStartMin: 23 * 60, wakeMin: 7 * 60, source: 'default_no_schedule' };
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
  // Do NOT override a sleeping DB status with schedule or energy checks. The DB is the one truth.
  // enforceSlowdownSleep, scheduledLocationEnforcement, and user-directed sleep all write this.
  // This applies to ALL character types (active_created, NPC, legacy, untyped).
  // A character whose DB says 'sleeping' IS sleeping — regardless of schedule fields.
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

    // Live work-schedule check: if character is currently on shift per their schedule,
    // never mark them asleep — even if DB says 'home'. This is the same guard that
    // locationResolutionEngine applies at Layer 1 before sleep enforcement.
    const isLiveOnWorkShift = (() => {
      if (!character.work_start_time || !character.work_end_time || !Array.isArray(character.work_days) || character.work_days.length === 0) return false;
      const dayOfWeek = nowET.getDay();
      if (!character.work_days.includes(dayOfWeek)) return false;
      const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
      const [sh, sm] = character.work_start_time.split(':').map(Number);
      const [eh, em] = character.work_end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin   = eh * 60 + em;
      if (endMin < startMin) return nowMin >= startMin || nowMin < endMin; // overnight
      return nowMin >= startMin && nowMin < endMin;
    })();

    const isConfinedOrWorking = character.is_jailed ||
      status === 'at_work' ||
      status === 'at_school' ||
      status === 'house_arrest' ||
      isLiveOnWorkShift;

    if (!isConfinedOrWorking) {
      if (isActiveCreated) {
        // ACTIVE CREATED CHARACTERS: check schedule window first (same as Travel page),
        // then fall back to autonomous evidence for late-night slowdown hours.
        const hasAwakeOverride = character.decided_to_stay_up_until &&
          new Date(character.decided_to_stay_up_until) > nowET;

        // PRIORITY: If character has an explicit sleep schedule, use it — this is the same
        // source Travel page uses. A character whose sleep_start_time/wake_up_time puts them
        // in the sleep window IS asleep, regardless of what the DB resolved_presence_status says.
        if (!hasAwakeOverride) {
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
              contextLabel: 'Asleep',
              visible_label: 'Asleep',
              wake_label: wakeLabel,
              confirmed_reason: 'scheduled_sleep_window_active_created',
              evidence_source: `schedule_window_source:${window?.source || 'unknown'}`,
              confidence: 0.9,
              stale_risk: false,
              isLikelyStale: false,
              blockingCondition: null,
              stale_db_detected: true,
            };
          }
        }

        // LOWEST PRIORITY: energy support signal — only when there is genuinely no schedule.
        // Energy does NOT override any schedule-derived window. It only applies when
        // computeAdaptiveSleepWindow returned 'default_no_schedule' (no work, no school,
        // no explicit fields). This prevents characters with no schedule from appearing
        // fully awake at 3 AM when their energy is critically low.
        if (!hasAwakeOverride) {
          const window = computeAdaptiveSleepWindow(character, nowET);
          if (window?.source === 'default_no_schedule') {
            const energyCritical = character.energy_value !== undefined && character.energy_value < 20;
            if (energyCritical) {
              return {
                isSleeping: true,
                isNapping: false,
                displayLabel: 'sleeping',
                contextLabel: 'Asleep',
                visible_label: 'Asleep',
                confirmed_reason: 'energy_critical_no_schedule',
                evidence_source: 'energy_value',
                confidence: 0.6,
                stale_risk: false,
                isLikelyStale: false,
                blockingCondition: null,
              };
            }
          }
        }

        // Awake — no schedule window, no energy evidence
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