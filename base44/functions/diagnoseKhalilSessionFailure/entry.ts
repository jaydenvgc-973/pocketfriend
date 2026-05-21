/**
 * diagnoseKhalilSessionFailure
 * 
 * Show why Khalil's session "6a0f160e7e97aa6bdd9b6aeb" did not progress or arrive.
 * No modifications.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const SESSION_ID = '6a0f160e7e97aa6bdd9b6aeb';

    // Get session
    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: SESSION_ID },
      null,
      1
    );

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get character
    const [khalil] = await base44.entities.Character.filter(
      { id: session.character_id },
      null,
      1
    );

    if (!khalil) {
      return Response.json({ error: 'Khalil not found' }, { status: 404 });
    }

    // Get locations
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter({}, null, 500);
    const originLoc = allLocs.find(l => l.id === session.origin_location_id);
    const destLoc = allLocs.find(l => l.id === session.destination_location_id);

    const now = new Date();
    const eta = new Date(session.estimated_arrival_time);
    const departure = new Date(session.estimated_departure_time);
    const lastUpdate = session.last_progress_update ? new Date(session.last_progress_update) : null;

    const secSinceDeparture = (now.getTime() - departure.getTime()) / 1000;
    const secUntilETA = (eta.getTime() - now.getTime()) / 1000;
    const expectedDuration = session.duration_minutes * 60;
    const expectedProgress = Math.min(100, (secSinceDeparture / expectedDuration) * 100);

    return Response.json({
      SESSION_PROOF: {
        id: SESSION_ID,
        route_status: session.route_status,
        progress_percent: session.progress_percent,
        character_id: session.character_id,
        character_name: khalil.name,
        owner_email: session.owner_email,
      },
      TIMING: {
        server_now: now.toISOString(),
        estimated_departure: departure.toISOString(),
        estimated_arrival: eta.toISOString(),
        duration_minutes: session.duration_minutes,
        seconds_elapsed: Math.round(secSinceDeparture),
        seconds_until_eta: Math.round(secUntilETA),
        expected_progress_percent: Math.round(expectedProgress),
        actual_progress_percent: session.progress_percent,
        progress_mismatch: Math.round(expectedProgress) - session.progress_percent,
      },
      LAST_UPDATE: {
        last_progress_update: session.last_progress_update,
        seconds_since_last_update: lastUpdate ? Math.round((now.getTime() - lastUpdate.getTime()) / 1000) : 'never',
      },
      LOCATIONS: {
        origin: {
          id: originLoc?.id,
          name: originLoc?.name,
          owner_email: originLoc?.owner_email,
          visible: !!originLoc,
        },
        destination: {
          id: destLoc?.id,
          name: destLoc?.name,
          owner_email: destLoc?.owner_email,
          visible: !!destLoc,
        },
      },
      CHARACTER_STATE: {
        canonical_location_id: khalil.resolved_current_location_id,
        canonical_location_name: khalil.resolved_current_location_name,
        travel_status: khalil.travel_status,
        traveling_to_location_id: khalil.traveling_to_location_id,
        traveling_to_location_name: khalil.traveling_to_location_name,
      },
      DIAGNOSIS: {
        eta_has_passed: secUntilETA < 0,
        progress_stuck_at_zero: session.progress_percent === 0 && secSinceDeparture > 60,
        progress_not_updating: lastUpdate && ((now.getTime() - lastUpdate.getTime()) / 1000) > 120,
        character_location_not_at_origin: khalil.resolved_current_location_id !== session.origin_location_id,
        session_status_in_transit: session.route_status === 'in_transit',
        expected_to_be_arrived: secUntilETA < 0 && session.route_status !== 'arrived',
        blocker_reason: session.blocker_reason || 'none',
      },
      ROOT_CAUSE_CANDIDATES: [
        {
          cause: 'processTravelArrivals not running',
          evidence: session.route_status === 'in_transit' && secUntilETA < 0,
          check: 'Is processTravelArrivals scheduled? Has it run in the last 5 minutes?',
        },
        {
          cause: 'processTravelArrivals not selecting this session',
          evidence: session.progress_percent === 0 && secSinceDeparture > 60,
          check: 'Does processTravelArrivals have a filter that excludes this session?',
        },
        {
          cause: 'Character location not updating on arrival',
          evidence: khalil.resolved_current_location_id === session.origin_location_id && session.route_status === 'in_transit',
          check: 'Is updateCharacterArrivalState being called? Is it succeeding?',
        },
        {
          cause: 'TravelSession not written correctly',
          evidence: !session.duration_minutes || !session.estimated_arrival_time,
          check: 'Were all required fields populated when session was created?',
        },
      ],
    });

  } catch (error) {
    console.error('[diagnoseKhalilSessionFailure]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});