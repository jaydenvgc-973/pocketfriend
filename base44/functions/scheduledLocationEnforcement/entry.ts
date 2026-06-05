import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINE RESOLVER (identical logic to Phase 4A enforceCharacterLocationPresence) ──

// Check if character is on a location-specific shift right now
// Supports shift.days, shift.start, shift.end, and overnight shifts
function isOnShiftNow(shift, etTime) {
  if (!shift?.start || !shift?.end) return false;
  if (shift.days && shift.days.length > 0) {
    if (!shift.days.includes(etTime.getDay())) return false;
  }
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  // Overnight shift (e.g. 22:00 -> 06:00)
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

// Check if character is on their own work schedule right now (character-level fields)
function isOnWorkSchedule(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) return false;
  const dayOfWeek = etTime.getDay();
  if (!character.work_days.includes(dayOfWeek)) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = character.work_start_time.split(':').map(Number);
  const [eh, em] = character.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return now >= startMin && now < endMin;
}

/**
 * ADAPTIVE SLEEP WINDOW — active_created_character only.
 *
 * Returns { sleepStartMin, wakeMin } in minutes-since-midnight (ET),
 * computed from the character's NEXT major obligation (work or school),
 * energy level, and stored schedule as a baseline.
 *
 * Rules:
 * - If the character has an upcoming work shift, sleep is planned so they
 *   wake up ~60 min before that shift starts.
 * - If the character works overnight (shift spans midnight), sleep is placed
 *   BEFORE the shift (daytime), not during or after it.
 * - If no work/school obligation exists, fall back to stored schedule.
 * - Minimum sleep duration: 6 hours. Maximum: 10 hours.
 *
 * Returns null if no sleep window can be determined.
 */
function computeAdaptiveSleepWindow(character, etTime) {
  const SLEEP_DURATION_MIN = 7 * 60;   // 7 hours default
  const PRE_SHIFT_BUFFER   = 60;       // wake up 60 min before shift

  // Collect the character's next shift start/end in minutes-since-midnight
  let nextShiftStartMin = null;
  let nextShiftEndMin   = null;

  // Helper: parse "HH:MM" to minutes
  const toMin = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const dayOfWeek = etTime.getDay();

  // PRIORITY 1: Stored schedule is the CANONICAL source of truth — always wins if present.
  // Matches sleepUtils.js priority order. Prevents priority inversion confirmed in live data.
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, isOvernightWorker: false };
  }

  // PRIORITY 2: No stored schedule — derive from work/school obligation only.
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    const isWorkDayToday    = character.work_days.includes(dayOfWeek);
    const isWorkDayTomorrow = character.work_days.includes((dayOfWeek + 1) % 7);
    if (isWorkDayToday || isWorkDayTomorrow) {
      nextShiftStartMin = toMin(character.work_start_time);
      nextShiftEndMin   = toMin(character.work_end_time);
    }
  }

  // School: use canonical resolver (enrollment override → location hours → unresolved)
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const dayOfWeek = etTime.getDay();
    // Inline resolver (avoid imports in Deno)
    const schoolSched = (() => {
      if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
        const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
        if (active) {
          const s = toMin(active.start_time);
          const e = toMin(active.end_time);
          if (s !== null && e !== null) return { startMin: s, endMin: e };
        }
      }
      if (locationMap && locationMap[character.education_location_id]) {
        const schoolLoc = locationMap[character.education_location_id];
        if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
          const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
          const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);
          const entry = todayEntries[0] || dayAgnosticEntries[0];
          if (entry) {
            const s = toMin(entry.open_time);
            const e = toMin(entry.close_time);
            if (s !== null && e !== null) return { startMin: s, endMin: e };
          }
        }
      }
      return { startMin: null, endMin: null };
    })();
    
    if (schoolSched.startMin !== null && schoolSched.endMin !== null) {
      nextShiftStartMin = schoolSched.startMin;
      nextShiftEndMin   = schoolSched.endMin;
    }
  }

  const isOvernightShift = nextShiftStartMin !== null && nextShiftEndMin !== null &&
    nextShiftEndMin < nextShiftStartMin;

  if (nextShiftStartMin !== null) {
    if (isOvernightShift) {
      const sleepStart = (nextShiftEndMin + 60) % 1440;
      const wakeTime   = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
      return { sleepStartMin: sleepStart, wakeMin: wakeTime, isOvernightWorker: true };
    } else {
      const wakeTime   = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
      const sleepStart = (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440;
      return { sleepStartMin: sleepStart, wakeMin: wakeTime, isOvernightWorker: false };
    }
  }

  // PRIORITY 3: Cannot determine — fail safe (awake).
  return null;
}

