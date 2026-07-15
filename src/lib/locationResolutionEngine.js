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
import { resolveHousingLocationForCharacter } from '@/lib/resolveHousingLocationForCharacter';
import { isCharacterAsleep as isCharacterAsleepFromUtils, isNPCCharacterType } from '@/lib/sleepUtils';
import { getCharacterSleepState } from '@/lib/characterSleepState';
import { detectUnsupportedFormat } from '@/lib/imageFormatValidator';

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

  // ── LOCATION AVAILABILITY GUARD ────────────────────────────────────────────
  // If the location map is empty or very small and the character has assigned location IDs,
  // this indicates a QUERY FAILURE (not the character being home).
  // In this case, preserve the character's DB-stored presence rather than falling home.
  // This is the primary defense against "location disappeared → character goes home."
  const locationMapSize = Object.keys(locationMap).length;
  const isLocationMapSuspectEmpty = locationMapSize === 0;
  if (isLocationMapSuspectEmpty) {
    // locationMap is completely empty — this is a data loading failure, NOT home truth.
    // Preserve whatever the DB says rather than computing home via fallback.
    const dbStatus = character.resolved_presence_status;
    const dbLocId = character.resolved_current_location_id;
    const dbLocName = character.resolved_current_location_name;
    const dbLocType = character.resolved_location_type;
    const dbSourceReason = character.resolved_source_reason;
    if (dbStatus && dbLocId) {
      // Return DB state as-is with a flag indicating the locationMap was unavailable
      return {
        resolved_current_location_id: dbLocId,
        resolved_current_location_name: dbLocName || 'Location unavailable',
        resolved_location_type: dbLocType || 'unknown',
        resolved_presence_status: dbStatus,
        resolved_source_reason: dbSourceReason || 'location_map_unavailable_preserved_db_state',
        resolved_zone: null,
        location_map_was_empty: true,
      };
    }
    // No DB state either — fall through to normal resolution (will eventually return 'location_unresolved')
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

  // HOSPITALIZATION GUARD: a hospitalized character is physically at the hospital
  // already committed by the authority (resolved_current_location_id). The
  // schedule/visit/home layers below must NOT re-resolve a hospitalized character
  // back to home, work, or school — that is the "Home — Hospitalized" violation.
  // Preserve the committed hospital state so every surface agrees. This mirrors
  // the existing confinement handling for incarcerated/house_arrest above.
  if (character.resolved_presence_status === 'hospitalized') {
    return {
      resolved_current_location_id: character.resolved_current_location_id || null,
      resolved_current_location_name: character.resolved_current_location_name || 'Hospital',
      resolved_location_type: character.resolved_location_type || 'medical',
      resolved_presence_status: 'hospitalized',
      resolved_source_reason: character.resolved_source_reason || 'medical_emergency',
      resolved_zone: null,
    };
  }

  // CALLOUT GUARD: If character has a valid work exception for TODAY, skip ALL work schedule logic.
  // work_exception_status = 'called_out' AND work_exception_date = today (ET) = full bypass.
  // This is the ONLY gate between Presence Truth and Schedule Truth.
  const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;

  if (!hasValidCallout && !isCharacterAsleepFromUtils(character, locationMap)) {
  // LAYER 1: Work schedule — SLEEP GUARD: asleep/napping characters must not be forced to work
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

    // LAST-KNOWN-GOOD PROTECTION: If work location is missing from map but character's DB
    // state says at_work at this exact location, preserve DB state instead of falling home.
    // A temporarily unavailable location record must NOT move a working character home.
    if (!workLocation) {
      const dbSaysAtWorkHere =
        character.resolved_presence_status === 'at_work' &&
        character.resolved_current_location_id === workLocId;
      const scheduleSaysAtWork = isCharacterOnWorkSchedule(character, currentTime);
      if (dbSaysAtWorkHere || scheduleSaysAtWork) {
        return {
          resolved_current_location_id: workLocId,
          resolved_current_location_name: character.resolved_current_location_name || character.occupation_location_name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule_location_temporarily_unavailable',
          resolved_zone: null,
          location_temporarily_unavailable: true,
        };
      }
      continue; // location not in map and not on schedule — skip
    }

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
  // SLEEP PRE-CHECK: if the character is in their sleep window, school must NOT win.
  // Sleep enforcement (Layer 3.5A) runs after this, but we must not send sleeping characters to school.
  if (character.student_status === 'enrolled' && character.education_location_id && !isCharacterAsleepFromUtils(character, locationMap)) {
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
    // LAST-KNOWN-GOOD: school location missing from map but character is enrolled.
    // Do NOT fall home — preserve DB state or show school as temporarily unavailable.
    if (!schoolLocation) {
      const dbSaysAtSchool =
        character.resolved_presence_status === 'at_school' &&
        character.resolved_current_location_id === character.education_location_id;
      if (dbSaysAtSchool) {
        return {
          resolved_current_location_id: character.education_location_id,
          resolved_current_location_name: character.resolved_current_location_name || character.education_location_name || 'School',
          resolved_location_type: 'school',
          resolved_presence_status: 'at_school',
          resolved_source_reason: 'school_schedule_location_temporarily_unavailable',
          resolved_zone: null,
          location_temporarily_unavailable: true,
        };
      }
    }
  }

  // LAYER 2.3: Religious location schedule — members attend during operating hours
  // Commitment level determines attendance frequency:
  //   devout    → attends all open windows
  //   moderate  → attends on days with service hours (uses location operating_hours day presence)
  //   in_name_only → never scheduled there (profile label only)
  if (
    character.religious_location_id &&
    character.religion &&
    character.religion !== 'None' &&
    character.belief_level !== 'in_name_only' &&
    !isCharacterAsleepFromUtils(character, locationMap)
  ) {
    const religiousLoc = locationMap[character.religious_location_id];
    if (religiousLoc) {
      const etTime = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const currentDay = etTime.getDay();
      const currentHour = etTime.getHours();
      const currentMin = etTime.getMinutes();
      const nowMin = currentHour * 60 + currentMin;

      // Check if there is a service/open window for this day
      const dayHours = (religiousLoc.operating_hours || []).filter(h => h.day_of_week === currentDay);
      const isServiceDay = dayHours.length > 0;

      if (isServiceDay) {
        for (const hours of dayHours) {
          if (!hours.open_time || !hours.close_time) continue;
          const [oh, om] = hours.open_time.split(':').map(Number);
          const [ch, cm] = hours.close_time.split(':').map(Number);
          const openMin = oh * 60 + om;
          const closeMin = ch * 60 + cm;
          if (nowMin >= openMin && nowMin < closeMin) {
            // devout always attends; moderate attends on most days
            const shouldAttend = character.belief_level === 'devout' || character.belief_level === 'moderate';
            if (shouldAttend) {
              return {
                resolved_current_location_id: character.religious_location_id,
                resolved_current_location_name: religiousLoc.name || 'Place of Worship',
                resolved_location_type: 'visit',
                resolved_presence_status: 'visiting',
                resolved_source_reason: 'religious_schedule',
                resolved_zone: null,
              };
            }
          }
        }
      }
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

  // LAYER 3: TRAVEL SYSTEM DEPRECATED — TravelSession is NO LONGER authoritative.
  // Characters teleport instantly at scheduled time. No slow transit state.
  // travel_status and TravelSession records must NOT override resolved_current_location_id.
  // Left here as a comment block so dependent imports don't break.
  // DO NOT RE-ENABLE without explicit architectural decision.

  // ── SLEEP ENFORCEMENT: runs before visit/autonomous layers ──────────────────
  // ALL character types — including NPC types — are subject to sleep enforcement.
  //
  // NPC FORCED SLEEP RULE: NPC-type characters (npc_regular, npc_family_member,
  // npc_fictitious, npc) have a forced sleep window. If no explicit sleep_start_time/
  // wake_up_time is set, they default to 00:00–08:00 ET. This is enforced BEFORE
  // social visit, autonomous travel, and home fallback layers.
  //
  // NPC sleep resolves to their own home/sleep/residence location — NOT blindly to
  // VGC Towers. If the NPC lives at VGC Towers, it will resolve there because
  // current_home_location_id points there. If not, it resolves to their actual home.
  const isNPC = isNPCCharacterType(character);

  // Resolve valid sleep home
  const sleepHomeId = resolveSleepHomeId(character, locationMap);
  const sleepHomeLoc = sleepHomeId ? locationMap[sleepHomeId] : null;

  // LAYER 3.5A: SLEEP LOCK — validated sleep only; raw DB sleep is NOT accepted as final truth.
  //
  // For active_created_character: isCharacterSleeping() applies the strict schedule-anchored
  // validator (window + 8h cap + work/school blockers). DB-sleeping alone is NOT sufficient.
  //
  // For NPC types: isCharacterSleeping() uses the existing clock-window approach (unchanged).
  //
  // Work/school resolution: if sleep is invalid because work or school is active,
  // we do NOT fall to home — the work/school layers above (Layer 1, Layer 2) have already
  // returned the correct obligation location. Sleep is simply not inserted here.
  const characterIsSleeping = isCharacterSleeping(character, locationMap);

  // VGC ACTIVE-WINDOW GUARD: VGC Towers NPC residents follow the VGC travel
  // schedule, NOT their individual sleep schedules, during the active travel
  // window (10 AM – 1 AM ET). If the DB says visiting/social_visit and the
  // resident is at a non-home location, the sleep enforcement layer must NOT
  // override it. The VGC travel system is the authority during active hours.
  if (characterIsSleeping && isNPC) {
    const etNow = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = etNow.getHours();
    const inActiveWindow = hour >= 10 || hour < 1; // 10 AM – 1 AM ET
    const isVGCVisit = character.presence_state === 'social_visit' ||
      character.resolved_presence_status === 'visiting';
    const isAwayFromHome = character.resolved_current_location_id &&
      character.resolved_current_location_id !== character.current_home_location_id &&
      character.resolved_current_location_id !== character.home_location_id;

    if (inActiveWindow && isVGCVisit && isAwayFromHome) {
      // VGC travel authority overrides individual sleep clock during active window.
      // Fall through to Layer 3.5D (social visit) which preserves the visiting state.
      // Do NOT insert sleep here.
    } else {
      // Not a VGC traveling resident, or outside active window — sleep applies normally
      const sleepSourceReason = isNPC ? 'npc_forced_sleep_window' : 'home_sleeping';
      if (sleepHomeId) {
        return {
          resolved_current_location_id: sleepHomeId,
          resolved_current_location_name: sleepHomeLoc?.name || 'Home',
          resolved_location_type: 'home',
          resolved_presence_status: 'sleeping',
          resolved_source_reason: sleepSourceReason,
          resolved_zone: null,
          home_resolution_failed: !sleepHomeLoc,
        };
      }
      return {
        resolved_current_location_id: null,
        resolved_current_location_name: 'Unresolved',
        resolved_location_type: 'sleep_unresolved',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: isNPC ? 'npc_forced_sleep_window_no_home' : 'no_valid_sleep_location',
        resolved_zone: null,
        home_resolution_failed: true,
      };
    }
  } else if (characterIsSleeping) {
    const sleepSourceReason = isNPC ? 'npc_forced_sleep_window' : 'home_sleeping';
    if (sleepHomeId) {
      return {
        resolved_current_location_id: sleepHomeId,
        resolved_current_location_name: sleepHomeLoc?.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: sleepSourceReason,
        resolved_zone: null,
        home_resolution_failed: !sleepHomeLoc,
      };
    }
    // Sleeping but no valid home
    return {
      resolved_current_location_id: null,
      resolved_current_location_name: 'Unresolved',
      resolved_location_type: 'sleep_unresolved',
      resolved_presence_status: 'sleeping',
      resolved_source_reason: isNPC ? 'npc_forced_sleep_window_no_home' : 'no_valid_sleep_location',
      resolved_zone: null,
      home_resolution_failed: true,
    };
  }



  // LAYER 3.5D: Social visit — only allowed outside sleep/pre-sleep windows
  const homeIdForVisitCheck = character.current_home_location_id || character.home_location_id;
  const resolvedLocIdForVisit = character.resolved_current_location_id;
  const isAwayFromHome = resolvedLocIdForVisit && resolvedLocIdForVisit !== homeIdForVisitCheck;

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
    // LAST-KNOWN-GOOD: Visit location temporarily missing from map.
    // Preserve the visiting state — DO NOT fall home.
    if (!socialLocation && character.resolved_current_location_name) {
      return {
        resolved_current_location_id: resolvedLocIdForVisit,
        resolved_current_location_name: character.resolved_current_location_name + ' (temporarily unavailable)',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: 'visit_location_temporarily_unavailable',
        resolved_zone: null,
        location_temporarily_unavailable: true,
      };
    }
  }

  // PHASE 4: RESOLVE HOME BASE (TEMPORARY HOUSING PRIORITY)
  let resolvedHomeId = null;

  if (character.is_temporarily_housed === true && character.temporary_housing_location_id) {
    resolvedHomeId = character.temporary_housing_location_id;
  } else {
    resolvedHomeId = character.current_home_location_id || character.home_location_id || null;
  }

  // LAYER 7+: Use housing resolver as ONLY source of truth for all home logic
  // CRITICAL: Preserve home_resolution_failed flag to distinguish lookup failures from true homelessness
  const housing = resolveHousingLocationForCharacter(character, locationMap);

  // LAST-KNOWN-GOOD PROTECTION: If home ID exists but location record not in map,
  // this is a TEMPORARY DATA UNAVAILABILITY — not proof the character is homeless or elsewhere.
  // Return a location_temporarily_unavailable marker rather than falling through to homeless/hotel logic.
  if (housing.home_resolution_failed === true && housing.housing_location_id) {
    return {
      resolved_current_location_id: housing.housing_location_id,
      resolved_current_location_name: character.resolved_current_location_name || 'Home (temporarily unavailable)',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'home_location_temporarily_unavailable',
      resolved_zone: null,
      home_resolution_failed: true,
      location_temporarily_unavailable: true,
    };
  }
  
  if (housing.housing_location_id && !housing.home_resolution_failed) {
    return {
      resolved_current_location_id: housing.housing_location_id,
      resolved_current_location_name: housing.housing_location_name || 'Home',
      resolved_location_type: housing.housing_context === 'stable_home' ? 'home' : 'visit',
      resolved_presence_status: housing.housing_context === 'stable_home' ? 'home' : 'visiting',
      resolved_source_reason: housing.source_reason,
      resolved_zone: null,
      home_resolution_failed: housing.home_resolution_failed,
    };
  }

  // PHASE 3B: TEMPORARY HOUSING ASSIGNMENT (RUNTIME ONLY, READ-ONLY)
  // Trigger: no home found + assignment eligible + no lookup failure
  // Queries pre-created system locations — does NOT create, does NOT persist
  if (
    housing.housing_location_id === null &&
    housing.may_assign_temporary_housing === true &&
    housing.home_resolution_failed === false &&
    character.owner_email
  ) {
    const balance = character.current_balance ?? 6000;

    // Find pre-created hotel location
    const hotelLocation = Object.values(locationMap).find(
      loc => loc.owner_email === character.owner_email &&
             loc.is_system_managed === true &&
             loc.system_location_role === 'temporary_hotel'
    );

    // Find pre-created shelter location
    const shelterLocation = Object.values(locationMap).find(
      loc => loc.owner_email === character.owner_email &&
             loc.is_system_managed === true &&
             loc.system_location_role === 'emergency_shelter'
    );

    // Use hotel if balance >= 150 AND hotel exists
    const tempLocation = (balance >= 150 && hotelLocation) ? hotelLocation : shelterLocation;

    if (tempLocation) {
      return {
        resolved_current_location_id: tempLocation.id,
        resolved_current_location_name: tempLocation.name || 'Temporary Housing',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'temporary_housing_assignment',
        resolved_zone: null,
        is_temporary_housing: true,
      };
    }
  }

  // No schedule/travel/visit matched — fall back to home base
  // CRITICAL: Do NOT use resolved_current_location_id (stale location). 
  // Compute home base fresh via housing resolver.
  const housingFallback = resolveHousingLocationForCharacter(character, locationMap);
  
  if (housingFallback.housing_location_id) {
    // Home base found (temporary or permanent)
    return {
      resolved_current_location_id: housingFallback.housing_location_id,
      resolved_current_location_name: housingFallback.housing_location_name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'fallback_to_home_base',
      resolved_zone: null,
      home_resolution_failed: housingFallback.home_resolution_failed,
    };
  }

  // No home base found — active_created_character must never use rabbit_hole
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Unresolved',
    resolved_location_type: 'location_unresolved',
    resolved_presence_status: 'location_unresolved',
    resolved_source_reason: 'no_valid_home_or_temporary_location',
    resolved_zone: null,
  };
}

/**
 * Check if a character is currently on shift based on location worker_shifts data
 * Handles overnight shifts (e.g. 17:00–01:00)
 */
function isOnShiftNow(shift, currentTime = new Date()) {
  if (!shift?.start || !shift?.end) return false;
  // CRITICAL: Convert to Eastern Time
  const etTime = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const today = etTime.getDay();
  const yesterday = (today + 6) % 7;
  const [startH, startM] = shift.start.split(':').map(Number);
  const [endH, endM] = shift.end.split(':').map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;
  const hasDays = shift.days && shift.days.length > 0;

  // Overnight shift (e.g. 17:00 -> 01:00): shift starts on a work day and ends after midnight.
  // On shift if: today is a work day AND time >= start (e.g. Fri 5 PM -> midnight)
  //           OR yesterday was a work day AND time < end (e.g. Fri 12 AM -> 1 AM, from Thu shift)
  if (endMin < startMin) {
    const afterStartToday = (!hasDays || shift.days.includes(today)) && now >= startMin;
    const beforeEndYesterday = (!hasDays || shift.days.includes(yesterday)) && now < endMin;
    return afterStartToday || beforeEndYesterday;
  }

  // Same-day shift
  if (hasDays && !shift.days.includes(today)) return false;
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

  // CRITICAL: Convert to Eastern Time
  const etTime = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const now = etTime.getTime();
  const dayOfWeek = etTime.getDay();
  const isWorkDay = character.work_days.includes(dayOfWeek);
  
  if (!isWorkDay) {
    return { onSchedule: false, inPrepWindow: false, minutesUntilWork: null };
  }

  const [workStartHour, workStartMin] = character.work_start_time.split(':').map(Number);
  const [workEndHour, workEndMin] = character.work_end_time.split(':').map(Number);
  
  const workStartMs = new Date(etTime).setHours(workStartHour, workStartMin, 0, 0);
  const workEndMs = new Date(etTime).setHours(workEndHour, workEndMin, 0, 0);

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
 * Valid sleep location categories
 */
const VALID_SLEEP_CATEGORIES = new Set(['home', 'hotel', 'shelter', 'generic']);

function isValidSleepCategory(location) {
  if (!location) return false;
  return VALID_SLEEP_CATEGORIES.has(location.category || '');
}

function resolveSleepHomeId(character, locationMap) {
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

const PRE_SLEEP_WINDOW_MINUTES = 60;

function isInPreSleepReturnWindow(character, currentTime) {
  if (!character.sleep_start_time) return false;
  const etTime = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = character.sleep_start_time.split(':').map(Number);
  const sleepStart = sh * 60 + sm;
  const windowStart = (sleepStart - PRE_SLEEP_WINDOW_MINUTES + 1440) % 1440;
  if (windowStart > sleepStart) return now >= windowStart || now < sleepStart;
  return now >= windowStart && now < sleepStart;
}

/**
 * Check if character is sleeping.
 * SINGLE SOURCE OF TRUTH: delegates to sleepUtils.isCharacterAsleep
 * so locationResolutionEngine and UI use identical logic.
 */
function isCharacterSleeping(character, locationMap) {
  return isCharacterAsleepFromUtils(character, locationMap);
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

  // Sleep state — ONE TRUTH RULE.
  // Must use the SAME source as resolveCharacterLocation / Travel page:
  //   1. DB field (resolved_presence_status === 'sleeping'/'napping') — written by enforce systems
  //   2. Schedule window via isCharacterAsleepFromUtils — same fn as resolveCharacterLocation uses
  //
  // If EITHER is true, the character IS sleeping. The home/location branches must NOT win.
  // This closes the gap where DB says 'home' but schedule says sleep window is active.
  // Sleep display: use the same validated resolver that resolveCharacterLocation uses.
  // For active_created_character: isCharacterAsleepFromUtils applies the strict
  // schedule-anchored validator — raw DB sleeping is NOT accepted without window validation.
  // For NPCs: clock-window approach unchanged.
  // ── SLEEP/REST DETECTION: SINGLE AUTHORITATIVE TRUTH ──────────────────────
  // Delegates to getCharacterSleepState — the SAME validator used by AlarmTool and
  // ChatHeader. Eliminates split truth: every sleep consumer reads one source.
  // For active_created_character, DB sleeping/napping is accepted ONLY when window +
  // cap + blocker validation passes. For NPCs, DB truth is accepted. resting is a
  // low-energy home state trusted from DB (no window required).
  const sleepState = getCharacterSleepState(character, locationMap);

  if (sleepState.isSleeping) {
    return { status: 'sleeping', label: 'Sleeping', sublabel: locName, isTransit: false, isSleeping: true };
  }
  if (sleepState.isNapping) {
    return { status: 'napping', label: 'Napping', sublabel: locName, isTransit: false, isSleeping: true };
  }
  if (presenceStatus === 'resting') {
    return { status: 'resting', label: 'Resting', sublabel: locName, isTransit: false, isSleeping: true };
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
  // Hunger critical is a derived state — it must NOT override a confirmed presence like home/visiting/work/school.
  // Only show "Looking for food" if no other authoritative presence exists.
  if (hungerCritical && !locName && presenceStatus !== 'home' && presenceStatus !== 'at_work' && presenceStatus !== 'at_school') {
    return { status: 'hunger_critical', label: 'Looking for food', sublabel: locName, isTransit: false, isSleeping: false };
  }

  // ── PRIORITY 1.5: RABBIT HOLE ─────────────────────────────────────────────
  if (character.resolved_presence_status === 'rabbit_hole' || character.is_rabbit_hole === true) {
    const label = character.rabbit_hole_label || character.resolved_current_location_name || 'Off-screen';
    return { status: 'rabbit_hole', label, sublabel: character.rabbit_hole_subtype || null, isTransit: false, isSleeping: false };
  }

  // ── PRIORITY 2: TRANSIT STATE — DEPRECATED ────────────────────────────────
  // TravelSession is no longer authoritative. Characters teleport at scheduled time.
  // Do NOT show "Traveling to…" — characters are at their current_location_id, period.
  // If presence_status is 'traveling', it is stale — fall through to current location display.

  // ── ONE TRUTH: live schedule-anchored resolution ───────────────────────────
  // The committed resolved_presence_status is authoritative ONLY insofar as the resolver
  // recomputes it from the actual schedule. A stale DB field left by an automation that
  // hasn't run (e.g. sleeping through a shift, at_work after a shift ended) must NOT override
  // the live schedule. resolveCharacterLocation is the single resolver shared with the Travel
  // page — Home/Chat/Travel read one truth. (Sleep/napping/resting/rabbit_hole/blocking states
  // were already handled above via getCharacterSleepState + committed crisis flags.)
  const resolved = resolveCharacterLocation(character, locationMap);
  const liveStatus = resolved.resolved_presence_status;
  const liveLocId = resolved.resolved_current_location_id;
  const liveLoc = liveLocId ? locationMap[liveLocId] : null;
  const liveLocName = resolved.resolved_current_location_name || liveLoc?.name || locName;

  if (liveStatus === 'at_work') {
    return { status: 'at_work', label: 'At work', sublabel: liveLocName || character.occupation_location_name || 'Work', isTransit: false, isSleeping: false };
  }
  if (liveStatus === 'at_school') {
    const schoolLoc = locationMap[character.education_location_id];
    return { status: 'at_school', label: 'At school', sublabel: schoolLoc?.name || liveLocName || 'School', isTransit: false, isSleeping: false };
  }
  if (liveStatus === 'visiting') {
    return { status: 'visiting', label: `At ${liveLocName}`, sublabel: null, isTransit: false, isSleeping: false };
  }
  if (liveStatus === 'home') {
    const hasHome = !!(character.current_home_location_id || character.home_location_id);
    if (hasHome) {
      return { status: 'home', label: 'At home', sublabel: liveLocName, isTransit: false, isSleeping: false };
    }
  }

  // ── FALLBACK — last confirmed location ────────────────────────────────────
  // RULE: Only display a location name if resolved_current_location_id exists AND a name is available.
  // If neither exists, show Away — never Nearby, never stale location, never Home.
  const hasValidLocation = !!liveLocId && !!liveLocName;
  return hasValidLocation
    ? { status: 'at_location', label: `At ${liveLocName}`, sublabel: null, isTransit: false, isSleeping: false }
    : { status: 'away', label: 'Away', sublabel: 'No valid location assigned', isTransit: false, isSleeping: false };
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

  // ── IMAGE MODE: Check for unsupported zone image formats ──────────────────────
  // If zone has ONLY AVIF/HEIC (no fallback JPEGs), log diagnostic but do NOT fail silently.
  if (imageMode && locId) {
    const location = locationMap[locId];
    if (location?.zones && Array.isArray(location.zones)) {
      const zone = location.zones.find(z => z.image_urls?.length > 0);
      if (zone?.image_urls) {
        const unsupportedCount = zone.image_urls.filter(url => detectUnsupportedFormat(url)).length;
        const totalCount = zone.image_urls.length;
        if (unsupportedCount === totalCount && totalCount > 0) {
          // All images are unsupported formats — diagnostic notice
          console.warn(`[buildLiveLocationContext] Zone "${zone.zone_name}" at "${locName}" has ONLY unsupported formats (${totalCount}x ${zone.image_urls.map(u => detectUnsupportedFormat(u)).filter(Boolean).join('/')}).\n  Recovery: Admin should re-upload with JPEG/PNG, or use fallback location images.`);
        }
      }
    }
  }

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
      if (imageMode) return `[LOCATION LOCKED: venue closed — character is heading home or at home, use residential/transit context]`;
      return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): The venue ${locName ? `"${locName}"` : 'you work at'} is now CLOSED. You are no longer on-site — you have finished your shift and are either heading home or already home. Speak in past tense about work. Do NOT describe yourself as still at the venue.`;
    }

    // ── SHIFT PHASE INJECTION ─────────────────────────────────────────────
    // Compute how far into the shift the character is so the LLM speaks accordingly.
    let shiftPhaseNote = '';
    if (!imageMode && character.work_start_time && character.work_end_time) {
      const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
      const [sh, sm] = character.work_start_time.split(':').map(Number);
      const [eh, em] = character.work_end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin   = eh * 60 + em;
      const isOvernight = endMin < startMin;
      let elapsedMin;
      if (isOvernight && nowMin < endMin) {
        elapsedMin = (1440 - startMin) + nowMin;
      } else {
        elapsedMin = nowMin - startMin;
      }
      const totalShiftMin = isOvernight ? (1440 - startMin) + endMin : endMin - startMin;
      const remainingMin  = Math.max(0, totalShiftMin - elapsedMin);
      if (elapsedMin >= 0 && totalShiftMin > 0) {
        const pct = elapsedMin / totalShiftMin;
        const elapsedHrs = Math.floor(elapsedMin / 60);
        const elapsedMinsRem = elapsedMin % 60;
        const remHrs = Math.floor(remainingMin / 60);
        const remMinsRem = remainingMin % 60;
        const elapsedStr   = elapsedHrs > 0 ? `${elapsedHrs}h ${elapsedMinsRem}m` : `${elapsedMinsRem}m`;
        const remainingStr = remHrs > 0 ? `${remHrs}h ${remMinsRem}m` : `${remMinsRem}m`;
        if (pct >= 0.85) {
          shiftPhaseNote = ` You have been here for ${elapsedStr} and have about ${remainingStr} left — you are NEARLY DONE with this shift. Speak like someone wrapping up, not someone just arriving.`;
        } else if (pct >= 0.65) {
          shiftPhaseNote = ` You are in the late portion of your shift — ${elapsedStr} in, ${remainingStr} to go.`;
        } else if (pct >= 0.40) {
          shiftPhaseNote = ` You are mid-shift — ${elapsedStr} in, ${remainingStr} remaining.`;
        } else if (pct >= 0.15) {
          shiftPhaseNote = ` You are in the early portion of your shift — ${elapsedStr} in.`;
        }
        // Expiry note for stale "just arrived" phrasing
        if (elapsedMin >= 60) {
          shiftPhaseNote += ` Any earlier message saying "walking in" or "just got here" is now ${elapsedStr} stale — do NOT repeat it as current truth.`;
        }
      }
    }

    if (imageMode) return `[LOCATION LOCKED: character is at work at ${locName || 'their workplace'} — use that work environment as background]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently AT WORK at ${locName || 'your workplace'}. All location references must match this environment.${shiftPhaseNote}`;
  }

  // ── AT SCHOOL ─────────────────────────────────────────────────────────────
  if (presence === 'at_school') {
    if (imageMode) return `[LOCATION LOCKED: character is at school/class — use school/campus environment]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently AT SCHOOL${locName ? ` (${locName})` : ''}. All location references must match this.`;
  }

  // ── TRAVELING — DEPRECATED ────────────────────────────────────────────────
  // Travel state is no longer a valid presence. Characters are always at their current location.
  // If presence = 'traveling', fall through to location name below (treat as at_location).

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