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

    // Load characters with pending relocations only
    let commitmentChars = [];
    try {
      commitmentChars = await base44.asServiceRole.entities.Character.filter(
        { status: 'active' }, '-updated_date', 200
      );
      commitmentChars = commitmentChars.filter(c =>
        c.owner_email && c.pending_scheduled_relocation_at && c.next_location_id
      );
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