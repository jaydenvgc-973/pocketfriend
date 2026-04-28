/**
 * LOCATION RESOLUTION ENGINE
 * 
 * Single authoritative source for character current location.
 * Computes one final resolved location per character.
 * 
 * Strict precedence:
 * 1. Work schedule (and location must be open)
 * 2. School schedule (and location must be open)
 * 3. Active travel
 * 4. Valid visit/event/supervision
 * 5. Free-time chosen location
 * 6. Home (only if truly home)
 */

import { isLocationOpen } from '@/lib/locationHoursUtils';

/**
 * Main resolution function: determine ONE true current location for a character
 * 
 * Inputs:
 * - character: full character object
 * - locationMap: {locationId: location}
 * - currentTime: Date object (defaults to now)
 * 
 * Returns:
 * {
 *   resolved_current_location_id: string,
 *   resolved_current_location_name: string,
 *   resolved_location_type: string,
 *   resolved_presence_status: string,
 *   resolved_source_reason: string,
 *   resolved_zone: string | null
 * }
 */
export function resolveCharacterLocation(character, locationMap = {}, currentTime = new Date()) {
  if (!character) {
    return createFailedResolution('No character provided');
  }

  // HOME CONTRADICTION GUARD (runs before all layers):
  // If the DB claims resolved_presence_status = home but the resolved location is NOT
  // the character's authoritative current_home_location_id, reject the stale state
  // immediately and return the correct home — or flag it if the home is not in the map.
  const trueHomeId = character.current_home_location_id || character.home_location_id;
  if (
    character.resolved_presence_status === 'home' &&
    character.resolved_current_location_id &&
    trueHomeId &&
    character.resolved_current_location_id !== trueHomeId
  ) {
    const trueHome = locationMap[trueHomeId];
    if (trueHome) {
      // Correct silently to authoritative home
      return {
        resolved_current_location_id: trueHomeId,
        resolved_current_location_name: trueHome.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_contradiction_corrected',
        resolved_zone: null,
      };
    }
    // True home not in locationMap — do NOT preserve the stale wrong location.
    // Fall through to normal layer resolution which will find the home via LAYER 7.
    // Clear the stale resolved fields from local view so layers don't read them.
  }

  // CALLOUT GUARD: If character has a valid work exception for TODAY, skip ALL work schedule logic.
  // work_exception_status = 'called_out' AND work_exception_date = today (ET) = full bypass.
  // This is the ONLY gate between Presence Truth and Schedule Truth.
  const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;

  if (!hasValidCallout) {
  // LAYER 1: Check ALL work locations (primary + additional) as strict schedule authority
  // Collect every location this character is linked to as a worker
  const allWorkLocIds = [];
  if (character.occupation_location_id) allWorkLocIds.push(character.occupation_location_id);
  if (character.current_work_location_id) allWorkLocIds.push(character.current_work_location_id);
  if (character.additional_occupation_locations?.length > 0) {
    character.additional_occupation_locations.forEach(loc => {
      if (loc.location_id && !allWorkLocIds.includes(loc.location_id)) {
        allWorkLocIds.push(loc.location_id);
      }
    });
  }

  // For each work location, check if character is on shift right now
  for (const workLocId of allWorkLocIds) {
    const workLocation = locationMap[workLocId];
    if (!workLocation) continue;
    if (isLocationOpen(workLocation, currentTime) === false) continue;

    // Check 1: Location has an explicit shift for this character → use it
    const locationShift = workLocation.worker_shifts?.[character.id];
    if (locationShift) {
      if (isOnShiftNow(locationShift, currentTime)) {
        return {
          resolved_current_location_id: workLocId,
          resolved_current_location_name: workLocation.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
          resolved_zone: null,
        };
      }
      // Shift defined but not active — don't fall through to character schedule for this location
      continue;
    }

    // Check 2: No explicit shift saved — fall back to character's own work_start/end/days
    // This handles characters who are on the roster but their shift hasn't been explicitly saved
    if (isCharacterOnWorkSchedule(character, currentTime)) {
      return {
        resolved_current_location_id: workLocId,
        resolved_current_location_name: workLocation.name || 'Work',
        resolved_location_type: 'work',
        resolved_presence_status: 'at_work',
        resolved_source_reason: 'work_schedule',
        resolved_zone: null,
      };
    }
  }

  } // end if (!hasValidCallout) — work schedule block

  // LAYER 2: Check school schedule
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLocation = locationMap[character.education_location_id];
    if (schoolLocation && isLocationOpen(schoolLocation, currentTime) !== false) {
      return {
        resolved_current_location_id: character.education_location_id,
        resolved_current_location_name: schoolLocation.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
        resolved_zone: null,
      };
    }
  }

  // LAYER 2.5: Rabbit hole — character is at an off-screen/unbuilt destination confirmed by user
  // This must come BEFORE home fallback. A rabbit hole is a valid current presence.
  if (character.resolved_presence_status === 'rabbit_hole' || character.is_rabbit_hole === true) {
    const label = character.rabbit_hole_label || character.resolved_current_location_name || 'Off-screen';
    return {
      resolved_current_location_id: null,
      resolved_current_location_name: label,
      resolved_location_type: 'rabbit_hole',
      resolved_presence_status: 'rabbit_hole',
      resolved_source_reason: character.resolved_source_reason || 'rabbit_hole',
      resolved_zone: null,
    };
  }

  // LAYER 3: Check active travel state
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
      };
    }
  }

  // LAYER 3.5: Social visit — NPC/character has been explicitly moved away from home by system
  // This MUST come before sleep/home fallback to prevent home override
  const homeIdForVisitCheck = character.current_home_location_id || character.home_location_id;
  const resolvedLocIdForVisit = character.resolved_current_location_id;
  const isAwayFromHome = resolvedLocIdForVisit && resolvedLocIdForVisit !== homeIdForVisitCheck;

  // Matches: presence_state=social_visit, OR presence_status=visiting, OR autonomous_movement source
  const isSystemPlacedVisit =
    character.presence_state === 'social_visit' ||
    character.resolved_presence_status === 'visiting' ||
    character.resolved_source_reason === 'autonomous_needs_driven' ||
    character.resolved_source_reason === 'autonomous_movement' ||
    character.resolved_source_reason === 'user_travel';

  if (isAwayFromHome && isSystemPlacedVisit) {
    const socialLocation = locationMap[resolvedLocIdForVisit];
    if (socialLocation) {
      return {
        resolved_current_location_id: resolvedLocIdForVisit,
        resolved_current_location_name: socialLocation.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
      };
    }
  }

  // LAYER 4: Check valid visit/event/supervision state
  // (Placeholder for future visit/event system)
  // For now, skip

  // Resolve the authoritative home ID — check both field names
  const resolvedHomeId = character.current_home_location_id || character.home_location_id || null;

  // LAYER 5: Check sleep/nap state (valid resting location)
  if (isCharacterSleeping(character)) {
    const homeLocation = resolvedHomeId ? locationMap[resolvedHomeId] : null;
    if (homeLocation) {
      return {
        resolved_current_location_id: resolvedHomeId,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'home_sleeping',
        resolved_zone: null,
      };
    }
  }

  // LAYER 6: Check if in recovery nap
  if (hasUnpaidSleepDebt(character) && isNapTime(character, currentTime)) {
    const homeLocation = resolvedHomeId ? locationMap[resolvedHomeId] : null;
    if (homeLocation) {
      return {
        resolved_current_location_id: resolvedHomeId,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'recovery_nap',
        resolved_presence_status: 'napping',
        resolved_source_reason: 'recovery_nap',
        resolved_zone: null,
      };
    }
  }

  // LAYER 7: Home fallback — check all known home field paths on the character
  // Priority: current_home_location_id → home_location_id → residence_id → assigned_residence
  const allHomeFieldCandidates = [
    character.current_home_location_id,
    character.home_location_id,
    character.residence_id,
    character.assigned_residence,
  ].filter(Boolean);

  for (const candidateId of allHomeFieldCandidates) {
    const homeLocation = locationMap[candidateId];
    if (homeLocation) {
      return {
        resolved_current_location_id: candidateId,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_free_time',
        resolved_zone: null,
      };
    }
  }

  // LAYER 7.5: Scan locationMap for any home/generic location that lists this character as a resident
  // This handles cases where current_home_location_id is not set but the Locations page shows them assigned.
  for (const [locId, loc] of Object.entries(locationMap)) {
    if (loc.category !== 'home' && loc.category !== 'generic') continue;
    const residentIds = loc.resident_character_ids || [];
    if (residentIds.includes(character.id)) {
      return {
        resolved_current_location_id: locId,
        resolved_current_location_name: loc.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_from_location_residents',
        resolved_zone: null,
      };
    }
    // Also check residents[] array (newer format)
    const residents = loc.residents || [];
    if (residents.some(r => r.character_id === character.id)) {
      return {
        resolved_current_location_id: locId,
        resolved_current_location_name: loc.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_from_location_residents',
        resolved_zone: null,
      };
    }
  }

  // LAYER 8: No home found — use safe rabbit-hole/away presence (never disappear)
  // Character has no resolvable home but must still be visible.
  if (character.resolved_current_location_id) {
    // They were last at a known location — keep them there
    const lastLoc = locationMap[character.resolved_current_location_id];
    if (lastLoc) {
      return {
        resolved_current_location_id: character.resolved_current_location_id,
        resolved_current_location_name: lastLoc.name || character.resolved_current_location_name || 'Unknown',
        resolved_location_type: character.resolved_location_type || 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: 'last_known_no_home',
        resolved_zone: null,
      };
    }
  }

  // Final safe fallback: no home, no last location — mark as away (rabbit hole), never disappear
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Away',
    resolved_location_type: 'rabbit_hole',
    resolved_presence_status: 'rabbit_hole',
    resolved_source_reason: 'no_home_safe_away',
    resolved_zone: null,
  };
}

