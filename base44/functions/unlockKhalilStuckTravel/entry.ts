/**
 * unlockKhalilStuckTravel
 * 
 * Khalil is stuck in traveling state because the cross-account TravelSession failed.
 * Clear his travel flags to allow a new, valid same-owner trip.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const KHALIL_ID = '6a0299e0dd588e28cb48df8a';
    const FAILED_SESSION_ID = '6a0f160e7e97aa6bdd9b6aeb';

    // Get Khalil's current state
    const [khalil] = await base44.entities.Character.filter({ id: KHALIL_ID }, null, 1);
    if (!khalil) return Response.json({ error: 'Khalil not found' }, { status: 404 });

    // Clear travel flags
    await base44.entities.Character.update(KHALIL_ID, {
      travel_status: 'not_traveling',
      traveling_to_location_id: null,
      traveling_to_location_name: null,
      travel_destination_location_id: null,
      resolved_source_reason: `cleared_failed_session:${FAILED_SESSION_ID}`,
    });

    // Verify read-back
    const [khalilAfter] = await base44.entities.Character.filter({ id: KHALIL_ID }, null, 1);

    console.log(`[unlockKhalilStuckTravel] ✅ Cleared Khalil traveling state`);

    return Response.json({
      success: true,
      khalil_id: KHALIL_ID,
      khalil_name: khalil.name,
      before: {
        travel_status: khalil.travel_status,
        traveling_to: khalil.traveling_to_location_name,
        location: khalil.resolved_current_location_name,
      },
      after: {
        travel_status: khalilAfter.travel_status,
        traveling_to: khalilAfter.traveling_to_location_name,
        location: khalilAfter.resolved_current_location_name,
      },
      failed_session_id: FAILED_SESSION_ID,
      verified: khalilAfter.travel_status === 'not_traveling' && !khalilAfter.traveling_to_location_id,
    });

  } catch (error) {
    console.error('[unlockKhalilStuckTravel]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});