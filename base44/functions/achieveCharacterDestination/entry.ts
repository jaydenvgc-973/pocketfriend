/**
 * achieveCharacterDestination
 *
 * CANONICAL DESTINATION-WRITE FUNCTION
 *
 * This is the authoritative logic for moving a character from ANY origin to ANY destination.
 * It is the ONLY function allowed to write:
 * - resolved_current_location_id
 * - resolved_current_location_name
 * - resolved_presence_status
 * - resolved_location_type
 * - resolved_source_reason
 *
 * This function was the working path before TravelSession and must remain the ONLY path.
 *
 * Called by:
 * 1. TravelSession completion (completeCharacterArrival → this function)
 * 2. Direct location assignment (when no transit needed)
 * 3. Home/work/school dispatch that doesn't use transit
 *
 * RULE: Character.resolved_current_location_id MUST equal destination_location_id after this runs.
 * RULE: No fallback to home_location_id.
 * RULE: No schedule/sleep override.
 * RULE: Read-back verification required.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      character_id,
      destination_location_id,
      destination_location_name,
      presence_status,      // 'home', 'at_work', 'at_school', 'visiting', etc.
      location_type,        // 'home', 'work', 'school', 'visit', etc.
      source_reason,        // why character is here (e.g., 'work_schedule', 'travel_completion')
      owner_email,          // Required: owner email for verification (service role has no user context)
    } = await req.json();

    if (!character_id || !destination_location_id || !owner_email) {
      return Response.json({
        error: 'character_id, destination_location_id, and owner_email required',
      }, { status: 400 });
    }

    // Get the character using service role
    const [char] = await base44.asServiceRole.entities.Character.filter(
      { id: character_id },
      null,
      1
    );

    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Verify ownership
    if (char.owner_email !== owner_email) {
      return Response.json({
        error: 'Character does not belong to the specified account',
        character_owner: char.owner_email,
        expected_owner: owner_email,
      }, { status: 403 });
    }

    // Get the destination location
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: destination_location_id },
      null,
      1
    );

    if (!destLoc) {
      return Response.json({
        error: 'Destination location not found',
        destination_id: destination_location_id,
      }, { status: 404 });
    }

    // Determine arrival presence and location type
    let finalPresenceStatus = presence_status || 'visiting';
    let finalLocationType = location_type || 'visit';

    // If destination is character's home, override to 'home'
    if (destLoc.id === char.current_home_location_id) {
      finalPresenceStatus = 'home';
      finalLocationType = 'home';
    }

    const now = new Date();

    // Snapshot for atomic revert if the location transition proof write fails.
    const preMoveSnapshot = {
      resolved_current_location_id:   char.resolved_current_location_id,
      resolved_current_location_name: char.resolved_current_location_name,
      resolved_presence_status:       char.resolved_presence_status,
      resolved_location_type:         char.resolved_location_type,
      resolved_source_reason:         char.resolved_source_reason,
      resolved_last_updated_at:       char.resolved_last_updated_at,
      last_arrived_time:              char.last_arrived_time,
      travel_status:                  char.travel_status,
      travel_destination_location_id: char.travel_destination_location_id,
      traveling_to_location_id:       char.traveling_to_location_id,
      traveling_to_location_name:     char.traveling_to_location_name,
    };

    // ─── WRITE CHARACTER TO DESTINATION ───────────────────────────────────
    // This is the canonical location write. No fallbacks, no overrides.
    // Use service-role to bypass RLS (ownership already verified above).
    await base44.asServiceRole.entities.Character.update(character_id, {
      resolved_current_location_id:   destLoc.id,
      resolved_current_location_name: destLoc.name,
      resolved_presence_status:       finalPresenceStatus,
      resolved_location_type:         finalLocationType,
      resolved_source_reason:         source_reason || `direct_destination:${destLoc.id}`,
      resolved_last_updated_at:       now.toISOString(),
      last_arrived_time:              now.toISOString(),
      // Clear all travel flags
      travel_status:                  'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id:       null,
      traveling_to_location_name:     null,
    });

    // ─── READ BACK AND VERIFY ─────────────────────────────────────────────
    const [charAfter] = await base44.asServiceRole.entities.Character.filter(
      { id: character_id },
      null,
      1
    );

    // HARD FAIL if destination was not written — revert is unnecessary here since
    // the write itself did not take effect (nothing to revert).
    if (charAfter.resolved_current_location_id !== destLoc.id) {
      throw new Error(
        `DESTINATION WRITE FAILED: character location not updated. ` +
        `expected=${destLoc.id} | actual=${charAfter.resolved_current_location_id}`
      );
    }

    if (charAfter.travel_status !== 'not_traveling') {
      throw new Error(
        `TRAVEL STATUS NOT CLEARED: travel_status=${charAfter.travel_status} | expected=not_traveling`
      );
    }

    // ─── AUTHORITATIVE LOCATION TRANSITION PROOF — hard gate, atomic ──────
    // Read-back above verifies the Character state; writeVerifiedLocationHistory
    // is the single authoritative writer for the persisted, queryable proof of
    // that verified transition (closes prior open records, prevents duplicate
    // current records, verifies owner + character state itself). If it fails,
    // the just-verified Character state is reverted so no state change can
    // outlive its proof record — UNLESS a concurrent writer has already moved
    // the character again, in which case reverting would destroy newer truth.
    try {
      const locResult = await base44.asServiceRole.functions.invoke('writeVerifiedLocationHistory', {
        character_id: character_id,
        owner_email: owner_email,
        location_id: destLoc.id,
        event_type: finalPresenceStatus === 'home' ? 'return_home' : 'arrival',
        travel_source: 'system',
        travel_reason: source_reason || null,
      });
      if (!locResult?.data?.success) {
        throw new Error(locResult?.data?.error || 'writeVerifiedLocationHistory failed');
      }
    } catch (proofError) {
      // Before reverting, re-read the Character. If a concurrent writer already
      // changed the state we're about to overwrite, a stale revert would destroy
      // newer legitimate truth — skip the revert and report it explicitly.
      let revertOutcome = 'reverted';
      let revertError = null;
      try {
        const [currentChar] = await base44.asServiceRole.entities.Character.filter({ id: character_id }, null, 1);
        const stillMatchesOurWrite = currentChar &&
          currentChar.resolved_current_location_id === destLoc.id &&
          currentChar.resolved_presence_status === finalPresenceStatus &&
          currentChar.resolved_location_type === finalLocationType &&
          currentChar.travel_status === 'not_traveling';
        if (stillMatchesOurWrite) {
          await base44.asServiceRole.entities.Character.update(character_id, preMoveSnapshot);
        } else {
          revertOutcome = 'revert_skipped_due_to_concurrent_update';
        }
      } catch (e) { revertError = e.message; }
      return Response.json({
        error: 'unverified_state_write',
        reason: 'LocationHistory transition proof failed',
        proof_error: proofError.message,
        revert_outcome: revertOutcome,
        revert_error: revertError,
      }, { status: 500 });
    }

    console.log(
      `[achieveCharacterDestination] ✅ ${char.name} → ${destLoc.name} | ` +
      `presence=${finalPresenceStatus} | location_type=${finalLocationType} | source=${source_reason}`
    );

    return Response.json({
      success: true,
      character_id: char.id,
      character_name: char.name,
      destination_id: destLoc.id,
      destination_name: destLoc.name,
      presence_status: finalPresenceStatus,
      location_type: finalLocationType,
      before_location: char.resolved_current_location_name,
      after_location: charAfter.resolved_current_location_name,
      before_travel_status: char.travel_status,
      after_travel_status: charAfter.travel_status,
      arrival_time: now.toISOString(),
    });

  } catch (error) {
    console.error('[achieveCharacterDestination]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});