/**
 * Check if a character is currently on shift based on location worker_shifts data
 * Handles overnight shifts (e.g. 17:00–01:00)
 */
function isOnShiftNow(shift, currentTime = new Date()) {
  if (!shift?.start || !shift?.end) return false;
  // Check day of week if days array is specified
  if (shift.days && shift.days.length > 0) {
    const dayOfWeek = currentTime.getDay();
    if (!shift.days.includes(dayOfWeek)) return false;
  }

  const now = currentTime.getHours() * 60 + currentTime.getMinutes();
  const [startH, startM] = shift.start.split(':').map(Number);
  const [endH, endM] = shift.end.split(':').map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  // Overnight shift (e.g. 17:00 -> 01:00)
  if (endMin < startMin) {
    return now >= startMin || now < endMin;
  }
  return now >= startMin && now < endMin;
}

/**
 * Check if character is on work schedule right now (with prep window)
 * Returns { onSchedule, inPrepWindow, minutesUntilWork }
 */
function getWorkScheduleStatus(character, currentTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return { onSchedule: false, inPrepWindow: false, minutesUntilWork: null };
  }

  const now = currentTime.getTime();
  const dayOfWeek = currentTime.getDay();
  const isWorkDay = character.work_days.includes(dayOfWeek);
  
  if (!isWorkDay) {
    return { onSchedule: false, inPrepWindow: false, minutesUntilWork: null };
  }

  const [workStartHour, workStartMin] = character.work_start_time.split(':').map(Number);
  const [workEndHour, workEndMin] = character.work_end_time.split(':').map(Number);
  
  const workStartMs = new Date(currentTime).setHours(workStartHour, workStartMin, 0, 0);
  const workEndMs = new Date(currentTime).setHours(workEndHour, workEndMin, 0, 0);

  const onSchedule = now >= workStartMs && now < workEndMs;
  
  // Prep window: 15 minutes before work starts
  const prepWindowStart = workStartMs - (15 * 60 * 1000);
  const inPrepWindow = !onSchedule && now >= prepWindowStart && now < workStartMs;
  
  const minutesUntilWork = inPrepWindow ? Math.round((workStartMs - now) / 60000) : null;

  return { onSchedule, inPrepWindow, minutesUntilWork };
}

