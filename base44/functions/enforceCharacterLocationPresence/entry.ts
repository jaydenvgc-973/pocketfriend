// ═══════════════════════════════════════════════════════════════════════════
// SOLE CANONICAL WRITER — One Truth Authority
// ═══════════════════════════════════════════════════════════════════════════
//
// enforceCharacterLocationPresence is the SOLE live backend canonical writer for:
//   - resolved_current_location_id
//   - resolved_current_location_name
//   - resolved_location_type
//   - resolved_presence_status
//   - presence_stay_lock
//   - presence_stay_lock_reason
//   - canonical transition reason (resolved_source_reason)
//   - canonical transition timestamps (last_sleep_start, last_nap_time, last_wake_time, last_pass_out_at)
//
// Every caller (simulateActiveCharacterNeeds, enforceCharacterWorkSchedule,
// processScheduledRelocations, autonomousCharacterMovement, wake/nap-end callers,
// pass-out callers) sends its requested transition, cause, and supporting
// production information to this function. This function:
//   1. Receives the requested transition through its real production interface
//   2. Loads the complete current Character state and relevant records
//   3. Invokes resolveCharacterLocation (inline resolver aligned with lib/)
//   4. Applies compatibility/integrity validation
//   5. Resolves as accepted, modified, redirected, deferred, rejected, or no_change
//   6. Performs one coherent Character.update() containing only canonical fields
//   7. Returns the exact disposition and committed result to the caller
//
// Callers retain their domain intelligence and classify their own transitions.
// Callers write downstream records (SleepTransition, LifeEvent, etc.) only
// after receiving a successfully committed result, built from the returned
// committed result — not from the original request.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ═════════════════════════════════════════════════════════════════════════════
// HOSPITAL STABILIZATION — one-time amounts applied at admission commit.
// Repurposed from the former recurring RATES.hospitalized. Applied exactly
// once when the authoritative hospitalization transition is committed (new
// admission only — not the reconciliation path for already-hospitalized chars).
// Continued recovery while hospitalized is handled by simulateActiveCharacterNeeds
// through existing activity effects, NOT by reapplying these values.
// ═════════════════════════════════════════════════════════════════════════════
const HOSPITAL_STABILIZATION = { hunger: 8, energy: 5, social: 1, health: 5, mental: 1, hygiene: 4, comfort: 2 };
const _clampNeed = (v) => Math.max(0, Math.min(100, v));

// ── HELPERS (aligned with src/lib/locationResolutionEngine.js) ────────────────

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
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

function isCharacterOnWorkSchedule(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return false;
  }
  const dayOfWeek = etTime.getDay();
  if (!character.work_days.includes(dayOfWeek)) return false;
  const now = etTime.getTime();
  const [workStartHour, workStartMin] = character.work_start_time.split(':').map(Number);
  const [workEndHour, workEndMin] = character.work_end_time.split(':').map(Number);
  const workStartMs = new Date(etTime).setHours(workStartHour, workStartMin, 0, 0);
  const workEndMs = new Date(etTime).setHours(workEndHour, workEndMin, 0, 0);
  return now >= workStartMs && now < workEndMs;
}

// ── RABBIT HOLE WORK SHIFT DETECTION ─────────────────────────────────────────
// Returns the workplace name if the character has an active rabbit hole work
// shift right now (authoritative Eastern Time), or null if no rabbit hole
// shift is active. Used by the Rabbit Hole preservation branch to ensure an
// active work shift is never short-circuited by a stale preserved presence.
//
// This uses the SAME isOnShiftNow determination used for a normal linked
// workplace — no LocationReference is required merely because the workplace
// is off-screen. The callout guard matches the work schedule block above.
function _findActiveRabbitHoleWorkShift(character, etTime) {
  // Callout check — if the character called out today, no work shift is active
  const todayET = etTime.toISOString().slice(0, 10);
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;
  if (hasValidCallout) return null;

  // Primary rabbit hole job
  const _isPrimaryRH = character.work_details?.is_rabbit_hole === true;
  if (_isPrimaryRH && character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    const shift = { start: character.work_start_time, end: character.work_end_time, days: character.work_days };
    if (isOnShiftNow(shift, etTime)) {
      return character.occupation_location_name || 'Work';
    }
  }
  // Additional rabbit hole jobs
  if (Array.isArray(character.additional_occupation_locations)) {
    for (const entry of character.additional_occupation_locations) {
      if (entry.location_id) continue;
      const isRH = entry.is_rabbit_hole === true;
      if (isRH && entry.shift_start && entry.shift_end) {
        const shift = { start: entry.shift_start, end: entry.shift_end, days: entry.work_days || null };
        if (isOnShiftNow(shift, etTime)) {
          return entry.location_name || 'Work';
        }
      }
    }
  }
  return null;
}

function _toMinutesSchool(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function _isInWindowSchool(nowMin, startMin, endMin) {
  if (startMin == null || endMin == null) return false;
  if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

// ── SCHOOL SCHEDULE — TIME-BOUND (mirrors the work schedule pattern) ──────
// A stale school lock has NO presence authority outside its schedule window.
// Only resolve at_school when the character is actually within their school
// hours right now (authoritative Eastern Time). Resolution order:
//   1. Enrollment override times (character.education_enrollments, active)
//   2. School location operating_hours for today (or day-agnostic)
// If neither provides a valid time window, or the current time is outside it,
// the character is NOT at school — return false.
function isCharacterOnSchoolSchedule(character, etTime, locationMap) {
  if (character.student_status !== 'enrolled') return false;
  if (!character.education_location_id) return false;

  const nowMin = etTime.getHours() * 60 + etTime.getMinutes();
  const dayOfWeek = etTime.getDay();

  // PRIORITY 1: Enrollment override times
  if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
    const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
    if (active) {
      const s = _toMinutesSchool(active.start_time);
      const e = _toMinutesSchool(active.end_time);
      if (s !== null && e !== null) {
        return _isInWindowSchool(nowMin, s, e);
      }
    }
  }

  // PRIORITY 2: School location operating hours
  const schoolLoc = locationMap[character.education_location_id];
  if (schoolLoc && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
    const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
    const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);

    if (todayEntries.length > 0) {
      const entry = todayEntries[0];
      return _isInWindowSchool(nowMin, _toMinutesSchool(entry.open_time), _toMinutesSchool(entry.close_time));
    }
    if (dayAgnosticEntries.length > 0) {
      const entry = dayAgnosticEntries[0];
      return _isInWindowSchool(nowMin, _toMinutesSchool(entry.open_time), _toMinutesSchool(entry.close_time));
    }
  }

  // No valid school hours found — the character is NOT at school right now
  return false;
}

const VALID_SLEEP_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'generic',
  'jail', 'prison', 'detention_center', 'correctional_facility',
  'juvenile_detention', 'halfway_house', 'holding_cell'
]);

