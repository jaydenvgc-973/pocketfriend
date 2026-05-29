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
 * Returns true if this character is an NPC resident of VGC Towers.
 *
 * RESIDENCY PROOF:
 *   character.current_home_location_id must point to a LocationReference whose
 *   name === 'VGC Towers'. This is the sole canonical residency source.
 *   No name matching on characters. No created_by. No heuristics.
 *
 * locationMap: { [locationId]: LocationReference } — must include VGC Towers entry.
 * Returns false when locationMap is not provided (safe fallback → generic NPC path).
 *
 * VGC Towers NPC residents are routed to the dedicated resident sleep window
 * (2:30 AM → 8:30 AM) instead of the generic npc_forced_default (0:00 → 8:00).
 * This keeps them available for the VGC Towers Travel system which sends residents
 * out into the world starting at 10 AM (DEPARTURE block).
 *
 * APPLIES ONLY to NPC-type characters. active_created_character is never affected.
 */
export function isVGCTowersNPCResident(character, locationMap) {
  if (!character || !locationMap) return false;
  if (!isNPCCharacterType(character)) return false;
  const homeId = character.current_home_location_id;
  if (!homeId) return false;
  const homeLoc = locationMap[homeId];
  if (!homeLoc) return false;
  return homeLoc.name === 'VGC Towers';
}

// VGC Towers resident sleep window (ET minutes-since-midnight)
//   Residents return home ~2:00 AM via returnVGCResidentsHome automation
//   Sleep begins ~2:30 AM (30-min wind-down after return)
//   Wake time   ~8:30 AM
//   Morning DEPARTURE travel block fires at 10:00 AM — fully clear of sleep by then
export const VGC_RESIDENT_SLEEP_START_MIN = 2 * 60 + 30;  // 150 min (2:30 AM)
export const VGC_RESIDENT_WAKE_TIME_MIN   = 8 * 60 + 30;  // 510 min (8:30 AM)

/**
 * Computes the sleep window for a character.
 * Schedule-based only. No debt.
 *
 * ONE TRUTH RULE: This is the single canonical sleep-window resolver.
 *
 * SOURCE LABELS (returned as `source` field):
 *   'stored_schedule'        — explicit sleep_start_time + wake_up_time on the record
 *   'vgc_resident_schedule'  — VGC Towers NPC resident window 02:30–08:30 AM
 *   'npc_forced_default'     — generic NPC fallback 00:00–08:00 (non-VGC-resident NPCs only)
 *   'overnight_work'         — derived from overnight work shift connected to a selected work day
 *   'work_schedule'          — derived from day shift; today or tomorrow is a selected work day
 *   'school_enrollment'      — derived from enrollment override start time
 *   'school_hours'           — documented fallback (08:00) when enrollment has no override time
 *   'no_structured_timing'   — no explicit schedule, no work, no school of any kind
 *
 * KEY RULES:
 *   - VGC Towers NPC residents use 'vgc_resident_schedule', NOT 'npc_forced_default'.
 *     Residency is proven by character.current_home_location_id → location.name === 'VGC Towers'.
 *   - Non-VGC NPC types still use 'npc_forced_default' (00:00–08:00). Unchanged.
 *   - Work-derived sleep applies ONLY on selected work days (and adjacent overnight logic).
 *   - Non-selected work days are not "no schedule" — but they are also not work days.
 *     Saturday for a Mon–Fri worker is simply not a work day. Do not invent timing for it.
 *   - The one overnight exception: if yesterday was a selected work day and the overnight
 *     shift crossed midnight, post-shift sleep applies this morning.
 *   - School enrolled characters: enrollment override → school hours → fallback.
 *   - Midnight (00:00) as a sleep start is arithmetic: 07:00 wake - 7h = 00:00.
 *   - Wake time is ALWAYS: sleepStart + SLEEP_DURATION. Never shiftStart - prepBuffer.
 *     Those are separate concepts (sleepWakeTime vs nextShiftPrepTime vs nextShiftStartTime).
 *
 * @param {object} character
 * @param {object} [locationMap] — optional { [locationId]: LocationReference }
 *   When provided, used to identify VGC Towers residency. When absent, VGC residents
 *   fall through to npc_forced_default (safe, conservative fallback).
 */
