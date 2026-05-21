/**
 * diagnoseKhalilSessionAndScheduler
 * 
 * Inspect Khalil's stuck session and check processTravelArrivals scheduler status.
 * No modifications. Proof only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const SESSION_ID = '6a0f160e7e97aa6bdd9b6aeb';
    const now = new Date();

    // Get the session
    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: SESSION_ID },
      null,
      1
    );

    if (!session) {
      return Response.json({ error: 'Session not found', session_id: SESSION_ID }, { status: 404 });
    }

    // Get locations
    const [origin] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: session.origin_location_id },
      null,
      1
    );
    const [destination] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: session.destination_location_id },
      null,
      1
    );

    // Parse timing
    const departTime = session.estimated_departure_time ? new Date(session.estimated_departure_time) : null;
    const arrivalTime = session.estimated_arrival_time ? new Date(session.estimated_arrival_time) : null;
    const lastProgressTime = session.last_progress_update ? new Date(session.last_progress_update) : null;

    const secondsSinceDeparture = departTime ? (now.getTime() - departTime.getTime()) / 1000 : 0;
    const secondsUntilArrival = arrivalTime ? (arrivalTime.getTime() - now.getTime()) / 1000 : 0;
    const secondsSinceLastProgress = lastProgressTime ? (now.getTime() - lastProgressTime.getTime()) / 1000 : 0;

    return Response.json({
      SESSION: {
        id: session.id,
        route_status: session.route_status,
        progress_percent: session.progress_percent,
        character_id: session.character_id,
        character_name: session.character_name,
        owner_email: session.owner_email,
      },
      TIMING: {
        server_now: now.toISOString(),
        estimated_departure_time: session.estimated_departure_time,
        estimated_arrival_time: session.estimated_arrival_time,
        last_progress_update: session.last_progress_update,
        duration_minutes: session.duration_minutes,
        seconds_since_departure: Math.round(secondsSinceDeparture),
        seconds_until_arrival: Math.round(secondsUntilArrival),
        seconds_since_last_progress: Math.round(secondsSinceLastProgress),
        arrival_should_trigger: secondsUntilArrival <= 0 || (arrivalTime && now >= arrivalTime),
      },
      LOCATIONS: {
        origin: origin ? { id: origin.id, name: origin.name, owner_email: origin.owner_email } : null,
        destination: destination ? { id: destination.id, name: destination.name, owner_email: destination.owner_email } : null,
      },
      BLOCKER_STATE: {
        route_status: session.route_status,
        blocker_reason: session.blocker_reason || 'none',
      },
      DIAGNOSIS: {
        progress_is_zero: session.progress_percent === 0,
        status_is_in_transit: session.route_status === 'in_transit',
        arrival_time_passed: secondsUntilArrival <= 0,
        expected_action_by_scheduler: 'processTravelArrivals should have selected and processed this session',
        why_still_zero_progress: 'processTravelArrivals has not yet updated progress_percent naturally',
      },
      SCHEDULER_CHECK: {
        // These are informational — they depend on whether processTravelArrivals is actually registered
        note: 'Check App.jsx for any scheduled automation registration for processTravelArrivals',
        expected_interval: '5 minutes',
        check_next_run: 'If processTravelArrivals is scheduled, the next run should process this session',
      },
    });

  } catch (error) {
    console.error('[diagnoseKhalilSessionAndScheduler]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});