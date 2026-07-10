import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── READ-ONLY DIAGNOSTIC: Anderson's Bar Substitution Source Tracer ────────
// This function does NOT write anything. It traces the exact source of the
// "At work · Anderson's Bar" substitution for Ethan's Wednesday VGC Recovery
// Yard shift.
//
// It inspects:
// 1. Character work-related fields (occupation_location_id, current_work_location_id,
//    additional_occupation_locations, work_start_time, work_end_time, work_days)
// 2. All LocationReference records with worker_shifts for this character
// 3. The resolution engine's work location iteration order
// 4. LocationHistory entries for the disputed period
// 5. SleepTransition records
// 6. The exact code path that would select Anderson's Bar over VGC Recovery Yard

function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isOnShiftNow(shift, etTime) {
  if (!shift?.start || !shift?.end) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const today = etTime.getDay();
  const yesterday = (today + 6) % 7;
  const startMin = toMin(shift.start);
  const endMin = toMin(shift.end);
  const hasDays = shift.days && shift.days.length > 0;
  if (endMin < startMin) {
    const afterStartToday = (!hasDays || shift.days.includes(today)) && now >= startMin;
    const beforeEndYesterday = (!hasDays || shift.days.includes(yesterday)) && now < endMin;
    return afterStartToday || beforeEndYesterday;
  }
  if (hasDays && !shift.days.includes(today)) return false;
  return now >= startMin && now < endMin;
}

function isCharacterOnWorkSchedule(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const dayOfWeek = etTime.getDay();
  if (!character.work_days.includes(dayOfWeek)) return false;
  const startMin = toMin(character.work_start_time);
  const endMin = toMin(character.work_end_time);
  if (endMin < startMin) {
    return now >= startMin || now < endMin;
  }
  return now >= startMin && now < endMin;
}

