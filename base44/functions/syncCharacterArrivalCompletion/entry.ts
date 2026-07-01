/**
 * syncCharacterArrivalCompletion
 *
 * REPAIRED: Previously wrote Character.resolved_current_location_id directly
 * with zero LocationHistory proof. Now writes Character first, then calls
 * writeVerifiedLocationHistory to produce the authoritative proof record.
 * If the proof fails, the Character write is reverted (compensating rollback).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { travel_session_id } = await req.json();
    if (!travel_session_id) {
      return Response.json({ error: 'travel_session_id required' }, { status: 400 });
    }

    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: travel_session_id }, null, 1
    );
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    if (session.route_status !== 'arrived') {
      return Response.json({ skipped: true, reason: `Session status is ${session.route_status}, not arrived` });
    }

    const [char] = await base44.entities.Character.filter({ id: session.character_id }, null, 1);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    if (char.owner_email !== user.email) {
      return Response.json({ error: 'Character does not belong to your account' }, { status: 403 });
    }

    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: session.destination_location_id }, null, 1
    );
    if (!destLoc) return Response.json({ error: `Destination not found: ${session.destination_location_id}` }, { status: 400 });

    // Determine arrival presence
    const charHomeId = char.current_home_location_id || null;
    let arrivalPresence = 'visiting';
    let arrivalLocationType = 'visit';
    if (destLoc.category === 'home' && (charHomeId === destLoc.id || char.temporary_housing_location_id === destLoc.id)) {
      arrivalPresence = 'home'; arrivalLocationType = 'home';
    } else if (session.travel_source === 'work_schedule') {
      arrivalPresence = 'at_work'; arrivalLocationType = 'work';
    } else if (session.travel_source === 'school_schedule') {
      arrivalPresence = 'at_school'; arrivalLocationType = 'school';
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Pre-write snapshot for rollback
    const preWriteSnapshot = {
      resolved_current_location_id: char.resolved_current_location_id,
      resolved_current_location_name: char.resolved_current_location_name,
      resolved_presence_status: char.resolved_presence_status,
      resolved_location_type: char.resolved_location_type,
      resolved_source_reason: char.resolved_source_reason,
      resolved_last_updated_at: char.resolved_last_updated_at,
      last_arrived_time: char.last_arrived_time,
      travel_status: char.travel_status,
      travel_destination_location_id: char.travel_destination_location_id,
      traveling_to_location_id: char.traveling_to_location_id,
      traveling_to_location_name: char.traveling_to_location_name,
    };

    // Write character to destination
    await base44.entities.Character.update(session.character_id, {
      resolved_current_location_id:   destLoc.id,
      resolved_current_location_name: destLoc.name,
      resolved_presence_status:       arrivalPresence,
      resolved_location_type:         arrivalLocationType,
      resolved_source_reason:         `arrived_from_travel_session:${session.id}`,
      resolved_last_updated_at:       nowIso,
      last_arrived_time:              nowIso,
      travel_status:                  'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id:       null,
      traveling_to_location_name:     null,
    });

    // Read back
    const [charVerify] = await base44.entities.Character.filter({ id: session.character_id }, null, 1);
    if (charVerify.resolved_current_location_id !== destLoc.id) {
      throw new Error('Verification failed: character not at destination');
    }
    if (charVerify.travel_status !== 'not_traveling' || charVerify.traveling_to_location_id !== null) {
      throw new Error('Verification failed: travel flags not cleared');
    }

    // ── PRODUCE VERIFIED LocationHistory PROOF ───────────────────────────
    let eventType = 'arrival';
    if (arrivalPresence === 'home') eventType = 'return_home';
    else if (arrivalPresence === 'at_work') eventType = 'work_start';
    else if (arrivalPresence === 'at_school') eventType = 'school_start';
    else if (destLoc.category === 'gym') eventType = 'gym_visit';
    else if (destLoc.category === 'religion') eventType = 'religious_service';
    else if (destLoc.category === 'food_drink') eventType = 'food_need';

    let travelSrc = 'system';
    if (session.travel_source) {
      if (session.travel_source.includes('schedule')) travelSrc = 'schedule';
      else if (session.travel_source.includes('autonomous')) travelSrc = 'autonomous';
      else if (session.travel_source === 'promise' || session.travel_source === 'commitment') travelSrc = 'promise';
      else if (session.travel_source === 'manual') travelSrc = 'manual';
      else travelSrc = session.travel_source;
    }

    try {
      const proofResult = await base44.asServiceRole.functions.invoke('writeVerifiedLocationHistory', {
        character_id: session.character_id,
        owner_email: char.owner_email,
        location_id: destLoc.id,
        event_type: eventType,
        travel_source: travelSrc,
        travel_reason: session.travel_reason || null,
      });
      if (!proofResult?.data?.success) {
        let revertError = null;
        try { await base44.entities.Character.update(session.character_id, preWriteSnapshot); }
        catch (e) { revertError = e.message; }
        return Response.json({
          success: false,
          error: 'unverified_state_write',
          reason: `LocationHistory proof failed — Character state reverted. proof_error=${proofResult?.data?.error || 'unknown'}`,
          revert_error: revertError,
        }, { status: 500 });
      }
    } catch (proofError) {
      let revertError = null;
      try { await base44.entities.Character.update(session.character_id, preWriteSnapshot); }
      catch (e) { revertError = e.message; }
      return Response.json({
        success: false,
        error: 'unverified_state_write',
        reason: `LocationHistory proof call threw — Character state reverted. proof_error=${proofError.message}`,
        revert_error: revertError,
      }, { status: 500 });
    }

    console.log(`[syncCharacterArrivalCompletion] ✅ ${char.name} arrival completed + proven at ${destLoc.name}`);

    return Response.json({
      success: true,
      character_id: session.character_id,
      character_name: char.name,
      destination: destLoc.name,
      arrival_presence: arrivalPresence,
      proof_written: true,
    });

  } catch (error) {
    console.error('[syncCharacterArrivalCompletion]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});