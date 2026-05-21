/**
 * completeCharacterArrival
 *
 * Delegates to achieveCharacterDestination (canonical path).
 * TravelSession completion → achieveCharacterDestination.
 *
 * This ensures the same authoritative destination-write logic
 * used pre-transit is used at travel completion.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 });

    // GET THE ARRIVED SESSION
    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: session_id },
      null, 1
    );

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.route_status !== 'arrived') {
      return Response.json({
        error: `Session not in 'arrived' state: ${session.route_status}`,
        session_id,
      }, { status: 400 });
    }

    // DELEGATE TO CANONICAL DESTINATION-WRITE FUNCTION
    const achieveRes = await base44.functions.invoke('achieveCharacterDestination', {
      character_id:              session.character_id,
      destination_location_id:   session.destination_location_id,
      destination_location_name: session.destination_location_name,
      presence_status:           session.travel_source === 'work_schedule' ? 'at_work' :
                                 session.travel_source === 'school_schedule' ? 'at_school' : 'visiting',
      location_type:             'visit',
      source_reason:             `travel_session_completion:${session.id}`,
    }).catch(e => ({ data: { success: false, error: e.message } }));

    const aData = achieveRes?.data || {};
    if (!aData.success) {
      return Response.json({
        error: `achieveCharacterDestination failed: ${aData.error}`,
        session_id,
      }, { status: 500 });
    }

    console.log(`[completeCharacterArrival] ✅ ${aData.character_name} completed arrival at ${aData.destination_name}`);

    return Response.json({
      success: true,
      session_id,
      character_id: aData.character_id,
      character_name: aData.character_name,
      destination_name: aData.destination_name,
      before_location: aData.before_location,
      after_location: aData.after_location,
      arrival_time: aData.arrival_time,
    });

  } catch (error) {
    console.error('[completeCharacterArrival]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});