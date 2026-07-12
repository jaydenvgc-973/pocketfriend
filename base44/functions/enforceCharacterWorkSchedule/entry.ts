import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── PRE-DEPARTURE CHILDCARE PROTECTION (inlined from ensureChildCaregiverPresence) ──
const _SAFE_ALONE_AGE = 16;
function _resolveAge(character) {
  if (character.age && typeof character.age === 'number' && character.age > 0) return character.age;
  if (character.age_range) {
    const r = character.age_range.toLowerCase();
    if (r.includes('early 20')) return 21;
    if (r.includes('mid 20')) return 25;
    if (r.includes('late 20')) return 28;
    if (r.includes('early 30')) return 31;
    if (r.includes('mid 30')) return 35;
    if (r.includes('late 30')) return 38;
    if (r.includes('40')) return 43;
    if (r.includes('50')) return 53;
    if (r.includes('60')) return 63;
    if (r.includes('70')) return 73;
  }
  return null;
}
function _isCaregiver(character) {
  return character.character_type === 'npc_regular' &&
    (character.is_sitter === true || (character.occupation || '').toLowerCase().includes('babysitter'));
}
async function _ensureChildcareBeforeDeparture(base44, char, homeId, allChars, allLocations) {
  if (!homeId || char.resolved_current_location_id !== homeId) return { ok: true };
  const childResidents = allChars.filter(c => {
    if (c.current_home_location_id !== homeId) return false;
    if (c.id === char.id) return false;
    if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
    const age = _resolveAge(c);
    if (age === null) return false;
    return age < _SAFE_ALONE_AGE;
  });
  if (childResidents.length === 0) return { ok: true };
  const childrenAtHome = childResidents.filter(c =>
    !c.resolved_current_location_id || c.resolved_current_location_id === homeId
  );
  if (childrenAtHome.length === 0) return { ok: true };
  const departingAge = _resolveAge(char);
  if (departingAge !== null && departingAge < _SAFE_ALONE_AGE) return { ok: true };
  const otherGuardians = allChars.filter(c => {
    if (c.id === char.id) return false;
    if (c.current_home_location_id !== homeId) return false;
    if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
    const age = _resolveAge(c);
    if (age === null || age < _SAFE_ALONE_AGE) return false;
    return !c.resolved_current_location_id || c.resolved_current_location_id === homeId;
  });
  if (otherGuardians.length > 0) return { ok: true };
  const homeLoc = allLocations.find(l => l.id === homeId);
  if (!homeLoc) return { ok: true };
  const existingSitter = allChars.find(c =>
    _isCaregiver(c) && c.resolved_current_location_id === homeId &&
    c.sitter_assigned_to_location_id === homeId
  );
  if (existingSitter) return { ok: true };
  const availableSitter = allChars.find(c =>
    _isCaregiver(c) && c.owner_email === char.owner_email &&
    c.sitter_assigned_to_location_id !== homeId
  );
  if (availableSitter) {
    await base44.asServiceRole.entities.Character.update(availableSitter.id, {
      resolved_current_location_id: homeId, resolved_current_location_name: homeLoc.name,
      resolved_location_type: 'home', resolved_presence_status: 'home',
      resolved_source_reason: 'child_supervision',
      resolved_last_updated_at: new Date().toISOString(),
      is_sitter: true, sitter_assigned_to_location_id: homeId,
    }).catch(() => {});
    return { ok: true, sitterAssigned: availableSitter.name };
  }
  const childNames = childResidents.map(c => c.name).join(', ');
  const sitterName = homeLoc.name + ' Babysitter';
  try {
    await base44.asServiceRole.entities.Character.create({
      name: sitterName, character_type: 'npc_regular', owner_email: char.owner_email,
      status: 'active', occupation: 'Babysitter', is_sitter: true,
      sitter_assigned_to_location_id: homeId, current_home_location_id: homeId,
      resolved_current_location_id: homeId, resolved_current_location_name: homeLoc.name,
      resolved_location_type: 'home', resolved_presence_status: 'home',
      resolved_source_reason: 'child_supervision_spawn',
      resolved_last_updated_at: new Date().toISOString(),
      personality_summary: 'A reliable babysitter caring for ' + childNames + ' at ' + homeLoc.name + '.',
      data_scope: 'private_user', visibility_scope: 'account_private',
      exclude_from_homepage: true, exclude_from_roster: true,
    });
    return { ok: true, sitterSpawned: sitterName };
  } catch (e) { return { ok: false, error: e.message }; }
}

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

      // Load all work locations for this character (ownership-scoped)
      const singleAllWorkLocIds = [];
      if (character.occupation_location_id) singleAllWorkLocIds.push(character.occupation_location_id);
      if (character.current_work_location_id && !singleAllWorkLocIds.includes(character.current_work_location_id)) {
        singleAllWorkLocIds.push(character.current_work_location_id);
      }
      if (Array.isArray(character.additional_occupation_locations)) {
        for (const entry of character.additional_occupation_locations) {
          if (entry.location_id && !singleAllWorkLocIds.includes(entry.location_id)) {
            singleAllWorkLocIds.push(entry.location_id);
          }
        }
      }

      // Build location map for this character's work locations (ownership-scoped)
      const singleLocMap = {};
      for (const locId of singleAllWorkLocIds) {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: locId });
        if (locs?.[0]) singleLocMap[locId] = locs[0];
      }

      // Find which work location has an active shift right now (worker_shifts authoritative)
      let singleActiveWorkLocId = null;
      for (const locId of singleAllWorkLocIds) {
        const loc = singleLocMap[locId];
        if (!loc) continue;
        const locationShift = loc.worker_shifts?.[characterId];
        if (locationShift) {
          if (isLocationShiftActiveNow(locationShift, singleClock)) {
            singleActiveWorkLocId = locId;
            break;
          }
          continue; // Shift defined but not active — do not fall back to character schedule
        }
        // No location-specific shift — use character-level schedule
        if (character.work_start_time && character.work_end_time && character.work_days) {
          const nowMin = singleClock.getHours() * 60 + singleClock.getMinutes();
          const [sh, sm] = character.work_start_time.split(':').map(Number);
          const [eh, em] = character.work_end_time.split(':').map(Number);
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;
          const isCross = endMin < startMin;
          const today = singleClock.getDay();
          const yesterday = (today + 6) % 7;
          const active = isCross
            ? (character.work_days.includes(today) && nowMin >= startMin) || (character.work_days.includes(yesterday) && nowMin < endMin)
            : character.work_days.includes(today) && nowMin >= startMin && nowMin < endMin;
          if (active) { singleActiveWorkLocId = locId; break; }
        }
      }

      const primaryWorkLocId = singleAllWorkLocIds.find(id => singleLocMap[id]) || null;
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
            // PRE-DEPARTURE CHILDCARE CHECK
          {
            const _homeId = character.current_home_location_id;
            if (_homeId && character.resolved_current_location_id === _homeId && singleActiveWorkLocId !== _homeId) {
              let _allChars = [];
              try { _allChars = await base44.asServiceRole.entities.Character.filter({ owner_email: character.owner_email, status: 'active' }, null, 200); } catch { _allChars = []; }
              let _allLocs = [];
              try { _allLocs = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: character.owner_email }, null, 100); } catch { _allLocs = []; }
              const _ccResult = await _ensureChildcareBeforeDeparture(base44, character, _homeId, _allChars, _allLocs);
              if (!_ccResult.ok) {
                return Response.json({ updated: false, reason: 'departure_blocked_childcare: ' + (_ccResult.error || 'unknown') });
              }
            }
          }
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

      // Not on any active shift — if still showing at a work location, send home
      const effectiveWorkLocId = primaryWorkLocId;
      if (effectiveWorkLocId && resolvedLocId === effectiveWorkLocId) {
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

        // Collect ALL work location IDs for this character
        const allWorkLocIds = [];
        if (char.occupation_location_id) allWorkLocIds.push(char.occupation_location_id);
        if (char.current_work_location_id && !allWorkLocIds.includes(char.current_work_location_id)) {
          allWorkLocIds.push(char.current_work_location_id);
        }
        if (Array.isArray(char.additional_occupation_locations)) {
          for (const entry of char.additional_occupation_locations) {
            if (entry.location_id && !allWorkLocIds.includes(entry.location_id)) {
              allWorkLocIds.push(entry.location_id);
            }
          }
        }

        if (allWorkLocIds.length === 0) continue;

        // Determine which work location (if any) has an active shift right now.
        // worker_shifts[char.id] is authoritative for that location.
        // If no location-specific shift exists, fall back to character-level schedule.
        let activeWorkLocId = null;
        for (const locId of allWorkLocIds) {
          const loc = locMap[locId];
          if (!loc) continue;
          const locationShift = loc.worker_shifts?.[char.id];
          if (locationShift) {
            if (isLocationShiftActiveNow(locationShift, globalClock)) {
              activeWorkLocId = locId;
              break;
            }
            // Shift defined but not active for this location — do NOT fall back to character schedule
            continue;
          }
          // No location-specific shift — use character-level schedule
          if (char.work_start_time && char.work_end_time && char.work_days) {
            const nowMin = globalClock.getHours() * 60 + globalClock.getMinutes();
            const [sh, sm] = char.work_start_time.split(':').map(Number);
            const [eh, em] = char.work_end_time.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;
            const isCross = endMin < startMin;
            const today = globalClock.getDay();
            const yesterday = (today + 6) % 7;
            const onCharSchedule = isCross
              ? (char.work_days.includes(today) && nowMin >= startMin) || (char.work_days.includes(yesterday) && nowMin < endMin)
              : char.work_days.includes(today) && nowMin >= startMin && nowMin < endMin;
            if (onCharSchedule) {
              activeWorkLocId = locId;
              break;
            }
          }
        }

        // Also determine what the "primary" work location is for post-shift return logic
        // (the first location in allWorkLocIds that is in scope)
        const primaryWorkLocId = allWorkLocIds.find(id => locMap[id]) || null;

        const onShift = !!activeWorkLocId;
        const workLocId = activeWorkLocId || primaryWorkLocId;

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
              // PRE-DEPARTURE CHILDCARE CHECK
              {
                const _homeId = char.current_home_location_id;
                if (_homeId && char.resolved_current_location_id === _homeId && activeWorkLocId !== _homeId) {
                  const _ccResult = await _ensureChildcareBeforeDeparture(base44, char, _homeId, groupChars, ownerLocations);
                  if (!_ccResult.ok) {
                    issues_found.push(char.name + ': DEPARTURE_BLOCKED_CHILD CARE — ' + (_ccResult.error || 'unknown'));
                    continue;
                  }
                }
              }
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
        } else if (!onShift && workLocId && resolvedLocId === workLocId) {
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