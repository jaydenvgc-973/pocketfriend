/**
 * diagnoseAndreStuckTravel
 * 
 * Show Andre's current stuck state with no modifications.
 * Proof only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Andre
    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, null, 200);
    const andre = allChars.find(c => 
      (c.name && c.name.toLowerCase().includes('andre')) ||
      (c.display_name && c.display_name.toLowerCase().includes('andre'))
    );

    if (!andre) {
      return Response.json({ error: 'Andre not found' }, { status: 404 });
    }

    // Get his locations
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter({}, null, 500);
    const andreLocs = allLocs.filter(l => l.owner_email === andre.owner_email || l.owner_email === user.email);

    // Get active/recent sessions
    const activeSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: andre.id },
      '-created_at',
      10
    );

    const now = new Date();

    return Response.json({
      ANDRE_CURRENT_STATE: {
        id: andre.id,
        name: andre.name,
        owner_email: andre.owner_email,
        display_name: andre.display_name,
      },
      LOCATION: {
        canonical_location_id: andre.resolved_current_location_id,
        canonical_location_name: andre.resolved_current_location_name,
        resolved_presence_status: andre.resolved_presence_status,
        resolved_location_type: andre.resolved_location_type,
        last_arrived_time: andre.last_arrived_time,
      },
      TRAVEL_FLAGS: {
        travel_status: andre.travel_status,
        traveling_to_location_id: andre.traveling_to_location_id,
        traveling_to_location_name: andre.traveling_to_location_name,
        travel_destination_location_id: andre.travel_destination_location_id,
      },
      ACTIVE_SESSIONS: activeSessions.map(s => ({
        id: s.id,
        route_status: s.route_status,
        progress_percent: s.progress_percent,
        origin_location_id: s.origin_location_id,
        origin_location_name: s.origin_location_name,
        destination_location_id: s.destination_location_id,
        destination_location_name: s.destination_location_name,
        estimated_departure_time: s.estimated_departure_time,
        estimated_arrival_time: s.estimated_arrival_time,
        actual_arrival_time: s.actual_arrival_time,
        last_progress_update: s.last_progress_update,
        blocker_reason: s.blocker_reason,
        duration_minutes: s.duration_minutes,
      })),
      TIME_INFO: {
        server_now: now.toISOString(),
      },
      LOCATIONS_AVAILABLE: {
        count: andreLocs.length,
        sample: andreLocs.slice(0, 3).map(l => ({ id: l.id, name: l.name, owner_email: l.owner_email })),
      },
      DIAGNOSIS: {
        is_traveling: andre.travel_status === 'traveling' || andre.travel_status === 'traveling_to_destination',
        has_active_session: activeSessions.some(s => ['in_transit', 'preparing', 'delayed'].includes(s.route_status)),
        canonical_matches_origin: andreLocs.find(l => l.id === andre.resolved_current_location_id)?.name,
        canonical_matches_destination: andreLocs.find(l => l.id === (activeSessions[0]?.destination_location_id))?.name,
        stuck_reason: activeSessions[0]?.route_status === 'arrival_failed' ? `arrival_failed: ${activeSessions[0]?.blocker_reason || 'unknown'}` : 'session exists but not arrived',
      },
    });

  } catch (error) {
    console.error('[diagnoseAndreStuckTravel]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});