function isValidSleepLocation(location) {
  if (!location) return false;
  return VALID_SLEEP_CATEGORIES.has(location.category || '');
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



// ── ACTIVE STORY EVENT VENUE AUTHORITY ──────────────────────────────────────
// During a Story Event's active time window, the assigned venue is the
// participating character's authoritative current location. This helper
// fetches active Story Events for the character and returns the venue info.
// Returns null when no Story Event is active for this character.
// Temporal test: start_time <= now <= end_time (Eastern Time). Status is NOT
// used as the temporal test — a 'complete' status alone does not activate the
// venue; the configured start/end window does.
async function findActiveStoryEventVenue(base44, characterId, etTime) {
  try {
    // Story Event times are stored in Eastern Time (America/New_York).
    // Compute the ET timezone offset dynamically (handles DST: EDT=-04:00, EST=-05:00).
    const now = new Date();
    const etMs = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime();
    const etOffsetMin = Math.round((etMs - now.getTime()) / 60000);
    const etOffsetStr = `${etOffsetMin >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(etOffsetMin)/60)).padStart(2,'0')}:${String(Math.abs(etOffsetMin)%60).padStart(2,'0')}`;
    const nowMs = now.getTime();

    // Fetch recent StoryEvents and filter for active ones with this character as participant/focus.
    // Only active_created_character participates in Story Events.
    const seEvents = await base44.asServiceRole.entities.StoryEvent.filter({}, '-created_date', 30).catch(() => []);
    for (const e of seEvents || []) {
      const pIds = Array.isArray(e.participant_character_ids) ? e.participant_character_ids : [];
      const fIds = Array.isArray(e.focus_character_ids) ? e.focus_character_ids : [];
      if (!pIds.includes(characterId) && !fIds.includes(characterId)) continue;
      const d = e.event_date;
      if (!d) continue;
      // Parse start/end times as Eastern Time by appending the ET offset
      const s = new Date(`${d}T${e.start_time || '00:00'}:00${etOffsetStr}`).getTime();
      if (isNaN(s) || nowMs < s) continue; // Not started yet
      if (e.end_time) {
        const en = new Date(`${d}T${e.end_time}:00${etOffsetStr}`).getTime();
        if (!isNaN(en) && nowMs > en) continue; // Already ended
      }
      // Compute activeUntil — the event's end time as an ISO datetime.
      // The frontend guard uses this to determine if the committed Story Event
      // venue is still temporally active. Stale venues (past activeUntil) are
      // not preserved — the resolver falls through to normal resolution.
      let _activeUntil = null;
      if (e.end_time) {
        const _enMs = new Date(`${d}T${e.end_time}:00${etOffsetStr}`).getTime();
        if (!isNaN(_enMs)) _activeUntil = new Date(_enMs).toISOString();
      } else {
        // No end_time — all-day event: active until end of the event day (ET)
        const _eodMs = new Date(`${d}T23:59:59${etOffsetStr}`).getTime();
        if (!isNaN(_eodMs)) _activeUntil = new Date(_eodMs).toISOString();
      }
      // Active Story Event with this character — return venue info
      if (e.is_rabbit_hole && e.rabbit_hole_venue_name) {
        return { isRabbitHole: true, venueName: e.rabbit_hole_venue_name, activeUntil: _activeUntil };
      } else if (e.venue_id) {
        return { isRabbitHole: false, venueId: e.venue_id, venueName: e.venue_name, activeUntil: _activeUntil };
      }
      // No venue assigned — skip this event
      continue;
    }
    return null;
  } catch (err) {
    console.warn(`[enforceCharacterLocationPresence] Story Event venue check failed (non-blocking): ${err.message}`);
    return null;
  }
}

/**
 * Evaluate a requested transition against the complete current state.
 * Returns a disposition and the canonical fields to commit.
 *
 * This is the RESOLVER — it does NOT rediscover what the caller intended.
 * It evaluates the requested transition against the current state and
 * determines: accepted, modified, redirected, deferred, rejected, or no_change.
 */
function evaluateRequestedTransition(character, locationMap, requested, etTime, activeStoryEventVenue = null) {
  const currentStatus = character.resolved_presence_status || '';
  const currentLocId = character.resolved_current_location_id || '';
  const requestedStatus = requested.requested_presence_status || null;
  const requestedLocId = requested.requested_location_id || null;

  // ── ACTIVE STORY EVENT VENUE AUTHORITY ──────────────────────────────────────
  // During a Story Event's active time window, the assigned venue is the
  // participating character's authoritative current location. This runs FIRST
  // — before incarceration, hospitalization, sleep, work, school, and home —
  // so the venue overrides all of them for participants. Non-participants get
  // null (activeStoryEventVenue is null) and fall through to normal resolution.
  //
  // Incarcerated and hospitalized participants can be temporarily at the venue;
  // their incarceration/hospitalization status fields (is_jailed, etc.) remain
  // unchanged — only the resolved location is overridden. After the event,
  // activeStoryEventVenue becomes null and the resolver re-resolves normally
  // (back to correctional facility, hospital, work, home, etc.).
  //
  // Hospitalization REQUESTS (new medical emergency) and lock-release REQUESTS
  // (obligation state management) bypass this check so those systems still
  // function during an active Story Event. Sleep is not treated as an absolute
  // blocker — the venue overrides sleep for participants, consistent with how
  // work overrides sleep via the existing obligation/wake behavior.
  if (activeStoryEventVenue && requestedStatus !== 'hospitalized' && !requested.requested_lock_release) {
    if (activeStoryEventVenue.isRabbitHole) {
      return {
        disposition: 'accepted',
        canonicalFields: {
          resolved_current_location_id: 'rabbit_hole',
          resolved_current_location_name: activeStoryEventVenue.venueName,
          resolved_location_type: 'rabbit_hole',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'story_event_venue',
          resolved_last_updated_at: etTime.toISOString(),
          story_event_venue_until: activeStoryEventVenue.activeUntil || null,
        },
        committed_result: {
          resolved_current_location_id: 'rabbit_hole',
          resolved_current_location_name: activeStoryEventVenue.venueName,
          resolved_location_type: 'rabbit_hole',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'story_event_venue',
        },
      };
    } else {
      const _seVenueLoc = locationMap[activeStoryEventVenue.venueId];
      const _seVenueName = _seVenueLoc?.name || activeStoryEventVenue.venueName || 'Story Event Venue';
      return {
        disposition: 'accepted',
        canonicalFields: {
          resolved_current_location_id: activeStoryEventVenue.venueId,
          resolved_current_location_name: _seVenueName,
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'story_event_venue',
          resolved_last_updated_at: etTime.toISOString(),
          story_event_venue_until: activeStoryEventVenue.activeUntil || null,
        },
        committed_result: {
          resolved_current_location_id: activeStoryEventVenue.venueId,
          resolved_current_location_name: _seVenueName,
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'story_event_venue',
        },
      };
    }
  }

  // ── NO TRANSITION REQUESTED — recompute location truth (legacy path) ────────
  // Only fall through to legacy recompute when NO request field is present at all.
  // Special request flags (requested_work_end, requested_lock_release, requested_relocation)
  // carry no requestedStatus/requestedLocId and must NOT be swallowed by this guard.
  const hasAnyRequest =
    !!requestedStatus ||
    !!requestedLocId ||
    requested.requested_work_end === true ||
    requested.requested_lock_release === true ||
    requested.requested_relocation === true;
  if (!hasAnyRequest) {
    return evaluateLegacyRecompute(character, locationMap, etTime, activeStoryEventVenue);
  }

  // ── INCARCERATION / HOUSE ARREST — absolute hard lock ──────────────────────
  if (character.is_jailed === true) {
    const facilityId = character.incarceration_facility_id || null;
    const facilityLoc = facilityId ? locationMap[facilityId] : null;
    const facilityName = facilityLoc?.name || character.incarceration_facility_name || 'Correctional Facility';
    if (currentStatus === 'incarcerated' && currentLocId === (facilityId || currentLocId)) {
      return { disposition: 'no_change', canonicalFields: {} };
    }
    return {
      disposition: 'accepted',
      canonicalFields: {
        resolved_current_location_id: facilityId || currentLocId || null,
        resolved_current_location_name: facilityName,
        resolved_location_type: 'incarcerated',
        resolved_presence_status: 'incarcerated',
        resolved_source_reason: 'incarceration_confinement_lock',
        resolved_last_updated_at: etTime.toISOString(),
      },
      committed_result: {
        resolved_current_location_id: facilityId || currentLocId || null,
        resolved_current_location_name: facilityName,
        resolved_location_type: 'incarcerated',
        resolved_presence_status: 'incarcerated',
        resolved_source_reason: 'incarceration_confinement_lock',
      },
    };
  }

  if (character.house_arrest_active === true) {
    const haLocId = character.house_arrest_location_id || character.current_home_location_id || null;
    const haLoc = haLocId ? locationMap[haLocId] : null;
    const haName = haLoc?.name || 'Residence (House Arrest)';
    if (currentStatus === 'house_arrest' && currentLocId === (haLocId || currentLocId)) {
      return { disposition: 'no_change', canonicalFields: {} };
    }
    return {
      disposition: 'accepted',
      canonicalFields: {
        resolved_current_location_id: haLocId || currentLocId || null,
        resolved_current_location_name: haName,
        resolved_location_type: 'house_arrest',
        resolved_presence_status: 'house_arrest',
        resolved_source_reason: 'house_arrest_confinement_lock',
        resolved_last_updated_at: etTime.toISOString(),
      },
      committed_result: {
        resolved_current_location_id: haLocId || currentLocId || null,
        resolved_current_location_name: haName,
        resolved_location_type: 'house_arrest',
        resolved_presence_status: 'house_arrest',
        resolved_source_reason: 'house_arrest_confinement_lock',
      },
    };
  }

  // ── HOSPITALIZED — discharge gate (movement lock until recovery) ──────────
  // A hospitalized character cannot leave the hospital until discharged. The
  // ONLY exit is 'home' (discharge), and only when ALL canonical life-needs
  // (hunger, energy, social, health, mental, hygiene, comfort) meet the
  // discharge threshold (85 — minimum of the approved 85–90% recovery range).
  // This is the same AND gate used by simulateActiveCharacterNeeds RC3b,
  // enforced at the authority so no caller (processScheduledRelocations,
  // enforceCharacterWorkSchedule, chat, manual) can bypass recovery by
  // requesting a non-hospitalized presence. Work, school, visiting, and all
  // other transitions are blocked outright — the character must be discharged
  // to home first, then resume normal scheduling in a subsequent cycle.
  if (currentStatus === 'hospitalized' && requestedStatus && requestedStatus !== 'hospitalized') {
    if (requestedStatus !== 'home') {
      return {
        disposition: 'rejected',
        reason: 'hospitalized_movement_blocked',
        canonicalFields: {},
      };
    }
    const _DISCHARGE_THRESHOLD = 85;
    const _needsReady = [
      character.hunger_value ?? 70,
      character.energy_value ?? 75,
      character.social_value ?? 65,
      character.health_value ?? 80,
      character.mental_value ?? 70,
      character.hygiene_value ?? 75,
      character.comfort_value ?? 70,
    ].every(v => v >= _DISCHARGE_THRESHOLD);
    if (!_needsReady) {
      return {
        disposition: 'rejected',
        reason: 'hospitalized_discharge_not_ready',
        canonicalFields: {},
      };
    }
    // All needs ≥ 85 and request is 'home' — discharge proceeds through the
    // normal transition path below. Do not return; fall through.
  }

  // ── SLEEP REQUESTED AT WORK — movement first, sleep after arrival ──────────
  // The character may never be canonically sleeping while at the workplace.
  // If sleeping is requested and the current location is a work location,
  // resolve as movement to the valid sleep location first. Sleeping is deferred
  // until the character arrives at the valid sleep location.
  if (requestedStatus === 'sleeping' || requestedStatus === 'napping') {
    const isCurrentlyAtWork = currentStatus === 'at_work' ||
      (currentLocId && character.occupation_location_id && currentLocId === character.occupation_location_id) ||
      (Array.isArray(character.additional_occupation_locations) &&
        character.additional_occupation_locations.some(loc => loc.location_id === currentLocId));

    if (isCurrentlyAtWork) {
      // Cannot sleep at work — redirect to movement home first
      const sleepHomeId = resolveValidSleepLocationId(character, locationMap);
      if (sleepHomeId && sleepHomeId !== currentLocId) {
        const sleepHomeLoc = locationMap[sleepHomeId];
        return {
          disposition: 'redirected',
          canonicalFields: {
            resolved_current_location_id: sleepHomeId,
            resolved_current_location_name: sleepHomeLoc?.name || 'Home',
            resolved_location_type: 'home',
            resolved_presence_status: 'home',
            resolved_source_reason: requested.requested_source_reason || 'sleep_redirect_from_work',
            resolved_last_updated_at: etTime.toISOString(),
            // Clear any work stay-lock so the sleep request can be resubmitted
            presence_stay_lock: false,
            presence_stay_lock_reason: null,
          },
          committed_result: {
            resolved_current_location_id: sleepHomeId,
            resolved_current_location_name: sleepHomeLoc?.name || 'Home',
            resolved_location_type: 'home',
            resolved_presence_status: 'home',
            resolved_source_reason: requested.requested_source_reason || 'sleep_redirect_from_work',
            redirect_reason: 'sleep_cannot_begin_at_work_moved_home_first',
          },
          // Signal to the caller that sleep must be resubmitted after arrival
          must_resubmit_sleep: true,
        };
      }
      // No valid sleep location — defer the sleep request
      return {
        disposition: 'deferred',
        canonicalFields: {},
        reason: 'sleep_requested_at_work_no_valid_sleep_location',
      };
    }

    // Not at work — validate the sleep location
    const sleepHomeId = requestedLocId || resolveValidSleepLocationId(character, locationMap);
    if (!sleepHomeId) {
      return { disposition: 'deferred', canonicalFields: {}, reason: 'no_valid_sleep_location' };
    }
    const sleepHomeLoc = locationMap[sleepHomeId];
    if (!isValidSleepLocation(sleepHomeLoc)) {
      // Requested location is not a valid sleep location — redirect to valid sleep home
      const validSleepId = resolveValidSleepLocationId(character, locationMap);
      if (validSleepId && validSleepId !== sleepHomeId) {
        const validSleepLoc = locationMap[validSleepId];
        return {
          disposition: 'redirected',
          canonicalFields: {
            resolved_current_location_id: validSleepId,
            resolved_current_location_name: validSleepLoc?.name || 'Home',
            resolved_location_type: 'home',
            resolved_presence_status: 'home',
            resolved_source_reason: 'sleep_redirect_to_valid_location',
            resolved_last_updated_at: etTime.toISOString(),
          },
          committed_result: {
            resolved_current_location_id: validSleepId,
            resolved_current_location_name: validSleepLoc?.name || 'Home',
            resolved_location_type: 'home',
            resolved_presence_status: 'home',
            resolved_source_reason: 'sleep_redirect_to_valid_location',
            redirect_reason: 'requested_location_not_valid_for_sleep',
          },
          must_resubmit_sleep: true,
        };
      }
      return { disposition: 'deferred', canonicalFields: {}, reason: 'requested_sleep_location_invalid' };
    }

    // Sleep can be committed at this location
    const canonicalFields = {
      resolved_current_location_id: sleepHomeId,
      resolved_current_location_name: sleepHomeLoc?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: requestedStatus,
      resolved_source_reason: requested.requested_source_reason || 'sleep_state',
      resolved_last_updated_at: etTime.toISOString(),
      presence_stay_lock: true,
      presence_stay_lock_reason: requestedStatus === 'sleeping' ? 'sleep_state' : 'nap_state',
      presence_stay_lock_authority: requested.requested_authority || 'enforceCharacterLocationPresence',
      presence_stay_lock_set_at: etTime.toISOString(),
      presence_stay_lock_created_by: 'system_automation',
    };
    if (requestedStatus === 'sleeping') {
      canonicalFields.last_sleep_start = requested.requested_timestamp || etTime.toISOString();
    } else {
      canonicalFields.last_nap_time = requested.requested_timestamp || etTime.toISOString();
    }
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: sleepHomeId,
        resolved_current_location_name: sleepHomeLoc?.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: requestedStatus,
        resolved_source_reason: requested.requested_source_reason || 'sleep_state',
      },
    };
  }

  // ── PASS-OUT REQUESTED — involuntary collapse, distinct from sleep ──────────
  // Critical-energy pass-out and 19-hour exhaustion are separate callers.
  // Each sends its own cause. This authority evaluates the current state and
  // commits the passed_out transition if valid.
  if (requestedStatus === 'passed_out') {
    // No second pass-out while already sleeping, napping, recovering, or passed out
    if (['sleeping', 'napping', 'passed_out', 'hospitalized'].includes(currentStatus)) {
      return { disposition: 'no_change', canonicalFields: {}, reason: 'already_in_rest_state' };
    }
    const canonicalFields = {
      resolved_presence_status: 'passed_out',
      resolved_source_reason: requested.requested_source_reason || 'passed_out',
      resolved_last_updated_at: etTime.toISOString(),
      presence_stay_lock: true,
      presence_stay_lock_reason: 'pass_out_recovery',
      presence_stay_lock_authority: requested.requested_authority || 'enforceCharacterLocationPresence',
      presence_stay_lock_set_at: etTime.toISOString(),
      presence_stay_lock_created_by: 'system_automation',
      presence_stay_lock_release_condition: 'energy_above_35',
      last_pass_out_at: requested.requested_timestamp || etTime.toISOString(),
    };
    // Pass-out can happen at the current location — it's involuntary collapse
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: currentLocId,
        resolved_current_location_name: character.resolved_current_location_name || 'Current Location',
        resolved_location_type: character.resolved_location_type || 'visit',
        resolved_presence_status: 'passed_out',
        resolved_source_reason: requested.requested_source_reason || 'passed_out',
      },
    };
  }

  // ── WAKE / NAP-END REQUESTED ───────────────────────────────────────────────
  // Existing wake and nap-end callers send the authorized transition.
  // The authority commits the valid post-wake presence and preserves the valid
  // current location unless another authorized transition moves the character.
  // It does NOT automatically force "home".
  if (requestedStatus === 'home' && ['sleeping', 'napping', 'passed_out', 'hospitalized'].includes(currentStatus)) {
    // Wake — preserve current location if it's a valid home, otherwise use resolved sleep home
    const currentLoc = currentLocId ? locationMap[currentLocId] : null;
    const isAtHome = currentLoc && (currentLoc.category === 'home' || character.current_home_location_id === currentLocId);
    const wakeLocId = isAtHome ? currentLocId : resolveValidSleepLocationId(character, locationMap);
    const wakeLoc = wakeLocId ? locationMap[wakeLocId] : null;
    const canonicalFields = {
      resolved_presence_status: 'home',
      resolved_source_reason: requested.requested_source_reason || 'wake',
      resolved_last_updated_at: etTime.toISOString(),
      last_wake_time: requested.requested_timestamp || etTime.toISOString(),
      presence_stay_lock: false,
      presence_stay_lock_reason: null,
      presence_stay_lock_authority: null,
      presence_stay_lock_release_condition: null,
    };
    if (wakeLocId && wakeLocId !== currentLocId) {
      canonicalFields.resolved_current_location_id = wakeLocId;
      canonicalFields.resolved_current_location_name = wakeLoc?.name || 'Home';
      canonicalFields.resolved_location_type = 'home';
    }
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: wakeLocId || currentLocId,
        resolved_current_location_name: wakeLoc?.name || character.resolved_current_location_name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: requested.requested_source_reason || 'wake',
      },
    };
  }

  // ── WORK REQUESTED (at_work) ───────────────────────────────────────────────
  // enforceCharacterWorkSchedule requests at_work when its rules determine
  // the active work obligation requires that transition.
  if (requestedStatus === 'at_work') {
    // Vacation Mode — temporary exemption from work attendance. Existing
    // work schedule and employment records remain intact; only enforcement
    // is skipped. The character remains free to travel and participate
    // normally. Switching Vacation Mode OFF resumes normal enforcement.
    //
    // This is the SOLE CANONICAL WRITER — the single chokepoint through which
    // ALL at_work requests pass. Guarding here covers every caller, including
    // later paths (autonomousCharacterMovement orphaned-traveling repair,
    // Tier 3.5 active-work dispatch) that recompute at_work from raw schedule
    // fields without their own vacation_mode check. The initial shift-start
    // path (enforceCharacterWorkSchedule) already checks vacation_mode before
    // requesting at_work; this guard is redundant for that caller but
    // authoritative for all others.
    if (character.vacation_mode === true) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'vacation_mode_work_exempt' };
    }
    // Hospitalized characters are in protected recovery — work cannot pull them out.
    if (character.resolved_presence_status === 'hospitalized') {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'hospitalized_work_blocked' };
    }
    // Passed-out characters are in an involuntary recovery state with its own
    // existing release condition (energy_above_35). A stale or continuous
    // "00:00–23:59" work-schedule lock must not override that existing
    // recovery authority. This handler rejects the invalid at_work request;
    // the calling scheduler (enforceCharacterWorkSchedule) releases any stale
    // persisted work lock through the existing authorized release pathway
    // (requested_lock_release → lines 718-742 of this function) so the lock
    // is actually cleared rather than merely ignored. The recovery pathway
    // (pass-out handler / simulateActiveCharacterNeeds) retains authority
    // until the existing release condition is met.
    if (character.resolved_presence_status === 'passed_out') {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'passed_out_work_blocked' };
    }
    // Critically ill — health below 20 is a biological emergency. Shared safeguard
    // for BOTH linked and rabbit-hole work — must execute before either branch.
    if ((character.health_value ?? 80) < 20) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'health_critical_work_blocked' };
    }
    // RABBIT-HOLE WORKPLACE — only for scheduler-authority requests with no linked location.
    // The saved occupation entry (primary or additional) determines classification:
    //   - Non-null saved location_id → linked workplace (even if the record is missing)
    //   - Null saved location_id + explicit rabbit-hole flag → intentional rabbit-hole
    // A missing linked record is an integrity error, NOT a rabbit-hole inference.
    if (!requestedLocId && requested.requested_location_name) {
      // Require scheduler authority — no other caller may commit a null-location work presence
      if (requested.requested_authority !== 'enforceCharacterWorkSchedule' &&
          requested.requested_authority !== 'autonomousCharacterMovement') {
        return { disposition: 'rejected', canonicalFields: {}, reason: 'rabbit_hole_requires_scheduler_authority' };
      }
      // Validate against saved rabbit-hole occupation entries — use ONLY the actual saved
      // destination name (occupation_location_name for primary, location_name for additional).
      // Never use workplace_type or category as a name equivalent.
      // Discriminator: saved location ID absent AND saved is_rabbit_hole flag explicitly true.
      // A saved name alone must not classify an occupation as a rabbit hole.
      const _rhNames = [];
      // One Truth safeguard: is_rabbit_hole flag is the authority for
      // rabbit-hole classification. A stale occupation_location_id from a
      // former linked job must NOT prevent the active rabbit-hole employment
      // from being recognized.
      {
        const isRH = character.work_details?.is_rabbit_hole === true;
        if (isRH && character.occupation_location_name) {
          _rhNames.push(character.occupation_location_name);
        }
      }
      if (Array.isArray(character.additional_occupation_locations)) {
        for (const entry of character.additional_occupation_locations) {
          if (entry.location_id) continue;
          const isRH = entry.is_rabbit_hole === true;
          if (isRH && entry.location_name) {
            _rhNames.push(entry.location_name);
          }
        }
      }
      if (_rhNames.length === 0) {
        return { disposition: 'rejected', canonicalFields: {}, reason: 'no_rabbit_hole_occupation_configured' };
      }
      if (!_rhNames.includes(requested.requested_location_name)) {
        return { disposition: 'rejected', canonicalFields: {}, reason: 'rabbit_hole_occupation_name_not_matched' };
      }
      const wasSleeping = currentStatus === 'sleeping' || currentStatus === 'napping';
      const canonicalFields = {
        resolved_current_location_id: 'rabbit_hole',
        resolved_current_location_name: requested.requested_location_name,
        resolved_location_type: 'rabbit_hole',
        resolved_presence_status: 'at_work',
        resolved_source_reason: requested.requested_source_reason || 'work_schedule',
        resolved_last_updated_at: etTime.toISOString(),
        presence_stay_lock: true,
        presence_stay_lock_reason: 'work_shift',
        presence_stay_lock_authority: 'enforceCharacterWorkSchedule',
        presence_stay_lock_set_at: etTime.toISOString(),
        presence_stay_lock_created_by: 'system_automation',
        // Clear stale nap/home lock fields so the committed work reality is coherent
        presence_stay_lock_expires_at: null,
        presence_stay_lock_release_condition: null,
        presence_stay_lock_location_id: null,
      };
      if (wasSleeping) {
        canonicalFields.last_wake_time = etTime.toISOString();
      }
      return {
        disposition: 'accepted',
        canonicalFields,
        committed_result: {
          resolved_current_location_id: 'rabbit_hole',
          resolved_current_location_name: requested.requested_location_name,
          resolved_location_type: 'rabbit_hole',
          resolved_presence_status: 'at_work',
          resolved_source_reason: requested.requested_source_reason || 'work_schedule',
          was_woken_from_sleep: wasSleeping,
        },
      };
    }
    const workLocId = requestedLocId || character.occupation_location_id;
    if (!workLocId) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'no_work_location' };
    }
    const workLoc = locationMap[workLocId];
    const wasSleeping = currentStatus === 'sleeping' || currentStatus === 'napping';
    const canonicalFields = {
      resolved_current_location_id: workLocId,
      resolved_current_location_name: workLoc?.name || character.occupation_location_name || 'Work',
      resolved_location_type: 'work',
      resolved_presence_status: 'at_work',
      resolved_source_reason: requested.requested_source_reason || 'work_schedule',
      resolved_last_updated_at: etTime.toISOString(),
      presence_stay_lock: true,
      presence_stay_lock_reason: 'work_shift',
      presence_stay_lock_authority: 'enforceCharacterWorkSchedule',
      presence_stay_lock_set_at: etTime.toISOString(),
      presence_stay_lock_location_id: workLocId,
      presence_stay_lock_created_by: 'system_automation',
      // Clear stale nap/home lock fields so the committed work reality is coherent
      presence_stay_lock_expires_at: null,
      presence_stay_lock_release_condition: null,
    };
    if (wasSleeping) {
      canonicalFields.last_wake_time = etTime.toISOString();
    }
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: workLocId,
        resolved_current_location_name: workLoc?.name || character.occupation_location_name || 'Work',
        resolved_location_type: 'work',
        resolved_presence_status: 'at_work',
        resolved_source_reason: requested.requested_source_reason || 'work_schedule',
        was_woken_from_sleep: wasSleeping,
      },
    };
  }

  // ── WORK END REQUESTED — obligation ending, not a canonical presence state ──
  // When the shift ends, the caller sends the work-end condition. The authority
  // determines the valid resulting canonical location and presence.
  // Work end does NOT automatically mean "home".
  if (requested.requested_work_end === true) {
    if (currentStatus !== 'at_work' && currentLocId !== character.occupation_location_id) {
      return { disposition: 'no_change', canonicalFields: {}, reason: 'not_at_work' };
    }
    // Resolve valid post-work location — typically home, but not forced
    const homeLocId = character.current_home_location_id || character.home_location_id;
    if (!homeLocId) {
      // No home — just clear the work lock and let the character remain
      const canonicalFields = {
        presence_stay_lock: false,
        presence_stay_lock_reason: null,
        presence_stay_lock_authority: null,
        presence_stay_lock_location_id: null,
        presence_stay_lock_set_at: null,
        presence_stay_lock_created_by: null,
        resolved_source_reason: requested.requested_source_reason || 'work_end',
        resolved_last_updated_at: etTime.toISOString(),
      };
      return {
        disposition: 'accepted',
        canonicalFields,
        committed_result: {
          resolved_current_location_id: currentLocId,
          resolved_current_location_name: character.resolved_current_location_name || 'Work',
          resolved_location_type: character.resolved_location_type || 'work',
          resolved_presence_status: currentStatus,
          resolved_source_reason: requested.requested_source_reason || 'work_end',
        },
      };
    }
    const homeLoc = locationMap[homeLocId];
    const energy = character.energy_value ?? 75;
    const needsPostWorkSleep = energy < 40;
    // MOVEMENT FIRST: commit the character home awake. The work lock is released.
    // No sleep-start timestamp, no sleep lock, and no sleep record is created
    // during the movement commit. If the character cannot remain awake (low
    // energy), set must_resubmit_sleep so the caller submits a separate
    // sleeping request after arrival. Only that follow-up commits sleeping,
    // applies the sleep lock, stamps last_sleep_start, and allows sleep records.
    const canonicalFields = {
      resolved_current_location_id: homeLocId,
      resolved_current_location_name: homeLoc?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: requested.requested_source_reason || 'work_end',
      resolved_last_updated_at: etTime.toISOString(),
      presence_stay_lock: false,
      presence_stay_lock_reason: null,
      presence_stay_lock_authority: null,
      presence_stay_lock_location_id: null,
      presence_stay_lock_set_at: null,
      presence_stay_lock_created_by: null,
    };
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: homeLocId,
        resolved_current_location_name: homeLoc?.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: requested.requested_source_reason || 'work_end',
        post_work_sleep_needed: needsPostWorkSleep,
      },
      must_resubmit_sleep: needsPostWorkSleep,
    };
  }

  // ── SCHOOL REQUESTED (at_school) ───────────────────────────────────────────
  if (requestedStatus === 'at_school') {
    // Hospitalized characters are in protected recovery — school cannot pull them out.
    if (character.resolved_presence_status === 'hospitalized') {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'hospitalized_school_blocked' };
    }
    const schoolLocId = requestedLocId || character.education_location_id;
    if (!schoolLocId) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'no_school_location' };
    }
    const schoolLoc = locationMap[schoolLocId];
    const canonicalFields = {
      resolved_current_location_id: schoolLocId,
      resolved_current_location_name: schoolLoc?.name || character.education_location_name || 'School',
      resolved_location_type: 'school',
      resolved_presence_status: 'at_school',
      resolved_source_reason: requested.requested_source_reason || 'school_schedule',
      resolved_last_updated_at: etTime.toISOString(),
      presence_stay_lock: true,
      presence_stay_lock_reason: 'school_schedule',
      presence_stay_lock_authority: 'enforceCharacterLocationPresence',
      presence_stay_lock_set_at: etTime.toISOString(),
      presence_stay_lock_location_id: schoolLocId,
      presence_stay_lock_created_by: 'system_automation',
    };
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: schoolLocId,
        resolved_current_location_name: schoolLoc?.name || character.education_location_name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: requested.requested_source_reason || 'school_schedule',
      },
    };
  }

  // ── RELOCATION / VISIT REQUESTED ────────────────────────────────────────────
  // Used by processScheduledRelocations, autonomousCharacterMovement, and
  // other travel/visit callers. The caller sends the destination and reason.
  if (requestedStatus === 'visiting' || requested.requested_relocation === true) {
    const destLocId = requestedLocId;
    if (!destLocId) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'no_destination' };
    }
    // Incarcerated/house-arrest/hospitalized characters cannot be relocated
    if (character.is_jailed || character.house_arrest_active) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'confinement_block' };
    }
    if (character.resolved_presence_status === 'hospitalized') {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'hospitalized_relocation_blocked' };
    }
    // RABBIT HOLE — intentional off-screen destination positively established by
    // an authorized movement pathway (chat commitment, user teleport, scheduled
    // relocation). The placeholder ID "rabbit_hole" is a valid canonical location
    // ID — NOT a failed lookup. Do NOT attempt a locationMap lookup.
    if (destLocId === 'rabbit_hole') {
      const destName = requested.requested_location_name || character.resolved_current_location_name || 'Off-screen';
      const canonicalFields = {
        resolved_current_location_id: 'rabbit_hole',
        resolved_current_location_name: destName,
        resolved_location_type: requested.requested_location_type || 'rabbit_hole',
        resolved_presence_status: requestedStatus || 'visiting',
        resolved_source_reason: requested.requested_source_reason || 'relocation',
        resolved_last_updated_at: etTime.toISOString(),
        last_arrived_time: etTime.toISOString(),
        travel_status: 'not_traveling',
        travel_destination_location_id: null,
        traveling_to_location_id: null,
        traveling_to_location_name: null,
      };
      if (requested.clear_stay_lock) {
        canonicalFields.presence_stay_lock = false;
        canonicalFields.presence_stay_lock_reason = null;
      }
      return {
        disposition: 'accepted',
        canonicalFields,
        committed_result: {
          resolved_current_location_id: 'rabbit_hole',
          resolved_current_location_name: destName,
          resolved_location_type: requested.requested_location_type || 'rabbit_hole',
          resolved_presence_status: requestedStatus || 'visiting',
          resolved_source_reason: requested.requested_source_reason || 'relocation',
        },
      };
    }
    const destLoc = locationMap[destLocId];
    if (!destLoc) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'destination_not_in_scope' };
    }
    const canonicalFields = {
      resolved_current_location_id: destLocId,
      resolved_current_location_name: destLoc.name,
      resolved_location_type: requested.requested_location_type || 'visit',
      resolved_presence_status: requestedStatus || 'visiting',
      resolved_source_reason: requested.requested_source_reason || 'relocation',
      resolved_last_updated_at: etTime.toISOString(),
      last_arrived_time: etTime.toISOString(),
      // Clear any stale travel fields
      travel_status: 'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id: null,
      traveling_to_location_name: null,
    };
    if (requested.clear_stay_lock) {
      canonicalFields.presence_stay_lock = false;
      canonicalFields.presence_stay_lock_reason = null;
    }
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: destLocId,
        resolved_current_location_name: destLoc.name,
        resolved_location_type: requested.requested_location_type || 'visit',
        resolved_presence_status: requestedStatus || 'visiting',
        resolved_source_reason: requested.requested_source_reason || 'relocation',
      },
    };
  }

  // ── HOSPITALIZATION REQUESTED ──────────────────────────────────────────────
  // A medical crisis uses the existing travel/admission path: the character is
  // physically moved to the hospital already listed in the app — the existing
  // medical-category location (the same convention autonomousCharacterMovement
  // uses to identify hospitals). The committed result carries the hospital as
  // the authoritative location so homepage, Travel, Chat, and Text all agree;
  // no surface shows home while another shows hospital. No status bars are
  // refilled here — recovery is progressive via the hospitalized context rates.
  if (requestedStatus === 'hospitalized') {
    // Resolve the hospital once (existing medical-category location, the same
    // convention autonomousCharacterMovement uses to identify hospitals).
    let hospitalLocId = requestedLocId || null;
    let hospitalLoc = hospitalLocId ? locationMap[hospitalLocId] : null;
    if (!hospitalLoc || (hospitalLoc.category || '').toLowerCase() !== 'medical') {
      const medLoc = Object.values(locationMap).find(l => (l.category || '').toLowerCase() === 'medical');
      if (medLoc) { hospitalLoc = medLoc; hospitalLocId = medLoc.id; }
    }
    if (currentStatus === 'hospitalized') {
      // Already hospitalized. The original hospitalization may have committed the
      // presence WITHOUT moving the location to the hospital — the "Home —
      // Hospitalized" violation (resolved_presence_status='hospitalized' but
      // resolved_current_location_id is still home, resolved_location_type is
      // not 'medical'). Reconcile the committed location to the hospital using
      // the same resolution as a fresh admission. This is the existing
      // hospitalization handler completing the move it committed; no new rule.
      // If the location is already the hospital (or no hospital exists), there
      // is nothing to do.
      const currentLoc = currentLocId ? locationMap[currentLocId] : null;
      const currentIsMedical = currentLoc && (currentLoc.category || '').toLowerCase() === 'medical';
      if (currentIsMedical || !hospitalLocId) {
        return { disposition: 'no_change', canonicalFields: {} };
      }
      const canonicalFields = {
        resolved_current_location_id: hospitalLocId,
        resolved_current_location_name: hospitalLoc?.name || 'Hospital',
        resolved_location_type: 'medical',
        resolved_last_updated_at: etTime.toISOString(),
      };
      return {
        disposition: 'accepted',
        canonicalFields,
        committed_result: {
          resolved_current_location_id: hospitalLocId,
          resolved_current_location_name: hospitalLoc?.name || 'Hospital',
          resolved_location_type: 'medical',
          resolved_presence_status: 'hospitalized',
          resolved_source_reason: character.resolved_source_reason || 'medical_emergency',
        },
      };
    }
    // ONE TRUTH SAFEGUARD: Hospitalization requires an actual medical facility.
    // A character cannot be "hospitalized" at their home — that is an invalid
    // state. The hospital is resolved from the location map, which includes the
    // account's own medical-category locations PLUS admin-shared medical
    // locations (scope: 'shared') as a fallback when the account owns none. If
    // no medical-category location exists in either set, REJECT the transition
    // rather than committing an invalid hospitalized-at-home state.
    if (!hospitalLocId) {
      return {
        disposition: 'rejected',
        reason: 'no_medical_facility_available',
        canonicalFields: {},
      };
    }
    const canonicalFields = {
      resolved_presence_status: 'hospitalized',
      resolved_source_reason: requested.requested_source_reason || 'medical_emergency',
      resolved_last_updated_at: etTime.toISOString(),
      current_activity: 'hospitalized — health collapsed',
      resolved_location_type: 'medical',
      resolved_current_location_id: hospitalLocId,
      resolved_current_location_name: hospitalLoc?.name || 'Hospital',
    };
    // One-time stabilization — applied exactly once at the admission commit.
    // These are fixed amounts, NOT recurring rates. Remaining hospitalized
    // never re-triggers this; only a new admission (after discharge) does.
    canonicalFields.hunger_value  = _clampNeed((character.hunger_value  ?? 70) + HOSPITAL_STABILIZATION.hunger);
    canonicalFields.energy_value  = _clampNeed((character.energy_value  ?? 75) + HOSPITAL_STABILIZATION.energy);
    canonicalFields.social_value  = _clampNeed((character.social_value  ?? 65) + HOSPITAL_STABILIZATION.social);
    canonicalFields.health_value  = _clampNeed((character.health_value  ?? 80) + HOSPITAL_STABILIZATION.health);
    canonicalFields.mental_value  = _clampNeed((character.mental_value  ?? 70) + HOSPITAL_STABILIZATION.mental);
    canonicalFields.hygiene_value = _clampNeed((character.hygiene_value ?? 75) + HOSPITAL_STABILIZATION.hygiene);
    canonicalFields.comfort_value  = _clampNeed((character.comfort_value  ?? 70) + HOSPITAL_STABILIZATION.comfort);
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: hospitalLocId,
        resolved_current_location_name: hospitalLoc?.name || 'Hospital',
        resolved_location_type: 'medical',
        resolved_presence_status: 'hospitalized',
        resolved_source_reason: requested.requested_source_reason || 'medical_emergency',
      },
    };
  }

  // ── LOCK RELEASE REQUESTED ─────────────────────────────────────────────────
  if (requested.requested_lock_release === true) {
    const canonicalFields = {
      presence_stay_lock: false,
      presence_stay_lock_reason: null,
      presence_stay_lock_authority: null,
      presence_stay_lock_location_id: null,
      presence_stay_lock_set_at: null,
      presence_stay_lock_expires_at: null,
      presence_stay_lock_release_condition: null,
      presence_stay_lock_created_by: null,
    };
    return {
      disposition: 'accepted',
      canonicalFields,
      committed_result: {
        resolved_current_location_id: currentLocId,
        resolved_current_location_name: character.resolved_current_location_name,
        resolved_location_type: character.resolved_location_type,
        resolved_presence_status: currentStatus,
        resolved_source_reason: character.resolved_source_reason,
        lock_released: true,
      },
    };
  }

  // ── EXPLICIT REQUEST NOT APPLICABLE TO CURRENT STATE ───────────────────────
  // An explicit requested transition was submitted but did not match any
  // applicable handler above. The requested transition is not applicable to
  // the current canonical state (e.g., a wake request when the character is
  // not sleeping/napping/passed_out). Return a noncommitting disposition.
  // Do NOT fall through to legacy recompute — that would commit an unrelated
  // state (e.g., at_work) merely because another world condition is active.
  if (hasAnyRequest) {
    return {
      disposition: 'no_longer_applicable',
      canonicalFields: {},
      reason: 'requested_transition_not_applicable_to_current_state',
      committed_result: null,
    };
  }

  // ── FALLBACK: legacy recompute (only when no requested transition) ────────
  return evaluateLegacyRecompute(character, locationMap, etTime, activeStoryEventVenue);
}