function isSleeping(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  // No determinable sleep schedule — cannot assume sleep. Return false.
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

// Returns true if within PRE_SLEEP_WINDOW_MINUTES before adaptive sleep start
const PRE_SLEEP_WINDOW_MINUTES = 60;
function isInPreSleepWindow(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  // No determinable sleep schedule — cannot assume pre-sleep window. Return false.
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin } = window;
  const windowStart = (sleepStartMin - PRE_SLEEP_WINDOW_MINUTES + 1440) % 1440;
  if (windowStart > sleepStartMin) return now >= windowStart || now < sleepStartMin;
  return now >= windowStart && now < sleepStartMin;
}

// Returns true if within `bufferMinutes` of the adaptive sleep start
function isNearSleepWindow(character, etTime, bufferMinutes) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin } = window;
  const windowStart = (sleepStartMin - bufferMinutes + 1440) % 1440;
  if (windowStart > sleepStartMin) return now >= windowStart || now < sleepStartMin;
  return now >= windowStart && now < sleepStartMin;
}

// Valid sleep locations — categories that are acceptable for sleeping
const VALID_SLEEP_CATEGORIES = new Set(['home', 'hotel', 'shelter', 'generic']);

function isValidSleepLocation(location) {
  if (!location) return false;
  return VALID_SLEEP_CATEGORIES.has(location.category || '');
}

// Check if a location is currently open based on its operating_hours and ET time.
// No hours defined = always open.
function isLocationCurrentlyOpen(location, etTime) {
  if (!location?.operating_hours || location.operating_hours.length === 0) return true;
  const dayOfWeek = etTime.getDay();
  const currentMinutes = etTime.getHours() * 60 + etTime.getMinutes();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const inWindow = (openStr, closeStr) => {
    const open = toMin(openStr); const close = toMin(closeStr);
    if (open == null || close == null) return false;
    if (open <= close) return currentMinutes >= open && currentMinutes <= close;
    return currentMinutes >= open || currentMinutes <= close;
  };
  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);
  if (todayEntries.length > 0) return todayEntries.some(h => inWindow(h.open_time, h.close_time));
  if (daySpecific.length > 0) return false; // Has day-specific hours but none for today = closed
  if (dayAgnostic.length > 0) return dayAgnostic.some(h => inWindow(h.open_time, h.close_time));
  return true;
}

function resolveValidSleepLocationId(character, locationMap) {
  if (character.temporary_housing_location_id && locationMap[character.temporary_housing_location_id]) {
    return character.temporary_housing_location_id;
  }
  if (character.current_home_location_id && locationMap[character.current_home_location_id]) {
    return character.current_home_location_id;
  }
  if (character.home_location_id && locationMap[character.home_location_id]) {
    return character.home_location_id;
  }
  return null;
}

function isNapTime(etTime) {
  const h = etTime.getHours();
  return h >= 13 && h < 16;
}

function hasSleepDebt(character) {
  return character.sleep_debt_hours && character.sleep_debt_hours > 0;
}