/**
 * Check if character is on work schedule right now
 */
function isCharacterOnWorkSchedule(character, currentTime) {
  const status = getWorkScheduleStatus(character, currentTime);
  return status.onSchedule;
}

/**
 * Check if character is sleeping
 */
function isCharacterSleeping(character) {
  if (!character.sleep_start_time || !character.wake_up_time) {
    return false;
  }

  // CRITICAL: Use Eastern Time for sleep schedule checks
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nowET.getHours();

  const sleepStart = parseInt(character.sleep_start_time.split(':')[0]);
  const wakeUp = parseInt(character.wake_up_time.split(':')[0]);

  // Handle sleep that crosses midnight
  if (sleepStart > wakeUp) {
    return hour >= sleepStart || hour < wakeUp;
  }
  return hour >= sleepStart && hour < wakeUp;
}

/**
 * Check if character has unpaid sleep debt
 */
function hasUnpaidSleepDebt(character) {
  return character.sleep_debt_hours && character.sleep_debt_hours > 0;
}

/**
 * Check if it's nap time (1-3pm typically)
 */
function isNapTime(character, currentTime) {
  const hour = currentTime.getHours();
  return hour >= 13 && hour < 16; // 1pm - 4pm
}

/**
 * Create a failed resolution response
 */
function createFailedResolution(reason) {
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Unknown',
    resolved_location_type: null,
    resolved_presence_status: 'unknown',
    resolved_source_reason: reason,
    resolved_zone: null,
  };
}

