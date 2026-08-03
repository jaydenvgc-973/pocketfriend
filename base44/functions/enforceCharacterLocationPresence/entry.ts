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
function isCharacterOnSchoolSchedule(character, etTime, locationMap) {
  if (character.student_status !== 'enrolled') return false;
  if (!character.education_location_id) return false;

  const nowMin = etTime.getHours() * 60 + etTime.getMinutes();
  const dayOfWeek = etTime.getDay();

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

function evaluateRequestedTransition(character, locationMap, requested, etTime) {
  const currentStatus = character.resolved_presence_status || '';
  const currentLocId = character.resolved_current_location_id || '';
  const requestedStatus = requested.requested_presence_status || null;
  const requestedLocId = requested.requested_location_id || null;

  const hasAnyRequest =
    !!requestedStatus ||
    !!requestedLocId ||
    requested.requested_work_end === true ||
    requested.requested_lock_release === true ||
    requested.requested_relocation === true;
  if (!hasAnyRequest) {
    return evaluateLegacyRecompute(character, locationMap, etTime);
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
  }

  // ── SLEEP REQUESTED AT WORK — movement first, sleep after arrival ──────────
  if (requestedStatus === 'sleeping' || requestedStatus === 'napping') {
    const isCurrentlyAtWork = currentStatus === 'at_work' ||
      (currentLocId && character.occupation_location_id && currentLocId === character.occupation_location_id) ||
      (Array.isArray(character.additional_occupation_locations) &&
        character.additional_occupation_locations.some(loc => loc.location_id === currentLocId));

    if (isCurrentlyAtWork) {
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
          must_resubmit_sleep: true,
        };
      }
      return {
        disposition: 'deferred',
        canonicalFields: {},
        reason: 'sleep_requested_at_work_no_valid_sleep_location',
      };
    }

    const sleepHomeId = requestedLocId || resolveValidSleepLocationId(character, locationMap);
    if (!sleepHomeId) {
      return { disposition: 'deferred', canonicalFields: {}, reason: 'no_valid_sleep_location' };
    }
    const sleepHomeLoc = locationMap[sleepHomeId];
    if (!isValidSleepLocation(sleepHomeLoc)) {
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

  // ── PASS-OUT REQUESTED ──────────────────────────────────────────────────
  if (requestedStatus === 'passed_out') {
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
  if (requestedStatus === 'home' && ['sleeping', 'napping', 'passed_out', 'hospitalized'].includes(currentStatus)) {
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
  if (requestedStatus === 'at_work') {
    if (character.resolved_presence_status === 'hospitalized') {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'hospitalized_work_blocked' };
    }
    if (character.resolved_presence_status === 'passed_out') {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'passed_out_work_blocked' };
    }
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
      if (requested.requested_authority !== 'enforceCharacterWorkSchedule') {
        return { disposition: 'rejected', canonicalFields: {}, reason: 'rabbit_hole_requires_scheduler_authority' };
      }
      // Validate against saved rabbit-hole occupation entries — use ONLY the actual saved
      // destination name (occupation_location_name for primary, location_name for additional).
      const _rhNames = [];
      if (!character.occupation_location_id) {
        const isRH = character.work_details?.is_rabbit_hole === true || !!character.occupation_location_name;
        if (isRH && character.occupation_location_name) {
          _rhNames.push(character.occupation_location_name);
        }
      }
      if (Array.isArray(character.additional_occupation_locations)) {
        for (const entry of character.additional_occupation_locations) {
          if (entry.location_id) continue;
          const isRH = entry.is_rabbit_hole === true || !!entry.location_name;
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
        resolved_current_location_id: null,
        resolved_current_location_name: requested.requested_location_name,
        resolved_location_type: 'work',
        resolved_presence_status: 'at_work',
        resolved_source_reason: requested.requested_source_reason || 'work_schedule',
        resolved_last_updated_at: etTime.toISOString(),
        presence_stay_lock: true,
        presence_stay_lock_reason: 'work_shift',
        presence_stay_lock_authority: 'enforceCharacterWorkSchedule',
        presence_stay_lock_set_at: etTime.toISOString(),
        presence_stay_lock_created_by: 'system_automation',
      };
      if (wasSleeping) {
        canonicalFields.last_wake_time = etTime.toISOString();
      }
      return {
        disposition: 'accepted',
        canonicalFields,
        committed_result: {
          resolved_current_location_id: null,
          resolved_current_location_name: requested.requested_location_name,
          resolved_location_type: 'work',
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

  // ── WORK END REQUESTED ────────────────────────────────────────────────────
  if (requested.requested_work_end === true) {
    if (currentStatus !== 'at_work' && currentLocId !== character.occupation_location_id) {
      return { disposition: 'no_change', canonicalFields: {}, reason: 'not_at_work' };
    }
    const homeLocId = character.current_home_location_id || character.home_location_id;
    if (!homeLocId) {
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
  if (requestedStatus === 'visiting' || requested.requested_relocation === true) {
    const destLocId = requestedLocId;
    if (!destLocId) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'no_destination' };
    }
    const destLoc = locationMap[destLocId];
    if (!destLoc) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'destination_not_in_scope' };
    }
    if (character.is_jailed || character.house_arrest_active) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'confinement_block' };
    }
    if (character.resolved_presence_status === 'hospitalized') {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'hospitalized_relocation_blocked' };
    }
    const canonicalFields = {
      resolved_current_location_id: destLocId,
      resolved_current_location_name: destLoc.name,
      resolved_location_type: requested.requested_location_type || 'visit',
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
        resolved_current_location_id: destLocId,
        resolved_current_location_name: destLoc.name,
        resolved_location_type: requested.requested_location_type || 'visit',
        resolved_presence_status: requestedStatus || 'visiting',
        resolved_source_reason: requested.requested_source_reason || 'relocation',
      },
    };
  }

  // ── HOSPITALIZATION REQUESTED ──────────────────────────────────────────────
  if (requestedStatus === 'hospitalized') {
    let hospitalLocId = requestedLocId || null;
    let hospitalLoc = hospitalLocId ? locationMap[hospitalLocId] : null;
    if (!hospitalLoc || (hospitalLoc.category || '').toLowerCase() !== 'medical') {
      const medLoc = Object.values(locationMap).find(l => (l.category || '').toLowerCase() === 'medical');
      if (medLoc) { hospitalLoc = medLoc; hospitalLocId = medLoc.id; }
    }
    if (currentStatus === 'hospitalized') {
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
    const canonicalFields = {
      resolved_presence_status: 'hospitalized',
      resolved_source_reason: requested.requested_source_reason || 'medical_emergency',
      resolved_last_updated_at: etTime.toISOString(),
      current_activity: 'hospitalized — health collapsed',
      resolved_location_type: 'medical',
    };
    if (hospitalLocId) {
      canonicalFields.resolved_current_location_id = hospitalLocId;
      canonicalFields.resolved_current_location_name = hospitalLoc?.name || 'Hospital';
    }
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
        resolved_current_location_id: hospitalLocId || currentLocId,
        resolved_current_location_name: hospitalLoc?.name || character.resolved_current_location_name || 'Hospital',
        resolved_location_type: hospitalLocId ? 'medical' : (character.resolved_location_type || 'medical'),
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

  if (hasAnyRequest) {
    return {
      disposition: 'no_longer_applicable',
      canonicalFields: {},
      reason: 'requested_transition_not_applicable_to_current_state',
      committed_result: null,
    };
  }

  return evaluateLegacyRecompute(character, locationMap, etTime);
}

function evaluateLegacyRecompute(character, locationMap, etTime) {
  const resolved = computeResolvedLocation(character, locationMap, etTime);
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

function computeResolvedLocation(character, locationMap, etTime) {
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

  const todayET = etTime.toISOString().slice(0, 10);
  const hasValidCallout = character.work_exception_status === 'called_out' && character.work_exception_date === todayET;
  if (!hasValidCallout) {
    const _isPrimaryRH = !character.occupation_location_id &&
      (character.work_details?.is_rabbit_hole === true || !!character.occupation_location_name);
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
          const isRH = entry.is_rabbit_hole === true || !!entry.location_name;
          if (isRH && entry.work_start_time && entry.work_end_time) {
            _orderedJobs.push({
              type: 'rabbit_hole',
              workplaceName: entry.location_name,
              shift: { start: entry.work_start_time, end: entry.work_end_time, days: entry.work_days || null },
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
          return { resolved_current_location_id: null, resolved_current_location_name: job.workplaceName || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule' };
        }
      }
    }
  }

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

function validateTransition(character, canonicalFields, locationMap) {
  if (canonicalFields.resolved_presence_status === 'sleeping' ||
      canonicalFields.resolved_presence_status === 'napping') {
    const locId = canonicalFields.resolved_current_location_id;
    if (locId && character.occupation_location_id === locId) {
      return { valid: false, reason: 'sleep_cannot_commit_at_workplace' };
    }
  }
  return { valid: true };
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

    if (!user && !owner_email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const effectiveOwnerEmail = owner_email || user?.email;
    if (user && owner_email && owner_email !== user.email) {
      // Service-role call with explicit owner_email — allowed for automation callers
    }

    if (!character_id) {
      return Response.json({ error: 'character_id required' }, { status: 400 });
    }

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

    let locations = [];
    try {
      locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: effectiveOwnerEmail });
    } catch (_) { /* proceed with empty map */ }
    const locationMap = {};
    for (const loc of locations) locationMap[loc.id] = loc;

    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const evaluation = evaluateRequestedTransition(character, locationMap, payload, etTime);
    const { disposition, canonicalFields, committed_result, reason, must_resubmit_sleep } = evaluation;

    if (disposition === 'no_change' || disposition === 'deferred' || disposition === 'rejected' || disposition === 'no_longer_applicable') {
      return Response.json({
        disposition,
        character_id,
        owner_email: effectiveOwnerEmail,
        reason: reason || (disposition === 'no_change' ? 'no_transition_required' : (disposition === 'no_longer_applicable' ? 'requested_transition_no_longer_applicable' : 'request_not_committed')),
        committed_result: null,
      });
    }

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

    const updatePayload = { ...canonicalFields };
    await base44.asServiceRole.entities.Character.update(character_id, updatePayload);

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