function classifySleepStateInline(character, etTime) {
  // Inline version of sleepUtils.js classifySleepState() — no local imports in Deno.
  // Returns { isStale, isValid, reason, consequence_tags }
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const STALE_GRACE = 20; // minutes past wake_up_time before stale classification

  const dbSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
  if (!dbSleeping) return { isStale: false, isValid: false, reason: 'not_sleeping_in_db' };

  if (isSleeping(character, etTime)) {
    return { isStale: false, isValid: true, reason: 'within_canonical_sleep_window' };
  }

  // Past canonical sleep window — check valid reasons before clearing
  if (character.decided_to_stay_up_until) {
    const stayUntil = new Date(character.decided_to_stay_up_until);
    if (stayUntil > new Date(Date.now() - 8 * 3600 * 1000)) {
      return { isStale: false, isValid: true, reason: 'shifted_sleep_stay_up', consequence_tags: ['tired'] };
    }
  }

  const sleepSource = character.resolved_source_reason || '';
  if (sleepSource === 'user_directed_nap' || sleepSource.includes('nap')) {
    return { isStale: false, isValid: true, reason: 'user_directed_nap' };
  }

  if ((character.sleep_debt_hours || 0) > 0 && character.resolved_presence_status === 'napping') {
    return { isStale: false, isValid: true, reason: 'recovery_nap' };
  }

  if ((character.health_value || 100) < 30) {
    return { isStale: false, isValid: true, reason: 'illness_sleep' };
  }

  if ((character.mental_value || 100) < 25) {
    return { isStale: false, isValid: true, reason: 'emotional_crash_sleep' };
  }

  if ((character.sleep_debt_hours || 0) >= 2) {
    return { isStale: false, isValid: true, reason: 'oversleeping_sleep_debt' };
  }

  if (character.sleep_interrupted_at) {
    const hoursSince = (Date.now() - new Date(character.sleep_interrupted_at).getTime()) / 3600000;
    if (hoursSince < 4) {
      return { isStale: false, isValid: true, reason: 'interrupted_sleep_recovery' };
    }
  }

  // Grace period check
  const wakeMin = toMin(character.wake_up_time);
  if (wakeMin !== null) {
    const currentMin = etTime.getHours() * 60 + etTime.getMinutes();
    let minutesPastWake = currentMin - wakeMin;
    if (minutesPastWake < 0) minutesPastWake += 1440;
    if (minutesPastWake < STALE_GRACE) {
      return { isStale: false, isValid: true, reason: 'within_wake_grace_period' };
    }
  }

  // Stale — build consequence tags by personality
  const consequenceTags = [];
  const dayOfWeek = etTime.getDay();
  const currentMin = etTime.getHours() * 60 + etTime.getMinutes();
  const hasWork = character.work_start_time && character.work_end_time &&
    Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek);
  if (hasWork) {
    const workStart = toMin(character.work_start_time);
    if (workStart !== null && currentMin > workStart) {
      consequenceTags.push('late_for_work');
    }
  }
  if (character.trait_anxious || (character.emotional_state || '').includes('anxious')) {
    consequenceTags.push('spiraling', 'rushing');
  } else if (character.trait_lazy || character.archetype === 'slacker') {
    consequenceTags.push('dismissive', 'may_call_out');
  } else if (character.trait_workaholic) {
    consequenceTags.push('panicking', 'guilty');
  }

  return { isStale: true, isValid: false, reason: 'stale_system_sleep', consequence_tags: consequenceTags };
}

const NPC_CHAR_TYPES_SET = new Set(['npc_fictitious', 'npc_family_member', 'npc_regular']);

