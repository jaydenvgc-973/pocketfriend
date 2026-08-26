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
  // the character's authoritative effective home, reject the stale state
  // immediately and return the correct home — or flag it if the home is not in the map.
  // VACATION MODE: When vacation_mode is ON and a Vacation Home is designated, the
  // Vacation Home IS the effective home — not the permanent home. The permanent home
  // temporarily loses effective-home authority. This guard must recognize the Vacation
  // Home so it does not "correct" a character at the Vacation Home back to permanent home.
  const trueHomeId = (character.vacation_mode === true && character.vacation_home_location_id)
    ? character.vacation_home_location_id
    : (character.current_home_location_id || character.home_location_id);
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

  // GATHERING ROOM GUARD: If the character is in a Gathering Room (indicated by
  // resolved_source_reason === 'gathering_room'), return that location immediately.
  // This integrates Gathering Room presence into the existing canonical location
  // authority without creating a second resolver. The backend function
  // (admitToGatheringRoom) sets these fields on the character's own account record.
  // When the session ends (exit/expire), the backend clears resolved_source_reason
  // and the resolver recomputes the character's real location (home, work, etc.).
  // Foreign characters' Gathering Room presence is NEVER injected into another
  // account's resolver — each account only reads its own Character records.
  if (character.resolved_source_reason === 'gathering_room' && character.resolved_current_location_id) {
    return {
      resolved_current_location_id: character.resolved_current_location_id,
      resolved_current_location_name: character.resolved_current_location_name || 'Gathering Room',
      resolved_location_type: character.resolved_location_type || 'visit',
      resolved_presence_status: character.resolved_presence_status || 'visiting',
      resolved_source_reason: 'gathering_room',
      resolved_zone: null,
    };
  }

  // STORY EVENT VENUE GUARD: If the character's committed location is a Story
  // Event venue (resolved_source_reason === 'story_event_venue'), preserve it.
  // During the active Story Event window, the venue is the authoritative
  // current location — work/school/home layers must NOT override it. This
  // mirrors the Gathering Room guard: the backend (enforceCharacterLocationPresence)
  // commits the venue during the active window, and the frontend preserves it.
  // When the event ends, the backend commits a new state (resolved_source_reason
  // changes to 'home'/'work'/etc.) and this guard no longer matches, so the
  // character's location reverts to the app's existing authoritative logic.
  // STORY EVENT VENUE GUARD: preserve the committed Story Event venue only while
  // the Story Event is temporally active. The backend sets story_event_venue_until
  // to the event's end time. If the current time is past that, the committed venue
  // is stale and must NOT override the current authoritative location — fall
  // through to normal resolution (work/school/home/etc.).
  if (character.resolved_source_reason === 'story_event_venue' &&
      character.resolved_current_location_id &&
      character.story_event_venue_until &&
      Date.now() < new Date(character.story_event_venue_until).getTime()) {
    return {
      resolved_current_location_id: character.resolved_current_location_id,
      resolved_current_location_name: character.resolved_current_location_name || 'Story Event',
      resolved_location_type: character.resolved_location_type || 'visit',
      resolved_presence_status: character.resolved_presence_status || 'visiting',
      resolved_source_reason: 'story_event_venue',
      resolved_zone: null,
    };
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

  // INVITED-TO-SCENE GUARD: When a character accepts an invitation and arrives
  // at a scene (inviteCharacterToLocation sets resolved_source_reason =
  // 'invited_to_scene'), the work/school/home layers below must NOT override
  // that committed location. The LLM in inviteCharacterToLocation already
  // evaluated the character's work/sleep state before deciding "coming_now" —
  // the decision to leave work or come from home was made there. This guard
  // ensures the arrived character propagates through the shared presence
  // pathway (resolveTravelPresenceEntities → getPresenceAtLocation →
  // Who's Here roster) on ALL accounts, identically. The guard is naturally
  // cleared when another system (user travel, sleep, work schedule) updates
  // the character's resolved_source_reason to something else.
  if (character.resolved_source_reason === 'invited_to_scene' &&
      character.resolved_presence_status === 'visiting' &&
      character.resolved_current_location_id) {
    return {
      resolved_current_location_id: character.resolved_current_location_id,
      resolved_current_location_name: character.resolved_current_location_name || 'Scene',
      resolved_location_type: character.resolved_location_type || 'visit',
      resolved_presence_status: 'visiting',
      resolved_source_reason: 'invited_to_scene',
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

  // WORK-SHIFT LOCK GUARD: An active work_shift presence lock is an authority,
  // BUT only if the character is actually on shift right now. A stale lock
  // (left by an automation that hasn't run work-end yet) must NOT keep showing
  // "at_work" after the shift has ended. Verify against BOTH location-level
  // worker_shifts AND character-level schedule — it is not either/or.
  // VACATION MODE: When vacation_mode is ON, the character is exempt from work
  // schedule enforcement. Skip the work-shift lock guard AND LAYER 1 (work
  // schedule) so the resolver does not place the character at work based on
  // schedule or lock. The character remains free to be at work through normal
  // travel (social visit, user travel) — Vacation Mode only exempts schedule
  // enforcement, it does not restrict where the character can go.
  const _vacationMode = character.vacation_mode === true;
  const _hasActiveWorkLock = !_vacationMode && character.presence_stay_lock === true &&
    (character.presence_stay_lock_reason === 'work_shift' ||
      character.presence_stay_lock_authority === 'enforceCharacterWorkSchedule');
  if (_hasActiveWorkLock && _isCharacterCurrentlyOnAnyShift(character, locationMap, currentTime)) {
    const _workLocName = character.resolved_current_location_name ||
      character.occupation_location_name ||
      (character.work_details && character.work_details.workplace_type) || 'Work';
    return {
      resolved_current_location_id: character.resolved_current_location_id || null,
      resolved_current_location_name: _workLocName,
      resolved_location_type: 'work',
      resolved_presence_status: 'at_work',
      resolved_source_reason: 'work_shift_lock_authority',
      resolved_zone: null,
    };
  }

  if (!hasValidCallout && !isCharacterAsleepFromUtils(character, locationMap) && !_vacationMode) {
  // LAYER 1: Work schedule — ordered evaluation matching enforceCharacterWorkSchedule.
  // Build ONE ordered employment sequence: primary first, then additional in
  // stored order. Each entry is linked or rabbit-hole. Evaluation proceeds in
  // this order so job priority follows the stored order — rabbit-hole jobs
  // never take artificial priority over linked jobs.
  // Stale-location correction: for an explicitly configured rabbit-hole primary,
  // do NOT fall back to current_work_location_id — that field may be stale from
  // a previous linked occupation. For non-rabbit-hole legacy occupations, existing
  // behavior (including current_work_location_id fallback) remains unchanged.
  // One Truth safeguard: the is_rabbit_hole flag is the authority for
  // rabbit-hole classification. A stale occupation_location_id from a former
  // linked job must NOT prevent the active rabbit-hole employment from being
  // recognized. Rabbit-hole employment always wins over obsolete workplace
  // identifiers.
  const _isPrimaryRH = character.work_details?.is_rabbit_hole === true;
  const _primaryLocId = _isPrimaryRH
    ? null
    : (character.occupation_location_id || character.current_work_location_id || null);
  const _orderedWorkJobs = [];
  if (_primaryLocId) {
    _orderedWorkJobs.push({ type: 'linked', locId: _primaryLocId });
  } else if (_isPrimaryRH && character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    _orderedWorkJobs.push({
      type: 'rabbit_hole',
      workplaceName: character.occupation_location_name,
      shift: { start: character.work_start_time, end: character.work_end_time, days: character.work_days },
    });
  }
  if (Array.isArray(character.additional_occupation_locations)) {
    for (const entry of character.additional_occupation_locations) {
      if (entry.location_id) {
        _orderedWorkJobs.push({ type: 'linked', locId: entry.location_id });
      } else {
        const isRH = entry.is_rabbit_hole === true;
        if (isRH && entry.shift_start && entry.shift_end) {
          _orderedWorkJobs.push({
            type: 'rabbit_hole',
            workplaceName: entry.location_name,
            shift: { start: entry.shift_start, end: entry.shift_end, days: entry.work_days || null },
          });
        }
      }
    }
  }
  for (const job of _orderedWorkJobs) {
    if (job.type === 'linked') {
      const workLocation = locationMap[job.locId];
      if (!workLocation) {
        // LAST-KNOWN-GOOD: missing linked record is an error condition, NOT a rabbit-hole inference.
        const dbSaysAtWorkHere =
          character.resolved_presence_status === 'at_work' &&
          character.resolved_current_location_id === job.locId;
        const scheduleSaysAtWork = isCharacterOnWorkSchedule(character, currentTime);
        if (dbSaysAtWorkHere || scheduleSaysAtWork) {
          return {
            resolved_current_location_id: job.locId,
            resolved_current_location_name: character.resolved_current_location_name || character.occupation_location_name || 'Work',
            resolved_location_type: 'work',
            resolved_presence_status: 'at_work',
            resolved_source_reason: 'work_schedule_location_temporarily_unavailable',
            resolved_zone: null,
            location_temporarily_unavailable: true,
          };
        }
        continue;
      }
      if (isLocationOpen(workLocation, currentTime) === false) continue;
      const locationShift = workLocation.worker_shifts?.[character.id];
      if (locationShift) {
        if (isOnShiftNow(locationShift, currentTime)) {
          return {
            resolved_current_location_id: job.locId,
            resolved_current_location_name: workLocation.name || 'Work',
            resolved_location_type: 'work',
            resolved_presence_status: 'at_work',
            resolved_source_reason: 'work_schedule',
            resolved_zone: null,
          };
        }
        continue;
      }
      if (isCharacterOnWorkSchedule(character, currentTime)) {
        return {
          resolved_current_location_id: job.locId,
          resolved_current_location_name: workLocation.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
          resolved_zone: null,
        };
      }
    } else {
      if (isOnShiftNow(job.shift, currentTime)) {
        return {
          resolved_current_location_id: 'rabbit_hole',
          resolved_current_location_name: job.workplaceName || 'Off-screen',
          resolved_location_type: 'rabbit_hole',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'rabbit_hole_work_schedule',
          resolved_zone: null,
        };
      }
    }
  }

  } // end if (!hasValidCallout) — work schedule block

  // LAYER 2: Check school schedule
  // SLEEP PRE-CHECK: if the character is in their sleep window, school must NOT win.
  // Sleep enforcement (Layer 3.5A) runs after this, but we must not send sleeping characters to school.
  // VACATION MODE: skip school schedule enforcement when vacation_mode is ON.
  if (character.student_status === 'enrolled' && character.education_location_id && !isCharacterAsleepFromUtils(character, locationMap) && !_vacationMode) {
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

  // ── RABBIT HOLE PRESERVATION (late) ────────────────────────────────────────
  // Runs AFTER confinement, hospitalization, work schedule, school schedule,
  // sleep enforcement, and social-visit layers. A rabbit hole is a valid
  // canonical location ID — NOT a failed lookup. If no higher authority has
  // claimed the character by this point, preserve the committed rabbit hole
  // state. Does NOT invent a presence status — preserves the actual committed
  // one. Does NOT reference is_rabbit_hole (not a Character field).
  if (character.resolved_current_location_id === 'rabbit_hole' ||
      character.resolved_location_type === 'rabbit_hole') {
    return {
      resolved_current_location_id: 'rabbit_hole',
      resolved_current_location_name: character.resolved_current_location_name || 'Off-screen',
      resolved_location_type: character.resolved_location_type || 'rabbit_hole',
      resolved_presence_status: character.resolved_presence_status || 'visiting',
      resolved_source_reason: character.resolved_source_reason || 'rabbit_hole',
      resolved_zone: null,
    };
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
 * Check if a character is currently on shift by checking BOTH:
 * 1. Character-level schedule (work_start_time, work_end_time, work_days)
 * 2. Location-level worker_shifts (for linked jobs with location IDs)
 * 3. Rabbit-hole job shifts (from additional_occupation_locations)
 *
 * The work lock must be able to read BOTH — it is not either/or.
 * A stale presence_stay_lock must NOT show "at_work" after the shift has ended.
 */
function _isCharacterCurrentlyOnAnyShift(character, locationMap = {}, currentTime = new Date()) {
  const etTime = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  // 1. Character-level schedule
  if (isCharacterOnWorkSchedule(character, etTime)) return true;

  // 2. Location-level worker_shifts + rabbit-hole job shifts
  const _isPrimaryRH = character.work_details?.is_rabbit_hole === true;

  // Primary linked job
  if (!_isPrimaryRH) {
    const _primaryLocId = character.occupation_location_id || character.current_work_location_id || null;
    if (_primaryLocId) {
      const loc = locationMap[_primaryLocId];
      if (loc) {
        const shift = loc.worker_shifts?.[character.id];
        if (shift && isOnShiftNow(shift, etTime)) return true;
      }
    }
  }

  // Primary rabbit-hole job (character-level schedule)
  if (_isPrimaryRH && character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    if (isOnShiftNow({ start: character.work_start_time, end: character.work_end_time, days: character.work_days }, etTime)) return true;
  }

  // Additional occupation locations
  if (Array.isArray(character.additional_occupation_locations)) {
    for (const entry of character.additional_occupation_locations) {
      if (entry.location_id) {
        const loc = locationMap[entry.location_id];
        if (loc) {
          const shift = loc.worker_shifts?.[character.id];
          if (shift && isOnShiftNow(shift, etTime)) return true;
        }
      } else if (entry.is_rabbit_hole === true && entry.shift_start && entry.shift_end) {
        if (isOnShiftNow({ start: entry.shift_start, end: entry.shift_end, days: entry.work_days || null }, etTime)) return true;
      }
    }
  }

  return false;
}

/**
 * Valid sleep location — capability-based, not just top-level category.
 * A location is sleep-eligible if its category is inherently sleep-permitting
 * OR it contains a sleep-permitting environment (residential or community).
 * Mirrors isValidSleepLocation in enforceCharacterLocationPresence.
 */
const VALID_SLEEP_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'generic',
  'jail_prison', 'transportation',
]);
const SLEEP_PERMITTING_ENV_TYPES = new Set(['residential', 'community']);

function isValidSleepCategory(location) {
  if (!location) return false;
  // Category-based eligibility
  if (VALID_SLEEP_CATEGORIES.has(location.category || '')) return true;
  // Environment-based eligibility (multi-use locations with residential/community env)
  if (Array.isArray(location.environments)) {
    for (const env of location.environments) {
      if (SLEEP_PERMITTING_ENV_TYPES.has(env.type)) return true;
    }
  }
  return false;
}

function resolveSleepHomeId(character, locationMap) {
  // VACATION HOME AUTHORITY: When Vacation Mode is ON and a Vacation Home is designated,
  // the Vacation Home is the authoritative sleep location — not the permanent home.
  // Mirrors resolveValidSleepLocationId in enforceCharacterLocationPresence.
  if (character.vacation_mode === true && character.vacation_home_location_id && locationMap[character.vacation_home_location_id]) {
    return character.vacation_home_location_id;
  }
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
  // WORK-SHIFT LOCK AUTHORITY: An active work_shift lock means the character
  // IS at work — BUT only if the character is actually on shift right now.
  // A stale lock must NOT keep showing "at_work" after the shift has ended.
  // Verify against BOTH location-level worker_shifts AND character-level schedule.
  if (character.presence_stay_lock === true &&
    (character.presence_stay_lock_reason === 'work_shift' ||
     character.presence_stay_lock_authority === 'enforceCharacterWorkSchedule') &&
    _isCharacterCurrentlyOnAnyShift(character, locationMap)) {
    const _workName = character.resolved_current_location_name ||
      character.occupation_location_name || 'Work';
    return { status: 'at_work', label: 'At work', sublabel: _workName, isTransit: false, isSleeping: false };
  }

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

  // ── WORK-SHIFT LOCK AUTHORITY ─────────────────────────────────────────────
  // An active work_shift lock means the character IS at work. This must be
  // checked BEFORE sleep/rabbit-hole/home — the lock is the inviolable authority.
  if (character.presence_stay_lock === true &&
    (character.presence_stay_lock_reason === 'work_shift' ||
     character.presence_stay_lock_authority === 'enforceCharacterWorkSchedule')) {
    const _workName = locName || character.occupation_location_name || 'their workplace';
    if (imageMode) return `[LOCATION LOCKED: character is at work at ${_workName} — use that work environment as background]`;
    return `\n\nLOCATION TRUTH (SYSTEM-LOCKED at ${timeStr}): You are currently AT WORK at ${_workName}. All location references must match this environment. You are NOT at home.`;
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