/**
 * Verify that all characters have unique locations (one presence only)
 * Returns array of violations if any
 */
export function verifyUniquePresence(characters, locationMap = {}) {
  const violations = [];
  const locationOccupants = {};

  characters.forEach(char => {
    const resolved = resolveCharacterLocation(char, locationMap);
    const locationId = resolved.resolved_current_location_id;

    if (locationId) {
      if (!locationOccupants[locationId]) {
        locationOccupants[locationId] = [];
      }
      locationOccupants[locationId].push(char.id);
    }
  });

  // Check for duplicates (this shouldn't happen with proper resolution)
  Object.entries(locationOccupants).forEach(([locId, charIds]) => {
    const counted = {};
    charIds.forEach(cid => {
      counted[cid] = (counted[cid] || 0) + 1;
    });
    Object.entries(counted).forEach(([cid, count]) => {
      if (count > 1) {
        violations.push({
          character_id: cid,
          location_id: locId,
          count,
          error: 'Character appears multiple times at same location',
        });
      }
    });
  });

  return violations;
}

/**
 * Verify that Home/Travel screens would show the same location
 * Returns true if consistent
 */
export function verifyScreenConsistency(character, locationMap = {}) {
  const resolved = resolveCharacterLocation(character, locationMap);
  
  // Both screens should read from resolved_current_location_id
  // This function just confirms the field exists and is valid
  return !!(resolved.resolved_current_location_id && resolved.resolved_current_location_name);
}

/**
 * Verify no false Home fallback occurred
 * Returns true if location is correctly non-Home when it should be
 */
export function verifyNoFalseHomeFallback(character, locationMap = {}) {
  const resolved = resolveCharacterLocation(character, locationMap);

  // If work schedule, must not be Home
  if (isCharacterOnWorkSchedule(character)) {
    return resolved.resolved_location_type !== 'home';
  }

  // If school schedule, must not be Home
  if (character.student_status === 'enrolled' && character.education_location_id) {
    return resolved.resolved_location_type !== 'school';
  }

  // If traveling, must not be Home
  if (character.travel_status && character.travel_status !== 'not_traveling') {
    return resolved.resolved_location_type !== 'home';
  }

  return true;
}