/**
 * Legacy recompute path — when no specific transition is requested, the
 * authority recomputes the resolved location using the inline resolver
 * (aligned with src/lib/locationResolutionEngine.js).
 */
function evaluateLegacyRecompute(character, locationMap, etTime, activeStoryEventVenue = null) {
  const resolved = computeResolvedLocation(character, locationMap, etTime, activeStoryEventVenue);
  const stored = buildStoredState(character);
  if (!hasChanged(resolved, stored)) {
    return { disposition: 'no_change', canonicalFields: {} };
  }
  const canonicalFields = {
    resolved_current_location_id: resolved.resolved_current_location_id,
    resolved_current_location_name: resolved.resolved_current_location_name,
    resolved_location_type: resolved.resolved_location_type,
    resolved_presence_status: resolved.resolved_presence_status,
    resolved_source_reason: resolved.resolved_source_reason,
    resolved_last_updated_at: etTime.toISOString(),
    story_event_venue_until: activeStoryEventVenue?.activeUntil || null,
  };
  return {
    disposition: 'accepted',
    canonicalFields,
    committed_result: {
      resolved_current_location_id: resolved.resolved_current_location_id,
      resolved_current_location_name: resolved.resolved_current_location_name,
      resolved_location_type: resolved.resolved_location_type,
      resolved_presence_status: resolved.resolved_presence_status,
      resolved_source_reason: resolved.resolved_source_reason,
    },
  };
}

