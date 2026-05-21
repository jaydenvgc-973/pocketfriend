/**
 * completeAllArrivals
 *
 * Scheduled function (runs every 5 minutes after processTravelArrivals).
 * For ALL sessions marked "arrived", writes the character's destination location
 * directly (inlined from achieveCharacterDestination).
 *
 * CRITICAL: This is what makes characters actually ARRIVE at their destination.
 * Without this, sessions sit in "arrived" state forever and characters stay
 * "in transit" even though they're already there.
 *
 * OWNERSHIP VERIFICATION: Uses owner_email from session, verifies character.owner_email matches.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Find ALL sessions marked "arrived" (across all users)
    const arrivedSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrived' },
      '-updated_date',
      200
    ).catch(() => []);

    if (arrivedSessions.length === 0) {
      console.log('[completeAllArrivals] No arrived sessions to process');
      return Response.json({ completed: 0, failed: 0 });
    }

    console.log(`[completeAllArrivals] Found ${arrivedSessions.length} arrived sessions — completing arrivals`);

    const results = [];
    let completed = 0;
    let failed = 0;

    // For each arrived session, inline the destination-write logic
    for (const session of arrivedSessions) {
      try {
        const char_id = session.character_id;
        const dest_id = session.destination_location_id;
        const session_owner_email = session.owner_email;

        // ─── Fetch character (service role) ───
        const [char] = await base44.asServiceRole.entities.Character.filter(
          { id: char_id },
          null,
          1
        );

        if (!char) {
          throw new Error(`Character not found for session ${session.id}`);
        }

        // ─── VERIFY OWNERSHIP ───
        if (char.owner_email !== session_owner_email) {
          throw new Error(
            `Ownership mismatch for ${char.name}: ` +
            `session owner=${session_owner_email}, character owner=${char.owner_email}`
          );
        }

        // ─── Fetch destination location ───
        const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
          { id: dest_id },
          null,
          1
        );

        if (!destLoc) {
          throw new Error(`Destination location not found: ${dest_id}`);
        }

        // ─── Determine final presence status and location type ───
        let finalPresenceStatus = session.travel_source === 'work_schedule' ? 'at_work' :
                                  session.travel_source === 'school_schedule' ? 'at_school' : 'visiting';
        let finalLocationType = 'visit';

        // If destination is character's home, override to 'home'
        if (destLoc.id === char.current_home_location_id) {
          finalPresenceStatus = 'home';
          finalLocationType = 'home';
        }

        const now = new Date();

        // ─── WRITE CHARACTER TO DESTINATION (canonical path) ───
        // This inlines achieveCharacterDestination logic.
        await base44.asServiceRole.entities.Character.update(char_id, {
          resolved_current_location_id:   destLoc.id,
          resolved_current_location_name: destLoc.name,
          resolved_presence_status:       finalPresenceStatus,
          resolved_location_type:         finalLocationType,
          resolved_source_reason:         `travel_session_completion:${session.id}`,
          resolved_last_updated_at:       now.toISOString(),
          last_arrived_time:              now.toISOString(),
          // ─── Clear all travel flags ───
          travel_status:                  'not_traveling',
          travel_destination_location_id: null,
          traveling_to_location_id:       null,
          traveling_to_location_name:     null,
        });

        // ─── Read back and verify ───
        const [charAfterVerify] = await base44.asServiceRole.entities.Character.filter(
          { id: char_id },
          null,
          1
        );

        if (charAfterVerify.resolved_current_location_id !== destLoc.id) {
          throw new Error(
            `DESTINATION WRITE FAILED for ${char.name}: ` +
            `expected location=${destLoc.id}, actual=${charAfterVerify.resolved_current_location_id}`
          );
        }

        if (charAfterVerify.travel_status !== 'not_traveling') {
          throw new Error(
            `TRAVEL STATUS NOT CLEARED for ${char.name}: ${charAfterVerify.travel_status}`
          );
        }

        // ─── Update TravelSession to mark complete ───
        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          route_status: 'arrived',
          actual_arrival_time: now.toISOString(),
        });

        completed++;
        results.push({
          session_id: session.id,
          character_id: char_id,
          character_name: char.name,
          destination: destLoc.name,
          status: 'completed',
          before_travel_status: char.travel_status,
          after_travel_status: charAfterVerify.travel_status,
        });
        console.log(
          `[completeAllArrivals] ✅ ${char.name} arrived at ${destLoc.name} ` +
          `(presence=${finalPresenceStatus}, location_type=${finalLocationType})`
        );

      } catch (e) {
        failed++;
        results.push({
          session_id: session.id,
          character_name: session.character_name || 'unknown',
          error: e.message,
          status: 'failed',
        });
        console.error(`[completeAllArrivals] ❌ Session ${session.id}: ${e.message}`);

        // Mark session as blocked due to failure
        try {
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status: 'blocked',
            blocker_reason: `Arrival completion failed: ${e.message}`,
          });
        } catch (blockErr) {
          console.error(`[completeAllArrivals] Failed to mark session blocked: ${blockErr.message}`);
        }
      }
    }

    console.log(`[completeAllArrivals] Complete | completed=${completed} | failed=${failed}`);

    return Response.json({
      total_sessions: arrivedSessions.length,
      completed,
      failed,
      results,
    });

  } catch (error) {
    console.error('[completeAllArrivals]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});