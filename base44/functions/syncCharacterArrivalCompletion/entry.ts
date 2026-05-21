/**
 * syncCharacterArrivalCompletion
 *
 * User-scoped function that completes character location updates after processTravelArrivals
 * marks a TravelSession as "arrived".
 *
 * This function runs AFTER a travel session transitions to "arrived" state.
 * It updates the character's resolved location to the destination, clears travel flags,
 * and verifies the write completed successfully.
 *
 * Called manually or via entity automation on TravelSession update.
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

    // Load the session
    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: travel_session_id },
      null, 1
    );
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Only process if session is marked "arrived"
    if (session.route_status !== 'arrived') {
      return Response.json({
        skipped: true,
        reason: `Session status is ${session.route_status}, not arrived`,
      });
    }

    // Load character and verify ownership
    const [char] = await base44.entities.Character.filter(
      { id: session.character_id },
      null, 1
    );
    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Verify user owns this character
    if (char.owner_email !== user.email) {
      return Response.json({
        error: 'Character does not belong to your account',
      }, { status: 403 });
    }

    // Load destination location
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: session.destination_location_id },
      null, 1
    );
    if (!destLoc) {
      return Response.json({
        error: `Destination location not found: ${session.destination_location_id}`,
      }, { status: 400 });
    }

    // Determine arrival presence status
    const charHomeId = char.current_home_location_id || null;
    let arrivalPresence = 'visiting';
    let arrivalLocationType = 'visit';

    if (destLoc.category === 'home' && (
      charHomeId === destLoc.id ||
      char.temporary_housing_location_id === destLoc.id
    )) {
      arrivalPresence = 'home';
      arrivalLocationType = 'home';
    } else if (session.travel_source === 'work_schedule') {
      arrivalPresence = 'at_work';
      arrivalLocationType = 'work';
    } else if (session.travel_source === 'school_schedule') {
      arrivalPresence = 'at_school';
      arrivalLocationType = 'school';
    }

    const now = new Date();

    // Update character location
    await base44.entities.Character.update(session.character_id, {
      resolved_current_location_id:   destLoc.id,
      resolved_current_location_name: destLoc.name,
      resolved_presence_status:       arrivalPresence,
      resolved_location_type:         arrivalLocationType,
      resolved_source_reason:         `arrived_from_travel_session:${session.id}`,
      resolved_last_updated_at:       now.toISOString(),
      last_arrived_time:              now.toISOString(),
      travel_status:                  'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id:       null,
      traveling_to_location_name:     null,
    });

    // Verify by reading back
    const [charVerify] = await base44.entities.Character.filter(
      { id: session.character_id },
      null, 1
    );

    if (charVerify.resolved_current_location_id !== destLoc.id) {
      throw new Error(`Verification failed: character not at destination`);
    }

    if (charVerify.travel_status !== 'not_traveling' || charVerify.traveling_to_location_id !== null) {
      throw new Error(`Verification failed: travel flags not cleared`);
    }

    console.log(`[syncCharacterArrivalCompletion] ✅ ${char.name} arrival completed at ${destLoc.name}`);

    return Response.json({
      success: true,
      character_id: session.character_id,
      character_name: char.name,
      destination: destLoc.name,
      arrival_presence: arrivalPresence,
    });

  } catch (error) {
    console.error('[syncCharacterArrivalCompletion]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});