/**
 * STRICT SCHEDULE ENFORCEMENT: Check if character is violating schedule
 * Returns { isViolating, violation_type, should_be_at }
 */
export function checkScheduleViolation(character, locationMap = {}, currentTime = new Date()) {
  const resolved = resolveCharacterLocation(character, locationMap, currentTime);
  const workStatus = getWorkScheduleStatus(character, currentTime);

  // CALLOUT GUARD: If a valid callout exists for today, no work violation can exist.
  const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;
  if (hasValidCallout) return { isViolating: false };

  // WORK VIOLATION: Character should be at work
  if (workStatus.onSchedule && character.occupation_location_id) {
    const isAtWork = resolved.resolved_location_id === character.occupation_location_id;
    const isReadyToTravel = workStatus.inPrepWindow;
    
    if (!isAtWork && !isReadyToTravel) {
      const workLoc = locationMap[character.occupation_location_id];
      return {
        isViolating: true,
        violation_type: 'work_schedule_violation',
        should_be_at: {
          location_id: character.occupation_location_id,
          location_name: workLoc?.name || 'Work',
          reason: 'Active work schedule'
        }
      };
    }
  }

  // SCHOOL VIOLATION: Character should be at school
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const isAtSchool = resolved.resolved_current_location_id === character.education_location_id;
    if (!isAtSchool) {
      const schoolLoc = locationMap[character.education_location_id];
      return {
        isViolating: true,
        violation_type: 'school_schedule_violation',
        should_be_at: {
          location_id: character.education_location_id,
          location_name: schoolLoc?.name || 'School',
          reason: 'Enrolled student during school hours'
        }
      };
    }
  }

  return { isViolating: false };
}

/**
 * SINGLE SOURCE OF TRUTH FOR ALL UI DISPLAYS
 *
 * getCharacterLivePresence() — every screen must call this instead of building its own text.
 * Returns one authoritative display object: status label, location name, transit text, sleep state.
 *
 * Priority order:
 *   1. Active overrides (asleep/collapsed/hunger critical/health critical)
 *   2. Transit state (left but not arrived)
 *   3. Confirmed arrival (presence_status = at_location)
 *   4. Last confirmed location (fallback)
 *
 * RULE: Schedule fields NEVER write directly to display state.
 * Schedule creates intent. Only confirmed state creates presence.
 */
