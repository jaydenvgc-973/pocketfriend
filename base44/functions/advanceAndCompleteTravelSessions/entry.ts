/**
 * advanceAndCompleteTravelSessions
 *
 * TRAVEL SESSION LIFECYCLE MANAGER
 *
 * For every active TravelSession (preparing, in_transit):
 * 1. Calculate progress based on elapsed time
 * 2. Update progress_percent
 * 3. If ETA passed, complete arrival
 *
 * This must run frequently (e.g., every 30 seconds) to keep travel moving.
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

    const results = {
      advanced: [],
      completed: [],
      failed: [],
    };

    for (const session of activeSessions) {
      try {
        const now = Date.now();
        const depTime = new Date(session.estimated_departure_time).getTime();
        const arrTime = new Date(session.estimated_arrival_time).getTime();
        const elapsedMs = now - depTime;
        const totalMs = arrTime - depTime;

        let progress = Math.min(Math.max(0, Math.round((elapsedMs / totalMs) * 100)), 100);

        // Update progress
        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          progress_percent: progress,
          last_progress_update: new Date().toISOString(),
          route_status: progress >= 100 ? 'arrived' : 'in_transit',
        });

        // If ETA passed, complete arrival
        if (now >= arrTime) {
          // Get character and location
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

          const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
            { id: session.destination_location_id },
            null,
            1
          );

          if (!destLoc) {
            results.failed.push({
              session_id: session.id,
              character_id: session.character_id,
              error: 'Destination location not found',
            });
            continue;
          }

          // Write destination using canonical logic
          const nowISO = new Date().toISOString();
          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_current_location_id: destLoc.id,
            resolved_current_location_name: destLoc.name,
            resolved_presence_status: 'visiting',
            resolved_location_type: 'visit',
            resolved_source_reason: `arrived_from_travel_session:${session.id}`,
            resolved_last_updated_at: nowISO,
            last_arrived_time: nowISO,
            travel_status: 'not_traveling',
            travel_destination_location_id: null,
            traveling_to_location_id: null,
            traveling_to_location_name: null,
          });

          // Read back verification
          const [charAfter] = await base44.asServiceRole.entities.Character.filter(
            { id: char.id },
            null,
            1
          );

          if (charAfter.resolved_current_location_id !== destLoc.id) {
            results.failed.push({
              session_id: session.id,
              character_id: char.id,
              error: `Destination write failed. Expected ${destLoc.id}, got ${charAfter.resolved_current_location_id}`,
            });
            continue;
          }

          // Mark session as arrived
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status: 'arrived',
            actual_arrival_time: nowISO,
            progress_percent: 100,
          });

          results.completed.push({
            session_id: session.id,
            character_id: char.id,
            character_name: char.name,
            destination: destLoc.name,
            travel_duration_minutes: session.duration_minutes,
          });

          console.log(`[advanceAndCompleteTravelSessions] ✅ ${char.name} arrived at ${destLoc.name}`);
        } else {
          results.advanced.push({
            session_id: session.id,
            character_name: session.character_name,
            progress_percent: progress,
            time_remaining_minutes: Math.round((arrTime - now) / 60000),
          });
        }
      } catch (e) {
        results.failed.push({
          session_id: session.id,
          error: e.message,
        });
      }
    }

    console.log(
      `[advanceAndCompleteTravelSessions] completed | advanced=${results.advanced.length} | completed=${results.completed.length} | failed=${results.failed.length}`
    );

    return Response.json({
      success: true,
      advanced: results.advanced,
      completed: results.completed,
      failed: results.failed,
    });

  } catch (error) {
    console.error('[advanceAndCompleteTravelSessions]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});