/**
 * updateCharacterArrivalState
 *
 * REPAIRED: Previously wrote Character.resolved_current_location_id directly
 * with zero LocationHistory proof. Now writes Character first, then calls
 * writeVerifiedLocationHistory to produce the authoritative proof record.
 * If the proof fails, the Character write is reverted (compensating rollback,
 * not atomic — see writeVerifiedLocationHistory concurrency note).
 *
 * Strategy: Query as service role (allowed), then update only if owner_email matches.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_id, owner_email, updates } = await req.json();

    if (!character_id || !owner_email || !updates) {
      return Response.json({ error: 'Missing character_id, owner_email, or updates' }, { status: 400 });
    }

    // Verify ownership
    const charArr = await base44.asServiceRole.entities.Character.filter(
      { id: character_id, owner_email: owner_email }, null, 1
    ).catch(() => []);
    const char = charArr?.[0];

    if (!char) {
      return Response.json({
        success: false,
        error: `Character not found or ownership mismatch: ${character_id}/${owner_email}`
      }, { status: 404 });
    }

    // Verify destination location exists
    const destLocArr = await base44.asServiceRole.entities.LocationReference.filter(
      { id: updates.resolved_current_location_id }, null, 1
    ).catch(() => []);
    const destLoc = destLocArr?.[0];
    if (!destLoc) {
      return Response.json({
        success: false,
        error: `Destination location not found: ${updates.resolved_current_location_id}`
      }, { status: 400 });
    }

    // Capture pre-write snapshot for rollback
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

    // Update with verified ownership
    await base44.asServiceRole.entities.Character.update(character_id, updates);

    // READ BACK verification
    const verifyArr = await base44.asServiceRole.entities.Character.filter(
      { id: character_id }, null, 1
    ).catch(() => []);
    const verified = verifyArr?.[0];

    if (!verified || verified.resolved_current_location_id !== updates.resolved_current_location_id) {
      return Response.json({
        success: false,
        error: `Destination write verification failed: expected ${updates.resolved_current_location_id}, got ${verified?.resolved_current_location_id || 'null'}`
      }, { status: 500 });
    }

    // ── PRODUCE VERIFIED LocationHistory PROOF ───────────────────────────
    // If this fails, revert the Character write (compensating rollback).
    let eventType = 'arrival';
    const destCat = destLoc.category || 'generic';
    if (destCat === 'home' || updates.resolved_presence_status === 'home') eventType = 'return_home';
    else if (updates.resolved_source_reason === 'work_schedule' || updates.resolved_presence_status === 'at_work') eventType = 'work_start';
    else if (updates.resolved_source_reason === 'school_schedule' || updates.resolved_presence_status === 'at_school') eventType = 'school_start';

    let travelSrc = 'system';
    const srcReason = updates.resolved_source_reason || '';
    if (srcReason.includes('schedule')) travelSrc = 'schedule';
    else if (srcReason.includes('autonomous')) travelSrc = 'autonomous';
    else if (srcReason.includes('promise') || srcReason.includes('commitment')) travelSrc = 'promise';
    else if (srcReason === 'manual_update') travelSrc = 'manual';

    try {
      const proofResult = await base44.asServiceRole.functions.invoke('writeVerifiedLocationHistory', {
        character_id,
        owner_email,
        location_id: destLoc.id,
        event_type: eventType,
        travel_source: travelSrc,
        travel_reason: srcReason || null,
      });
      if (!proofResult?.data?.success) {
        // PROOF FAILED — revert
        let revertError = null;
        try { await base44.asServiceRole.entities.Character.update(character_id, preWriteSnapshot); }
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
      try { await base44.asServiceRole.entities.Character.update(character_id, preWriteSnapshot); }
      catch (e) { revertError = e.message; }
      return Response.json({
        success: false,
        error: 'unverified_state_write',
        reason: `LocationHistory proof call threw — Character state reverted. proof_error=${proofError.message}`,
        revert_error: revertError,
      }, { status: 500 });
    }

    console.log(`[updateCharacterArrivalState] ✅ Updated + verified + proven ${char.name} → ${destLoc.name}`);

    return Response.json({
      success: true,
      character_id,
      character_name: char.name,
      destination: destLoc.name,
      verified: true,
      proof_written: true,
    });

  } catch (error) {
    console.error('[updateCharacterArrivalState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});