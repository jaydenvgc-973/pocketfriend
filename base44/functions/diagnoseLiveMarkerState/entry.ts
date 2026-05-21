/**
 * diagnoseLiveMarkerState
 * 
 * Show EXACTLY what LivePresenceMap will render for Khalil and Andre.
 * 
 * For each character:
 * - active TravelSession (in_transit, preparing, delayed)
 * - Character.resolved_current_location_id
 * - Character.travel_status and traveling_to_location_id
 * - Whether static pin would be suppressed (travelingCharacterIds check)
 * - Whether transit marker would render
 * - Final marker count per character
 * - Final marker location
 * - If marker appears at origin after failed travel, show exact reason
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const khalilId = '6a0299e0dd588e28cb48df8a';
    const andreId = '69cd1c421ecd8b69850b3a6a';

    const diagnoseMark = async (charId, charName) => {
      // Load character
      const [char] = await base44.entities.Character.filter({ id: charId }, null, 1);
      if (!char) return { error: `${charName} not found` };

      // Check for active in_transit session
      const inTransitSessions = await base44.asServiceRole.entities.TravelSession.filter(
        { character_id: charId, route_status: 'in_transit' },
        null,
        1
      );
      const activeSession = inTransitSessions?.[0] || null;

      // Get most recent session (any status)
      const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
        { character_id: charId },
        '-created_date',
        1
      );
      const mostRecentSession = allSessions?.[0] || null;

      // Load origin and destination for active session
      let originLoc = null, destLoc = null;
      if (activeSession) {
        const [o] = await base44.asServiceRole.entities.LocationReference.filter(
          { id: activeSession.origin_location_id }, null, 1
        );
        const [d] = await base44.asServiceRole.entities.LocationReference.filter(
          { id: activeSession.destination_location_id }, null, 1
        );
        originLoc = o;
        destLoc = d;
      }

      // Load character's current location
      const [currentLoc] = await base44.asServiceRole.entities.LocationReference.filter(
        { id: char.resolved_current_location_id }, null, 1
      );

      // LIVEPRESENCEMAP LOGIC:
      // - If activeSession exists and route_status is in_transit:
      //   - travelingCharacterIds.has(charId) = true
      //   - buildMarkers will SUPPRESS static pin (line 683-686)
      //   - TransitMarker will RENDER (if coords exist)
      // - If activeSession does NOT exist:
      //   - travelingCharacterIds.has(charId) = false
      //   - buildMarkers will show static pin at resolved_current_location_id
      //   - TransitMarker will NOT render

      const hasActiveTravel = activeSession?.route_status === 'in_transit';
      const staticPinSuppressed = hasActiveTravel;
      const transitMarkerWillRender = hasActiveTravel && originLoc && destLoc;

      // Determine what markers will show
      let finalMarkerCount = 0;
      let finalMarkerLocations = [];

      if (transitMarkerWillRender) {
        finalMarkerCount += 1;
        finalMarkerLocations.push({
          type: 'transit_marker',
          location: `between ${originLoc.name} and ${destLoc.name}`,
          progress: activeSession.progress_percent || 0,
        });
      }

      if (!staticPinSuppressed && char.resolved_current_location_id && currentLoc) {
        finalMarkerCount += 1;
        finalMarkerLocations.push({
          type: 'static_pin',
          location: currentLoc.name,
          source_field: 'Character.resolved_current_location_id',
        });
      }

      // Check for failure case: no active travel, but travel_status says traveling
      const stuckInTravelState = !hasActiveTravel && char.travel_status !== 'not_traveling';

      // Check if character appears at origin (the failure case)
      const charAtOrigin = activeSession && char.resolved_current_location_id === activeSession.origin_location_id;
      const markerWouldShowOrigin = finalMarkerLocations.some(m => m.type === 'static_pin' && m.location === originLoc?.name);

      return {
        character: {
          id: char.id,
          name: char.name,
          owner_email: char.owner_email,
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          travel_status: char.travel_status,
          traveling_to_location_id: char.traveling_to_location_id,
          traveling_to_location_name: char.traveling_to_location_name,
        },
        active_session: activeSession ? {
          id: activeSession.id,
          route_status: activeSession.route_status,
          progress_percent: activeSession.progress_percent,
          origin: {
            id: activeSession.origin_location_id,
            name: activeSession.origin_location_name,
            owner_email: originLoc?.owner_email || 'unknown',
          },
          destination: {
            id: activeSession.destination_location_id,
            name: activeSession.destination_location_name,
            owner_email: destLoc?.owner_email || 'unknown',
          },
          eta: activeSession.estimated_arrival_time,
        } : null,
        most_recent_session: mostRecentSession ? {
          id: mostRecentSession.id,
          route_status: mostRecentSession.route_status,
          actual_arrival: mostRecentSession.actual_arrival_time,
        } : null,
        livepresencemap_logic: {
          has_active_in_transit_session: hasActiveTravel,
          travelingCharacterIds_contains_char: hasActiveTravel,
          static_pin_suppressed: staticPinSuppressed,
          static_pin_suppression_reason: staticPinSuppressed ? 'character in in_transit session' : 'not traveling',
          transit_marker_will_render: transitMarkerWillRender,
          transit_marker_render_reason: !hasActiveTravel
            ? 'no in_transit session'
            : !originLoc || !destLoc
            ? 'missing origin or destination location'
            : 'will render',
        },
        final_markers: {
          count: finalMarkerCount,
          markers: finalMarkerLocations,
        },
        failure_diagnostics: {
          stuck_in_travel_state: stuckInTravelState,
          stuck_reason: stuckInTravelState ? `travel_status=${char.travel_status}, traveling_to=${char.traveling_to_location_id}, but no active TravelSession` : 'ok',
          character_at_origin: charAtOrigin,
          static_marker_would_show_origin: markerWouldShowOrigin,
          unsuppression_risk: markerWouldShowOrigin
            ? `FAILURE: Static marker would show ${originLoc?.name}. Character never wrote to destination. Map shows return home.`
            : 'ok',
        },
      };
    };

    const [khalilDiag, andreDiag] = await Promise.all([
      diagnoseMark(khalilId, 'Khalil'),
      diagnoseMark(andreId, 'Andre'),
    ]);

    return Response.json({
      KHALIL: khalilDiag,
      ANDRE: andreDiag,
      TIMESTAMP: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[diagnoseLiveMarkerState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});