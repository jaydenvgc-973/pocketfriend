/**
 * resetStuckSessionsToInTransit
 *
 * For diagnostics: Reset stuck arrival_failed sessions to in_transit
 * so processTravelArrivals can attempt completion again.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Find all arrival_failed sessions
    const failedSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrival_failed' },
      '-created_date',
      50
    );

    const updated = [];
    for (const session of failedSessions) {
      await base44.asServiceRole.entities.TravelSession.update(session.id, {
        route_status: 'in_transit',
      });
      updated.push({
        id: session.id,
        character: session.character_name,
        destination: session.destination_location_name,
      });
    }

    console.log(`[resetStuckSessionsToInTransit] Reset ${updated.length} sessions to in_transit`);

    return Response.json({
      reset: updated.length,
      sessions: updated,
    });

  } catch (error) {
    console.error('[resetStuckSessionsToInTransit]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});