/**
 * forceStuckSessionsToDestination
 *
 * EMERGENCY COMPLETION FUNCTION
 *
 * For all TravelSessions in "in_transit" or "preparing" state:
 * 1. Mark session as "arrived" immediately
 * 2. Move character to destination location
 * 3. Clear travel_status
 * 4. Verify read-back
 *
 * This bypasses ETA waiting and forces stuck travel to complete NOW.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get all active sessions
    const activeSessions = await base44.asServiceRole.entities.TravelSession.filter(
      {
        route_status: { $in: ['preparing', 'in_transit'] },
      },
      '-created_at',
      500
    );

    console.log(`[forceStuckSessionsToDestination] Found ${activeSessions.length} stuck sessions — forcing completion NOW`);

    const results = {
      completed: [],
      failed: [],
    };

    for (const session of activeSessions) {
      try {
        // Get character
        const [char] = await base44.asServiceRole.entities.Character.filter(
          { id: session.character_id },
          null,
          1
        );

        if (!char) {
          results.failed.push({
            session_id: session.id,
            character_id: session.character_id,
            error: 'Character not found',
          });
          continue;
        }

        // Get destination location
        const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
          { id: session.destination_location_id },
          null,
          1
        );

        if (!destLoc) {
          results.failed.push({
            session_id: session.id,
            character_id: char.id,
            character_name: char.name,
            error: 'Destination location not found',
          });
          continue;
        }

        const nowISO = new Date().toISOString();

        // ─── WRITE CHARACTER TO DESTINATION ───────────────────────────────
        await base44.asServiceRole.entities.Character.update(char.id, {
          resolved_current_location_id: destLoc.id,
          resolved_current_location_name: destLoc.name,
          resolved_presence_status: 'visiting',
          resolved_location_type: 'visit',
          resolved_source_reason: `forced_arrival_from_stuck_session:${session.id}`,
          resolved_last_updated_at: nowISO,
          last_arrived_time: nowISO,
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
          traveling_to_location_id: null,
          traveling_to_location_name: null,
        });

        // ─── READ BACK VERIFICATION ───────────────────────────────────
        const [charAfter] = await base44.asServiceRole.entities.Character.filter(
          { id: char.id },
          null,
          1
        );

        if (charAfter.resolved_current_location_id !== destLoc.id) {
          results.failed.push({
            session_id: session.id,
            character_id: char.id,
            character_name: char.name,
            error: `Destination write failed. Expected ${destLoc.id}, got ${charAfter.resolved_current_location_id}`,
          });
          continue;
        }

        if (charAfter.travel_status !== 'not_traveling') {
          results.failed.push({
            session_id: session.id,
            character_id: char.id,
            character_name: char.name,
            error: `Travel status not cleared. Got ${charAfter.travel_status}`,
          });
          continue;
        }

        // ─── MARK SESSION AS ARRIVED ───────────────────────────────────
        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          route_status: 'arrived',
          actual_arrival_time: nowISO,
          progress_percent: 100,
        });

        results.completed.push({
          session_id: session.id,
          character_id: char.id,
          character_name: char.name,
          from_location: char.resolved_current_location_name,
          to_location: destLoc.name,
          status_before: `traveling_to_${session.destination_location_name}`,
          status_after: 'at_' + destLoc.name,
        });

        console.log(
          `[forceStuckSessionsToDestination] ✅ ${char.name} is now at ${destLoc.name} (was traveling)`
        );

      } catch (e) {
        results.failed.push({
          session_id: session.id,
          error: e.message,
        });
        console.error(`[forceStuckSessionsToDestination] Error on session ${session.id}:`, e.message);
      }
    }

    console.log(
      `[forceStuckSessionsToDestination] COMPLETE | completed=${results.completed.length} | failed=${results.failed.length}`
    );

    return Response.json({
      success: true,
      total_forced: results.completed.length,
      completed: results.completed,
      failed: results.failed,
    });

  } catch (error) {
    console.error('[forceStuckSessionsToDestination]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});