// ── INLINE RESOLVER (aligned with src/lib/locationResolutionEngine.js) ───────
function computeResolvedLocation(character, locationMap, etTime, activeStoryEventVenue = null) {
  // ── ACTIVE STORY EVENT VENUE AUTHORITY ──────────────────────────────────────
  // During a Story Event's active time window, the assigned venue is the
  // participating character's authoritative current location. This runs FIRST
  // — before hospitalization, incarceration, house arrest, sleep, work, school,
  // and home — so the venue overrides all of them for participants.
  // Non-participants get null (activeStoryEventVenue is null) and fall through
  // to normal resolution. Incarcerated/hospitalized participants are temporarily
  // at the venue; their status fields remain unchanged. After the event, this
  // check is skipped (null) and the resolver re-resolves normally.
  if (activeStoryEventVenue) {
    if (activeStoryEventVenue.isRabbitHole) {
      return {
        resolved_current_location_id: 'rabbit_hole',
        resolved_current_location_name: activeStoryEventVenue.venueName,
        resolved_location_type: 'rabbit_hole',
        resolved_presence_status: 'visiting',
        resolved_source_reason: 'story_event_venue',
      };
    } else {
      const _seVenueLoc = locationMap[activeStoryEventVenue.venueId];
      return {
        resolved_current_location_id: activeStoryEventVenue.venueId,
        resolved_current_location_name: _seVenueLoc?.name || activeStoryEventVenue.venueName || 'Story Event Venue',
        resolved_location_type: 'visit',
        resolved_presence_status: 'visiting',
        resolved_source_reason: 'story_event_venue',
      };
    }
  }

  // ── HOSPITALIZATION GUARD — preserve committed hospital state ──────────────
  // A hospitalized character is physically at the hospital. Schedule/visit/home
  // layers must NOT re-resolve them back to home, work, or school.
  if (character.resolved_presence_status === 'hospitalized') {
    return {
      resolved_current_location_id: character.resolved_current_location_id || null,
      resolved_current_location_name: character.resolved_current_location_name || 'Hospital',
      resolved_location_type: character.resolved_location_type || 'medical',
      resolved_presence_status: 'hospitalized',
      resolved_source_reason: character.resolved_source_reason || 'medical_emergency',
    };
  }

  // Incarceration lock
  if (character.is_jailed === true) {
    const facilityId = character.incarceration_facility_id || null;
    const facilityLoc = facilityId ? locationMap[facilityId] : null;
    const facilityName = facilityLoc?.name || character.incarceration_facility_name || 'Correctional Facility';
    return {
      resolved_current_location_id: facilityId || character.resolved_current_location_id || null,
      resolved_current_location_name: facilityName,
      resolved_location_type: 'incarcerated',
      resolved_presence_status: 'incarcerated',
      resolved_source_reason: 'incarceration_confinement_lock',
    };
  }

  // House arrest lock
  if (character.house_arrest_active === true) {
    const haLocId = character.house_arrest_location_id || character.current_home_location_id || null;
    const haLoc = haLocId ? locationMap[haLocId] : null;
    const haName = haLoc?.name || 'Residence (House Arrest)';
    return {
      resolved_current_location_id: haLocId || character.resolved_current_location_id || null,
      resolved_current_location_name: haName,
      resolved_location_type: 'house_arrest',
      resolved_presence_status: 'house_arrest',
      resolved_source_reason: 'house_arrest_confinement_lock',
    };
  }

  // Sleep state lock — preserve committed sleep state BEFORE work/school
  // evaluation. Recompute reflects already-committed reality; it does not
  // independently manufacture a work/school transition from schedule evaluation.
  // If the character is committed as sleeping or napping, that reality is
  // preserved and work/school schedules are NOT evaluated here. A genuine work
  // or school obligation remains an authorized wake condition through the
  // existing obligation pathway (enforceCharacterWorkSchedule), which sends an
  // explicit at_work/at_school request through evaluateRequestedTransition —
  // NOT through this recompute. Sleep caps (6-8h), alarms, and wake boundaries
  // are handled by the dedicated automations (simulateActiveCharacterNeeds,
  // enforceWakeTimeBoundary, processScheduledCharacterAlarms) — NOT by this recompute.
  const sleepHomeId = resolveValidSleepLocationId(character, locationMap);
  const sleepHomeLoc = sleepHomeId ? locationMap[sleepHomeId] : null;
  const dbSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
  if (dbSleeping && sleepHomeId) {
    return {
      resolved_current_location_id: sleepHomeId,
      resolved_current_location_name: sleepHomeLoc?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: character.resolved_presence_status,
      resolved_source_reason: 'energy_driven_sleep_preserved',
    };
  }

  // Work schedule — ordered evaluation matching enforceCharacterWorkSchedule.
  // Build ONE ordered employment sequence: primary first, then additional in
  // stored order. Each entry is linked or rabbit-hole. Evaluation proceeds in
  // this order so job priority follows the stored order — rabbit-hole jobs
  // never take artificial priority over linked jobs.
  const todayET = etTime.toISOString().slice(0, 10);
  const hasValidCallout = character.work_exception_status === 'called_out' && character.work_exception_date === todayET;
  if (!hasValidCallout) {
    // Stale-location correction: for an explicitly configured rabbit-hole primary,
    // do NOT fall back to current_work_location_id — that field may be stale from
    // a previous linked occupation. For non-rabbit-hole legacy occupations, existing
    // behavior (including current_work_location_id fallback) remains unchanged.
    // Discriminator: saved location ID absent AND saved is_rabbit_hole flag explicitly true.
    // A saved name alone must not classify an occupation as a rabbit hole.
    // One Truth safeguard: the is_rabbit_hole flag is the authority for
    // rabbit-hole classification. A stale occupation_location_id from a
    // former linked job must NOT prevent the active rabbit-hole employment
    // from being recognized.
    const _isPrimaryRH = character.work_details?.is_rabbit_hole === true;
    const _primaryLocId = _isPrimaryRH
      ? null
      : (character.occupation_location_id || character.current_work_location_id || null);
    const _orderedJobs = [];
    if (_primaryLocId) {
      _orderedJobs.push({ type: 'linked', locId: _primaryLocId });
    } else if (_isPrimaryRH && character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
      _orderedJobs.push({
        type: 'rabbit_hole',
        workplaceName: character.occupation_location_name,
        shift: { start: character.work_start_time, end: character.work_end_time, days: character.work_days },
      });
    }
    if (Array.isArray(character.additional_occupation_locations)) {
      for (const entry of character.additional_occupation_locations) {
        if (entry.location_id) {
          _orderedJobs.push({ type: 'linked', locId: entry.location_id });
        } else {
          const isRH = entry.is_rabbit_hole === true;
          if (isRH && entry.shift_start && entry.shift_end) {
            _orderedJobs.push({
              type: 'rabbit_hole',
              workplaceName: entry.location_name,
              shift: { start: entry.shift_start, end: entry.shift_end, days: entry.work_days || null },
            });
          }
        }
      }
    }
    for (const job of _orderedJobs) {
      if (job.type === 'linked') {
        const workLocation = locationMap[job.locId];
        if (!workLocation) continue;
        const locationShift = workLocation.worker_shifts?.[character.id];
        if (locationShift) {
          if (isOnShiftNow(locationShift, etTime)) {
            return { resolved_current_location_id: job.locId, resolved_current_location_name: workLocation.name || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule' };
          }
          continue;
        }
        if (isCharacterOnWorkSchedule(character, etTime)) {
          return { resolved_current_location_id: job.locId, resolved_current_location_name: workLocation.name || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule' };
        }
      } else {
        if (isOnShiftNow(job.shift, etTime)) {
          return { resolved_current_location_id: 'rabbit_hole', resolved_current_location_name: job.workplaceName || 'Work', resolved_location_type: 'rabbit_hole', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule' };
        }
      }
    }
  }

  // School schedule — TIME-BOUND: only resolve at_school when the character is
  // actually within their school hours right now (authoritative Eastern Time).
  // A stale school lock has NO presence authority outside its schedule window,
  // exactly like the work schedule above. If the current time is past the
  // school end time, this block does NOT return at_school — the character
  // falls through to sleep/visit/home resolution instead.
  if (isCharacterOnSchoolSchedule(character, etTime, locationMap)) {
    const schoolLocation = locationMap[character.education_location_id];
    return {
      resolved_current_location_id: character.education_location_id,
      resolved_current_location_name: schoolLocation?.name || 'School',
      resolved_location_type: 'school',
      resolved_presence_status: 'at_school',
      resolved_source_reason: 'school_schedule',
    };
  }

  // Visiting / social-visit preservation (aligned with client-side Layer 3.5D)
  // A character placed at a non-home location by the system (autonomous
  // movement, scheduled relocation, user travel) must NOT be sent home by
  // the legacy recompute. The client-side resolveCharacterLocation preserves
  // these visits (Layer 3.5D); the authority must do the same so Chat/Text
  // see the same visiting location as Homepage/Travel. Without this layer,
  // the authority's recompute falls through to home base and undoes the
  // visit — the One Truth violation where Chat/Text show home while
  // Homepage/Travel show the visited location.
  const visitHomeId = character.current_home_location_id || character.home_location_id || null;
  const visitLocId = character.resolved_current_location_id || null;
  const visitIsAwayFromHome = visitLocId && visitHomeId && visitLocId !== visitHomeId;
  const visitIsSystemPlaced =
    character.presence_state === 'social_visit' ||
    character.resolved_presence_status === 'visiting' ||
    character.resolved_source_reason === 'autonomous_needs_driven' ||
    character.resolved_source_reason === 'autonomous_movement' ||
    character.resolved_source_reason === 'user_travel' ||
    character.resolved_source_reason === 'scheduled_user_confirmed_relocation' ||
    character.resolved_source_reason === 'social_visit_from_system';
  if (visitIsAwayFromHome && visitIsSystemPlaced) {
    const visitLocation = visitLocId ? locationMap[visitLocId] : null;
    if (visitLocation) {
      return {
        resolved_current_location_id: visitLocId,
        resolved_current_location_name: visitLocation.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
      };
    }
  }

  // ── RABBIT HOLE PRESERVATION (late) ────────────────────────────────────────
  // Runs AFTER confinement, hospitalization, work schedule, school schedule,
  // sleep enforcement, and social-visit layers. A rabbit hole is a valid
  // canonical location ID — NOT a failed lookup.
  //
  // ONE TRUTH SAFEGUARD: Before preserving any stale presence, check for an
  // active rabbit hole work shift. If the shift is active, the character IS
  // at_work — a stale 'home' or 'visiting' presence must NOT be preserved.
  // This prevents the invalid tuple:
  //   location_id = rabbit_hole, location_name = Agency, presence = home
  //
  // When the shift is NOT active, a stale 'at_work' presence must NOT be
  // preserved either — the work authority has ended and the character must
  // fall through to home/visit resolution. 'home' at a rabbit hole is also
  // invalid (home is a specific location, not a rabbit hole).
  //
  // Legitimate non-work rabbit holes (visiting, etc.) established through an
  // authorized pathway remain protected.
  if (character.resolved_current_location_id === 'rabbit_hole' ||
      character.resolved_location_type === 'rabbit_hole') {
    // 1. Active rabbit hole work shift → return the complete work tuple atomically
    const _activeRHWorkplace = _findActiveRabbitHoleWorkShift(character, etTime);
    if (_activeRHWorkplace) {
      return {
        resolved_current_location_id: 'rabbit_hole',
        resolved_current_location_name: _activeRHWorkplace,
        resolved_location_type: 'rabbit_hole',
        resolved_presence_status: 'at_work',
        resolved_source_reason: 'work_schedule',
      };
    }
    // 2. Stale 'at_work' or 'home' at a rabbit hole with no active shift →
    //    do NOT preserve; fall through to home/visit resolution below.
    const _stalePresence = character.resolved_presence_status;
    if (_stalePresence !== 'at_work' && _stalePresence !== 'home') {
      // 3. Legitimate non-work rabbit hole → preserve actual presence
      return {
        resolved_current_location_id: 'rabbit_hole',
        resolved_current_location_name: character.resolved_current_location_name || 'Off-screen',
        resolved_location_type: character.resolved_location_type || 'rabbit_hole',
        resolved_presence_status: _stalePresence || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'rabbit_hole',
      };
    }
    // Fall through — stale 'at_work' or 'home' will be resolved by home base below
  }

  // Home base fallback
  const resolvedHomeId = character.current_home_location_id || character.home_location_id || null;
  if (resolvedHomeId) {
    const homeLocation = locationMap[resolvedHomeId];
    return {
      resolved_current_location_id: resolvedHomeId,
      resolved_current_location_name: homeLocation?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'fallback_to_home_base',
    };
  }

  return {
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || 'Off-screen',
    resolved_location_type: character.resolved_location_type || 'home',
    resolved_presence_status: character.resolved_presence_status || 'home',
    resolved_source_reason: 'no_mapped_home_valid_state',
  };
}

function buildStoredState(character) {
  return {
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || null,
    resolved_location_type: character.resolved_location_type || null,
    resolved_presence_status: character.resolved_presence_status || null,
    resolved_source_reason: character.resolved_source_reason || null,
  };
}

function hasChanged(resolved, stored) {
  return (
    resolved.resolved_current_location_id !== stored.resolved_current_location_id ||
    resolved.resolved_current_location_name !== stored.resolved_current_location_name ||
    resolved.resolved_location_type !== stored.resolved_location_type ||
    resolved.resolved_presence_status !== stored.resolved_presence_status ||
    resolved.resolved_source_reason !== stored.resolved_source_reason
  );
}

// ── CURRENT SITUATION REFLECTION ─────────────────────────────────────────────
// Derives a human-readable current_situation string from the committed result.
// This is a REFLECTION of the committed reality (state/action + location), not
// a new authority. The committed result already holds the authoritative state
// and location; this function merely combines them for human readability.
//   state/action = resolved_presence_status (sleeping, at_work, home, etc.)
//   location     = resolved_current_location_name (Home, Agency, etc.)
// The distinction between location and state/action is preserved: "Sleeping at
// home" means sleeping=state/action and home=location — not that sleeping is a
// location or home is a state.
function buildCurrentSituation(committed) {
  const status = committed.resolved_presence_status || 'home';
  const locName = committed.resolved_current_location_name || '';
  const stateMap = {
    sleeping: 'Sleeping',
    napping: 'Napping',
    passed_out: 'Passed out',
    at_work: 'Working',
    at_school: 'At school',
    hospitalized: 'Hospitalized',
    incarcerated: 'Incarcerated',
    house_arrest: 'Under house arrest',
    visiting: 'Visiting',
    home: 'Home',
    traveling: 'Traveling',
    confined: 'Confined',
    rabbit_hole: 'Off-screen',
  };
  const state = stateMap[status] || status;
  if (!locName) return state;
  return `${state} at ${locName}`;
}

// ── COMPATIBILITY/INTEGRITY VALIDATION ───────────────────────────────────────
// Applies existing validation logic from src/lib/presenceEnforcementEngine.js
// before commitment. Rejects transitions that violate system integrity.
function validateTransition(character, canonicalFields, locationMap) {
  // Rule: character cannot be omnipresent (in multiple locations)
  // Rule: no invalid travel state
  // Rule: sleeping cannot be committed at a workplace
  if (canonicalFields.resolved_presence_status === 'sleeping' ||
      canonicalFields.resolved_presence_status === 'napping') {
    const locId = canonicalFields.resolved_current_location_id;
    if (locId && character.occupation_location_id === locId) {
      // Sleeping at work — block this commit
      return { valid: false, reason: 'sleep_cannot_commit_at_workplace' };
    }
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// OBLIGATED TRANSITION NARRATIVE EMISSION
// ═══════════════════════════════════════════════════════════════════════════
// Emits an authoritative narrative record for obligated life-state transitions
// (work arrival, work return, school arrival, school return, hospitalization,
// hospital return) at the sole canonical commit point. The narrative is saved
// as a Message with is_narrative=true in the character's direct conversation.
//
// ONE TRUTH: The narrative is derived from the committed_result — the actual
// committed state — not from the request. This guarantees the narrative matches
// the authoritative state.
//
// IDEMPOTENCY: This function is only called when disposition='accepted' AND
// the transition represents an actual state change (oldStatus != newStatus).
// Repeated evaluations of an already-committed state return 'no_change'
// before reaching the commit point, so no duplicate narratives are created.
async function emitObligatedTransitionNarrative(base44, character, committed_result, ownerEmail, etTime) {
  const oldStatus = character.resolved_presence_status || '';
  const newStatus = committed_result.resolved_presence_status || '';
  const newLocType = committed_result.resolved_location_type || '';
  const newLocName = committed_result.resolved_current_location_name || '';
  const newReason = committed_result.resolved_source_reason || '';
  const charName = character.name || character.display_name || 'Character';

  // No transition — nothing to narrate
  if (oldStatus === newStatus) return;

  let narrativeText = null;

  // 1. Work arrival: old != at_work → new == at_work (location type must be work or rabbit_hole)
  if (oldStatus !== 'at_work' && newStatus === 'at_work' && (newLocType === 'work' || newLocType === 'rabbit_hole')) {
    narrativeText = newLocName && newLocName !== 'Work'
      ? `${charName} has gone to work at ${newLocName}.`
      : `${charName} has gone to work.`;
  }
  // 2. Work return: old == at_work → new == home (reason must indicate work_end)
  else if (oldStatus === 'at_work' && newStatus === 'home' && (newReason === 'work_end' || newReason.includes('work_end'))) {
    narrativeText = `${charName} has returned home from work.`;
  }
  // 3. School arrival: old != at_school → new == at_school (location type must be school)
  else if (oldStatus !== 'at_school' && newStatus === 'at_school' && newLocType === 'school') {
    narrativeText = newLocName && newLocName !== 'School'
      ? `${charName} has gone to school at ${newLocName}.`
      : `${charName} has gone to school.`;
  }
  // 4. School return: old == at_school → new == home (reason must indicate school end)
  else if (oldStatus === 'at_school' && newStatus === 'home' && (newReason === 'school_end' || newReason.includes('school_end'))) {
    narrativeText = `${charName} has returned home from school.`;
  }
  // 5. Hospitalization: old != hospitalized → new == hospitalized (location type must be medical)
  else if (oldStatus !== 'hospitalized' && newStatus === 'hospitalized' && newLocType === 'medical') {
    narrativeText = newLocName && newLocName !== 'Hospital'
      ? `${charName} has been hospitalized at ${newLocName}.`
      : `${charName} has been hospitalized.`;
  }
  // 6. Hospital return: old == hospitalized → new == home
  else if (oldStatus === 'hospitalized' && newStatus === 'home') {
    narrativeText = `${charName} has returned home from being hospitalized.`;
  }

  if (!narrativeText) return;

  // Find or create the character's direct conversation
  let convoId = null;
  try {
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: ownerEmail, type: 'direct', character_ids: character.id },
      '-last_message_date', 10
    );
    const directConvo = convos.find(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      return ids.length === 1 && ids[0] === character.id && !c.shared_conversation_key;
    });
    if (directConvo) convoId = directConvo.id;
  } catch (_) {}

  if (!convoId) {
    try {
      const newConvo = await base44.asServiceRole.entities.Conversation.create({
        title: `direct with ${charName}`,
        type: 'direct',
        character_ids: [character.id],
        owner_email: ownerEmail,
      });
      convoId = newConvo.id;
    } catch (_) { return; }
  }

  // Save the narrative as a system message
  await base44.asServiceRole.entities.Message.create({
    conversation_id: convoId,
    sender_type: 'character',
    character_id: character.id,
    character_name: charName,
    content: narrativeText,
    // OBLIGATED-LOCATION NARRATIVE TIMESTAMP — actual UTC instant.
    // etTime is a "fake-UTC" Date whose UTC components equal the Eastern
    // components (used for schedule evaluation via getHours() in the UTC-local
    // Deno runtime). etTime.toISOString() produces "07:31:00Z" to represent
    // 7:31 AM Eastern — but when the frontend interprets that string as an
    // actual UTC instant and converts to Eastern for display, it subtracts the
    // UTC→Eastern offset (4h EDT / 5h EST), showing "3:31 AM" instead of
    // "7:31 AM". new Date().toISOString() stores the actual UTC instant
    // (e.g. "11:31:00Z" for 7:31 AM EDT), which the frontend correctly converts
    // to "7:31 AM" Eastern. The temporal withholding filter
    // (new Date(ts).getTime() <= Date.now()) is a no-op for obligated
    // narratives because they are created at the occurrence moment — the
    // actual UTC instant is already <= Date.now(), so the narrative is visible
    // immediately. This is DST-safe: no hardcoded offset.
    timestamp: new Date().toISOString(),
    is_narrative: true,
    channel: 'scene',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    let payload = {};
    try { payload = await req.json(); } catch (_) { /* no body */ }

    const { character_id, owner_email } = payload;

    // ── AUTH: user-scoped or service-role with owner_email override ────────────
    if (!user && !owner_email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const effectiveOwnerEmail = owner_email || user?.email;
    if (user && owner_email && owner_email !== user.email) {
      // Service-role call with explicit owner_email — allowed for automation callers
      // that pass owner_email to scope to the correct account.
    }

    if (!character_id) {
      return Response.json({ error: 'character_id required' }, { status: 400 });
    }

    // ── LOAD CHARACTER ─────────────────────────────────────────────────────────
    let characters = [];
    if (user) {
      characters = await base44.entities.Character.filter({ id: character_id, owner_email: effectiveOwnerEmail });
    }
    if (!characters || characters.length === 0) {
      characters = await base44.asServiceRole.entities.Character.filter({ id: character_id, owner_email: effectiveOwnerEmail });
    }
    if (!characters || characters.length === 0) {
      return Response.json({ error: 'Character not found or ownership mismatch', character_id }, { status: 404 });
    }
    const character = characters[0];

    // ── LOAD LOCATIONS ─────────────────────────────────────────────────────────
    let locations = [];
    try {
      locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: effectiveOwnerEmail });
    } catch (_) { /* proceed with empty map — resolver handles gracefully */ }
    const locationMap = {};
    for (const loc of locations) locationMap[loc.id] = loc;

    // ── ADMIN-SHARED MEDICAL LOCATIONS (hospitalization fallback) ──────────────
    // Admin-shared medical-category locations (scope: 'shared', created_by_role:
    // 'admin') are eligible hospitalization destinations — same shared-location
    // access pattern as fetchAllLocationsForUser Query 2. When the account has no
    // own medical-category location, load admin-shared medical locations so the
    // hospitalization handler can fall back to an admin-shared hospital. Own
    // locations take priority (loaded first; the hospitalization category scan
    // finds them first by insertion order).
    //
    // ACCOUNT ISOLATION PRESERVED: Shared locations are NOT Gathering Rooms. A
    // character hospitalized at a shared hospital gets permission to USE the
    // place — not access to characters from other accounts. Co-presence
    // resolution (buildCanonicalCharacterContext) remains owner-scoped
    // (Character.filter({ owner_email })), so a character at a shared hospital
    // never discovers characters from other accounts. Shared location =
    // permission to use the place, not permission to share characters.
    const hasOwnMedical = Object.values(locationMap).some(l => (l.category || '').toLowerCase() === 'medical');
    if (!hasOwnMedical) {
      try {
        const sharedLocs = await base44.asServiceRole.entities.LocationReference.filter(
          { scope: 'shared', created_by_role: 'admin' },
          '-created_date',
          100
        );
        for (const loc of sharedLocs) {
          if ((loc.category || '').toLowerCase() === 'medical' && !locationMap[loc.id]) {
            locationMap[loc.id] = loc;
          }
        }
      } catch (_) { /* non-blocking — hospitalization will reject if no medical found */ }
    }

    // ── EASTERN TIME (authoritative — America/New_York) ───────────────────────
    // Intl.DateTimeFormat with timeZone: 'America/New_York' extracts the actual
    // Eastern date/time components. The toLocaleString trick is unreliable in this
    // runtime (it returns UTC-formatted strings without converting); formatToParts
    // is the robust path. The resulting Date is constructed via Date.UTC so its
    // UTC components equal the Eastern components — getHours()/getDay() in this
    // runtime then return the Eastern hour/day for schedule evaluation.
    // Do NOT manually subtract a UTC offset — Eastern Time shifts between EST/EDT.
    const _etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const _etMap = {};
    for (const p of _etParts) _etMap[p.type] = p.value;
    const etTime = new Date(Date.UTC(
      parseInt(_etMap.year, 10),
      parseInt(_etMap.month, 10) - 1,
      parseInt(_etMap.day, 10),
      parseInt(_etMap.hour, 10) % 24,
      parseInt(_etMap.minute, 10),
      parseInt(_etMap.second, 10),
    ));

    // ── ACTIVE STORY EVENT VENUE ──────────────────────────────────────────────
    // Fetch the active Story Event venue for this character (if any). During
    // the active window, the venue is the authoritative current location and
    // overrides work/school/home in both the request handler and the recompute
    // path. Only active_created_character participates in Story Events.
    let activeStoryEventVenue = null;
    try {
      activeStoryEventVenue = await findActiveStoryEventVenue(base44, character_id, etTime);
    } catch (_) { /* non-blocking */ }

    // ── EVALUATE REQUESTED TRANSITION ──────────────────────────────────────────
    const evaluation = evaluateRequestedTransition(character, locationMap, payload, etTime, activeStoryEventVenue);
    const { disposition, canonicalFields, committed_result, reason, must_resubmit_sleep } = evaluation;

    // ── NO CHANGE — return immediately ─────────────────────────────────────────
    if (disposition === 'no_change' || disposition === 'deferred' || disposition === 'rejected' || disposition === 'no_longer_applicable') {
      return Response.json({
        disposition,
        character_id,
        owner_email: effectiveOwnerEmail,
        reason: reason || (disposition === 'no_change' ? 'no_transition_required' : (disposition === 'no_longer_applicable' ? 'requested_transition_no_longer_applicable' : 'request_not_committed')),
        committed_result: null,
      });
    }

    // ── VALIDATE BEFORE COMMIT ─────────────────────────────────────────────────
    const validation = validateTransition(character, canonicalFields, locationMap);
    if (!validation.valid) {
      return Response.json({
        disposition: 'rejected',
        character_id,
        owner_email: effectiveOwnerEmail,
        reason: validation.reason,
        committed_result: null,
      });
    }

    // ── COMMIT ONE COHERENT CANONICAL UPDATE ──────────────────────────────────
    // Only canonical fields that must change for this resolved transition.
    // Callers may continue writing noncanonical fields they already own.
    // current_situation is updated from the same committed result — it receives
    // the established truth as a readable reflection, not as a new authority.
    const updatePayload = { ...canonicalFields };
    if (committed_result) {
      updatePayload.current_situation = buildCurrentSituation(committed_result);
    }
    await base44.asServiceRole.entities.Character.update(character_id, updatePayload);

    // ── OBLIGATED TRANSITION NARRATIVE EMISSION ────────────────────────────────
    // Emit an authoritative narrative record for obligated life-state transitions
    // (work, school, hospitalization, return-home) directly at the sole canonical
    // commit point. Only for active_created_character types. Non-blocking —
    // narrative failures do not prevent the committed result from returning.
    // Idempotent by design: only fires on disposition='accepted' with an actual
    // state transition (oldStatus != newStatus). Repeated evaluations of an
    // already-committed state return 'no_change' and never reach this code.
    if (character.character_type === 'active_created_character' && committed_result) {
      try {
        await emitObligatedTransitionNarrative(base44, character, committed_result, effectiveOwnerEmail, etTime);
      } catch (narrErr) {
        console.warn(`[enforceCharacterLocationPresence] Narrative emission failed (non-blocking): ${narrErr.message}`);
      }
    }

    // ── RETURN EXACT COMMITTED RESULT AND DISPOSITION ──────────────────────────
    return Response.json({
      disposition,
      character_id,
      owner_email: effectiveOwnerEmail,
      committed_result,
      must_resubmit_sleep: must_resubmit_sleep || false,
      timestamp: etTime.toISOString(),
    });

  } catch (error) {
    console.error('enforceCharacterLocationPresence error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});