/**
 * completeCharacterArrival
 *
 * User-scoped function to complete a character's arrival by updating their location.
 * Called after processTravelArrivals marks a TravelSession as "arrived".
 * Uses user session token to satisfy Character RLS rules.
 *
 * RULES:
 * - Only processes sessions marked "arrived"
 * - Reads back Character after update to verify
 * - Only clears travel flags if location write succeeds
 * - No character moved without RLS verification
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

    // VERIFY CHARACTER OWNERSHIP
    const [char] = await base44.entities.Character.filter(
      { id: session.character_id },
      null, 1
    );

    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    if (char.owner_email !== user.email) {
      return Response.json({
        error: 'Character does not belong to your account',
        character_owner: char.owner_email,
        session_owner: session.character_id,
      }, { status: 403 });
    }

    // GET DESTINATION LOCATION
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: session.destination_location_id },
      null, 1
    );

    if (!destLoc) {
      return Response.json({
        error: 'Destination location not found',
        destination_id: session.destination_location_id,
      }, { status: 404 });
    }

    // UPDATE CHARACTER LOCATION
    const now = new Date();
    
    // Determine arrival presence
    let arrivalPresence = 'visiting';
    if (destLoc.category === 'home' && char.current_home_location_id === destLoc.id) {
      arrivalPresence = 'home';
    } else if (session.travel_source === 'work_schedule') {
      arrivalPresence = 'at_work';
    } else if (session.travel_source === 'school_schedule') {
      arrivalPresence = 'at_school';
    }

    await base44.entities.Character.update(session.character_id, {
      resolved_current_location_id:   destLoc.id,
      resolved_current_location_name: destLoc.name,
      resolved_presence_status:       arrivalPresence,
      resolved_location_type:         destLoc.category === 'home' ? 'home' : 'visit',
      resolved_source_reason:         `arrived_from_travel_session:${session.id}`,
      resolved_last_updated_at:       now.toISOString(),
      last_arrived_time:              now.toISOString(),
      travel_status:                  'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id:       null,
      traveling_to_location_name:     null,
    });

    // VERIFY BY READING BACK
    const [charAfter] = await base44.entities.Character.filter(
      { id: session.character_id },
      null, 1
    );

    if (charAfter.resolved_current_location_id !== destLoc.id) {
      throw new Error(`Verification failed: character not at destination after update`);
    }

    if (charAfter.travel_status !== 'not_traveling') {
      throw new Error(`Verification failed: travel_status not cleared`);
    }

    console.log(`[completeCharacterArrival] ✅ ${char.name} completed arrival at ${destLoc.name}`);

    return Response.json({
      success: true,
      session_id,
      character_id: char.id,
      character_name: char.name,
      destination_name: destLoc.name,
      before_location: char.resolved_current_location_name,
      after_location: charAfter.resolved_current_location_name,
      arrival_time: now.toISOString(),
    });

  } catch (error) {
    console.error('[completeCharacterArrival]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});