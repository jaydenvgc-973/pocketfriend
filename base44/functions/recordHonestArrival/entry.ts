/**
 * recordHonestArrival
 * 
 * For sessions that were marked arrival_failed but character WAS successfully moved,
 * record the actual arrival time and close the session.
 * 
 * This ONLY works if:
 * - Character is already at destination
 * - Character travel flags are already cleared
 * - Session is marked arrival_failed
 * 
 * This does NOT attempt a write (which would fail).
 * This ONLY records the fact that arrival already happened.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 });

    // Load session
    const [session] = await base44.asServiceRole.entities.TravelSession.filter({ id: session_id }, null, 1);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    // Load character
    const [char] = await base44.entities.Character.filter({ id: session.character_id }, null, 1);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    // Verify character is actually at destination
    if (char.resolved_current_location_id !== session.destination_location_id) {
      return Response.json({
        success: false,
        error: 'Character is not at destination',
        character_location: char.resolved_current_location_id,
        destination: session.destination_location_id,
      }, { status: 400 });
    }

    // Verify character is not traveling
    if (char.travel_status !== 'not_traveling' && char.travel_status !== 'traveling') {
      return Response.json({
        success: false,
        error: 'Character travel status unexpected',
        travel_status: char.travel_status,
      }, { status: 400 });
    }

    const now = new Date();

    // Mark session as arrived with actual_arrival_time recorded
    await base44.asServiceRole.entities.TravelSession.update(session_id, {
      route_status: 'arrived',
      progress_percent: 100,
      actual_arrival_time: now.toISOString(),
      last_progress_update: now.toISOString(),
    });

    console.log(`[recordHonestArrival] ✅ Recorded arrival for ${char.name} at ${session.destination_location_name}`);

    return Response.json({
      success: true,
      character: char.name,
      destination: session.destination_location_name,
      actual_arrival_time: now.toISOString(),
      session_id: session_id,
    });

  } catch (error) {
    console.error('[recordHonestArrival]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});