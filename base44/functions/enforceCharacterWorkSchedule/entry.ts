import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Check if a location-specific shift for this character is active right now (ET)
// Handles cross-midnight shifts correctly — e.g. 17:00→01:00 spanning two calendar days.
function isLocationShiftActiveNow(shift, nowET) {
  if (!shift?.start || !shift?.end) return false;
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const isCrossMidnight = endMin < startMin;
  const today = nowET.getDay();
  const yesterday = (today + 6) % 7;
  const hasDays = shift.days && shift.days.length > 0;

  if (isCrossMidnight) {
    // On shift if: today is a shift day AND time >= start (e.g. 17:00→23:59 window)
    //           OR yesterday was a shift day AND time < end (e.g. 00:00→01:00 overnight window)
    const afterStartToday = (!hasDays || shift.days.includes(today)) && nowMin >= startMin;
    const beforeEndYesterday = (!hasDays || shift.days.includes(yesterday)) && nowMin < endMin;
    return afterStartToday || beforeEndYesterday;
  } else {
    if (hasDays && !shift.days.includes(today)) return false;
    return nowMin >= startMin && nowMin < endMin;
  }
}

/**
 * Evaluate the COMPLETE SET of a character's employment assignments.
 * Every assignment is independently evaluated against the current day and time.
 * Returns ALL active assignments — never breaks on the first match.
 * Multiple active assignments = genuine shift overlap (a conflict the caller
 * resolves only between those active assignments, never by discarding others).
 */
function resolveWorkAssignments(character, locMap, clock, characterId) {
  // Build the complete set of employment assignments in priority order:
  // additional_occupation_locations → current_work_location_id → occupation_location_id
  const workEntries = [];
  if (Array.isArray(character.additional_occupation_locations)) {
    for (const entry of character.additional_occupation_locations) {
      if (entry.location_id && !workEntries.find(e => e.locId === entry.location_id)) {
        workEntries.push({ locId: entry.location_id, hasCharShiftData: !!(entry.shift_start && entry.shift_end), charShift: entry });
      }
    }
  }
  if (character.current_work_location_id && !workEntries.find(e => e.locId === character.current_work_location_id)) {
    workEntries.push({ locId: character.current_work_location_id, hasCharShiftData: false, charShift: null });
  }
  if (character.occupation_location_id && !workEntries.find(e => e.locId === character.occupation_location_id)) {
    workEntries.push({ locId: character.occupation_location_id, hasCharShiftData: false, charShift: null });
  }

  const allWorkLocIds = new Set(workEntries.map(e => e.locId));

  // Evaluate EVERY assignment independently — collect ALL active, never break
  const activeAssignments = [];
  for (const entry of workEntries) {
    const loc = locMap[entry.locId];
    if (!loc) continue;

    // If an explicit shift is defined for this assignment, it is the authority.
    // An inactive explicit shift does NOT fall back to the character schedule.
    const locationShift = loc.worker_shifts?.[characterId];
    if (locationShift) {
      if (isLocationShiftActiveNow(locationShift, clock)) {
        activeAssignments.push({ locId: entry.locId });
      }
      continue;
    }
    if (entry.hasCharShiftData) {
      const charShift = { start: entry.charShift.shift_start, end: entry.charShift.shift_end, days: entry.charShift.work_days };
      if (isLocationShiftActiveNow(charShift, clock)) {
        activeAssignments.push({ locId: entry.locId });
      }
      continue;
    }

    // No explicit shift on this assignment — use character schedule fallback
    if (character.work_start_time && character.work_end_time && character.work_days) {
      const nowMin = clock.getHours() * 60 + clock.getMinutes();
      const [sh, sm] = character.work_start_time.split(':').map(Number);
      const [eh, em] = character.work_end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const isCross = endMin < startMin;
      const today = clock.getDay();
      const yesterday = (today + 6) % 7;
      const onSchedule = isCross
        ? (character.work_days.includes(today) && nowMin >= startMin) || (character.work_days.includes(yesterday) && nowMin < endMin)
        : character.work_days.includes(today) && nowMin >= startMin && nowMin < endMin;
      if (onSchedule) {
        activeAssignments.push({ locId: entry.locId });
      }
    }
  }

  return { allWorkLocIds, activeAssignments };
}

