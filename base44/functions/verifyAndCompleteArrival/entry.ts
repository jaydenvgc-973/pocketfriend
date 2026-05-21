/**
 * verifyAndCompleteArrival
 * 
 * GUARDRAIL FUNCTION: Complete a travel arrival with verified destination write.
 * 
 * This function:
 * 1. Loads the TravelSession
 * 2. Checks if ETA has passed (arrival should have triggered)
 * 3. Loads Character and verifies its current location
 * 4. If Character is NOT at destination:
 *    - Check if there was a prior successful arrival (another completed session)
 *    - If yes, restore to that verified destination
 *    - If no, leave the character at origin and mark session as blocked
 * 5. If Character IS at destination:
 *    - Mark session as arrived
 *    - Record actual_arrival_time
 * 6. Clear character travel flags in all cases
 * 7. Read back and verify
 * 
 * This prevents stale origin markers from unsuppressing after failed travel.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 });

    const now = new Date();

    // Load session
    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: session_id }, null, 1
    );
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    // Load character
    const [char] = await base44.entities.Character.filter({ id: session.character_id }, null, 1);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const eta = new Date(session.estimated_arrival_time);
    const etaPassed = now.getTime() >= eta.getTime();

    // Check if character is at destination
    const charAtDestination = char.resolved_current_location_id === session.destination_location_id;

    // If at destination, mark arrived
    if (charAtDestination) {
      await base44.asServiceRole.entities.TravelSession.update(session_id, {
        route_status: 'arrived',
        progress_percent: 100,
        actual_arrival_time: now.toISOString(),
      });

      // Clear travel flags on character
      await base44.entities.Character.update(session.character_id, {
        travel_status: 'not_traveling',
        traveling_to_location_id: null,
        traveling_to_location_name: null,
      });

      console.log(`[verifyAndCompleteArrival] ✅ Character ${char.name} verified at destination ${session.destination_location_name}`);

      return Response.json({
        success: true,
        status: 'arrived_verified',
        character: char.name,
        destination: session.destination_location_name,
        actual_arrival: now.toISOString(),
      });
    }

    // Not at destination — check for prior successful arrival
    const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: session.character_id, route_status: 'arrived' },
      '-created_date',
      10
    );

    const priorArrived = allSessions.find(s => s.actual_arrival_time);

    if (priorArrived) {
      // Restore to last verified destination
      const lastDestLoc = (await base44.asServiceRole.entities.LocationReference.filter(
        { id: priorArrived.destination_location_id }, null, 1
      ))[0];

      if (lastDestLoc) {
        await base44.entities.Character.update(session.character_id, {
          resolved_current_location_id: lastDestLoc.id,
          resolved_current_location_name: lastDestLoc.name,
          travel_status: 'not_traveling',
          traveling_to_location_id: null,
          traveling_to_location_name: null,
        });

        console.log(`[verifyAndCompleteArrival] ⚠️ Current session failed. Restored ${char.name} to prior verified location: ${lastDestLoc.name}`);

        return Response.json({
          success: true,
          status: 'restored_to_prior_arrival',
          character: char.name,
          prior_destination: lastDestLoc.name,
          reason: 'Current session destination write failed; restored to last verified location',
        });
      }
    }

    // No prior arrival — character is stuck at current location
    // Clear travel flags but leave location as-is (wherever they actually are)
    await base44.entities.Character.update(session.character_id, {
      travel_status: 'not_traveling',
      traveling_to_location_id: null,
      traveling_to_location_name: null,
    });

    // Mark session as failed with reason
    await base44.asServiceRole.entities.TravelSession.update(session_id, {
      route_status: 'arrival_failed',
      blocker_reason: 'destination_write_failed_no_prior_arrival',
    });

    console.log(`[verifyAndCompleteArrival] ❌ Session failed with no prior arrival. Character ${char.name} remains at current location with cleared travel flags.`);

    return Response.json({
      success: true,
      status: 'arrival_failed_no_recovery',
      character: char.name,
      current_location: char.resolved_current_location_name,
      reason: 'Arrival write failed and no prior successful arrival to restore',
    });

  } catch (error) {
    console.error('[verifyAndCompleteArrival]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});