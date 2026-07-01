/**
 * createTravelSession — TRANSIT TRAVEL REMOVED
 *
 * This function previously calculated travel duration from distance, set ETA,
 * created in-transit route_status with progress_percent, and kept the character
 * at origin during a simulated transit phase. That behavior is forbidden.
 *
 * Characters now teleport instantly. This function delegates to
 * achieveCharacterDestination to write resolved_current_location_id to the
 * destination immediately, with verified LocationHistory proof.
 *
 * No TravelSession is created. No ETA, no progress, no in-transit state.
 *
 * Promised teleport (future-time scheduling) is handled by
 * confirmMovementCommitment → processScheduledRelocations, not this function.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    const {
      characterId,
      destinationLocationId,
      travelReason,
      travelSource,
      sourceMessageId,
      sourceConversationId,
      ownerEmail,
    } = await req.json();

    if (!characterId || !destinationLocationId) {
      return Response.json({ error: 'characterId and destinationLocationId are required' }, { status: 400 });
    }

    const requestEmail = user?.email || ownerEmail;
    if (!requestEmail) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Delegate to instant teleport — achieveCharacterDestination writes
    // resolved_current_location_id + writeVerifiedLocationHistory proof.
    const result = await base44.asServiceRole.functions.invoke('achieveCharacterDestination', {
      character_id: characterId,
      destination_location_id: destinationLocationId,
      presence_status: travelSource === 'work_schedule' ? 'at_work' :
                        travelSource === 'school_schedule' ? 'at_school' : 'visiting',
      location_type: travelSource === 'work_schedule' ? 'work' :
                     travelSource === 'school_schedule' ? 'school' : 'visit',
      source_reason: travelReason || travelSource || 'instant_teleport',
    }).catch(e => ({ data: { success: false, error: e.message } }));

    const d = result?.data || {};
    if (!d.success) {
      return Response.json({ success: false, error: d.error || 'achieveCharacterDestination failed' }, { status: 500 });
    }

    return Response.json({
      success: true,
      character_name: d.character_name,
      destination: d.destination_name,
      instant_teleport: true,
      proof_written: true,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});