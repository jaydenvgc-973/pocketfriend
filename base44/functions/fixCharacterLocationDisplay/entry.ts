import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixCharacterLocationDisplay — Authoritative Location Contradiction Repair
 *
 * When confirm:true is passed, this function:
 *   1. Detects characters at closed or stale invalid locations
 *   2. Resolves the correct location using the inline resolver
 *   3. Writes ALL authoritative fields (resolved + correction lock)
 *   4. Clears ALL stale movement fields that can pull the character back
 *   5. Writes a 30-minute correction lock to block autonomous relapse
 *
 * ACCOUNT ISOLATION: All queries scoped to owner_email only.
 * FORBIDDEN: created_by is never used.
 */

// ── EASTERN TIME ───────────────────────────────────────────────────────────────
function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

// ── SHARED OPEN/CLOSED HELPER ──────────────────────────────────────────────────
// Returns true if open, false if closed, true if no hours defined (always open).
function isLocationOpen(location, nowET) {
  const hours = location?.operating_hours;
  if (!hours || hours.length === 0) return true; // no hours = always open
  const dayOfWeek = nowET.getDay();
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const inWindow = (open, close) => {
    const oMin = toMin(open); const cMin = toMin(close);
    if (oMin == null || cMin == null) return false;
    if (oMin <= cMin) return currentMin >= oMin && currentMin <= cMin;
    return currentMin >= oMin || currentMin <= cMin;
  };
  const daySpecific = hours.filter(h => h.day_of_week != null);
  const dayAgnostic = hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);
  if (todayEntries.length > 0) return todayEntries.some(h => inWindow(h.open_time, h.close_time));
  if (daySpecific.length > 0) return false; // day-specific hours exist but none for today = closed
  if (dayAgnostic.length > 0) return dayAgnostic.some(h => inWindow(h.open_time, h.close_time));
  return true;
}

// All categories where a character may validly sleep
const VALID_SLEEP_CATEGORIES = new Set(['home', 'hotel', 'shelter', 'generic']);
// Outdoor/public categories valid for sleeping when character is homeless
const HOMELESS_SLEEP_CATEGORIES = new Set(['outdoor', 'public', 'park', 'community']);
// All confinement facility categories — these are LOCKED states, never corrected
const CONFINEMENT_CATEGORIES = new Set(['jail_prison']);

function isValidSleepLocation(loc) {
  return loc && VALID_SLEEP_CATEGORIES.has(loc.category || '');
}

function isConfinementLocation(loc) {
  return loc && (loc.is_confinement_facility === true || CONFINEMENT_CATEGORIES.has(loc.category || ''));
}

