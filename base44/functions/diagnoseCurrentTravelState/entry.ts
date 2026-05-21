/**
 * diagnoseCurrentTravelState
 *
 * Shows what's actually happening with travel sessions and character status.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // All TravelSessions
    const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
      {},
      '-created_at',
      500
    );

    // Characters with travel_status set
    const travelingChars = await base44.asServiceRole.entities.Character.filter(
      { travel_status: { $ne: 'not_traveling' } },
      '-updated_date',
      500
    );

    const report = {
      total_sessions: allSessions.length,
      total_traveling_characters: travelingChars.length,
      session_breakdown: {},
      character_status: [],
      mismatches: [],
    };

    // Group sessions by status
    for (const session of allSessions) {
      const status = session.route_status;
      if (!report.session_breakdown[status]) {
        report.session_breakdown[status] = [];
      }
      report.session_breakdown[status].push({
        id: session.id,
        character_name: session.character_name,
        from: session.origin_location_name,
        to: session.destination_location_name,
        progress: session.progress_percent,
        eta: session.estimated_arrival_time,
      });
    }

    // Character travel status
    for (const char of travelingChars) {
      report.character_status.push({
        id: char.id,
        name: char.name,
        travel_status: char.travel_status,
        current_location: char.resolved_current_location_name,
        traveling_to: char.traveling_to_location_name,
      });
    }

    // Find mismatches: character traveling but no session
    for (const char of travelingChars) {
      const hasSession = allSessions.some(s => s.character_id === char.id && s.route_status !== 'arrived');
      if (!hasSession) {
        report.mismatches.push({
          type: 'traveling_without_active_session',
          character_id: char.id,
          character_name: char.name,
          travel_status: char.travel_status,
          current_location: char.resolved_current_location_name,
        });
      }
    }

    console.log('[diagnoseCurrentTravelState] Report:', JSON.stringify(report, null, 2));

    return Response.json(report);

  } catch (error) {
    console.error('[diagnoseCurrentTravelState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});