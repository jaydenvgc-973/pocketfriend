/**
 * repairAndreToLastVerifiedDestination
 * 
 * Andre has a COMPLETED session (6a0ee95057b83e3a9fcc7aa6) with actual_arrival_time.
 * His CHARACTER state is stuck in traveling due to a newer failed session.
 * 
 * This repair:
 * 1. Finds the last ARRIVED session
 * 2. Verifies it has actual_arrival_time (proof of completion)
 * 3. Updates Character to that destination
 * 4. Clears travel flags
 * 5. Closes the failed session as orphaned
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const andreaCharacterId = '69cd1c421ecd8b69850b3a6a';

    // Load all sessions
    const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: andreaCharacterId },
      '-created_date',
      100
    );

    // Find the most recent ARRIVED session with actual_arrival_time
    const arrivedSessions = allSessions.filter(s => 
      s.route_status === 'arrived' && s.actual_arrival_time
    );

    if (arrivedSessions.length === 0) {
      return Response.json({
        success: false,
        error: 'No completed travel sessions found for Andre',
        reason: 'Cannot determine last verified destination',
      }, { status: 400 });
    }

    const lastArrived = arrivedSessions[0]; // Most recent (sorted by -created_date)
    const destination = lastArrived.destination_location_id;
    const destinationName = lastArrived.destination_location_name;

    // Load character
    const [andre] = await base44.entities.Character.filter({ id: andreaCharacterId }, null, 1);

    console.log(`[repairAndreToLastVerifiedDestination] Last arrived session: ${lastArrived.id}`);
    console.log(`[repairAndreToLastVerifiedDestination] Destination: ${destinationName} (${destination})`);
    console.log(`[repairAndreToLastVerifiedDestination] Actual arrival time: ${lastArrived.actual_arrival_time}`);

    // Update character to arrived destination
    await base44.entities.Character.update(andreaCharacterId, {
      resolved_current_location_id: destination,
      resolved_current_location_name: destinationName,
      travel_status: 'not_traveling',
      traveling_to_location_id: null,
      traveling_to_location_name: null,
      resolved_presence_status: 'visiting',
      last_arrived_time: lastArrived.actual_arrival_time,
    });

    // Mark failed session as orphaned (not closing it, just documenting failure)
    const failedSession = allSessions.find(s => s.route_status === 'arrival_failed');
    if (failedSession) {
      await base44.asServiceRole.entities.TravelSession.update(failedSession.id, {
        blocker_reason: 'session_orphaned_by_prior_successful_completion',
      });
    }

    // Read back to verify
    const [andreaVerified] = await base44.entities.Character.filter({ id: andreaCharacterId }, null, 1);

    const success =
      andreaVerified.resolved_current_location_id === destination &&
      andreaVerified.travel_status === 'not_traveling' &&
      andreaVerified.traveling_to_location_id === null;

    console.log(`[repairAndreToLastVerifiedDestination] ✅ Repaired and verified: ${success}`);

    return Response.json({
      success,
      character: andreaVerified.name,
      location: andreaVerified.resolved_current_location_name,
      travel_status: andreaVerified.travel_status,
      traveling_to: andreaVerified.traveling_to_location_id,
      last_verified_arrival: lastArrived.actual_arrival_time,
      failed_session_marked: failedSession ? 'yes' : 'none',
    });

  } catch (error) {
    console.error('[repairAndreToLastVerifiedDestination]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});