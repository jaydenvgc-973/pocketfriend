/**
 * diagnoseTravelSessionFailure
 * 
 * Inspect why Khalil's test session failed to progress or arrive.
 * Show exact session state, ETA calculation, scheduler status, and failure point.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const SESSION_ID = '6a0f160e7e97aa6bdd9b6aeb';

    // Get the failed session
    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: SESSION_ID },
      null,
      1
    );

    if (!session) {
      return Response.json({ error: `Session ${SESSION_ID} not found` }, { status: 404 });
    }

    // Get character and locations
    const [khalil] = await base44.entities.Character.filter(
      { id: session.character_id },
      null,
      1
    );

    const [originLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: session.origin_location_id },
      null,
      1
    );

    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: session.destination_location_id },
      null,
      1
    );

    // Calculate progress
    const depTime = session.estimated_departure_time ? new Date(session.estimated_departure_time).getTime() : 0;
    const etaTime = session.estimated_arrival_time ? new Date(session.estimated_arrival_time).getTime() : 0;
    const totalDuration = etaTime - depTime;
    const elapsedTime = now.getTime() - depTime;
    const expectedProgress = Math.min(99, Math.round((elapsedTime / totalDuration) * 100));

    const etaPassed = now.getTime() >= etaTime;

    // Check if processTravelArrivals should have picked this up
    const lastProgressUpdate = session.last_progress_update ? new Date(session.last_progress_update).getTime() : depTime;
    const timeSinceLastUpdate = now.getTime() - lastProgressUpdate;

    return Response.json({
      timestamp: now.toISOString(),
      session: {
        id: session.id,
        character_id: session.character_id,
        character_name: session.character_name,
        route_status: session.route_status,
      },
      character: {
        id: khalil?.id,
        name: khalil?.name,
        owner_email: khalil?.owner_email,
        travel_status: khalil?.travel_status,
        traveling_to: khalil?.traveling_to_location_name,
      },
      origin: {
        id: session.origin_location_id,
        name: originLoc?.name,
        owner_email: originLoc?.owner_email,
      },
      destination: {
        id: session.destination_location_id,
        name: destLoc?.name,
        owner_email: destLoc?.owner_email,
      },
      timing: {
        estimated_departure: session.estimated_departure_time,
        estimated_arrival: session.estimated_arrival_time,
        actual_arrival: session.actual_arrival_time,
        server_now: now.toISOString(),
        total_duration_minutes: session.duration_minutes,
        elapsed_time_ms: elapsedTime,
        time_since_last_update_ms: timeSinceLastUpdate,
      },
      progress: {
        current_percent: session.progress_percent,
        expected_percent: expectedProgress,
        progress_stuck: session.progress_percent === 0 && expectedProgress > 5,
        last_progress_update: session.last_progress_update,
      },
      arrival_check: {
        eta_passed: etaPassed,
        seconds_past_eta: etaPassed ? Math.round((now.getTime() - etaTime) / 1000) : null,
        route_status_is_in_transit: session.route_status === 'in_transit',
        should_have_arrived: etaPassed && session.route_status === 'in_transit',
      },
      diagnostics: {
        symptom: 'Progress stuck at 0%, route_status in_transit, no arrival',
        possible_causes: [
          'processTravelArrivals scheduler is not running',
          'processTravelArrivals skipped this session (blocker check)',
          'processTravelArrivals ran but failed to update TravelSession',
          'processTravelArrivals ran but Character update failed',
          'ETA calculation was incorrect',
        ],
      },
    });

  } catch (error) {
    console.error('[diagnoseTravelSessionFailure]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});