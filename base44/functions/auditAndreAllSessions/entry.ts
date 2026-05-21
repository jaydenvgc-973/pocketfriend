/**
 * auditAndreAllSessions
 * Show ALL TravelSession records for Andre Rivera across all statuses
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const andreaCharacterId = '69cd1c421ecd8b69850b3a6a';

    // Get ALL sessions for Andre (no status filter)
    const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: andreaCharacterId },
      '-created_date',
      100
    );

    const sessionDetails = [];
    for (const session of allSessions) {
      sessionDetails.push({
        id: session.id,
        route_status: session.route_status,
        progress_percent: session.progress_percent,
        character_id: session.character_id,
        character_name: session.character_name,
        owner_email: session.owner_email,
        origin_id: session.origin_location_id,
        origin_name: session.origin_location_name,
        destination_id: session.destination_location_id,
        destination_name: session.destination_location_name,
        estimated_departure: session.estimated_departure_time,
        estimated_arrival: session.estimated_arrival_time,
        actual_arrival: session.actual_arrival_time,
        error_reason: session.error_reason || 'none',
        blocker_reason: session.blocker_reason || 'none',
        created: session.created_date,
      });
    }

    // Get current Andre state
    const [andre] = await base44.entities.Character.filter({ id: andreaCharacterId }, null, 1);

    return Response.json({
      ANDRE_SESSIONS: {
        total_count: allSessions.length,
        sessions: sessionDetails,
      },
      ANDRE_CURRENT_STATE: {
        id: andre.id,
        name: andre.name,
        owner_email: andre.owner_email,
        resolved_current_location_id: andre.resolved_current_location_id,
        resolved_current_location_name: andre.resolved_current_location_name,
        travel_status: andre.travel_status,
        traveling_to_location_id: andre.traveling_to_location_id,
        traveling_to_location_name: andre.traveling_to_location_name,
        resolved_presence_status: andre.resolved_presence_status,
      },
    });

  } catch (error) {
    console.error('[auditAndreAllSessions]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});