/**
 * fullTravelDiagnosticKhalilAndre
 *
 * Complete diagnostic showing EXACTLY what is happening with Khalil and Andre's travel.
 * No theories, no fixes. Raw data only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const khalilId = '6a0299e0dd588e28cb48df8a';
    const andreId = '69cd1c421ecd8b69850b3a6a';

    const diagnose = async (charId, charName) => {
      // CHARACTER STATE
      const [char] = await base44.entities.Character.filter({ id: charId }, null, 1);
      if (!char) return { error: `${charName} not found` };

      // TRAVEL SESSIONS - ALL, no filter
      const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
        { character_id: charId },
        '-created_date',
        20
      );

      // Active in_transit session
      const activeSession = allSessions.find(s => s.route_status === 'in_transit');
      
      // Most recent session (any status)
      const mostRecentSession = allSessions[0];

      // LOCATIONS
      let originLoc = null, destLoc = null;
      if (mostRecentSession) {
        const [o] = await base44.asServiceRole.entities.LocationReference.filter(
          { id: mostRecentSession.origin_location_id }, null, 1
        );
        const [d] = await base44.asServiceRole.entities.LocationReference.filter(
          { id: mostRecentSession.destination_location_id }, null, 1
        );
        originLoc = o;
        destLoc = d;
      }

      const [currentLoc] = await base44.asServiceRole.entities.LocationReference.filter(
        { id: char.resolved_current_location_id }, null, 1
      );

      return {
        CHARACTER: {
          id: char.id,
          name: char.name,
          owner_email: char.owner_email,
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          travel_status: char.travel_status,
          traveling_to_location_id: char.traveling_to_location_id,
          traveling_to_location_name: char.traveling_to_location_name,
        },
        CURRENT_LOCATION: currentLoc ? {
          id: currentLoc.id,
          name: currentLoc.name,
          owner_email: currentLoc.owner_email,
          category: currentLoc.category,
        } : null,
        ACTIVE_TRAVEL_SESSION: activeSession ? {
          id: activeSession.id,
          route_status: activeSession.route_status,
          progress_percent: activeSession.progress_percent,
          estimated_departure_time: activeSession.estimated_departure_time,
          estimated_arrival_time: activeSession.estimated_arrival_time,
          actual_arrival_time: activeSession.actual_arrival_time,
          origin: activeSession.origin_location_id ? {
            id: activeSession.origin_location_id,
            name: activeSession.origin_location_name,
            owner_email: originLoc?.owner_email,
          } : null,
          destination: activeSession.destination_location_id ? {
            id: activeSession.destination_location_id,
            name: activeSession.destination_location_name,
            owner_email: destLoc?.owner_email,
          } : null,
        } : 'NONE',
        MOST_RECENT_SESSION: mostRecentSession ? {
          id: mostRecentSession.id,
          route_status: mostRecentSession.route_status,
          progress_percent: mostRecentSession.progress_percent,
          estimated_arrival_time: mostRecentSession.estimated_arrival_time,
          actual_arrival_time: mostRecentSession.actual_arrival_time,
          error_reason: mostRecentSession.error_reason,
          blocker_reason: mostRecentSession.blocker_reason,
        } : null,
        ALL_SESSIONS: allSessions.map(s => ({
          id: s.id,
          route_status: s.route_status,
          progress: s.progress_percent,
          origin: s.origin_location_name,
          destination: s.destination_location_name,
          eta: s.estimated_arrival_time,
          actual_arrival: s.actual_arrival_time,
          error: s.error_reason || s.blocker_reason || 'none',
        })),
        MAP_MARKER_STATUS: {
          has_active_in_transit_session: !!activeSession,
          travel_marker_will_render: !!activeSession,
          static_pin_suppressed: !!activeSession,
          static_pin_would_render_at: !activeSession ? currentLoc?.name : 'suppressed',
          character_at_origin: mostRecentSession ? char.resolved_current_location_id === mostRecentSession.origin_location_id : null,
          character_at_destination: mostRecentSession ? char.resolved_current_location_id === mostRecentSession.destination_location_id : null,
        },
        FAILURE_ANALYSIS: {
          travel_status_stuck: char.travel_status !== 'not_traveling' && !activeSession,
          traveling_to_stuck: char.traveling_to_location_id && !activeSession,
          most_recent_session_failed: mostRecentSession?.route_status === 'arrival_failed',
          character_location_not_updated_to_destination: mostRecentSession && char.resolved_current_location_id !== mostRecentSession.destination_location_id,
          actual_arrival_time_missing: mostRecentSession && !mostRecentSession.actual_arrival_time,
          error_reason: mostRecentSession?.error_reason || 'none',
          blocker_reason: mostRecentSession?.blocker_reason || 'none',
        },
      };
    };

    const [khalilDiag, andreDiag] = await Promise.all([
      diagnose(khalilId, 'Khalil'),
      diagnose(andreId, 'Andre'),
    ]);

    return Response.json({
      TIMESTAMP: new Date().toISOString(),
      KHALIL: khalilDiag,
      ANDRE: andreDiag,
    });

  } catch (error) {
    console.error('[fullTravelDiagnosticKhalilAndre]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});