// ── SHIFT CHECK ────────────────────────────────────────────────────────────────
function isOnShiftNow(shift, nowET) {
  if (!shift?.start || !shift?.end) return false;
  if (shift.days && shift.days.length > 0) {
    if (!shift.days.includes(nowET.getDay())) return false;
  }
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

function isCharacterOnWorkSchedule(char, nowET) {
  if (!char.work_start_time || !char.work_end_time || !char.work_days) return false;
  const dayOfWeek = nowET.getDay();
  if (!char.work_days.includes(dayOfWeek)) return false;
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = char.work_start_time.split(':').map(Number);
  const [eh, em] = char.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

// ── ADAPTIVE SLEEP CHECK (mirrors other functions) ────────────────────────────
function computeAdaptiveSleepWindow(char) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const nowET = getNowET();
  const dayOfWeek = nowET.getDay();
  let nextShiftStartMin = null;
  let nextShiftEndMin = null;
  if (char.work_start_time && char.work_end_time && Array.isArray(char.work_days)) {
    if (char.work_days.includes(dayOfWeek) || char.work_days.includes((dayOfWeek + 1) % 7)) {
      nextShiftStartMin = toMin(char.work_start_time);
      nextShiftEndMin = toMin(char.work_end_time);
    }
  }
  if (!nextShiftStartMin && char.student_status === 'enrolled' && char.education_location_id) {
    nextShiftStartMin = 8 * 60; nextShiftEndMin = 15 * 60;
  }
  if (nextShiftStartMin !== null) {
    const isOvernight = nextShiftEndMin < nextShiftStartMin;
    if (isOvernight) {
      return { sleepStartMin: (nextShiftEndMin + 60) % 1440, wakeMin: (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440 };
    }
    const wakeTime = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
    return { sleepStartMin: (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440, wakeMin: wakeTime };
  }
  if (char.sleep_start_time && char.wake_up_time) {
    const s = toMin(char.sleep_start_time); const w = toMin(char.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w };
  }
  return null;
}

function isCharacterSleeping(char) {
  const window = computeAdaptiveSleepWindow(char);
  if (!window) return false;
  const nowET = getNowET();
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

// ── INLINE RESOLVER ────────────────────────────────────────────────────────────
// Returns the correct resolved state for a character, OR a VALID_STATE sentinel
// when the character is in a locked/valid state that must never be overridden.
//
// VALID STATE GUARDS (checked before all resolver layers):
//   1. Jail/Prison confinement — locked until release
//   2. Hotel/shelter sleep — valid temporary housing sleep
//   3. Outdoor/public sleep — valid for homeless characters
//   4. Rabbit-hole home — character home not in location map (valid unlisted home)
function resolveCharacterLocation(char, locationMap) {
  const nowET = getNowET();
  const todayET = nowET.toISOString().slice(0, 10);

  // ══ GUARD 1: JAIL/PRISON CONFINEMENT ══════════════════════════════════════
  // is_jailed is the authoritative confinement flag. The character is LOCKED
  // at the incarceration facility until explicitly released. Never route home.
  if (char.is_jailed === true) {
    const facilityId = char.incarceration_facility_id || char.resolved_current_location_id || null;
    const facilityLoc = facilityId ? locationMap[facilityId] : null;
    const facilityName = facilityLoc?.name || char.incarceration_facility_name || 'Confinement Facility';
    return {
      _valid_state: true,
      _valid_reason: 'jail_confinement_locked',
      resolved_current_location_id: facilityId,
      resolved_current_location_name: facilityName,
      resolved_location_type: 'incarcerated',
      resolved_presence_status: 'incarcerated',
      resolved_source_reason: 'confined_by_user',
    };
  }

  // Also check: character is at a confinement location by resolved fields (even without is_jailed flag)
  const currentResolvedLoc = char.resolved_current_location_id ? locationMap[char.resolved_current_location_id] : null;
  if (currentResolvedLoc && isConfinementLocation(currentResolvedLoc)) {
    return {
      _valid_state: true,
      _valid_reason: 'at_confinement_facility',
      resolved_current_location_id: char.resolved_current_location_id,
      resolved_current_location_name: currentResolvedLoc.name,
      resolved_location_type: char.resolved_location_type || 'incarcerated',
      resolved_presence_status: char.resolved_presence_status || 'incarcerated',
      resolved_source_reason: char.resolved_source_reason || 'confinement_facility_presence',
    };
  }

  // ══ GUARD 2: HOTEL/SHELTER SLEEP — valid temporary housing sleep ══════════
  // Characters assigned to hotel/shelter as temporary housing may sleep there.
  // This is NOT a contradiction — do not re-route to a permanent home.
  const tempHousingId = char.temporary_housing_location_id || null;
  const tempHousingLoc = tempHousingId ? locationMap[tempHousingId] : null;
  if (isCharacterSleeping(char) && tempHousingLoc && (tempHousingLoc.category === 'hotel' || tempHousingLoc.category === 'shelter')) {
    return {
      _valid_state: true,
      _valid_reason: 'sleeping_at_temporary_housing',
      resolved_current_location_id: tempHousingId,
      resolved_current_location_name: tempHousingLoc.name,
      resolved_location_type: 'temporary_housing',
      resolved_presence_status: 'sleeping',
      resolved_source_reason: 'temporary_housing_sleep',
    };
  }

  // ══ GUARD 3: OUTDOOR/PUBLIC SLEEP for homeless characters ═════════════════
  // Homeless characters (is_homeless=true or housing_context indicates unsheltered)
  // may legitimately sleep at outdoor/public/park locations. Valid — do not re-route.
  const isHomeless = char.is_homeless === true || char.housing_context === 'homeless_unsheltered';
  if (isCharacterSleeping(char) && isHomeless && char.resolved_current_location_id) {
    const currentSleepLoc = locationMap[char.resolved_current_location_id];
    if (currentSleepLoc && HOMELESS_SLEEP_CATEGORIES.has(currentSleepLoc.category || '')) {
      return {
        _valid_state: true,
        _valid_reason: 'homeless_outdoor_sleep',
        resolved_current_location_id: char.resolved_current_location_id,
        resolved_current_location_name: currentSleepLoc.name,
        resolved_location_type: char.resolved_location_type || 'visit',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'homeless_sleep_location',
      };
    }
  }

  // ══ GUARD 4: RABBIT-HOLE HOME — home not in location map ══════════════════
  // If the character's home ID is set but NOT in the location map, the home
  // is an unlisted/rabbit-hole residence. This is valid — do not mark as unresolved
  // or force correction. The character is simply "home" at an unlisted location.
  const homeId = char.temporary_housing_location_id || char.current_home_location_id || char.home_location_id || null;
  if (homeId && !locationMap[homeId]) {
    // Home exists (ID set) but not loaded in location map — rabbit-hole valid state
    const resolvedLocInMap = char.resolved_current_location_id ? locationMap[char.resolved_current_location_id] : null;
    // Only protect if the character is resolved TO their home (or unresolved) — not if they're at a valid open location
    const isAtHomeOrUnresolved = !char.resolved_current_location_id
      || char.resolved_current_location_id === homeId
      || char.resolved_presence_status === 'home'
      || char.resolved_presence_status === 'sleeping'
      || !resolvedLocInMap; // resolved loc also not in map
    if (isAtHomeOrUnresolved) {
      return {
        _valid_state: true,
        _valid_reason: 'rabbit_hole_home_not_in_location_map',
        resolved_current_location_id: char.resolved_current_location_id || homeId,
        resolved_current_location_name: char.resolved_current_location_name || 'Home (unlisted)',
        resolved_location_type: char.resolved_location_type || 'home',
        resolved_presence_status: char.resolved_presence_status || 'home',
        resolved_source_reason: 'rabbit_hole_home_valid',
      };
    }
  }

  // ══ LAYER 0: Sleep lock — sleeping characters go home ══════════════════════
  // Only reached when none of the guards above matched.
  // At this point: not jailed, not at confinement, not temp-housing sleep,
  // not outdoor-homeless sleep, not rabbit-hole. Standard sleep = go home.
  const sleepHomeId = char.temporary_housing_location_id || char.current_home_location_id || char.home_location_id || null;
  const sleepHomeLoc = sleepHomeId ? locationMap[sleepHomeId] : null;

  if (isCharacterSleeping(char)) {
    if (sleepHomeId && sleepHomeLoc) {
      return {
        resolved_current_location_id: sleepHomeId,
        resolved_current_location_name: sleepHomeLoc.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'adaptive_sleep_location_lock',
      };
    }
    return {
      resolved_current_location_id: null,
      resolved_current_location_name: 'Unresolved',
      resolved_location_type: 'sleep_unresolved',
      resolved_presence_status: 'sleeping',
      resolved_source_reason: 'no_valid_sleep_location',
    };
  }

  // LAYER 1: Work schedule (skip if called out today)
  const hasValidCallout = char.work_exception_status === 'called_out' && char.work_exception_date === todayET;
  if (!hasValidCallout) {
    const allWorkLocIds = [];
    if (char.occupation_location_id) allWorkLocIds.push(char.occupation_location_id);
    if (char.current_work_location_id && !allWorkLocIds.includes(char.current_work_location_id)) allWorkLocIds.push(char.current_work_location_id);
    (char.additional_occupation_locations || []).forEach(loc => {
      if (loc.location_id && !allWorkLocIds.includes(loc.location_id)) allWorkLocIds.push(loc.location_id);
    });
    for (const workLocId of allWorkLocIds) {
      const workLocation = locationMap[workLocId];
      if (!workLocation) continue;
      // Do NOT send character to a closed work location
      if (!isLocationOpen(workLocation, nowET)) continue;
      const locationShift = workLocation.worker_shifts?.[char.id];
      if (locationShift) {
        if (isOnShiftNow(locationShift, nowET)) {
          return { resolved_current_location_id: workLocId, resolved_current_location_name: workLocation.name || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule' };
        }
        continue;
      }
      if (isCharacterOnWorkSchedule(char, nowET)) {
        return { resolved_current_location_id: workLocId, resolved_current_location_name: workLocation.name || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule' };
      }
    }
  }

  // LAYER 2: School schedule
  if (char.student_status === 'enrolled' && char.education_location_id) {
    const schoolLocation = locationMap[char.education_location_id];
    if (schoolLocation && isLocationOpen(schoolLocation, nowET)) {
      return { resolved_current_location_id: char.education_location_id, resolved_current_location_name: schoolLocation.name || 'School', resolved_location_type: 'school', resolved_presence_status: 'at_school', resolved_source_reason: 'school_schedule' };
    }
  }

  // LAYER 3: Active travel with valid destination
  if (char.travel_status && char.travel_status !== 'not_traveling' && char.travel_destination_location_id) {
    const destLocation = locationMap[char.travel_destination_location_id];
    if (destLocation && isLocationOpen(destLocation, nowET)) {
      return { resolved_current_location_id: char.travel_destination_location_id, resolved_current_location_name: destLocation.name || 'Traveling', resolved_location_type: 'traveling', resolved_presence_status: 'traveling', resolved_source_reason: char.travel_status };
    }
  }

  // LAYER 4: Preserve active visit ONLY if:
  //   - Not autonomous (autonomous visits are always stale and must not be preserved)
  //   - Location exists and is OPEN
  //   - Location is a valid sleep category (hotel/shelter/home) OR it's a user-initiated visit
  const homeIdForVisitCheck = char.current_home_location_id || char.home_location_id;
  const resolvedLocId = char.resolved_current_location_id;
  const isAwayFromHome = resolvedLocId && resolvedLocId !== homeIdForVisitCheck;
  const isAutonomousVisit =
    char.resolved_source_reason === 'autonomous_needs_driven' ||
    char.resolved_source_reason === 'autonomous_movement' ||
    char.resolved_source_reason === 'energy_low_return_home';
  const isUserVisit = char.resolved_source_reason === 'user_travel' || char.presence_state === 'social_visit';

  if (isAwayFromHome) {
    const visitLoc = locationMap[resolvedLocId];
    // BLOCK: closed non-residential location — never preserve
    if (visitLoc && !isValidSleepLocation(visitLoc) && !isLocationOpen(visitLoc, nowET)) {
      // Fall through to home
      console.log(`[FIX_LOCATIONS] CLOSED_BLOCK: ${char.name} at ${visitLoc.name} — closed, routing home`);
    }
    // BLOCK: autonomous visit at non-sleep location — never preserve
    else if (isAutonomousVisit && visitLoc && !isValidSleepLocation(visitLoc)) {
      // Fall through to home
    }
    // ALLOW: valid sleep location regardless of visit type
    else if (visitLoc && isValidSleepLocation(visitLoc)) {
      return { resolved_current_location_id: resolvedLocId, resolved_current_location_name: visitLoc.name, resolved_location_type: 'visit', resolved_presence_status: char.resolved_presence_status || 'visiting', resolved_source_reason: char.resolved_source_reason };
    }
    // ALLOW: user-initiated visit at open non-sleep location
    else if (isUserVisit && visitLoc && isLocationOpen(visitLoc, nowET)) {
      return { resolved_current_location_id: resolvedLocId, resolved_current_location_name: visitLoc.name, resolved_location_type: 'visit', resolved_presence_status: char.resolved_presence_status || 'visiting', resolved_source_reason: char.resolved_source_reason };
    }
    // All other cases fall through to home
  }

  // LAYER 5: Home fallback
  const resolvedHomeId = char.temporary_housing_location_id || char.current_home_location_id || char.home_location_id || null;
  if (resolvedHomeId) {
    const homeLocation = locationMap[resolvedHomeId];
    if (homeLocation) {
      return { resolved_current_location_id: resolvedHomeId, resolved_current_location_name: homeLocation.name || 'Home', resolved_location_type: 'home', resolved_presence_status: 'home', resolved_source_reason: 'home_free_time' };
    }
  }

  // LAYER 6: Resident scan (fallback — find home from location records)
  for (const [locId, loc] of Object.entries(locationMap)) {
    if (loc.category !== 'home' && loc.category !== 'generic') continue;
    if ((loc.resident_character_ids || []).includes(char.id) || (loc.residents || []).some(r => r.character_id === char.id)) {
      return { resolved_current_location_id: locId, resolved_current_location_name: loc.name || 'Home', resolved_location_type: 'home', resolved_presence_status: 'home', resolved_source_reason: 'home_from_location_residents' };
    }
  }

  // No home found — active_created_character must never use rabbit_hole
  // Use location_unresolved to signal the character needs a home assigned
  return {
    resolved_current_location_id:   null,
    resolved_current_location_name: 'Unresolved',
    resolved_location_type:         'location_unresolved',
    resolved_presence_status:       'location_unresolved',
    resolved_source_reason:         'no_valid_home_or_temporary_location',
  };
}

// ── STALE MOVEMENT FIELD CLEARER ──────────────────────────────────────────────
// Returns the fields to null-out when correcting a character away from an invalid location.
function buildStaleFieldClear() {
  return {
    travel_destination_location_id: null,
    travel_destination_id:          null,
    travel_status:                  'not_traveling',
    autonomous_destination_id:      null,
    autonomous_movement_status:     null,
    needs_destination_id:           null,
    recreational_destination_id:    null,
    current_activity_destination_id: null,
    resolved_visit_type:            null,
    last_autonomous_location_id:    null,
    last_social_location_id:        null,
    last_recreational_location_id:  null,
    rabbit_hole_location_id:        null,
    rabbit_hole_status:             null,
    visit_location_id:              null,
    social_visit_status:            null,
    active_visit_id:                null,
    in_transit:                     false,
  };
}

// ── CONTRADICTION DETECTION ────────────────────────────────────────────────────
function detectContradiction(char, resolverResult, locationMap) {
  const nowET = getNowET();

  // VALID STATE: resolver returned a guard sentinel — skip without any correction
  // These states (jail, temp-housing sleep, homeless outdoor sleep, rabbit-hole home)
  // are valid under current rules and must never be corrected.
  if (resolverResult._valid_state === true) {
    return {
      action: 'SKIP_VALID',
      detail: `Valid state preserved: ${resolverResult._valid_reason} — no correction needed`,
      before: null,
      after: null,
      changedFields: [],
    };
  }

  // TRAVEL PROTECTION: active travel with valid open destination — skip
  if (char.travel_status && char.travel_status !== 'not_traveling' && char.travel_destination_location_id) {
    const destLoc = locationMap[char.travel_destination_location_id];
    const isOwnedDest = destLoc?.owner_email === char.owner_email;
    const isSharedDest = destLoc?.scope === 'shared';
    if (destLoc && (isOwnedDest || isSharedDest) && isLocationOpen(destLoc, nowET)) {
      return { action: 'SKIP_TRAVEL', detail: 'Character in valid active travel — protected', before: null, after: null, changedFields: [] };
    } else {
      return { action: 'FLAG_TRAVEL_DESTINATION', detail: `travel_destination_location_id (${char.travel_destination_location_id}) invalid, closed, or cross-account`, before: null, after: null, changedFields: [] };
    }
  }

  const truthId     = resolverResult.resolved_current_location_id;
  const truthName   = resolverResult.resolved_current_location_name;
  const truthStatus = resolverResult.resolved_presence_status;
  const truthType   = resolverResult.resolved_location_type;
  const truthReason = resolverResult.resolved_source_reason;

  const idMatches     = char.resolved_current_location_id   === truthId;
  const nameMatches   = char.resolved_current_location_name === truthName;
  const statusMatches = char.resolved_presence_status       === truthStatus;
  const typeMatches   = !truthType || char.resolved_location_type === truthType;

  if (idMatches && nameMatches && statusMatches && typeMatches) {
    return { action: 'NO_CHANGE', detail: 'All fields match', before: null, after: null, changedFields: [] };
  }

  const changedFields = [];
  const before = {};
  const after  = {};

  if (!idMatches)     { changedFields.push('resolved_current_location_id');   before.resolved_current_location_id   = char.resolved_current_location_id;   after.resolved_current_location_id   = truthId; }
  if (!nameMatches)   { changedFields.push('resolved_current_location_name'); before.resolved_current_location_name = char.resolved_current_location_name; after.resolved_current_location_name = truthName; }
  if (!statusMatches) { changedFields.push('resolved_presence_status');       before.resolved_presence_status       = char.resolved_presence_status;       after.resolved_presence_status       = truthStatus; }
  if (!typeMatches && truthType) { changedFields.push('resolved_location_type'); before.resolved_location_type = char.resolved_location_type; after.resolved_location_type = truthType; }

  let action = 'COMBINED_SYNC';
  if (changedFields.length === 1) action = changedFields[0].includes('status') ? 'STATUS_SYNC' : 'FIELD_SYNC';

  return { action, detail: truthReason || 'correction', before, after, changedFields, truthId, truthName, truthStatus, truthType };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const confirmWrite = body?.confirm === true;
    const page = body?.page || 1;
    const pageSize = body?.pageSize || 5;
    const nowET = getNowET();

    console.log(`[FIX_LOCATIONS] Starting | user=${user.email} | confirmWrite=${confirmWrite}`);

    // Load locations — owner_email scoped only (NO created_by)
    const [ownedLocs, sharedLocs] = await Promise.all([
      base44.entities.LocationReference.filter({ owner_email: user.email }).catch(() => []),
      base44.entities.LocationReference.filter({ scope: 'shared' }).catch(() => []),
    ]);
    const locSeen = new Set();
    const allLocations = [...ownedLocs, ...sharedLocs].filter(l => {
      if (locSeen.has(l.id)) return false;
      locSeen.add(l.id); return true;
    });
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));
    console.log(`[FIX_LOCATIONS] Loaded ${allLocations.length} locations`);

    // Load characters — owner_email scoped only (NO created_by)
    const [activeOwned, npcFictOwned, npcFamOwned] = await Promise.all([
      base44.entities.Character.filter({ owner_email: user.email, character_type: 'active_created_character', status: 'active' }).catch(() => []),
      base44.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious', status: 'active' }).catch(() => []),
      base44.entities.Character.filter({ owner_email: user.email, character_type: 'npc_family_member', status: 'active' }).catch(() => []),
    ]);

    const charSeen = new Set();
    const allCharacters = [...activeOwned, ...npcFictOwned, ...npcFamOwned].filter(c => {
      if (charSeen.has(c.id)) return false;
      charSeen.add(c.id); return true;
    });
    console.log(`[FIX_LOCATIONS] Loaded ${allCharacters.length} characters`);

    // Identify internal family files
    const standaloneCharIds = new Set(allCharacters.map(c => c.id));
    const internalFamilyFiles = [];
    for (const char of allCharacters) {
      for (const fm of (char.family_members || [])) {
        if (fm.name && !standaloneCharIds.has(fm.character_id)) {
          internalFamilyFiles.push({ name: fm.name, parent_character_id: char.id, parent_character_name: char.name });
        }
      }
    }

    // Run resolver and detect contradictions
    const results = [];
    let travel_protected_count = 0;
    let travel_flagged_count = 0;

    for (const char of allCharacters) {
      const resolverResult = resolveCharacterLocation(char, locationMap);
      const contradiction = detectContradiction(char, resolverResult, locationMap);
      if (contradiction.action === 'SKIP_TRAVEL') travel_protected_count++;
      else if (contradiction.action === 'FLAG_TRAVEL_DESTINATION') travel_flagged_count++;
      results.push({
        character_id:   char.id,
        character_name: char.name,
        character_type: char.character_type,
        owner_email:    char.owner_email,
        action:         contradiction.action,
        detail:         contradiction.detail,
        before:         contradiction.before,
        after:          contradiction.after,
        changedFields:  contradiction.changedFields || [],
        truthId:        contradiction.truthId,
        // Capture stored location so we can write correction lock
        stored_location_id: char.resolved_current_location_id,
        home_id: char.current_home_location_id || char.home_location_id,
      });
    }

    const toWrite   = results.filter(r => !['NO_CHANGE', 'SKIP_TRAVEL', 'SKIP_VALID', 'FLAG_TRAVEL_DESTINATION'].includes(r.action));
    const noChange  = results.filter(r => r.action === 'NO_CHANGE');
    const skipValid = results.filter(r => r.action === 'SKIP_VALID');
    const flagged   = results.filter(r => r.action === 'FLAG_TRAVEL_DESTINATION');

    // DRY RUN — return preview only
    if (!confirmWrite) {
      const totalPages = Math.ceil(toWrite.length / pageSize);
      const startIdx = (page - 1) * pageSize;
      const pageCorrections = toWrite.slice(startIdx, Math.min(startIdx + pageSize, toWrite.length));
      return Response.json({
        dry_run: true,
        pagination: { page, page_size: pageSize, total_pages: totalPages, total_corrections: toWrite.length },
        to_write_count: toWrite.length,
        no_change_count: noChange.length,
        valid_skipped_count: skipValid.length,
        valid_skipped_items: skipValid.map(r => ({ character_name: r.character_name, detail: r.detail })),
        flagged_count: flagged.length,
        travel_protected_count,
        travel_flagged_count,
        internal_family_count: internalFamilyFiles.length,
        flagged_items: flagged,
        corrections_preview: pageCorrections,
        summary: { to_write_count: toWrite.length, no_change_count: noChange.length, valid_skipped_count: skipValid.length, flagged_count: flagged.length, travel_protected_count, travel_flagged_count, internal_family_count: internalFamilyFiles.length },
      });
    }

    // WRITE MODE
    const written = [];
    const writeErrors = [];
    const lockTimestamp = nowET.toISOString();

    for (const result of toWrite) {
      if (!result.after || Object.keys(result.after).length === 0) continue;

      // Determine if this is a correction away from a non-home invalid location
      // If so: write correction lock + clear stale movement fields
      const wasAtNonHome = result.stored_location_id && result.stored_location_id !== result.home_id;
      const isBeingRoutedHome = result.after.resolved_location_type === 'home' || result.after.resolved_presence_status === 'sleeping';
      const isBeingCorrectedFromBadVisit = wasAtNonHome && isBeingRoutedHome;

      const correctionLockFields = isBeingCorrectedFromBadVisit ? {
        location_correction_locked_until:  new Date(nowET.getTime() + 30 * 60 * 1000).toISOString(),
        location_correction_previous_id:   result.stored_location_id,
        location_correction_corrected_id:  result.truthId || null,
        location_correction_reason:        'fix_locations_correction',
        location_correction_corrected_at:  lockTimestamp,
        last_location_correction_at:       lockTimestamp,
      } : {};

      const staleClears = isBeingCorrectedFromBadVisit ? buildStaleFieldClear() : {};

      const updatePayload = {
        ...result.after,
        resolved_source_reason: result.detail || 'fix_location_repair',
        resolved_last_updated_at: lockTimestamp,
        ...staleClears,
        ...correctionLockFields,
      };

      // Never write these structural fields
      delete updatePayload.current_home_location_id;
      delete updatePayload.current_work_location_id;
      delete updatePayload.occupation_location_id;
      delete updatePayload.traveling_to_location_id;

      try {
        await base44.entities.Character.update(result.character_id, updatePayload);
        written.push({
          ...result,
          correction_lock_written: isBeingCorrectedFromBadVisit,
          stale_fields_cleared:    isBeingCorrectedFromBadVisit,
        });
        if (isBeingCorrectedFromBadVisit) {
          console.log(`[FIX_LOCATIONS] ✓ CORRECTED+LOCKED: ${result.character_name} | from=${result.stored_location_id} → home | lock until ${correctionLockFields.location_correction_locked_until}`);
        } else {
          console.log(`[FIX_LOCATIONS] ✓ SYNCED: ${result.character_name} | ${result.action}`);
        }
      } catch (writeErr) {
        console.error(`[FIX_LOCATIONS] Write failed for ${result.character_name}:`, writeErr.message);
        writeErrors.push({ name: result.character_name, error: writeErr.message });
      }
    }

    console.log(`[FIX_LOCATIONS] WRITE complete | written=${written.length} | valid_skipped=${skipValid.length}`);
    return Response.json({
      dry_run: false,
      corrected_count: written.length,
      corrections: written,
      valid_skipped_count: skipValid.length,
      valid_skipped_items: skipValid.map(r => ({ character_name: r.character_name, detail: r.detail })),
      flagged_count: flagged.length,
      flagged_items: flagged,
      travel_protected_count,
      travel_flagged_count,
      internal_family_count: internalFamilyFiles.length,
      no_change_count: noChange.length,
      write_errors: writeErrors,
      summary: written.length === 0 && flagged.length === 0
        ? `Location check complete. No contradictions found.${skipValid.length > 0 ? ` ${skipValid.length} valid state(s) preserved (jail, temp housing, rabbit-hole home).` : ''}`
        : `${written.length} contradiction${written.length !== 1 ? 's' : ''} repaired.${skipValid.length > 0 ? ` ${skipValid.length} valid state(s) preserved.` : ''}${flagged.length > 0 ? ` ${flagged.length} travel issue${flagged.length !== 1 ? 's' : ''} flagged.` : ''}`,
    });

  } catch (error) {
    console.error('[FIX_LOCATIONS] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});