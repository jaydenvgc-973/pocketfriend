// TEMPORARY INLINE RESOLVER — Phase 4A manual enforcement only
// Must be kept aligned with lib/locationResolutionEngine.js until shared backend-safe resolver exists.
// This function performs owner-scoped, manual synchronization of character location presence.
// 
// PHASE 4A FLOW: compute → compare → write once only if changed

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// HELPER: Check if character is on a location-specific shift right now
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

// HELPER: Check if character is on work schedule right now (character's own fields)
function isCharacterOnWorkSchedule(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return false;
  }
  const now = etTime.getTime();
  const dayOfWeek = etTime.getDay();
  const isWorkDay = character.work_days.includes(dayOfWeek);
  if (!isWorkDay) return false;

  const [workStartHour, workStartMin] = character.work_start_time.split(':').map(Number);
  const [workEndHour, workEndMin] = character.work_end_time.split(':').map(Number);

  const workStartMs = new Date(etTime).setHours(workStartHour, workStartMin, 0, 0);
  const workEndMs = new Date(etTime).setHours(workEndHour, workEndMin, 0, 0);

  return now >= workStartMs && now < workEndMs;
}

/**
 * ADAPTIVE SLEEP WINDOW — active_created_character only.
 * Derives sleep start/wake times from next work/school obligation and character energy.
 * Overnight workers sleep BEFORE their shift, not during it.
 * Falls back to stored sleep_start_time / wake_up_time when no obligation exists.
 */
function computeAdaptiveSleepWindow(character, etTime) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER   = 60;

  const toMin = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const dayOfWeek = etTime.getDay();
  let nextShiftStartMin = null;
  let nextShiftEndMin   = null;

  // PRIORITY 1: Stored schedule wins — matches sleepUtils.js canonical order.
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, isOvernightWorker: false };
  }

  // PRIORITY 2: No stored schedule — derive from work/school.
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    const isWorkDayToday    = character.work_days.includes(dayOfWeek);
    const isWorkDayTomorrow = character.work_days.includes((dayOfWeek + 1) % 7);
    if (isWorkDayToday || isWorkDayTomorrow) {
      nextShiftStartMin = toMin(character.work_start_time);
      nextShiftEndMin   = toMin(character.work_end_time);
    }
  }

  if (!nextShiftStartMin && character.student_status === 'enrolled' && character.education_location_id) {
    nextShiftStartMin = 8 * 60;
    nextShiftEndMin   = 15 * 60;
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

  // PRIORITY 3: Cannot determine.
  return null;
}

// Returns true if within `bufferMinutes` of adaptive sleep start
function isNearSleepWindow(character, etTime, bufferMinutes) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin } = window;
  const windowStart = (sleepStartMin - bufferMinutes + 1440) % 1440;
  if (windowStart > sleepStartMin) return now >= windowStart || now < sleepStartMin;
  return now >= windowStart && now < sleepStartMin;
}

// Returns true if within 60 minutes before adaptive sleep start
const PRE_SLEEP_WINDOW_MINUTES = 60;

function isCharacterSleeping(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  // No determinable sleep schedule — cannot assume sleep. Return false.
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

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

// Confinement categories — treated as valid sleep/residence locations for routing purposes.
// Note: autonomous movement is still fully blocked for incarcerated characters regardless.
const CONFINEMENT_CATEGORIES = new Set([
  'jail', 'prison', 'detention_center', 'correctional_facility',
  'juvenile_detention', 'halfway_house', 'holding_cell'
]);

const VALID_SLEEP_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'generic',
  // Confinement facilities are valid sleep/residence locations
  'jail', 'prison', 'detention_center', 'correctional_facility',
  'juvenile_detention', 'halfway_house', 'holding_cell'
]);

function isValidSleepLocation(location) {
  if (!location) return false;
  return VALID_SLEEP_CATEGORIES.has(location.category || '');
}

// Check if a location is currently open based on its operating_hours and ET time.
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
  if (daySpecific.length > 0) return false;
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

// HELPER: Check if nap time (1-3pm)
function isNapTime(etTime) {
  const hour = etTime.getHours();
  return hour >= 13 && hour < 16;
}

// HELPER: Check if has unpaid sleep debt
function hasUnpaidSleepDebt(character) {
  return character.sleep_debt_hours && character.sleep_debt_hours > 0;
}