function computeResolved(character, locationMap, etTime) {
  const todayET = etTime.toISOString().slice(0, 10);

  // NPCs are NEVER subject to sleep debt, recovery nap, or pre-sleep return logic.
  // Only active_created_character uses biological sleep systems.
  const isNPCChar = NPC_CHAR_TYPES_SET.has(character.character_type);

  // ── LAYER 0: SLEEP LOCK — valid vs stale distinction ─────────────────────
  // RULE: Valid character-driven sleep (oversleeping, recovery, illness, emotional crash,
  // shifted schedule, interrupted, user-directed nap) → preserve and lock at home.
  // Stale system sleep (DB says sleeping, canonical says false, no valid reason) → do NOT lock.
  // Instead fall through to normal resolution so the character wakes up correctly.
  // SKIPPED entirely for NPCs — they are governed by DB presence only, not sleep windows.
  const sleepHomeId = resolveValidSleepLocationId(character, locationMap);
  const sleepHomeLoc = sleepHomeId ? locationMap[sleepHomeId] : null;

  const dbSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';

  // ── ACTIVE_CREATED_CHARACTER: sleep state is DB truth, not clock window ──────
  // For active_created_characters, sleep is driven by the energy/needs system
  // (simulateActiveCharacterNeeds + autonomousCharacterMovement). The clock window
  // is NOT an authority. We only lock location if the DB already says sleeping.
  // If DB says sleeping → preserve at valid sleep location (protect the state the energy system wrote).
  // If DB says awake   → do NOT force sleep based on any clock window.
  if (!isNPCChar) {
    if (dbSleeping) {
      // DB says sleeping — preserve the state at a valid sleep location.
      // This protects what the energy system already wrote. Do not clear it via schedule.
      if (sleepHomeId) {
        return {
          resolved_current_location_id: sleepHomeId,
          resolved_current_location_name: sleepHomeLoc?.name || 'Home',
          resolved_location_type: 'home',
          resolved_presence_status: character.resolved_presence_status, // preserve sleeping/napping
          resolved_source_reason: 'energy_driven_sleep_preserved',
          resolved_zone: null,
          home_resolution_failed: !sleepHomeLoc,
        };
      }
      // No valid sleep location — character is sleeping somewhere off-screen, preserve it
      return {
        resolved_current_location_id: character.resolved_current_location_id || null,
        resolved_current_location_name: character.resolved_current_location_name || 'Home',
        resolved_location_type: character.resolved_location_type || 'home',
        resolved_presence_status: character.resolved_presence_status,
        resolved_source_reason: 'energy_driven_sleep_no_mapped_home',
        resolved_zone: null,
        home_resolution_failed: true,
      };
    }
    // DB says awake — fall through to obligation/location resolution. Do NOT force sleep.
  }

  // ── LAYER 0B: RECOVERY NAP LOCK — DISABLED GLOBALLY ──
  // Sleep debt is not proven safe as a location/availability controller.
  // Do not lock any character (NPC or active_created) to home napping via sleep_debt_hours.
  // if (!isNPCChar && hasSleepDebt(character) && isNapTime(etTime) && sleepHomeId) { ... }

  // ── LAYER 0C: PRE-SLEEP RETURN WINDOW — DISABLED GLOBALLY ────────────────
  // Pre-sleep return locks blocked legitimate character availability 60 min before their sleep schedule.
  // Do not force any character home via sleep schedule math until audited and proven safe.
  // if (!isNPCChar && isInPreSleepWindow(character, etTime) && sleepHomeId) { ... }

  // ── LAYERS 1+: Normal schedule logic (only reached when NOT sleeping) ─────
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;

  // LAYER 1: Work schedule
  // Checks ALL work locations: primary + current + additional jobs.
  // Per location: uses location.worker_shifts[character.id] first; falls back to character's own schedule.
  if (!hasValidCallout) {
    const allWorkLocIds = [];
    if (character.occupation_location_id) allWorkLocIds.push(character.occupation_location_id);
    if (character.current_work_location_id && !allWorkLocIds.includes(character.current_work_location_id)) {
      allWorkLocIds.push(character.current_work_location_id);
    }
    if (Array.isArray(character.additional_occupation_locations)) {
      for (const loc of character.additional_occupation_locations) {
        if (loc.location_id && !allWorkLocIds.includes(loc.location_id)) {
          allWorkLocIds.push(loc.location_id);
        }
      }
    }

    for (const workLocId of allWorkLocIds) {
      const workLoc = locationMap[workLocId];
      if (!workLoc) continue;

      // Check location-specific shift for this character first
      const locationShift = workLoc.worker_shifts?.[character.id];
      if (locationShift) {
        if (isOnShiftNow(locationShift, etTime)) {
          return {
            resolved_current_location_id: workLocId,
            resolved_current_location_name: workLoc.name || 'Work',
            resolved_location_type: 'work',
            resolved_presence_status: 'at_work',
            resolved_source_reason: 'work_schedule',
            resolved_zone: null,
            home_resolution_failed: false,
          };
        }
        // Shift defined but not active — skip character's own schedule for this location
        continue;
      }

      // No location-specific shift — fall back to character's own work_days/start/end
      if (isOnWorkSchedule(character, etTime)) {
        return {
          resolved_current_location_id: workLocId,
          resolved_current_location_name: workLoc.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
          resolved_zone: null,
          home_resolution_failed: false,
        };
      }
    }
  }

  // LAYER 2: School schedule
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLoc = locationMap[character.education_location_id];
    if (schoolLoc) {
      return {
        resolved_current_location_id: character.education_location_id,
        resolved_current_location_name: schoolLoc.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
        resolved_zone: null,
        home_resolution_failed: false,
      };
    }
  }

  // LAYER 3: Active travel
  if (character.travel_status && character.travel_status !== 'not_traveling' && character.travel_destination_location_id) {
    const destLoc = locationMap[character.travel_destination_location_id];
    if (destLoc) {
      return {
        resolved_current_location_id: character.travel_destination_location_id,
        resolved_current_location_name: destLoc.name || 'Traveling',
        resolved_location_type: 'traveling',
        resolved_presence_status: 'traveling',
        resolved_source_reason: character.travel_status,
        resolved_zone: null,
        home_resolution_failed: false,
      };
    }
  }

  // LAYER 4: Active system-placed visit
  // autonomous_needs_driven and autonomous_movement visits at non-sleep locations
  // are NEVER preserved — they are stale and must always fall through to home.
  // Only user-initiated visits at non-sleep locations are preserved (and only outside pre-sleep window).
  // CLOSED LOCATION RULE: Any visit to a currently-closed location is NEVER preserved, regardless of source.
  const homeId = character.current_home_location_id || character.home_location_id;
  const resolvedLocId = character.resolved_current_location_id;
  const isAwayFromHome = resolvedLocId && resolvedLocId !== homeId;

  const isAutonomousVisit =
    character.resolved_source_reason === 'autonomous_needs_driven' ||
    character.resolved_source_reason === 'autonomous_movement';

  const isUserInitiatedVisit =
    character.presence_state === 'social_visit' ||
    character.resolved_source_reason === 'user_travel';

  if (isAwayFromHome) {
    const visitLoc = locationMap[resolvedLocId];

    // CLOSED LOCATION BLOCK: If the location is closed right now, never preserve it — fall through to home
    if (visitLoc && !isValidSleepLocation(visitLoc) && !isLocationCurrentlyOpen(visitLoc, etTime)) {
      // Location is closed — do not preserve regardless of visit source
      console.log && console.log(`[scheduledEnforcement] ${character.name}: closed location block — ${visitLoc.name} is closed, routing home`);
      // Fall through to home fallback below
    }
    // Autonomous visits at non-sleep locations are never preserved — fall through to home
    else if (isAutonomousVisit && visitLoc && !isValidSleepLocation(visitLoc)) {
      // Do not preserve — fall through to home fallback below
    } else if (visitLoc && isValidSleepLocation(visitLoc)) {
      // Valid sleep location (hotel/shelter/home) — preserve regardless of visit type
      return {
        resolved_current_location_id: resolvedLocId,
        resolved_current_location_name: visitLoc.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
        home_resolution_failed: false,
      };
    } else if (isUserInitiatedVisit && visitLoc && !isNearSleepWindow(character, etTime, 120)) {
      // User-initiated visit at non-sleep location, far from sleep, and location is open — allow
      return {
        resolved_current_location_id: resolvedLocId,
        resolved_current_location_name: visitLoc.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
        home_resolution_failed: false,
      };
    }
    // All other cases: fall through to home fallback
  }

  // Resolve home base for fallback
  let resolvedHomeId = null;
  if (character.is_temporarily_housed === true && character.temporary_housing_location_id) {
    resolvedHomeId = character.temporary_housing_location_id;
  } else {
    resolvedHomeId = character.current_home_location_id || character.home_location_id || null;
  }

  // LAYER 7 (old 6 removed — nap now handled above): Home base fallback
  if (resolvedHomeId) {
    const homeLoc = locationMap[resolvedHomeId];
    return {
      resolved_current_location_id: resolvedHomeId,
      resolved_current_location_name: homeLoc?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'fallback_to_home_base',
      resolved_zone: null,
      home_resolution_failed: !homeLoc,
    };
  }

  // LAYER 8: No home — active_created_character must never use rabbit_hole
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Unresolved',
    resolved_location_type: 'location_unresolved',
    resolved_presence_status: 'location_unresolved',
    resolved_source_reason: 'no_valid_home_or_temporary_location',
    resolved_zone: null,
    home_resolution_failed: true,
  };
}

