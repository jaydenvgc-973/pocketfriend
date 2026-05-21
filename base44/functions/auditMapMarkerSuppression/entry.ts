/**
 * auditMapMarkerSuppression
 * 
 * Show whether LivePresenceMap is suppressing static origin avatars during travel
 * and re-enabling them after travel ends WITHOUT verifying destination write.
 * 
 * For Khalil and Andre, show:
 * - Travel marker source (TravelSession.route_status)
 * - Static presence marker source (Character.resolved_current_location_id)
 * - Whether static marker was suppressed
 * - What field the static marker uses
 * - Whether Character canonical location equals origin or destination
 * - Final marker count
 * - Final marker location
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const khalilId = '6a0299e0dd588e28cb48df8a';
    const andreId = '69cd1c421ecd8b69850b3a6a';

    const auditCharacter = async (charId, charName) => {
      // Load character
      const [char] = await base44.entities.Character.filter({ id: charId }, null, 1);
      if (!char) return { error: `${charName} not found` };

      // Load all sessions for this character
      const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
        { character_id: charId },
        '-created_date',
        100
      );

      // Get active in_transit session
      const activeSession = allSessions.find(s => s.route_status === 'in_transit');

      // Get most recent session (to show history)
      const mostRecentSession = allSessions[0];

      // Load origin and destination locations
      const originLoc = activeSession?.origin_location_id
        ? (await base44.asServiceRole.entities.LocationReference.filter(
            { id: activeSession.origin_location_id }, null, 1
          ))[0]
        : null;

      const destLoc = activeSession?.destination_location_id
        ? (await base44.asServiceRole.entities.LocationReference.filter(
            { id: activeSession.destination_location_id }, null, 1
          ))[0]
        : null;

      const mostRecentDest = mostRecentSession?.destination_location_id
        ? (await base44.asServiceRole.entities.LocationReference.filter(
            { id: mostRecentSession.destination_location_id }, null, 1
          ))[0]
        : null;

      // Get current location
      const currentLoc = char.resolved_current_location_id
        ? (await base44.asServiceRole.entities.LocationReference.filter(
            { id: char.resolved_current_location_id }, null, 1
          ))[0]
        : null;

      // DIAGNOSTIC QUESTIONS
      const travelMarkerActive = activeSession?.route_status === 'in_transit';
      const staticMarkerWouldBeSuppressed = travelMarkerActive; // LivePresenceMap suppresses during in_transit
      const characterCurrentLocationIsOrigin = activeSession && char.resolved_current_location_id === activeSession.origin_location_id;
      const characterCurrentLocationIsDestination = activeSession && char.resolved_current_location_id === activeSession.destination_location_id;
      const destinationWriteFailed = mostRecentSession?.route_status === 'arrival_failed' || mostRecentSession?.route_status === 'arrived' && !mostRecentSession.actual_arrival_time;

      return {
        character: {
          id: char.id,
          name: char.name,
          owner: char.owner_email,
          current_location_id: char.resolved_current_location_id,
          current_location_name: char.resolved_current_location_name,
          travel_status: char.travel_status,
          traveling_to_id: char.traveling_to_location_id,
        },
        active_session: activeSession ? {
          id: activeSession.id,
          route_status: activeSession.route_status,
          progress_percent: activeSession.progress_percent,
          origin_id: activeSession.origin_location_id,
          origin_name: activeSession.origin_location_name,
          destination_id: activeSession.destination_location_id,
          destination_name: activeSession.destination_location_name,
          estimated_arrival: activeSession.estimated_arrival_time,
        } : null,
        most_recent_session: mostRecentSession ? {
          id: mostRecentSession.id,
          route_status: mostRecentSession.route_status,
          destination_name: mostRecentDest?.name,
          actual_arrival: mostRecentSession.actual_arrival_time,
        } : null,
        current_location: currentLoc ? {
          id: currentLoc.id,
          name: currentLoc.name,
          owner: currentLoc.owner_email,
        } : null,
        map_marker_diagnostics: {
          travel_marker_active: travelMarkerActive,
          travel_marker_source: activeSession ? `TravelSession.${activeSession.id}` : 'none',
          static_marker_would_use: 'Character.resolved_current_location_id',
          static_marker_suppressed: staticMarkerWouldBeSuppressed,
          static_marker_suppressed_reason: travelMarkerActive
            ? `LivePresenceMap line 683-686: traveling character ${charName} suppressed from static pins`
            : 'not suppressed',
          character_at_origin: characterCurrentLocationIsOrigin,
          character_at_destination: characterCurrentLocationIsDestination,
          character_at_unknown_location: !characterCurrentLocationIsOrigin && !characterCurrentLocationIsDestination,
        },
        arrival_integrity_check: {
          is_destination_write_verified: characterCurrentLocationIsDestination && activeSession?.destination_location_id === char.resolved_current_location_id,
          destination_write_failed: destinationWriteFailed,
          unsuppression_risk: staticMarkerWouldBeSuppressed === false && characterCurrentLocationIsOrigin
            ? `MARKER RISK: Static origin marker would unsuppress and show character at origin, but destination write never happened`
            : 'ok',
        },
      };
    };

    const [khalilAudit, andreAudit] = await Promise.all([
      auditCharacter(khalilId, 'Khalil'),
      auditCharacter(andreId, 'Andre'),
    ]);

    return Response.json({
      KHALIL: khalilAudit,
      ANDRE: andreAudit,
      SUPPRESSION_RULE: {
        description: 'LivePresenceMap.buildMarkers() suppresses static pins for traveling characters (lines 683-686)',
        location_in_code: 'components/travel/LivePresenceMap:683-686',
        suppression_trigger: 'travelingCharacterIds.has(entity.id) → if true, skip marker and log suppression',
        expected_behavior: 'One travel marker shown, origin pin hidden',
        problem: 'When travel fails, unsuppression happens without verifying Character.resolved_current_location_id was updated to destination',
      },
    });

  } catch (error) {
    console.error('[auditMapMarkerSuppression]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});