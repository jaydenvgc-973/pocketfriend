/**
 * diagnosKhalilAndreFailure
 * 
 * Inspect Khalil and Andre's latest TravelSessions to understand why:
 * - Khalil reached 97%, then disappeared and returned to origin
 * - Andre started traveling and did not complete
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch both characters
    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, null, 500);
    const khalil = allChars.find(c => c.name?.toLowerCase().includes('khalil'));
    const andre = allChars.find(c => c.name?.toLowerCase().includes('andre'));

    if (!khalil || !andre) {
      return Response.json({ error: 'Characters not found' }, { status: 404 });
    }

    // Get latest sessions (sorted by creation, newest first)
    const khalilSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: khalil.id },
      '-created_at',
      3
    );
    const andreSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: andre.id },
      '-created_at',
      3
    );

    const khalilLatest = khalilSessions?.[0] || null;
    const andreLatest = andreSessions?.[0] || null;

    const now = new Date();

    // Helper to get location details
    const getLocationInfo = async (locId) => {
      if (!locId) return null;
      const [loc] = await base44.asServiceRole.entities.LocationReference.filter(
        { id: locId },
        null,
        1
      ).catch(() => []);
      return loc ? {
        id: loc.id,
        name: loc.name,
        owner_email: loc.owner_email,
      } : null;
    };

    // Build diagnostic for Khalil
    const khalilOriginLoc = await getLocationInfo(khalilLatest?.origin_location_id);
    const khalilDestLoc = await getLocationInfo(khalilLatest?.destination_location_id);

    const khalilDiag = {
      CHARACTER: {
        id: khalil.id,
        name: khalil.name,
        owner_email: khalil.owner_email,
      },
      SESSION: khalilLatest ? {
        id: khalilLatest.id,
        owner_email: khalilLatest.owner_email,
        route_status: khalilLatest.route_status,
        progress_percent: khalilLatest.progress_percent,
        estimated_departure_time: khalilLatest.estimated_departure_time,
        estimated_arrival_time: khalilLatest.estimated_arrival_time,
        actual_arrival_time: khalilLatest.actual_arrival_time,
        blocker_reason: khalilLatest.blocker_reason,
        error_reason: khalilLatest.error_reason,
      } : null,
      ORIGIN: khalilOriginLoc,
      DESTINATION: khalilDestLoc,
      CHARACTER_STATE: {
        travel_status: khalil.travel_status,
        resolved_current_location_name: khalil.resolved_current_location_name,
        resolved_current_location_id: khalil.resolved_current_location_id,
        traveling_to_location_id: khalil.traveling_to_location_id,
        traveling_to_location_name: khalil.traveling_to_location_name,
      },
      TIMING: {
        server_now: now.toISOString(),
        eta_passed: khalilLatest ? new Date(khalilLatest.estimated_arrival_time) <= now : null,
        minutes_since_eta: khalilLatest ? Math.round((now.getTime() - new Date(khalilLatest.estimated_arrival_time).getTime()) / 60000) : null,
        session_age_minutes: khalilLatest ? Math.round((now.getTime() - new Date(khalilLatest.created_at).getTime()) / 60000) : null,
      },
      CRITICAL_QUESTIONS: {
        why_returned_to_origin: 'Khalil reached 97% then disappeared. Was updateCharacterArrivalState write rejected?',
        session_marked_arrived: khalilLatest?.route_status === 'arrived',
        session_marked_failed: khalilLatest?.route_status === 'arrival_failed',
        character_still_traveling: khalil.travel_status === 'traveling_to_destination',
        actual_arrival_recorded: khalilLatest?.actual_arrival_time ? true : false,
      },
    };

    // Build diagnostic for Andre
    const andreOriginLoc = await getLocationInfo(andreLatest?.origin_location_id);
    const andreDestLoc = await getLocationInfo(andreLatest?.destination_location_id);

    const andreDiag = {
      CHARACTER: {
        id: andre.id,
        name: andre.name,
        owner_email: andre.owner_email,
      },
      SESSION: andreLatest ? {
        id: andreLatest.id,
        owner_email: andreLatest.owner_email,
        route_status: andreLatest.route_status,
        progress_percent: andreLatest.progress_percent,
        estimated_departure_time: andreLatest.estimated_departure_time,
        estimated_arrival_time: andreLatest.estimated_arrival_time,
        actual_arrival_time: andreLatest.actual_arrival_time,
        blocker_reason: andreLatest.blocker_reason,
        error_reason: andreLatest.error_reason,
      } : null,
      ORIGIN: andreOriginLoc,
      DESTINATION: andreDestLoc,
      CHARACTER_STATE: {
        travel_status: andre.travel_status,
        resolved_current_location_name: andre.resolved_current_location_name,
        resolved_current_location_id: andre.resolved_current_location_id,
        traveling_to_location_id: andre.traveling_to_location_id,
        traveling_to_location_name: andre.traveling_to_location_name,
      },
      TIMING: {
        server_now: now.toISOString(),
        eta_passed: andreLatest ? new Date(andreLatest.estimated_arrival_time) <= now : null,
        minutes_since_eta: andreLatest ? Math.round((now.getTime() - new Date(andreLatest.estimated_arrival_time).getTime()) / 60000) : null,
        session_age_minutes: andreLatest ? Math.round((now.getTime() - new Date(andreLatest.created_at).getTime()) / 60000) : null,
      },
      CRITICAL_QUESTIONS: {
        why_started_during_khalil_test: 'Andre started traveling. Was this autonomous? Work? Promise? Duplicate stale?',
        session_marked_arrived: andreLatest?.route_status === 'arrived',
        session_marked_failed: andreLatest?.route_status === 'arrival_failed',
        character_still_traveling: andre.travel_status === 'traveling_to_destination',
        actual_arrival_recorded: andreLatest?.actual_arrival_time ? true : false,
      },
    };

    // Compare previous sessions to understand pattern
    const khalilPrevious = khalilSessions?.[1] || null;
    const andrePrevious = andreSessions?.[1] || null;

    return Response.json({
      KHALIL: khalilDiag,
      ANDRE: andreDiag,
      PREVIOUS_SESSIONS: {
        khalil_previous: khalilPrevious ? {
          id: khalilPrevious.id,
          route_status: khalilPrevious.route_status,
          created_at: khalilPrevious.created_at,
        } : null,
        andre_previous: andrePrevious ? {
          id: andrePrevious.id,
          route_status: andrePrevious.route_status,
          created_at: andrePrevious.created_at,
        } : null,
      },
      ROOT_CAUSE_CANDIDATES: {
        candidate_1: 'processTravelArrivals did not run or did not select the sessions',
        candidate_2: 'updateCharacterArrivalState write was silently rejected by RLS',
        candidate_3: 'Session marked arrived but character location write failed, so Frontend reverted visually',
        candidate_4: 'Frontend marker disappeared due to cache/subscription, but backend did not confirm arrival',
        candidate_5: 'ETA threshold (2 minutes) was not met, so scheduler did not process',
      },
    });

  } catch (error) {
    console.error('[diagnosKhalilAndreFailure]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});