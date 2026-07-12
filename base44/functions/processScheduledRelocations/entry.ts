/**
 * processScheduledRelocations — PROMISED TELEPORT ONLY
 *
 * Legacy transit cleanup path (travel_destination_location_id) REMOVED.
 * Promise teleport path (pending_scheduled_relocation_at + next_location_id) PRESERVED.
 *
 * When a character has a pending scheduled relocation (set by
 * confirmMovementCommitment or commitCharacterTravelToUser), and the
 * scheduled time has arrived, the character is teleported INSTANTLY to
 * the destination. No transit, no ETA, no progress.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const nowIso = now.toISOString();

    // Foreground yield check (preserved)
    let userActiveSessionUntil = 0;
    try {
      const activeFlag = await base44.asServiceRole.entities.AppWorldState.filter(
        { key: 'user_active_session' }, null, 1
      );
      if (activeFlag?.[0]?.value) {
        userActiveSessionUntil = new Date(activeFlag[0].value).getTime();
      }
    } catch { /* non-fatal */ }
    const isForegroundActive = now.getTime() < userActiveSessionUntil;

    // Narrow query: try $lte for due-time filtering; fall back to broad if unsupported
    let commitmentChars = [];
    try {
      let _rawChars = [];
      let _lteSupported = true;
      try {
        _rawChars = await base44.asServiceRole.entities.Character.filter(
          { status: 'active', pending_scheduled_relocation_at: { $lte: nowIso } },
          '-updated_date', 200
        );
      } catch (_lteErr) {
        _lteSupported = false;
        _rawChars = await base44.asServiceRole.entities.Character.filter(
          { status: 'active' }, '-updated_date', 200
        );
      }
      commitmentChars = _rawChars.filter(c => {
        if (!c.owner_email || !c.next_location_id || !c.pending_scheduled_relocation_at) return false;
        if (_lteSupported) return true;
        return new Date(c.pending_scheduled_relocation_at) <= now;
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }

    console.log(`[processScheduledRelocations] Processing ${commitmentChars.length} pending relocations (foreground=${isForegroundActive})`);

    const relocated = [];

    for (const char of commitmentChars) {
      if (!char.owner_email) continue;

      // PROMISE TELEPORT: instant relocation at scheduled time
      const scheduledTime = new Date(char.pending_scheduled_relocation_at);
      if (now >= scheduledTime) {
        const fromLocation = char.resolved_current_location_name || 'Previous Location';
        const toLocation = char.next_location_name || 'Destination';

        // Capture pre-teleport snapshot for rollback if proof fails
        const preTeleportSnapshot = {
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          resolved_presence_status: char.resolved_presence_status,
          resolved_location_type: char.resolved_location_type,
          resolved_source_reason: char.resolved_source_reason,
          resolved_last_updated_at: char.resolved_last_updated_at,
          pending_scheduled_relocation_at: char.pending_scheduled_relocation_at,
          pending_relocation_from: char.pending_relocation_from,
          pending_relocation_from_name: char.pending_relocation_from_name,
          pending_relocation_source: char.pending_relocation_source,
          pending_relocation_message_id: char.pending_relocation_message_id,
          pending_relocation_confirmed_at: char.pending_relocation_confirmed_at,
          next_location_id: char.next_location_id,
          next_location_name: char.next_location_name,
        };

        // PRE-DEPARTURE CHILDCARE CHECK
        const _homeId = char.current_home_location_id;
        if (_homeId && char.resolved_current_location_id === _homeId && char.next_location_id !== _homeId) {
          let _allChars = [];
          try { _allChars = await base44.asServiceRole.entities.Character.filter({ owner_email: char.owner_email, status: 'active' }, null, 200); } catch { _allChars = []; }
          let _allLocs = [];
          try { _allLocs = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: char.owner_email }, null, 100); } catch { _allLocs = []; }
          const _ccResult = await _ensureChildcareBeforeDeparture(base44, char, _homeId, _allChars, _allLocs);
          if (!_ccResult.ok) {
            console.error('[processScheduledRelocations] ' + char.name + ': DEPARTURE BLOCKED — childcare coverage failed: ' + (_ccResult.error || 'unknown'));
            continue;
          }
          if (_ccResult.sitterAssigned || _ccResult.sitterSpawned) {
            console.log('[processScheduledRelocations] ' + char.name + ': childcare resolved (' + (_ccResult.sitterAssigned || _ccResult.sitterSpawned) + ')');
          }
        }
        // Instant teleport — write destination immediately
        await base44.asServiceRole.entities.Character.update(char.id, {
          resolved_current_location_id: char.next_location_id,
          resolved_current_location_name: toLocation,
          resolved_presence_status: 'visiting',
          resolved_location_type: 'visit',
          resolved_source_reason: 'scheduled_user_confirmed_relocation',
          resolved_last_updated_at: nowIso,
          // Clear all pending relocation fields
          pending_scheduled_relocation_at: null,
          pending_relocation_from: null,
          pending_relocation_from_name: null,
          pending_relocation_source: null,
          pending_relocation_message_id: null,
          pending_relocation_confirmed_at: null,
          next_location_id: null,
          next_location_name: null,
          // Clear any stale travel fields
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
          traveling_to_location_id: null,
          traveling_to_location_name: null,
        });

        // Produce LocationHistory proof directly — revert on failure.
        // Inlined instead of invoking writeVerifiedLocationHistory because
        // function-to-function invocation from this scheduled service-role
        // context carries a session identity whose email does not match the
        // character's owner_email, triggering a 403 in that function's
        // session-user guard. This executor is a trusted system caller;
        // owner_email is already verified against the Character record.
        let proofFailed = false;
        let proofErrorMsg = null;
        try {
          const openRecords = await base44.asServiceRole.entities.LocationHistory.filter(
            { character_id: char.id, owner_email: char.owner_email, is_current: true }, null, 20
          );
          for (const open of openRecords) {
            if (open.location_id === char.next_location_id) continue;
            const arrivalMs = new Date(open.arrival_time).getTime();
            const durationMinutes = Math.round((Date.now() - arrivalMs) / 60000);
            await base44.asServiceRole.entities.LocationHistory.update(open.id, {
              is_current: false,
              departure_time: nowIso,
              duration_minutes: durationMinutes > 0 ? durationMinutes : null,
            });
          }
          const alreadyCurrent = openRecords.find(o => o.location_id === char.next_location_id);
          if (!alreadyCurrent) {
            let destLoc = null;
            try {
              const [dl] = await base44.asServiceRole.entities.LocationReference.filter({ id: char.next_location_id }, null, 1);
              destLoc = dl;
            } catch { /* non-fatal — category defaults to 'other' */ }
            await base44.asServiceRole.entities.LocationHistory.create({
              character_id: char.id,
              character_name: char.name || 'Unknown',
              owner_email: char.owner_email,
              location_id: char.next_location_id,
              location_name: destLoc?.name || toLocation,
              location_category: destLoc?.category || 'other',
              event_type: 'arrival',
              arrival_time: nowIso,
              travel_source: 'promise',
              travel_reason: 'scheduled_user_confirmed_relocation',
              is_current: true,
            });
          }
        } catch (e) {
          proofFailed = true;
          proofErrorMsg = e.message;
        }
        if (proofFailed) {
          let revertError = null;
          try { await base44.asServiceRole.entities.Character.update(char.id, preTeleportSnapshot); }
          catch (e) { revertError = e.message; }
          console.error(`[processScheduledRelocations] PROOF FAILED for ${char.name}: ${proofErrorMsg} | revert_error=${revertError}`);
          continue;
        }

        // Mark matching CharacterCommitment records as arrived
        const commitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
          { character_id: char.id, status: 'active', destination_location_id: char.next_location_id },
          null, 5
        ).catch(() => []);
        for (const c of commitments) {
          try {
            await base44.asServiceRole.entities.CharacterCommitment.update(c.id, {
              status: 'arrived',
              completed_at: nowIso,
            });
          } catch (commitErr) {
            console.error(`[processScheduledRelocations] CharacterCommitment update FAILED for ${c.id}: ${commitErr.message}`);
          }
        }

        relocated.push({
          character_name: char.name,
          from: fromLocation,
          to: toLocation,
          reason: 'user_confirmed_commitment'
        });
      }
    }

    return Response.json({
      success: true,
      relocated: relocated.length,
      characters: relocated,
      note: 'Promise teleport only. Transit travel removed.',
    });

  } catch (error) {
    console.error('[processScheduledRelocations]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});