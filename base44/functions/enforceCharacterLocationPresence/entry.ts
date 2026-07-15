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

/**
 * Evaluate a requested transition against the complete current state.
 * Returns a disposition and the canonical fields to commit.
 *
 * This is the RESOLVER — it does NOT rediscover what the caller intended.
 * It evaluates the requested transition against the current state and
 * determines: accepted, modified, redirected, deferred, rejected, or no_change.
 */
function evaluateRequestedTransition(character, locationMap, requested, etTime) {
  const currentStatus = character.resolved_presence_status || '';
  const currentLocId = character.resolved_current_location_id || '';
  const requestedStatus = requested.requested_presence_status || null;
  const requestedLocId = requested.requested_location_id || null;

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
    const workLocId = requestedLocId || character.occupation_location_id;
    if (!workLocId) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'no_work_location' };
    }
    const workLoc = locationMap[workLocId];
    // Blocked from work if critically ill
    if ((character.health_value ?? 80) < 20) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'health_critical_work_blocked' };
    }
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
    const destLoc = locationMap[destLocId];
    if (!destLoc) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'destination_not_in_scope' };
    }
    // Incarcerated/house-arrest characters cannot relocate
    if (character.is_jailed || character.house_arrest_active) {
      return { disposition: 'rejected', canonicalFields: {}, reason: 'confinement_block' };
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
    if (currentStatus === 'hospitalized') {
      return { disposition: 'no_change', canonicalFields: {} };
    }
    let hospitalLocId = requestedLocId || null;
    let hospitalLoc = hospitalLocId ? locationMap[hospitalLocId] : null;
    if (!hospitalLoc || (hospitalLoc.category || '').toLowerCase() !== 'medical') {
      const medLoc = Object.values(locationMap).find(l => (l.category || '').toLowerCase() === 'medical');
      if (medLoc) { hospitalLoc = medLoc; hospitalLocId = medLoc.id; }
    }
    const canonicalFields = {
      resolved_presence_status: 'hospitalized',
      resolved_source_reason: requested.requested_source_reason || 'medical_emergency',
      resolved_last_updated_at: etTime.toISOString(),
      current_activity: 'hospitalized — health collapsed',
    };
    if (hospitalLocId) {
      canonicalFields.resolved_current_location_id = hospitalLocId;
      canonicalFields.resolved_current_location_name = hospitalLoc?.name || 'Hospital';
      canonicalFields.resolved_location_type = 'medical';
    }
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
  return evaluateLegacyRecompute(character, locationMap, etTime);
}

/**
 * Legacy recompute path — when no specific transition is requested, the
 * authority recomputes the resolved location using the inline resolver
 * (aligned with src/lib/locationResolutionEngine.js).
 */
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

// ── INLINE RESOLVER (aligned with src/lib/locationResolutionEngine.js) ───────
function computeResolvedLocation(character, locationMap, etTime) {
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

  // Sleep state lock — preserve DB truth
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

  // Work schedule
  const todayET = etTime.toISOString().slice(0, 10);
  const hasValidCallout = character.work_exception_status === 'called_out' && character.work_exception_date === todayET;
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
      const locationShift = workLocation.worker_shifts?.[character.id];
      if (locationShift) {
        if (isOnShiftNow(locationShift, etTime)) {
          return {
            resolved_current_location_id: workLocId,
            resolved_current_location_name: workLocation.name || 'Work',
            resolved_location_type: 'work',
            resolved_presence_status: 'at_work',
            resolved_source_reason: 'work_schedule',
          };
        }
        continue;
      }
      if (isCharacterOnWorkSchedule(character, etTime)) {
        return {
          resolved_current_location_id: workLocId,
          resolved_current_location_name: workLocation.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
        };
      }
    }
  }

  // School schedule
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLocation = locationMap[character.education_location_id];
    if (schoolLocation) {
      return {
        resolved_current_location_id: character.education_location_id,
        resolved_current_location_name: schoolLocation.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
      };
    }
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

    // ── EASTERN TIME ───────────────────────────────────────────────────────────
    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // ── EVALUATE REQUESTED TRANSITION ──────────────────────────────────────────
    const evaluation = evaluateRequestedTransition(character, locationMap, payload, etTime);
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
    const updatePayload = { ...canonicalFields };
    await base44.asServiceRole.entities.Character.update(character_id, updatePayload);

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