function computeAdaptiveSleepWindow(character, locationMap) {
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

  // PRIORITY 2 (NPC types): Separate VGC Towers residents from generic NPCs.
  //
  //   VGC Towers NPC residents → 'vgc_resident_schedule' (2:30 AM–8:30 AM)
  //   All other NPC types     → 'npc_forced_default'    (0:00 AM–8:00 AM)
  //
  // VGC residents participate in forced world travel (DEPARTURE block at 10 AM).
  // The generic 0:00–8:00 window is acceptable for background NPCs, but for VGC
  // residents it would suppress travel availability in ways inconsistent with the
  // VGC Travel system design: residents return home at ~1 AM, need wind-down time,
  // then sleep 2:30–8:30, fully awake and eligible for 10 AM departure.
  if (isNPCCharacterType(character)) {
    if (isVGCTowersNPCResident(character, locationMap)) {
      return {
        sleepStartMin: VGC_RESIDENT_SLEEP_START_MIN,
        wakeMin: VGC_RESIDENT_WAKE_TIME_MIN,
        source: 'vgc_resident_schedule',
      };
    }
    // Generic NPC (non-VGC-resident) — unchanged behavior
    return { sleepStartMin: 0, wakeMin: 8 * 60, source: 'npc_forced_default' };
  }

  // PRIORITY 3: Derive from work schedule (active_created_character).
  // Work-derived sleep timing ONLY applies on selected work days (and adjacent overnight logic).
  // Non-selected work days are not "no schedule" — but they are also not work days.
  // The system must NOT apply work sleep timing on days the character is not scheduled to work,
  // except for one legitimate case: an overnight shift that began on a selected work day and
  // ended after midnight into the next morning.
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
        const workedLastNight = character.work_days.includes(yesterday);
        const worksTonight    = character.work_days.includes(today);
        if (workedLastNight || worksTonight) {
          const sleepStartMin = (endMin + DECOMPRESSION_MIN) % 1440;
          const wakeMin       = (sleepStartMin + SLEEP_DURATION_MIN) % 1440;
          return { sleepStartMin, wakeMin, source: 'overnight_work' };
        }
      } else {
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

  // PRIORITY 4: School-enrolled character (no work schedule).
  // Uses canonical school schedule resolver (enrollment override → location hours → unresolved)
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const dayOfWeek = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
    // Inline resolver (avoid module imports here)
    let schoolStartMin = null, schoolEndMin = null;
    
    // Priority 1: Enrollment override
    if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
      const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
      if (active) {
        schoolStartMin = toMin(active.start_time);
        schoolEndMin = toMin(active.end_time);
      }
    }
    
    // Priority 2: School location operating hours (requires locationMap — passed from caller)
    if (schoolStartMin === null && locationMap && locationMap[character.education_location_id]) {
      const schoolLoc = locationMap[character.education_location_id];
      if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
        const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
        const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);
        const entry = todayEntries[0] || dayAgnosticEntries[0];
        if (entry) {
          schoolStartMin = toMin(entry.open_time);
          schoolEndMin = toMin(entry.close_time);
        }
      }
    }

    if (schoolStartMin !== null && schoolEndMin !== null) {
      const wakeMin       = (schoolStartMin - 60 + 1440) % 1440;
      const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
      return { sleepStartMin, wakeMin, source: 'school_resolved' };
    }
    // No valid school schedule
    return { sleepStartMin: null, wakeMin: null, source: 'school_schedule_unresolved' };
  }

  // PRIORITY 5: No structured timing at all.
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
 *
 * @param {object} character
 * @param {object} [locationMap] — optional { [locationId]: LocationReference }
 *   When provided, enables VGC Towers residency detection so residents use the
 *   correct 2:30 AM–8:30 AM window instead of the generic 0:00–8:00 window.
 */
export function isCharacterAsleep(character, locationMap) {
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
  // Uses canonical school schedule resolver (enrollment override → location hours)
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const weekday = [1, 2, 3, 4, 5].includes(dayOfWeek);
    if (weekday) {
      let schoolStartMin = null, schoolEndMin = null;
      
      // Priority 1: Enrollment override
      if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
        const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
        if (active) {
          schoolStartMin = toMin(active.start_time);
          schoolEndMin = toMin(active.end_time);
        }
      }
      
      // Priority 2: School location operating hours
      if (schoolStartMin === null && locationMap && locationMap[character.education_location_id]) {
        const schoolLoc = locationMap[character.education_location_id];
        if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
          const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
          const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);
          const entry = todayEntries[0] || dayAgnosticEntries[0];
          if (entry) {
            schoolStartMin = toMin(entry.open_time);
            schoolEndMin = toMin(entry.close_time);
          }
        }
      }

      if (schoolStartMin !== null && schoolEndMin !== null) {
        const inSchool = currentMinutes >= schoolStartMin && currentMinutes < schoolEndMin;
        if (inSchool) return false;
      }
    }
  }

  // Guard 2c: active travel commitment or travel session in progress → awake
  if (character.travel_status && character.travel_status !== 'not_traveling') return false;

  // Guard 2d: confinement — jailed or house arrest characters follow facility schedule, not sleep
  if (character.is_jailed || character.house_arrest_active) return false;

  // Guard 3: sleep window — pass locationMap so VGC residents get the correct window
  const window = computeAdaptiveSleepWindow(character, locationMap);
  if (!window || window.sleepStartMin == null || window.wakeMin == null) return false;

  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) {
    return currentMinutes >= sleepStartMin || currentMinutes < wakeMin;
  }
  return currentMinutes >= sleepStartMin && currentMinutes < wakeMin;
}