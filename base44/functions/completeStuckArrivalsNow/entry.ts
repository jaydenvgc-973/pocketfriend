/**
 * completeStuckArrivalsNow
 *
 * User-scoped function to complete arrivals for the current user's characters
 * that are still marked as traveling.
 *
 * This uses user auth (not service role) so RLS permissions apply correctly.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get user's characters that are still traveling
    const travelingChars = await base44.entities.Character.filter({ 
      travel_status: { $ne: 'not_traveling' }
    });

    console.log(`[completeStuckArrivalsNow] Found ${travelingChars.length} traveling characters for ${user.email}`);

    const results = {
      completed: [],
      failed: [],
    };

    for (const char of travelingChars) {
      try {
        // Get destination location
        const destLocationId = char.travel_destination_location_id || char.traveling_to_location_id;

        if (!destLocationId) {
          results.failed.push({
            character_id: char.id,
            character_name: char.name,
            error: 'No destination location ID found',
          });
          continue;
        }

        // Try to get the destination location
        let destLoc = null;
        try {
          const allLocs = await base44.entities.LocationReference.list();
          destLoc = allLocs.find(l => l.id === destLocationId);
        } catch (e) {
          // Fallback: try service role
          const [loc] = await base44.asServiceRole.entities.LocationReference.filter(
            { id: destLocationId },
            null,
            1
          );
          destLoc = loc;
        }

        if (!destLoc) {
          results.failed.push({
            character_id: char.id,
            character_name: char.name,
            error: `Destination location ${destLocationId} not found`,
          });
          continue;
        }

        const nowISO = new Date().toISOString();

        // ─── WRITE CHARACTER TO DESTINATION (USER-SCOPED) ───────────────
        await base44.entities.Character.update(char.id, {
          resolved_current_location_id: destLoc.id,
          resolved_current_location_name: destLoc.name,
          resolved_presence_status: 'visiting',
          resolved_location_type: 'visit',
          resolved_source_reason: `forced_arrival:${destLocationId}`,
          resolved_last_updated_at: nowISO,
          last_arrived_time: nowISO,
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
          traveling_to_location_id: null,
          traveling_to_location_name: null,
        });

        // ─── READ BACK VERIFICATION ───────────────────────────────────
        const [charAfter] = await base44.entities.Character.filter(
          { id: char.id },
          null,
          1
        );

        if (charAfter.resolved_current_location_id !== destLoc.id) {
          results.failed.push({
            character_id: char.id,
            character_name: char.name,
            error: `Write failed: expected location ${destLoc.id}, got ${charAfter.resolved_current_location_id}`,
          });
          continue;
        }

        if (charAfter.travel_status !== 'not_traveling') {
          results.failed.push({
            character_id: char.id,
            character_name: char.name,
            error: `Travel status not cleared: got ${charAfter.travel_status}`,
          });
          continue;
        }

        results.completed.push({
          character_id: char.id,
          character_name: char.name,
          from_location: char.resolved_current_location_name,
          to_location: destLoc.name,
          status_before: 'traveling_to_destination',
          status_after: 'at_location',
        });

        console.log(`[completeStuckArrivalsNow] ✅ ${char.name} is now at ${destLoc.name}`);

      } catch (e) {
        results.failed.push({
          character_id: char.id,
          character_name: char.name,
          error: e.message,
        });
        console.error(`[completeStuckArrivalsNow] Error on ${char.name}:`, e.message);
      }
    }

    console.log(
      `[completeStuckArrivalsNow] COMPLETE | completed=${results.completed.length} | failed=${results.failed.length}`
    );

    return Response.json({
      success: true,
      total_completed: results.completed.length,
      completed: results.completed,
      failed: results.failed,
    });

  } catch (error) {
    console.error('[completeStuckArrivalsNow]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});