function buildStored(character) {
  return {
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || null,
    resolved_location_type: character.resolved_location_type || null,
    resolved_presence_status: character.resolved_presence_status || null,
    resolved_source_reason: character.resolved_source_reason || null,
    resolved_zone: character.resolved_zone || null,
    home_resolution_failed: character.home_resolution_failed || false,
  };
}

function hasChanged(resolved, stored) {
  return (
    resolved.resolved_current_location_id !== stored.resolved_current_location_id ||
    resolved.resolved_current_location_name !== stored.resolved_current_location_name ||
    resolved.resolved_location_type !== stored.resolved_location_type ||
    resolved.resolved_presence_status !== stored.resolved_presence_status ||
    resolved.resolved_source_reason !== stored.resolved_source_reason ||
    (resolved.resolved_zone || null) !== stored.resolved_zone ||
    (resolved.home_resolution_failed || false) !== stored.home_resolution_failed
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // NO base44.auth.me() — this function is service-role only, no user session assumed

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;
    const max_owners = typeof body.max_owners === 'number' ? body.max_owners : null;
    const max_chars = typeof body.max_characters_per_owner === 'number' ? body.max_characters_per_owner : null;

    // STEP 1: Discover all user-created active characters (service role — sees all accounts)
    // LEGACY COMPATIBILITY: Do NOT filter by character_type here.
    // Legacy characters created before character_type was introduced have character_type = null
    // and must participate in sleep/schedule enforcement. The NPC filter below excludes NPC types.
    let allCharacters = [];
    try {
      allCharacters = await base44.asServiceRole.entities.Character.filter({
        status: 'active',
        created_by_user: true,
      });
    } catch (err) {
      if (err?.status === 429) {
        return Response.json({ error: 'Rate limit hit during character discovery', status: 429 }, { status: 429 });
      }
      throw err;
    }
    // Exclude NPC types — they have their own sleep enforcement path (npc_forced_default window).
    // Include active_created_character AND legacy null/undefined character_type.
    const NPC_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious', 'npc']);
    allCharacters = allCharacters.filter(c => !NPC_TYPES.has(c.character_type));

    // STEP 2: Extract distinct owner_email values — skip records missing owner_email
    const ownerEmailSet = new Set();
    const skippedNoOwner = [];
    for (const c of allCharacters) {
      if (!c.owner_email) {
        skippedNoOwner.push({ character_id: c.id, name: c.name, reason: 'missing_owner_email' });
      } else {
        ownerEmailSet.add(c.owner_email);
      }
    }

    let ownerEmails = Array.from(ownerEmailSet);
    if (max_owners !== null) {
      ownerEmails = ownerEmails.slice(0, max_owners);
    }

    // STEP 3: Process each owner in isolation
    const results = [];
    let owners_checked = 0;
    let characters_checked = 0;
    let would_update = 0;
    let updated = 0;
    let no_change = 0;
    let errors = 0;
    const skipped = [...skippedNoOwner];

    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    for (const owner_email of ownerEmails) {
      owners_checked++;

      // Load characters scoped to this owner only
      // LEGACY COMPATIBILITY: Do NOT filter by character_type — legacy characters have null type
      // and must participate in sleep/schedule enforcement same as active_created_character.
      let ownerChars = [];
      try {
        ownerChars = await base44.asServiceRole.entities.Character.filter({
          owner_email,
          status: 'active',
          created_by_user: true,
        });
        // Exclude NPC types — they use npc_forced_default sleep path, not schedule enforcement
        ownerChars = ownerChars.filter(c => !NPC_TYPES.has(c.character_type));
      } catch (err) {
        if (err?.status === 429) {
          return Response.json({
            dry_run, owners_checked, characters_checked,
            would_update, updated, no_change,
            skipped: skipped.length, errors,
            results,
            aborted: true,
            abort_reason: 'rate_limit_429_on_character_fetch',
            abort_at_owner: owner_email,
          });
        }
        errors++;
        results.push({ owner_email, error: err.message });
        continue;
      }

      if (max_chars !== null) {
        ownerChars = ownerChars.slice(0, max_chars);
      }

      // Load locations scoped to this owner only
      let locations = [];
      try {
        locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email });
      } catch (err) {
        if (err?.status === 429) {
          return Response.json({
            dry_run, owners_checked, characters_checked,
            would_update, updated, no_change,
            skipped: skipped.length, errors,
            results,
            aborted: true,
            abort_reason: 'rate_limit_429_on_location_fetch',
            abort_at_owner: owner_email,
          });
        }
        errors++;
        results.push({ owner_email, error: `Location fetch failed: ${err.message}` });
        continue;
      }

      const locationMap = {};
      for (const loc of locations) {
        locationMap[loc.id] = loc;
      }

      // Process each character serially
      for (const character of ownerChars) {
        characters_checked++;

        try {
          const resolved = computeResolved(character, locationMap, etTime);
          const stored = buildStored(character);
          const changed = hasChanged(resolved, stored);

          const entry = {
            character_id: character.id,
            name: character.name,
            owner_email,
            changed,
            resolved_presence_status: resolved.resolved_presence_status,
            resolved_source_reason: resolved.resolved_source_reason,
            resolved_current_location_id: resolved.resolved_current_location_id,
            stored_presence_status: stored.resolved_presence_status,
            stored_location_id: stored.resolved_current_location_id,
          };

          if (!changed) {
            no_change++;
            entry.action = 'no_change';
          } else if (dry_run) {
            would_update++;
            entry.action = 'would_update';
          } else {
            // WRITE: only changed fields, only if not dry_run
            const timestamp = etTime.toISOString();

            // CORRECTION LOCK: if the character is being moved away from a non-home, non-sleep location
            // (e.g. closed social/religion/workplace), write a 30-minute lock so autonomous movement
            // cannot immediately undo the correction.
            const wasAtNonHome = stored.resolved_current_location_id &&
              stored.resolved_current_location_id !== (character.current_home_location_id || character.home_location_id);
            const isBeingSentHome = resolved.resolved_location_type === 'home' || resolved.resolved_location_type === 'sleep_unresolved';
            const wasInvalidReason = [
              'autonomous_needs_driven', 'autonomous_movement', 'closed_location_blocked',
              'fallback_to_home_base', 'rabbit_hole'
            ].includes(stored.resolved_source_reason || '');

            const lockFields = (wasAtNonHome && isBeingSentHome) ? {
              location_correction_locked_until: new Date(etTime.getTime() + 30 * 60 * 1000).toISOString(),
              location_correction_previous_id: stored.resolved_current_location_id,
              location_correction_reason: 'scheduled_enforcement_correction',
              location_correction_corrected_at: timestamp,
            } : {};

            // SLEEP ONSET STAMP: write last_sleep_start on the transition awake → sleeping.
            // This is the canonical sleep onset write path. Only stamps when the character
            // was NOT already sleeping in the DB (prevents overwriting a valid ongoing sleep start).
            const wasAlreadySleeping = stored.resolved_presence_status === 'sleeping' || stored.resolved_presence_status === 'napping';
            const isNowSleeping = resolved.resolved_presence_status === 'sleeping' || resolved.resolved_presence_status === 'napping';
            const sleepOnsetFields = (isNowSleeping && !wasAlreadySleeping)
              ? { last_sleep_start: timestamp }
              : {};

            await base44.asServiceRole.entities.Character.update(character.id, {
              resolved_current_location_id: resolved.resolved_current_location_id,
              resolved_current_location_name: resolved.resolved_current_location_name,
              resolved_location_type: resolved.resolved_location_type,
              resolved_presence_status: resolved.resolved_presence_status,
              resolved_source_reason: resolved.resolved_source_reason,
              resolved_zone: resolved.resolved_zone,
              resolved_last_updated_at: timestamp,
              home_resolution_failed: resolved.home_resolution_failed,
              ...lockFields,
              ...sleepOnsetFields,
            });
            updated++;
            entry.action = 'updated';

            // Write durable location history for schedule-driven moves (fire-and-forget)
            if (character.owner_email && resolved.resolved_current_location_id) {
              let evtType = 'arrival';
              if (resolved.resolved_presence_status === 'at_work') evtType = 'work_start';
              else if (resolved.resolved_presence_status === 'at_school') evtType = 'school_start';
              else if (resolved.resolved_presence_status === 'home') evtType = 'return_home';
              else if (resolved.resolved_presence_status === 'sleeping') evtType = 'stay';

              const travelSrc = resolved.resolved_source_reason === 'work_schedule' ? 'schedule'
                : resolved.resolved_source_reason === 'school_schedule' ? 'schedule'
                : 'system';

              base44.asServiceRole.functions.invoke('recordLocationHistoryEvent', {
                characterId: character.id,
                characterName: character.name,
                ownerEmail: character.owner_email,
                locationId: resolved.resolved_current_location_id,
                locationName: resolved.resolved_current_location_name,
                locationCategory: 'other',
                eventType: evtType,
                travelSource: travelSrc,
                travelReason: resolved.resolved_source_reason || null,
                arrivalTime: timestamp,
                previousLocationId: stored.resolved_current_location_id || null,
              }).catch(() => {});
            }
            if (Object.keys(lockFields).length > 0) {
              entry.correction_lock_written = true;
              entry.lock_until = lockFields.location_correction_locked_until;
            }
          }

          results.push(entry);
        } catch (err) {
          if (err?.status === 429) {
            return Response.json({
              dry_run, owners_checked, characters_checked,
              would_update, updated, no_change,
              skipped: skipped.length, errors,
              results,
              aborted: true,
              abort_reason: 'rate_limit_429_on_character_write',
              abort_at_character: character.id,
              abort_at_owner: owner_email,
            });
          }
          errors++;
          results.push({ character_id: character.id, name: character.name, owner_email, error: err.message, action: 'error' });
        }

        // 300ms delay between characters — serial only
        await sleep(300);
      }
    }

    return Response.json({
      dry_run,
      owners_checked,
      characters_checked,
      would_update,
      updated,
      no_change,
      skipped: skipped.length,
      skipped_details: skippedNoOwner,
      errors,
      results,
      aborted: false,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});