// MINIMAL INLINE RESOLVER: Compute ONE resolved location object
// PRIORITY: Incarceration lock > house arrest > sleep lock > nap > pre-sleep return > work > school > travel > visit > home fallback
function computeResolvedLocation(character, locationMap, etTime) {
  const todayET = etTime.toISOString().slice(0, 10);

  // ── LAYER -1: INCARCERATION HARD LOCK (ABSOLUTE HIGHEST PRIORITY) ────────
  // If character is jailed/incarcerated, they are CONFINED.
  // ALL civilian routing is bypassed — sleep, work, school, travel, autonomous movement.
  // The confinement facility IS their location truth.
  // This is not an error state. It is a valid life state.
  if (character.is_jailed === true) {
    const facilityId   = character.incarceration_facility_id || null;
    const facilityLoc  = facilityId ? locationMap[facilityId] : null;
    const facilityName = facilityLoc?.name || character.incarceration_facility_name || 'Correctional Facility';

    return {
      resolved_current_location_id:   facilityId || character.resolved_current_location_id || null,
      resolved_current_location_name: facilityName,
      resolved_location_type:         'incarcerated',
      resolved_presence_status:       'incarcerated',
      resolved_source_reason:         'incarceration_confinement_lock',
      resolved_zone:                  null,
      home_resolution_failed:         false
    };
  }

  // ── LAYER -0.5: HOUSE ARREST LOCK ────────────────────────────────────────
  // Character is confined to their assigned house arrest residence.
  // They may not autonomously travel elsewhere.
  if (character.house_arrest_active === true) {
    const haLocId  = character.house_arrest_location_id || character.current_home_location_id || null;
    const haLoc    = haLocId ? locationMap[haLocId] : null;
    const haName   = haLoc?.name || 'Residence (House Arrest)';

    return {
      resolved_current_location_id:   haLocId || character.resolved_current_location_id || null,
      resolved_current_location_name: haName,
      resolved_location_type:         'house_arrest',
      resolved_presence_status:       'house_arrest',
      resolved_source_reason:         'house_arrest_confinement_lock',
      resolved_zone:                  null,
      home_resolution_failed:         false
    };
  }

  // ── LAYER 0: SLEEP HARD LOCK (HIGHEST PRIORITY — runs before everything) ───
  // active_created_character inside their sleep window must be locked to their
  // valid sleep location. This overrides work, school, travel, visits, and
  // all stale resolved_source_reason / autonomous / needs-driven fields.
  const sleepHomeId = resolveValidSleepLocationId(character, locationMap);
  const sleepHomeLoc = sleepHomeId ? locationMap[sleepHomeId] : null;

  if (isCharacterSleeping(character, etTime)) {
    if (sleepHomeId) {
      return {
        resolved_current_location_id: sleepHomeId,
        resolved_current_location_name: sleepHomeLoc?.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'adaptive_sleep_location_lock',
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
    // No valid mapped home — this is a VALID state (rabbit hole, shelter, transitional housing, etc.)
    // Do NOT mark as error. Character is sleeping wherever they are.
    return {
      resolved_current_location_id: character.resolved_current_location_id || null,
      resolved_current_location_name: character.resolved_current_location_name || 'Off-screen',
      resolved_location_type: character.resolved_location_type || 'rabbit_hole',
      resolved_presence_status: 'sleeping',
      resolved_source_reason: 'sleeping_no_mapped_home',
      resolved_zone: null,
      home_resolution_failed: false
    };
  }

  // ── LAYER 0B: RECOVERY NAP LOCK ──────────────────────────────────────────
  if (hasUnpaidSleepDebt(character) && isNapTime(etTime) && sleepHomeId) {
    return {
      resolved_current_location_id: sleepHomeId,
      resolved_current_location_name: sleepHomeLoc?.name || 'Home',
      resolved_location_type: 'recovery_nap',
      resolved_presence_status: 'napping',
      resolved_source_reason: 'recovery_nap',
      resolved_zone: null,
      home_resolution_failed: !sleepHomeLoc
    };
  }

  // ── LAYER 0C: PRE-SLEEP RETURN WINDOW (60 min before sleep) ─────────────
  // Cancels stale visits/autonomous/travel destinations — returns character home.
  if (isInPreSleepWindow(character, etTime) && sleepHomeId) {
    return {
      resolved_current_location_id: sleepHomeId,
      resolved_current_location_name: sleepHomeLoc?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'returning_home_for_sleep',
      resolved_source_reason: 'adaptive_pre_sleep_return',
      resolved_zone: null,
      home_resolution_failed: !sleepHomeLoc
    };
  }

  // ── LAYERS 1+: Normal schedule logic (only reached when NOT sleeping) ─────
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;

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
      const workLocation = locationMap[workLocId];
      if (!workLocation) continue;

      // Check location-specific shift for this character first
      const locationShift = workLocation.worker_shifts?.[character.id];
      if (locationShift) {
        if (isOnShiftNow(locationShift, etTime)) {
          return {
            resolved_current_location_id: workLocId,
            resolved_current_location_name: workLocation.name || 'Work',
            resolved_location_type: 'work',
            resolved_presence_status: 'at_work',
            resolved_source_reason: 'work_schedule',
            resolved_zone: null,
            home_resolution_failed: false
          };
        }
        // Shift defined but not active — skip character's own schedule for this location
        continue;
      }

      // No location-specific shift — fall back to character's own work_days/start/end
      if (isCharacterOnWorkSchedule(character, etTime)) {
        return {
          resolved_current_location_id: workLocId,
          resolved_current_location_name: workLocation.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
          resolved_zone: null,
          home_resolution_failed: false
        };
      }
    }
  }

  // LAYER 2: School schedule
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLocation = locationMap[character.education_location_id];
    if (schoolLocation) {
      return {
        resolved_current_location_id: character.education_location_id,
        resolved_current_location_name: schoolLocation.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
  }

  // LAYER 3: Active travel
  if (character.travel_status && character.travel_status !== 'not_traveling' && character.travel_destination_location_id) {
    const destLocation = locationMap[character.travel_destination_location_id];
    if (destLocation) {
      return {
        resolved_current_location_id: character.travel_destination_location_id,
        resolved_current_location_name: destLocation.name || 'Traveling',
        resolved_location_type: 'traveling',
        resolved_presence_status: 'traveling',
        resolved_source_reason: character.travel_status,
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
  }

  // LAYER 4: Active system-placed visit
  // ONLY honoured for user_travel or social_visit at valid sleep locations.
  // autonomous_needs_driven and autonomous_movement visits at non-sleep locations
  // are NEVER preserved — they are stale and must always fall through to home.
  const homeIdForVisitCheck = character.current_home_location_id || character.home_location_id;
  const resolvedLocIdForVisit = character.resolved_current_location_id;
  const isAwayFromHome = resolvedLocIdForVisit && resolvedLocIdForVisit !== homeIdForVisitCheck;

  const isAutonomousVisit =
    character.resolved_source_reason === 'autonomous_needs_driven' ||
    character.resolved_source_reason === 'autonomous_movement';

  const isUserInitiatedVisit =
    character.presence_state === 'social_visit' ||
    character.resolved_source_reason === 'user_travel';

  if (isAwayFromHome) {
    const visitLoc = locationMap[resolvedLocIdForVisit];

    // CLOSED LOCATION BLOCK: never preserve a visit at a currently-closed location
    if (visitLoc && !isValidSleepLocation(visitLoc) && !isLocationCurrentlyOpen(visitLoc, etTime)) {
      // Fall through to home fallback below
    }
    // Autonomous visits at non-sleep locations are never preserved — fall through to home
    else if (isAutonomousVisit && visitLoc && !isValidSleepLocation(visitLoc)) {
      // Do not preserve — fall through to home fallback below
    } else if (visitLoc && isValidSleepLocation(visitLoc)) {
      // At a valid sleep location (hotel/shelter/home) — preserve regardless of visit type
      return {
        resolved_current_location_id: resolvedLocIdForVisit,
        resolved_current_location_name: visitLoc.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
        home_resolution_failed: false
      };
    } else if (isUserInitiatedVisit && visitLoc && !isNearSleepWindow(character, etTime, 120)) {
      // User-initiated visit at a non-sleep location, far from sleep — allow
      return {
        resolved_current_location_id: resolvedLocIdForVisit,
        resolved_current_location_name: visitLoc.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
        home_resolution_failed: false
      };
    }
    // All other cases: fall through to home fallback
  }

  // PHASE 4: RESOLVE HOME BASE (TEMPORARY HOUSING PRIORITY)
  let resolvedHomeId = null;

  if (character.is_temporarily_housed === true && character.temporary_housing_location_id) {
    resolvedHomeId = character.temporary_housing_location_id;
  } else {
    resolvedHomeId = character.current_home_location_id || character.home_location_id || null;
  }

  // LAYER 7: Home base fallback
  if (resolvedHomeId) {
    const homeLocation = locationMap[resolvedHomeId];
    return {
      resolved_current_location_id: resolvedHomeId,
      resolved_current_location_name: homeLocation?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'fallback_to_home_base',
      resolved_zone: null,
      home_resolution_failed: !homeLocation
    };
  }

  // LAYER 8: No mapped home found — this is a VALID state.
  // Characters may have rabbit hole, implied, transitional, or no formal home.
  // Preserve whatever resolved location they currently have, or mark as off-screen.
  // NEVER treat this as an error.
  return {
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || 'Off-screen',
    resolved_location_type: character.resolved_location_type || 'rabbit_hole',
    resolved_presence_status: character.resolved_presence_status || 'away',
    resolved_source_reason: 'no_mapped_home_valid_state',
    resolved_zone: null,
    home_resolution_failed: false
  };
}

// Build stored state from character
function buildStoredState(character) {
  return {
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || null,
    resolved_location_type: character.resolved_location_type || null,
    resolved_presence_status: character.resolved_presence_status || null,
    resolved_source_reason: character.resolved_source_reason || null,
    resolved_zone: character.resolved_zone || null,
    home_resolution_failed: character.home_resolution_failed || false
  };
}

// Deep compare resolved vs stored
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character_id, owner_email } = await req.json();

    // Verify ownership match (owner_email must equal current user)
    if (owner_email !== user.email) {
      return Response.json({ error: 'Ownership mismatch' }, { status: 403 });
    }

    // Load character with owner_email filter (ownership-scoped)
    const characters = await base44.entities.Character.filter({
      id: character_id,
      owner_email
    });

    if (!characters || characters.length === 0) {
      return Response.json({
        status: 'error',
        message: 'Character not found or ownership mismatch',
        character_id
      }, { status: 404 });
    }

    const character = characters[0];

    // Load locations with owner_email filter (ownership-scoped)
    const locations = await base44.entities.LocationReference.filter({
      owner_email
    });

    // Build locationMap for resolver
    const locationMap = {};
    for (const loc of locations) {
      locationMap[loc.id] = loc;
    }

    // Eastern Time for all calculations
    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // STEP 1: Compute resolved location
    const resolved = computeResolvedLocation(character, locationMap, etTime);

    // STEP 2: Build stored state
    const stored = buildStoredState(character);

    // STEP 3: Compare
    if (!hasChanged(resolved, stored)) {
      return Response.json({
        status: 'no_change',
        character_id,
        owner_email,
        message: 'Character location already matches resolver output'
      });
    }

    // STEP 4: Write once (only if changed)
    const timestamp = etTime.toISOString();
    const updateData = {
      resolved_current_location_id: resolved.resolved_current_location_id,
      resolved_current_location_name: resolved.resolved_current_location_name,
      resolved_location_type: resolved.resolved_location_type,
      resolved_presence_status: resolved.resolved_presence_status,
      resolved_source_reason: resolved.resolved_source_reason,
      resolved_zone: resolved.resolved_zone,
      resolved_last_updated_at: timestamp,
      home_resolution_failed: resolved.home_resolution_failed
    };

    await base44.entities.Character.update(character_id, updateData);

    return Response.json({
      status: 'updated',
      character_id,
      owner_email,
      changes: {
        location_id: { from: stored.resolved_current_location_id, to: resolved.resolved_current_location_id },
        location_type: { from: stored.resolved_location_type, to: resolved.resolved_location_type },
        presence_status: { from: stored.resolved_presence_status, to: resolved.resolved_presence_status },
        source_reason: { from: stored.resolved_source_reason, to: resolved.resolved_source_reason }
      },
      timestamp
    });

  } catch (error) {
    console.error('enforceCharacterLocationPresence error:', error);
    return Response.json({
      status: 'error',
      message: error.message
    }, { status: 500 });
  }
});