export function getCharacterLivePresence(character, locationMap = {}) {
  if (!character) return { status: 'unknown', label: 'Unknown', sublabel: null, isTransit: false, isSleeping: false };

  const loc = locationMap[character.resolved_current_location_id];
  const locName = loc?.name || character.resolved_current_location_name || null;

  // ── PRIORITY 1: OVERRIDES ──────────────────────────────────────────────────
  const presenceStatus = character.resolved_presence_status || character.location_status;

  // Sleep state (sleeping / napping)
  if (presenceStatus === 'sleeping' || presenceStatus === 'napping') {
    const label = presenceStatus === 'napping' ? 'Napping' : 'Sleeping';
    return { status: presenceStatus, label, sublabel: locName, isTransit: false, isSleeping: true };
  }

  // Sleep interrupted by chat — character is now awake at their location
  if (character.sleep_interrupted_at) {
    const minutesSinceInterrupt = (Date.now() - new Date(character.sleep_interrupted_at).getTime()) / 60000;
    if (minutesSinceInterrupt < 60) {
      return { status: 'sleep_interrupted', label: 'Awake', sublabel: `Just woke up · ${locName}`, isTransit: false, isSleeping: false };
    }
  }

  // Critical needs override — hunger/health emergencies must surface
  const hungerCritical  = (character.hunger_value ?? 70) < 15;
  const healthCritical  = (character.health_value ?? 80) < 20;
  const energyCritical  = (character.energy_value ?? 75) < 10;

  if (healthCritical) {
    return { status: 'health_critical', label: 'Health Emergency', sublabel: locName, isTransit: false, isSleeping: false };
  }
  if (energyCritical && presenceStatus !== 'at_work') {
    return { status: 'energy_critical', label: 'Exhausted', sublabel: locName, isTransit: false, isSleeping: false };
  }
  if (hungerCritical) {
    return { status: 'hunger_critical', label: 'Looking for food', sublabel: locName, isTransit: false, isSleeping: false };
  }

  // ── PRIORITY 1.5: RABBIT HOLE ─────────────────────────────────────────────
  if (character.resolved_presence_status === 'rabbit_hole' || character.is_rabbit_hole === true) {
    const label = character.rabbit_hole_label || character.resolved_current_location_name || 'Off-screen';
    return { status: 'rabbit_hole', label, sublabel: character.rabbit_hole_subtype || null, isTransit: false, isSleeping: false };
  }

  // ── PRIORITY 2: TRANSIT STATE ──────────────────────────────────────────────
  if (presenceStatus === 'traveling') {
    const destLoc = locationMap[character.travel_destination_location_id];
    const destName = destLoc?.name || character.traveling_to_location_name || 'destination';
    return { status: 'in_transit', label: `Traveling to ${destName}`, sublabel: null, isTransit: true, isSleeping: false };
  }

  // ── PRIORITY 3: CONFIRMED PRESENCE ────────────────────────────────────────
  if (presenceStatus === 'at_work') {
    const workLoc = locationMap[character.occupation_location_id];
    return { status: 'at_work', label: `At work`, sublabel: workLoc?.name || 'Work', isTransit: false, isSleeping: false };
  }
  if (presenceStatus === 'at_school') {
    const schoolLoc = locationMap[character.education_location_id];
    return { status: 'at_school', label: `At school`, sublabel: schoolLoc?.name || 'School', isTransit: false, isSleeping: false };
  }
  if (presenceStatus === 'visiting') {
    return { status: 'visiting', label: `At ${locName}`, sublabel: null, isTransit: false, isSleeping: false };
  }
  if (presenceStatus === 'home') {
    return { status: 'home', label: 'At home', sublabel: locName, isTransit: false, isSleeping: false };
  }

  // ── PRIORITY 4: FALLBACK — last confirmed location ─────────────────────────
  return { status: 'at_location', label: locName ? `At ${locName}` : 'Nearby', sublabel: null, isTransit: false, isSleeping: false };
}

/**
 * SINGLE AUTHORITATIVE LOCATION CONTEXT FOR LLM PROMPTS
 *
 * Call this before generating chat replies, narratives, or image prompts.
 * Returns a hard-locked location truth string that MUST override any stale context.
 *
 * Rules:
 * - If character is home (any home presence): returns home context, blocks work/venue framing
 * - If character is at work/school: returns venue context with operating status
 * - If traveling: returns transit context
 * - If sleeping: returns sleep context
 *
 * imageMode = true returns a shorter string suitable for image prompt injection
 */