Deno.serve(async (req) => {
  try {
    // ── DISABLED ────────────────────────────────────────────────────────────
    // This function was created outside the authorized scope. It simulated
    // current resolver behavior using current data — it did NOT capture the
    // original rendered timeline object or historical execution. Its output
    // is a current-state simulation only, not original execution evidence.
    // Preserved for audit. Do NOT execute again.
    return Response.json(
      { disabled: true, reason: 'Function disabled — created outside scope. Output was current-state simulation, not execution proof. Preserved for audit only.' },
      { status: 403 }
    );
    // eslint-disable-next-line no-unreachable
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = getNowET();
    const todayET = nowET.toISOString().slice(0, 10);
    const dayOfWeek = nowET.getDay();
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    // Find Ethan Thompson
    const ethanCandidates = await base44.asServiceRole.entities.Character.filter({
      name: 'Ethan Thompson',
      character_type: 'active_created_character'
    });
    const ethan = ethanCandidates[0];
    if (!ethan) return Response.json({ error: 'Ethan Thompson not found' }, { status: 404 });

    // Load all locations for the owner
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: ethan.owner_email }, null, 300
    );
    const locationMap = {};
    allLocations.forEach(l => { if (l?.id) locationMap[l.id] = l; });

    // ── 1. CHARACTER WORK FIELDS ────────────────────────────────────────────
    const charWorkFields = {
      character_id: ethan.id,
      character_name: ethan.name,
      owner_email: ethan.owner_email,
      occupation_location_id: ethan.occupation_location_id,
      occupation_location_name: ethan.occupation_location_name,
      current_work_location_id: ethan.current_work_location_id,
      additional_occupation_locations: ethan.additional_occupation_locations || [],
      work_start_time: ethan.work_start_time,
      work_end_time: ethan.work_end_time,
      work_days: ethan.work_days,
      resolved_presence_status: ethan.resolved_presence_status,
      resolved_current_location_id: ethan.resolved_current_location_id,
      resolved_current_location_name: ethan.resolved_current_location_name,
      resolved_location_type: ethan.resolved_location_type,
      resolved_source_reason: ethan.resolved_source_reason,
      presence_stay_lock: ethan.presence_stay_lock,
      presence_stay_lock_reason: ethan.presence_stay_lock_reason,
      last_pass_out_at: ethan.last_pass_out_at,
      last_wake_time: ethan.last_wake_time,
      last_sleep_start: ethan.last_sleep_start,
      energy_value: ethan.energy_value,
      work_exception_status: ethan.work_exception_status,
      work_exception_date: ethan.work_exception_date,
    };

    // ── 2. WORK LOCATION DETAILS ────────────────────────────────────────────
    const allWorkLocIds = [];
    if (ethan.occupation_location_id) allWorkLocIds.push(ethan.occupation_location_id);
    if (ethan.current_work_location_id && !allWorkLocIds.includes(ethan.current_work_location_id)) {
      allWorkLocIds.push(ethan.current_work_location_id);
    }
    if (ethan.additional_occupation_locations?.length > 0) {
      ethan.additional_occupation_locations.forEach(loc => {
        if (loc.location_id && !allWorkLocIds.includes(loc.location_id)) {
          allWorkLocIds.push(loc.location_id);
        }
      });
    }

    const workLocationDetails = allWorkLocIds.map((locId, idx) => {
      const loc = locationMap[locId];
      const shift = loc?.worker_shifts?.[ethan.id];
      return {
        list_position: idx,
        source_field: locId === ethan.occupation_location_id ? 'occupation_location_id'
          : locId === ethan.current_work_location_id ? 'current_work_location_id'
          : 'additional_occupation_locations',
        location_id: locId,
        location_name: loc?.name || 'NOT IN MAP',
        location_category: loc?.category,
        has_explicit_shift: !!shift,
        shift_details: shift ? { start: shift.start, end: shift.end, days: shift.days } : null,
        is_on_shift_now: shift ? isOnShiftNow(shift, nowET) : null,
        location_is_open: loc ? loc.operating_hours ? 'has_hours' : 'no_hours' : 'unknown',
        is_character_on_schedule: isCharacterOnWorkSchedule(ethan, nowET),
      };
    });

    // ── 3. RESOLUTION ENGINE TRACE ──────────────────────────────────────────
    // Simulate exactly what resolveCharacterLocation does for work locations
    const resolutionTrace = [];
    for (const workLocId of allWorkLocIds) {
      const workLocation = locationMap[workLocId];
      const step = {
        checking_location_id: workLocId,
        checking_location_name: workLocation?.name || 'NOT_IN_MAP',
        step_1_location_in_map: !!workLocation,
      };

      if (!workLocation) {
        step.result = 'SKIP - location not in map';
        resolutionTrace.push(step);
        continue;
      }

      // Check 1: explicit worker_shift
      const locationShift = workLocation.worker_shifts?.[ethan.id];
      step.step_2_has_explicit_shift = !!locationShift;
      if (locationShift) {
        const onShift = isOnShiftNow(locationShift, nowET);
        step.step_2_shift_active = onShift;
        if (onShift) {
          step.result = 'RETURN at_work at ' + workLocation.name + ' (via explicit shift)';
          resolutionTrace.push(step);
          break;
        }
        step.result = 'SKIP - shift defined but not active';
        resolutionTrace.push(step);
        continue;
      }

      // Check 2: fallback to character schedule
      const onSchedule = isCharacterOnWorkSchedule(ethan, nowET);
      step.step_3_character_on_schedule = onSchedule;
      if (onSchedule) {
        step.result = 'RETURN at_work at ' + workLocation.name + ' (via character schedule fallback)';
        resolutionTrace.push(step);
        break;
      }
      step.result = 'SKIP - character not on schedule';
      resolutionTrace.push(step);
    }

    // ── 4. WHICH LOCATION WOULD WIN? ────────────────────────────────────────
    const winningLocation = resolutionTrace.find(t => t.result?.startsWith('RETURN'));
    const andersonsBarLocations = allLocations.filter(l =>
      l.name && l.name.toLowerCase().includes('anderson')
    );
    const vgcYardLocations = allLocations.filter(l =>
      l.name && (l.name.toLowerCase().includes('vgc recovery') || l.name.toLowerCase().includes('recovery yard'))
    );

    // ── 5. LOCATION HISTORY (last 48h) ──────────────────────────────────────
    const cutoff48h = new Date(nowET.getTime() - 48 * 60 * 60 * 1000);
    const locHistory = await base44.asServiceRole.entities.LocationHistory.filter(
      { character_id: ethan.id, owner_email: ethan.owner_email },
      '-arrival_time', 50
    ).catch(() => []);
    const recentLocHistory = locHistory.filter(h => h.arrival_time && new Date(h.arrival_time) >= cutoff48h);

    // ── 6. SLEEP TRANSITIONS (last 48h) ─────────────────────────────────────
    const sleepTransitions = await base44.asServiceRole.entities.SleepTransition.filter(
      { character_id: ethan.id },
      '-timestamp', 50
    ).catch(() => []);
    const recentSleepTransitions = sleepTransitions.filter(t => t.timestamp && new Date(t.timestamp) >= cutoff48h);

    // ── 7. FIND ANDERSON'S BAR REFERENCES ───────────────────────────────────
    const andersonReferences = {
      in_occupation_location_id: ethan.occupation_location_id &&
        locationMap[ethan.occupation_location_id]?.name?.toLowerCase().includes('anderson'),
      in_occupation_location_name: (ethan.occupation_location_name || '').toLowerCase().includes('anderson'),
      in_current_work_location_id: ethan.current_work_location_id &&
        locationMap[ethan.current_work_location_id]?.name?.toLowerCase().includes('anderson'),
      in_resolved_current_location_name: (ethan.resolved_current_location_name || '').toLowerCase().includes('anderson'),
      in_resolved_current_location_id: ethan.resolved_current_location_id &&
        locationMap[ethan.resolved_current_location_id]?.name?.toLowerCase().includes('anderson'),
      in_location_history: recentLocHistory.filter(h =>
        (h.location_name || '').toLowerCase().includes('anderson')
      ).map(h => ({ id: h.id, name: h.location_name, arrival: h.arrival_time, event: h.event_type })),
      in_sleep_transitions: recentSleepTransitions.filter(t =>
        (t.reason || '').toLowerCase().includes('anderson') ||
        (t.location_name || '').toLowerCase().includes('anderson')
      ).map(t => ({ id: t.id, reason: t.reason, timestamp: t.timestamp })),
    };

    // ── 8. FIND VGC RECOVERY YARD REFERENCES ────────────────────────────────
    const vgcYardReferences = {
      location_ids: vgcYardLocations.map(l => ({ id: l.id, name: l.name, category: l.category })),
      in_occupation_location_id: ethan.occupation_location_id &&
        vgcYardLocations.some(l => l.id === ethan.occupation_location_id),
      in_current_work_location_id: ethan.current_work_location_id &&
        vgcYardLocations.some(l => l.id === ethan.current_work_location_id),
      in_additional_occupation_locations: (ethan.additional_occupation_locations || []).some(loc =>
        vgcYardLocations.some(l => l.id === loc.location_id)
      ),
      has_explicit_shift_for_ethan: vgcYardLocations.some(l => l.worker_shifts?.[ethan.id]),
      in_location_history: recentLocHistory.filter(h =>
        vgcYardLocations.some(l => l.id === h.location_id)
      ).map(h => ({ id: h.id, name: h.location_name, arrival: h.arrival_time, event: h.event_type })),
    };

    return Response.json({
      diagnostic_type: 'READ_ONLY_ANDERSONS_BAR_SUBSTITUTION_TRACER',
      timestamp: new Date().toISOString(),
      eastern_time: nowET.toISOString(),
      eastern_time_display: nowET.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      eastern_date: todayET,
      day_of_week: dayNames[dayOfWeek],
      day_of_week_number: dayOfWeek,

      // Section 1: Character work fields
      character_work_fields: charWorkFields,

      // Section 2: Work location details (with iteration order)
      work_location_iteration_order: workLocationDetails,
      total_work_locations: allWorkLocIds.length,

      // Section 3: Resolution engine trace (step-by-step)
      resolution_trace: resolutionTrace,
      winning_location: winningLocation || 'NONE - no work location matched',

      // Section 4: Anderson's Bar references
      andersons_bar_locations_found: andersonsBarLocations.map(l => ({ id: l.id, name: l.name, category: l.category })),
      anderson_references: andersonReferences,

      // Section 5: VGC Recovery Yard references
      vgc_yard_references: vgcYardReferences,

      // Section 6: Location history
      recent_location_history: recentLocHistory.map(h => ({
        id: h.id,
        location_id: h.location_id,
        location_name: h.location_name,
        event_type: h.event_type,
        arrival_time: h.arrival_time,
        departure_time: h.departure_time,
        travel_source: h.travel_source,
        travel_reason: h.travel_reason,
        is_current: h.is_current,
      })),

      // Section 7: Sleep transitions
      recent_sleep_transitions: recentSleepTransitions.map(t => ({
        id: t.id,
        transition_type: t.transition_type,
        from_status: t.from_status,
        to_status: t.to_status,
        authority: t.authority,
        reason: t.reason,
        timestamp: t.timestamp,
        state_start_ref: t.state_start_ref,
      })),

      // Section 8: Analysis
      analysis: {
        bug_identified: !winningLocation ? false : 
          winningLocation.checking_location_name?.toLowerCase().includes('anderson') &&
          !winningLocation.step_2_has_explicit_shift,
        bug_explanation: winningLocation && !winningLocation.step_2_has_explicit_shift
          ? `Resolution engine checked ${winningLocation.checking_location_name} (position ${winningLocation.checking_location_id === ethan.occupation_location_id ? '0 = occupation_location_id' : 'other'}) first. ` +
            `No explicit worker_shift found for Ethan on this location. ` +
            `Fell back to isCharacterOnWorkSchedule(character) which uses Ethan's own work_start/end/days. ` +
            `Wednesday is a work day and time is within shift hours → returned at_work at ${winningLocation.checking_location_name}. ` +
            `VGC Recovery Yard (which may have an explicit shift or be current_work_location_id) was never checked because the loop already returned.`
          : 'Requires further analysis',
        correct_authority_order: [
          '1. Location with ACTIVE explicit worker_shift for this character',
          '2. current_work_location_id (if character is on schedule)',
          '3. additional_occupation_locations with explicit shifts',
          '4. occupation_location_id (default, lowest priority) only if no higher-authority location matches',
        ],
      },
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});