/**
 * Select the active work location from active assignments.
 * If multiple shifts genuinely overlap, resolve the conflict ONLY between
 * those active assignments: prefer the location the character is already at,
 * otherwise the first by priority order. Never discards remaining assignments.
 */
function selectActiveWorkLocId(activeAssignments, resolvedLocId) {
  if (activeAssignments.length === 0) return null;
  if (activeAssignments.length === 1) return activeAssignments[0].locId;
  // Genuine overlap — conflict resolution between active assignments only
  const alreadyAt = activeAssignments.find(a => a.locId === resolvedLocId);
  return (alreadyAt || activeAssignments[0]).locId;
}

/**
 * OWNERSHIP-ISOLATED SCHEDULER
 * 
 * AUTHORITY: owner_email ONLY
 * - NO session auth (no user.email ownership inference)
 * - NO created_by logic
 * - Groups all active_created_character by owner_email
 * - Processes each owner_email group in complete isolation
 * - Blocks records with missing owner_email immediately
 * - Location access scoped strictly: location.owner_email === character.owner_email
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { characterId } = body;

    // Use ET time for all schedule decisions — never UTC.
    // These vars are unused in global mode (each char loop re-derives nowET), kept for single-char path only.
    const _unusedUtc = new Date(); void _unusedUtc;

    // --- Single character mode (requires session auth to scope to owned character) ---
    if (characterId) {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

      // OWNERSHIP CHECK: Must match owner_email
      const char = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      if (!char || char.length === 0) {
        return Response.json({ error: 'Character not found' }, { status: 404 });
      }
      const character = char[0];

      // OWNERSHIP BOUNDARY: owner_email must match session user
      if (!character.owner_email || character.owner_email !== user.email) {
        return Response.json({ error: 'Access denied — ownership mismatch' }, { status: 403 });
      }

      const resolvedLocId = character.resolved_current_location_id;
      const isSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
      const activity = (character.current_activity || '').toLowerCase();

      // Helper: Check if character is blocked from work
      const isBlockedFromWork = (char) => {
        const isCriticallyIll = char.health_value !== undefined && char.health_value < 20;
        const isInEmergency = char.current_activity && char.current_activity.toLowerCase().includes('emergency');
        return isCriticallyIll || isInEmergency;
      };

      if (isBlockedFromWork(character)) {
       return Response.json({ updated: false, reason: 'Character blocked from work (sick/emergency)' });
      }

      // PROTECTED STATE GUARD: passed_out, sleeping, napping, hospitalized characters
      // and characters with an active pass_out_recovery stay lock must NEVER be overridden.
      if (['passed_out', 'sleeping', 'napping', 'hospitalized'].includes(character.resolved_presence_status)) {
       return Response.json({ updated: false, reason: 'Character in protected state — work enforcement skipped' });
      }
      if (character.presence_stay_lock === true && character.presence_stay_lock_reason === 'pass_out_recovery') {
       return Response.json({ updated: false, reason: 'Character in pass_out_recovery — work enforcement skipped' });
      }

      // Work is an authorized wake source. Track if character was sleeping so the
      // wake is recorded (last_wake_time + proof records) — prevents silent wake.
      const _wasSleepingBeforeWork = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';

      // CALLOUT GUARD: valid callout for today = full work schedule bypass
      const singleNowET = new Date();
      // CRITICAL: Intl.DateTimeFormat.formatToParts with timeZone does NOT work in
      // Deno sandbox — returns UTC. toLocaleString with timeZone DOES work.
      const _sEtDateStr = singleNowET.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
      });
      const _sWdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const _sEtParsed = _sEtDateStr.match(/(\w+),\s*(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+)/);
      const singleClock = {
        getHours: () => parseInt(_sEtParsed[5]) % 24,
        getMinutes: () => parseInt(_sEtParsed[6]),
        getDay: () => _sWdMap[_sEtParsed[1]],
      };
      const todayET = `${_sEtParsed[4]}-${_sEtParsed[2].padStart(2,'0')}-${_sEtParsed[3].padStart(2,'0')}`;
      if (character.work_exception_status === 'called_out' && character.work_exception_date === todayET) {
        return Response.json({ updated: false, reason: 'Character has a valid callout for today — work schedule bypassed' });
      }

      // Extract all configured work-location IDs to load their LocationReference records
      const singleWorkLocIds = [];
      if (Array.isArray(character.additional_occupation_locations)) {
        for (const entry of character.additional_occupation_locations) {
          if (entry.location_id && !singleWorkLocIds.includes(entry.location_id)) singleWorkLocIds.push(entry.location_id);
        }
      }
      if (character.current_work_location_id && !singleWorkLocIds.includes(character.current_work_location_id)) singleWorkLocIds.push(character.current_work_location_id);
      if (character.occupation_location_id && !singleWorkLocIds.includes(character.occupation_location_id)) singleWorkLocIds.push(character.occupation_location_id);

      const singleLocMap = {};
      for (const locId of singleWorkLocIds) {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: locId });
        if (locs?.[0]) singleLocMap[locId] = locs[0];
      }

      // Evaluate EVERY assignment independently — collect ALL active assignments
      const { allWorkLocIds: singleAllWorkLocIds, activeAssignments: singleActiveAssignments } =
        resolveWorkAssignments(character, singleLocMap, singleClock, characterId);

      // Select the active shift. If multiple shifts overlap, resolve the conflict
      // ONLY between those active assignments.
      const singleActiveWorkLocId = selectActiveWorkLocId(singleActiveAssignments, resolvedLocId);
      const validSleepReasons = ['overnight_shift', 'on_call', 'emergency', 'user_directed'];
      const hasValidSleepReason = validSleepReasons.some(r => activity.includes(r));

      // Shared helper: write a Character location/presence transition, then write
      // BOTH authoritative proof records that a dual-fact change requires:
      // LocationHistory (via the single authoritative writer — closes prior open
      // records, verifies state) for the location fact, AND SleepTransition for
      // the sleep fact when the new status is 'sleeping'. A change that mutates
      // two canonical facts in one write may never leave either fact unproven.
      // If either proof write fails, the Character write is reverted immediately.
      async function writeVerifiedTransition({ payload, revertPayload, newLocationId, newStatus, eventType, reason }) {
        // A transition INTO 'sleeping' must stamp last_sleep_start — every downstream
        // consumer (6h guards, 8h sleep cap, wake-time boundary) reads this field as
        // the authoritative sleep-start timer. Writing the SleepTransition proof
        // without this field would make the proof and the state diverge.
        const finalPayload = newStatus === 'sleeping'
          ? { ...payload, last_sleep_start: singleNowET.toISOString() }
          : payload;
        await base44.asServiceRole.entities.Character.update(characterId, finalPayload);
        try {
          // Inline LocationHistory write — cross-function invoke returns 403 because
          // createClientFromRequest(req) cannot establish service-role auth when
          // called from another backend function. Write directly here instead.
          const _nowIso = singleNowET.toISOString();
          const _openRecs = await base44.asServiceRole.entities.LocationHistory.filter(
            { character_id: characterId, owner_email: character.owner_email, is_current: true }, null, 20
          );
          for (const _open of _openRecs) {
            if (_open.location_id === newLocationId) continue;
            const _arrMs = new Date(_open.arrival_time).getTime();
            const _durMin = Math.round((Date.now() - _arrMs) / 60000);
            await base44.asServiceRole.entities.LocationHistory.update(_open.id, {
              is_current: false, departure_time: _nowIso,
              duration_minutes: _durMin > 0 ? _durMin : null,
            });
          }
          const _already = _openRecs.find(o => o.location_id === newLocationId);
          if (!_already) {
            const [_destLoc] = await base44.asServiceRole.entities.LocationReference.filter({ id: newLocationId }, null, 1);
            await base44.asServiceRole.entities.LocationHistory.create({
              character_id: characterId, character_name: character.name,
              owner_email: character.owner_email, location_id: newLocationId,
              location_name: _destLoc?.name || '', location_category: _destLoc?.category || 'generic',
              event_type: eventType, arrival_time: _nowIso,
              travel_source: 'schedule', travel_reason: reason, is_current: true,
            });
          }
          if (newStatus === 'sleeping') {
            await base44.asServiceRole.entities.SleepTransition.create({
              character_id: characterId, character_name: character.name, owner_email: character.owner_email,
              transition_type: 'sleep_start', from_status: character.resolved_presence_status || 'unknown',
              to_status: 'sleeping', authority: 'enforceCharacterWorkSchedule', reason, timestamp: singleNowET.toISOString(),
              state_start_ref: singleNowET.toISOString(),
            });
          }
          return { verified: true };
        } catch (proofError) {
          let revertError = null;
          try { await base44.asServiceRole.entities.Character.update(characterId, revertPayload); } catch (e) { revertError = e.message; }
          return { verified: false, proof_error: proofError.message, revert_error: revertError };
        }
      }

      const revertBase = {
        resolved_current_location_id: character.resolved_current_location_id,
        resolved_presence_status: character.resolved_presence_status,
        resolved_location_type: character.resolved_location_type,
        resolved_source_reason: character.resolved_source_reason,
        resolved_last_updated_at: character.resolved_last_updated_at,
        last_sleep_start: character.last_sleep_start,
        presence_stay_lock: character.presence_stay_lock,
        presence_stay_lock_location_id: character.presence_stay_lock_location_id,
        presence_stay_lock_set_at: character.presence_stay_lock_set_at,
        presence_stay_lock_reason: character.presence_stay_lock_reason,
        presence_stay_lock_authority: character.presence_stay_lock_authority,
        presence_stay_lock_expires_at: character.presence_stay_lock_expires_at,
        presence_stay_lock_release_condition: character.presence_stay_lock_release_condition,
        presence_stay_lock_created_by: character.presence_stay_lock_created_by,
      };

      if (singleActiveWorkLocId) {
        const result = await writeVerifiedTransition({
          payload: {
            resolved_current_location_id: singleActiveWorkLocId,
            resolved_presence_status: 'at_work',
            resolved_location_type: 'work',
            resolved_source_reason: 'work_schedule',
            resolved_last_updated_at: singleNowET.toISOString(),
            ...(_wasSleepingBeforeWork ? { last_wake_time: singleNowET.toISOString() } : {}),
            presence_stay_lock: true,
            presence_stay_lock_reason: 'work_shift',
            presence_stay_lock_authority: 'enforceCharacterWorkSchedule',
            presence_stay_lock_set_at: singleNowET.toISOString(),
            presence_stay_lock_location_id: singleActiveWorkLocId,
            presence_stay_lock_created_by: 'system_automation',
          },
          revertPayload: revertBase,
          newLocationId: singleActiveWorkLocId,
          newStatus: 'at_work',
          eventType: 'work_start',
          reason: 'On shift — moved to work',
        });
        if (!result.verified) {
          return Response.json({ updated: false, reason: 'unverified_state_write', proof_error: result.proof_error, revert_error: result.revert_error });
        }
        if (_wasSleepingBeforeWork) {
          try {
            await base44.asServiceRole.entities.SleepTransition.create({ character_id: characterId, character_name: character.name, owner_email: character.owner_email, transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'at_work', authority: 'work_schedule_wake', reason: 'Work shift started — woke for work.', timestamp: singleNowET.toISOString(), state_start_ref: character.last_sleep_start || null });
            await base44.asServiceRole.entities.LifeEvent.create({ character_id: characterId, character_name: character.name, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Woke up for work', description: `${character.name} woke up for their work shift.`, emotional_impact: 'groggy', triggered_by: 'life_simulation', timestamp: singleNowET.toISOString(), context_tags: ['sleep_end', 'woke_up', 'work_schedule'] });
          } catch (proofError) { console.warn(`[enforceCharacterWorkSchedule] ${character.name}: work-wake proof failed (non-reverting): ${proofError.message}`); }
        }
        return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: singleActiveWorkLocId, reason: 'On shift — moved to work' });
      }

      // Not on any active shift — if still at ANY configured work location, send home
      if (singleAllWorkLocIds.has(resolvedLocId)) {
        if (isSleeping && !hasValidSleepReason) {
          const homeLocId = character.current_home_location_id;
          if (homeLocId) {
            const result = await writeVerifiedTransition({
              payload: {
                resolved_current_location_id: homeLocId,
                resolved_presence_status: 'sleeping',
                resolved_location_type: 'home',
                resolved_source_reason: 'fallback_to_home_base',
                resolved_last_updated_at: singleNowET.toISOString(),
                presence_stay_lock: false,
                presence_stay_lock_location_id: null,
                presence_stay_lock_set_at: null,
                presence_stay_lock_reason: null,
                presence_stay_lock_authority: null,
                presence_stay_lock_expires_at: null,
                presence_stay_lock_release_condition: null,
                presence_stay_lock_created_by: null,
              },
              revertPayload: revertBase,
              newLocationId: homeLocId,
              newStatus: 'sleeping',
              eventType: 'return_home',
              reason: 'Sleeping at work — moved home',
            });
            if (!result.verified) {
              return Response.json({ updated: false, reason: 'unverified_state_write', proof_error: result.proof_error, revert_error: result.revert_error });
            }
            return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: homeLocId, reason: 'Sleeping at work — moved home' });
          }
        } else if (!isSleeping && character.current_home_location_id) {
          const homeLocId = character.current_home_location_id;
          const energy = character.energy_value ?? 75;
          const newStatus = energy < 40 ? 'sleeping' : 'home';
          const result = await writeVerifiedTransition({
            payload: {
              resolved_current_location_id: homeLocId,
              resolved_presence_status: newStatus,
              resolved_location_type: 'home',
              resolved_source_reason: 'fallback_to_home_base',
              resolved_last_updated_at: singleNowET.toISOString(),
              presence_stay_lock: false,
              presence_stay_lock_location_id: null,
              presence_stay_lock_set_at: null,
              presence_stay_lock_reason: null,
              presence_stay_lock_authority: null,
              presence_stay_lock_expires_at: null,
              presence_stay_lock_release_condition: null,
              presence_stay_lock_created_by: null,
            },
            revertPayload: revertBase,
            newLocationId: homeLocId,
            newStatus,
            eventType: 'return_home',
            reason: `Shift ended — going home (${newStatus})`,
          });
          if (!result.verified) {
            return Response.json({ updated: false, reason: 'unverified_state_write', proof_error: result.proof_error, revert_error: result.revert_error });
          }
          return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: homeLocId, reason: `Shift ended — going home (${newStatus})` });
        }
      }

      return Response.json({ updated: false, reason: 'No schedule change needed' });
    }

    // --- GLOBAL SCHEDULER MODE (no session) ---
    // FOREGROUND YIELD CHECK: batch enforcement must yield while user is active.
    // Single-character mode (characterId path above) already ran — this guard covers the bulk scan only.
    try {
      const sessions = await base44.asServiceRole.entities.AppWorldState.filter({ key: 'user_active_session' });
      if (sessions.length > 0) {
        const lastUpdate = sessions[0].value ? new Date(sessions[0].value).getTime() : 0;
        const isForegroundActive = (Date.now() - lastUpdate) < 30 * 1000;
        if (isForegroundActive) {
          console.log(`[enforceCharacterWorkSchedule] User active — deferring batch enforcement to protect foreground`);
          return Response.json({ summary: 'Yielded — foreground user active', issues_found: [], fixes_applied: [], owners_processed: 0, blockedCharacters: [] });
        }
      }
    } catch (_) { /* non-fatal — proceed */ }

    // OWNERSHIP ENFORCEMENT: Group by owner_email, process each in isolation
    const allCharacters = await base44.asServiceRole.entities.Character.filter({
      character_type: 'active_created_character',
      status: 'active'
    });

    console.log(`[enforceCharacterWorkSchedule] Found ${allCharacters.length} total active_created_character records`);

    // OWNERSHIP GROUPING: Group by owner_email
    const charactersByOwner = {};
    const blockedCharacters = [];

    for (const char of allCharacters) {
      // OWNERSHIP BLOCK: Missing owner_email
      if (!char.owner_email) {
        blockedCharacters.push({
          id: char.id,
          name: char.name,
          reason: 'OWNERSHIP_BLOCKED — owner_email missing',
        });
        console.warn(`[enforceCharacterWorkSchedule] BLOCKED: ${char.name} (${char.id}) — no owner_email`);
        continue;
      }

      // Group by owner_email (SOLE OWNERSHIP AUTHORITY)
      if (!charactersByOwner[char.owner_email]) {
        charactersByOwner[char.owner_email] = [];
      }
      charactersByOwner[char.owner_email].push(char);
    }

    const issues_found = [];
    const fixes_applied = [];
    let fixCount = 0;

    // PROCESS EACH OWNER_EMAIL GROUP IN ISOLATION
    for (const [ownerEmail, groupChars] of Object.entries(charactersByOwner)) {
      console.log(`[enforceCharacterWorkSchedule] Processing owner ${ownerEmail}: ${groupChars.length} characters`);

      // Load ONLY locations for this owner
      const ownerLocations = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email: ownerEmail
      });
      const locMap = Object.fromEntries(ownerLocations.map(l => [l.id, l]));

      for (const char of groupChars) {
        const resolvedLocId = char.resolved_current_location_id;
        const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';

        // CALLOUT GUARD: skip work enforcement for characters with valid callout today
        const nowET = new Date();
        // CRITICAL: Intl.DateTimeFormat.formatToParts with timeZone does NOT work
        // in Deno sandbox. Use toLocaleString which IS working.
        const _gEtDateStr = nowET.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
        });
        const _gWdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const _gEtParsed = _gEtDateStr.match(/(\w+),\s*(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+)/);
        const globalClock = {
          getHours: () => parseInt(_gEtParsed[5]) % 24,
          getMinutes: () => parseInt(_gEtParsed[6]),
          getDay: () => _gWdMap[_gEtParsed[1]],
        };
        const todayET = `${_gEtParsed[4]}-${_gEtParsed[2].padStart(2,'0')}-${_gEtParsed[3].padStart(2,'0')}`;
        if (char.work_exception_status === 'called_out' && char.work_exception_date === todayET) {
          continue; // Called out — do not force to work
        }

        // PROTECTED STATE GUARD: passed_out, sleeping, napping, hospitalized characters
        // must NEVER be overridden by work enforcement. Also check pass_out_recovery stay
        // lock — even if resolved_presence_status was externally cleared to 'home',
        // the stay lock proves the character is still in forced recovery.
        if (['passed_out', 'sleeping', 'napping', 'hospitalized'].includes(char.resolved_presence_status)) continue;
        if (char.presence_stay_lock === true && char.presence_stay_lock_reason === 'pass_out_recovery') continue;

        // Evaluate EVERY assignment independently — collect ALL active assignments
        const { allWorkLocIds, activeAssignments } =
          resolveWorkAssignments(char, locMap, globalClock, char.id);

        if (allWorkLocIds.size === 0) continue;

        // Select the active shift. If multiple overlap, resolve only between them.
        const activeWorkLocId = selectActiveWorkLocId(activeAssignments, resolvedLocId);
        const onShift = !!activeWorkLocId;

        if (onShift && activeWorkLocId) {
          // OWNERSHIP CHECK: work location must be in same owner scope
          if (!locMap[activeWorkLocId]) {
            issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — work location not in owner scope`);
            continue;
          }
          if (resolvedLocId !== activeWorkLocId) {
            issues_found.push(`${char.name}: should be at work but location stale`);
            const revertPayload = {
              resolved_current_location_id: char.resolved_current_location_id,
              resolved_presence_status: char.resolved_presence_status,
              resolved_location_type: char.resolved_location_type,
              resolved_source_reason: char.resolved_source_reason,
              resolved_last_updated_at: char.resolved_last_updated_at,
              presence_stay_lock: char.presence_stay_lock,
              presence_stay_lock_reason: char.presence_stay_lock_reason,
              presence_stay_lock_authority: char.presence_stay_lock_authority,
              presence_stay_lock_set_at: char.presence_stay_lock_set_at,
              presence_stay_lock_location_id: char.presence_stay_lock_location_id,
              presence_stay_lock_created_by: char.presence_stay_lock_created_by,
            };
            await base44.asServiceRole.entities.Character.update(char.id, {
              resolved_current_location_id: activeWorkLocId,
              resolved_presence_status: 'at_work',
              resolved_location_type: 'work',
              resolved_source_reason: 'work_schedule',
              resolved_last_updated_at: nowET.toISOString(),
              ...(isSleeping ? { last_wake_time: nowET.toISOString() } : {}),
              presence_stay_lock: true,
              presence_stay_lock_reason: 'work_shift',
              presence_stay_lock_authority: 'enforceCharacterWorkSchedule',
              presence_stay_lock_set_at: nowET.toISOString(),
              presence_stay_lock_location_id: activeWorkLocId,
              presence_stay_lock_created_by: 'system_automation',
            });
            try {
              // Inline LocationHistory write — cross-function invoke returns 403
              const _nowIso1 = nowET.toISOString();
              const _openRecs1 = await base44.asServiceRole.entities.LocationHistory.filter(
                { character_id: char.id, owner_email: ownerEmail, is_current: true }, null, 20
              );
              for (const _open of _openRecs1) {
                if (_open.location_id === activeWorkLocId) continue;
                const _arrMs1 = new Date(_open.arrival_time).getTime();
                const _durMin1 = Math.round((Date.now() - _arrMs1) / 60000);
                await base44.asServiceRole.entities.LocationHistory.update(_open.id, {
                  is_current: false, departure_time: _nowIso1,
                  duration_minutes: _durMin1 > 0 ? _durMin1 : null,
                });
              }
              if (!_openRecs1.find(o => o.location_id === activeWorkLocId)) {
                await base44.asServiceRole.entities.LocationHistory.create({
                  character_id: char.id, character_name: char.name, owner_email: ownerEmail,
                  location_id: activeWorkLocId, location_name: locMap[activeWorkLocId]?.name || '',
                  location_category: locMap[activeWorkLocId]?.category || 'generic',
                  event_type: 'work_start', arrival_time: _nowIso1,
                  travel_source: 'schedule', travel_reason: 'work_schedule', is_current: true,
                });
              }
              if (isSleeping) {
                try {
                  await base44.asServiceRole.entities.SleepTransition.create({ character_id: char.id, character_name: char.name, owner_email: ownerEmail, transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'at_work', authority: 'work_schedule_wake', reason: 'Work shift started — woke for work.', timestamp: nowET.toISOString(), state_start_ref: char.last_sleep_start || null });
                  await base44.asServiceRole.entities.LifeEvent.create({ character_id: char.id, character_name: char.name, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Woke up for work', description: `${char.name} woke up for their work shift.`, emotional_impact: 'groggy', triggered_by: 'life_simulation', timestamp: nowET.toISOString(), context_tags: ['sleep_end', 'woke_up', 'work_schedule'] });
                } catch (wakeProofError) { console.warn(`[enforceCharacterWorkSchedule] ${char.name}: work-wake proof failed (non-reverting): ${wakeProofError.message}`); }
              }
              fixes_applied.push(`${char.name}: synced to work location`);
              fixCount++;
            } catch (proofError) {
              let revertError = null;
              try { await base44.asServiceRole.entities.Character.update(char.id, revertPayload); } catch (e) { revertError = e.message; }
              issues_found.push(`${char.name}: UNVERIFIED_STATE_WRITE — work-location proof failed (${proofError.message}), reverted (revert_error=${revertError})`);
            }
          }
        } else if (!onShift && allWorkLocIds.has(resolvedLocId)) {
          // Character is at work but shift ended
          const homeLocId = char.current_home_location_id;
          if (!homeLocId) {
            issues_found.push(`${char.name}: shift ended, at work, no home location`);
            continue;
          }
          // OWNERSHIP CHECK: home location must be in same owner scope
          if (!locMap[homeLocId]) {
            issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — home location not in owner scope`);
            continue;
          }
          if (isSleeping) {
            issues_found.push(`${char.name}: SLEEPING_AT_WORK_INVALID — shift ended`);
          } else {
            issues_found.push(`${char.name}: POST_SHIFT_EXIT_NOT_TRIGGERED — still at work`);
          }
          const energy = char.energy_value || 75;
          const newStatus = energy < 40 ? 'sleeping' : 'home';
          const revertPayload = {
            resolved_current_location_id: char.resolved_current_location_id,
            resolved_presence_status: char.resolved_presence_status,
            resolved_location_type: char.resolved_location_type,
            resolved_source_reason: char.resolved_source_reason,
            resolved_last_updated_at: char.resolved_last_updated_at,
            last_sleep_start: char.last_sleep_start,
            presence_stay_lock: char.presence_stay_lock,
            presence_stay_lock_location_id: char.presence_stay_lock_location_id,
            presence_stay_lock_set_at: char.presence_stay_lock_set_at,
            presence_stay_lock_reason: char.presence_stay_lock_reason,
            presence_stay_lock_authority: char.presence_stay_lock_authority,
            presence_stay_lock_expires_at: char.presence_stay_lock_expires_at,
            presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
            presence_stay_lock_created_by: char.presence_stay_lock_created_by,
          };
          // A transition INTO 'sleeping' must stamp last_sleep_start in the SAME
          // write as the location change — otherwise the SleepTransition proof
          // below would document a sleep-start timestamp the Character record
          // never actually recorded (proof/state divergence).
          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_current_location_id: homeLocId,
            resolved_presence_status: newStatus,
            resolved_location_type: 'home',
            resolved_source_reason: 'fallback_to_home_base',
            resolved_last_updated_at: nowET.toISOString(),
            ...(newStatus === 'sleeping' ? { last_sleep_start: nowET.toISOString() } : {}),
            presence_stay_lock: false,
            presence_stay_lock_location_id: null,
            presence_stay_lock_set_at: null,
            presence_stay_lock_reason: null,
            presence_stay_lock_authority: null,
            presence_stay_lock_expires_at: null,
            presence_stay_lock_release_condition: null,
            presence_stay_lock_created_by: null,
          });
          try {
            // Inline LocationHistory write — cross-function invoke returns 403
            const _nowIso2 = nowET.toISOString();
            const _openRecs2 = await base44.asServiceRole.entities.LocationHistory.filter(
              { character_id: char.id, owner_email: ownerEmail, is_current: true }, null, 20
            );
            for (const _open of _openRecs2) {
              if (_open.location_id === homeLocId) continue;
              const _arrMs2 = new Date(_open.arrival_time).getTime();
              const _durMin2 = Math.round((Date.now() - _arrMs2) / 60000);
              await base44.asServiceRole.entities.LocationHistory.update(_open.id, {
                is_current: false, departure_time: _nowIso2,
                duration_minutes: _durMin2 > 0 ? _durMin2 : null,
              });
            }
            if (!_openRecs2.find(o => o.location_id === homeLocId)) {
              await base44.asServiceRole.entities.LocationHistory.create({
                character_id: char.id, character_name: char.name, owner_email: ownerEmail,
                location_id: homeLocId, location_name: locMap[homeLocId]?.name || '',
                location_category: locMap[homeLocId]?.category || 'home',
                event_type: 'return_home', arrival_time: _nowIso2,
                travel_source: 'schedule', travel_reason: 'shift_ended', is_current: true,
              });
            }
            // Sleep fact — proven in addition to (not instead of) the location fact.
            if (newStatus === 'sleeping') {
              await base44.asServiceRole.entities.SleepTransition.create({
                character_id: char.id, character_name: char.name, owner_email: ownerEmail,
                transition_type: 'sleep_start', from_status: char.resolved_presence_status || 'unknown',
                to_status: 'sleeping', authority: 'enforceCharacterWorkSchedule',
                reason: 'Shift ended — low energy, went to sleep at home.', timestamp: nowET.toISOString(),
                state_start_ref: nowET.toISOString(),
              });
            }
            fixes_applied.push(`${char.name}: relocated home (${newStatus})`);
            fixCount++;
          } catch (proofError) {
            let revertError = null;
            try { await base44.asServiceRole.entities.Character.update(char.id, revertPayload); } catch (e) { revertError = e.message; }
            issues_found.push(`${char.name}: UNVERIFIED_STATE_WRITE — home-relocation proof failed (${proofError.message}), reverted (revert_error=${revertError})`);
          }
        }
      }
    }

    const summary = issues_found.length === 0
      ? `✅ Processed ${allCharacters.length} active_created_character across ${Object.keys(charactersByOwner).length} owners — no issues.`
      : `⚠️ Found ${issues_found.length} issues, applied ${fixCount} fixes. Blocked: ${blockedCharacters.length} (missing owner_email).`;

    return Response.json({
      summary,
      issues_found,
      fixes_applied,
      owners_processed: Object.keys(charactersByOwner).length,
      blockedCharacters,
    });
  } catch (error) {
    console.error('Enforcement error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});