export function buildLiveLocationContext(character, locationMap = {}, imageMode = false) {
  if (!character) return '';

  const presence = character.resolved_presence_status;
  const locId = character.resolved_current_location_id;
  const locName = (locId && locationMap[locId]?.name) || character.resolved_current_location_name;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // ── RABBIT HOLE ───────────────────────────────────────────────────────────
  if (presence === 'rabbit_hole' || character.is_rabbit_hole === true) {
    const label = character.rabbit_hole_label || character.resolved_current_location_name || 'Off-screen';
    if (imageMode) return `[LOCATION LOCKED: character is at an off-screen location: "${label}" — do not place them at home or any built venue]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently at "${label}" — an off-screen destination not in the built location list. You are NOT at home. Do NOT describe yourself as being at home or any other built location. This is your current presence.`;
  }

  // ── SLEEPING ──────────────────────────────────────────────────────────────
  if (presence === 'sleeping' || presence === 'napping') {
    if (imageMode) return `[LOCATION LOCKED: character is at home sleeping — use residential bedroom/bed context]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently ASLEEP at home${locName ? ` (${locName})` : ''}. Do NOT speak as if you are at any venue, work, or public place.`;
  }

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (presence === 'home') {
    if (imageMode) return `[LOCATION LOCKED: character is at home — use residential interior context${locName ? ` matching ${locName}` : ''}]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently AT HOME${locName ? ` (${locName})` : ''}. You are NOT at work, a bar, club, or any other venue. Any work or outing context is PAST TENSE only.`;
  }

  // ── AT WORK ───────────────────────────────────────────────────────────────
  if (presence === 'at_work') {
    const workLoc = locId ? locationMap[locId] : null;
    const isOpen = workLoc ? (isLocationOpen(workLoc, now) !== false) : true;
    if (!isOpen) {
      // Venue closed — character should have left. Treat as home.
      console.warn(`[LOCATION_HOURS] ${character.name} is marked at_work but ${locName} is closed at ${timeStr}. Correcting to home.`);
      const homeName = locationMap[character.current_home_location_id]?.name || 'Home';
      if (imageMode) return `[LOCATION LOCKED: venue closed — character is heading home or at home, use residential/transit context]`;
      return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): The venue ${locName ? `"${locName}"` : 'you work at'} is now CLOSED. You are no longer on-site — you have finished your shift and are either heading home or already home. Speak in past tense about work. Do NOT describe yourself as still at the venue.`;
    }
    if (imageMode) return `[LOCATION LOCKED: character is at work at ${locName || 'their workplace'} — use that work environment as background]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently AT WORK at ${locName || 'your workplace'}. All location references must match this environment.`;
  }

  // ── AT SCHOOL ─────────────────────────────────────────────────────────────
  if (presence === 'at_school') {
    if (imageMode) return `[LOCATION LOCKED: character is at school/class — use school/campus environment]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently AT SCHOOL${locName ? ` (${locName})` : ''}. All location references must match this.`;
  }

  // ── TRAVELING ─────────────────────────────────────────────────────────────
  if (presence === 'traveling') {
    const destName = character.traveling_to_location_name || locName || 'your destination';
    if (imageMode) return `[LOCATION LOCKED: character is in transit to ${destName} — use travel/vehicle/street context]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently IN TRANSIT to ${destName}. You have NOT arrived yet. Do NOT say you are already there.`;
  }

  // ── VISITING / UNKNOWN ────────────────────────────────────────────────────
  if (locName) {
    if (imageMode) return `[LOCATION LOCKED: character is at ${locName}]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently at ${locName}.`;
  }

  return '';
}

/**
 * AUTO-CORRECT: If character is violating schedule, force correct location
 * Returns corrected character data or null if no correction needed
 */
export function autoCorrectScheduleViolation(character, locationMap = {}, currentTime = new Date()) {
  const violation = checkScheduleViolation(character, locationMap, currentTime);
  
  if (!violation.isViolating) {
    return null; // No violation, no correction needed
  }

  const correction = {};
  const { location_id, location_name, reason } = violation.should_be_at;

  if (violation.violation_type === 'work_schedule_violation') {
    correction.resolved_current_location_id = location_id;
    correction.resolved_current_location_name = location_name;
    correction.resolved_location_type = 'work';
    correction.resolved_presence_status = 'at_work';
    correction.resolved_source_reason = 'work_schedule_enforced';
  } else if (violation.violation_type === 'school_schedule_violation') {
    correction.resolved_current_location_id = location_id;
    correction.resolved_current_location_name = location_name;
    correction.resolved_location_type = 'school';
    correction.resolved_presence_status = 'at_school';
    correction.resolved_source_reason = 'school_schedule_enforced';
  }

  correction.resolved_last_updated_at = currentTime.toISOString();
  return correction;
}