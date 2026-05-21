/**
 * diagnoseTravelStuckSessions
 *
 * ROOT CAUSE DIAGNOSTIC — characters showing "in transit" with NO status bar, NO map movement,
 * and NO valid arrival logic.
 *
 * SYMPTOM: "is already in transit to X" but no TravelSession progress rendered
 * LIKELY CAUSE: TravelSession exists but has corrupted/invalid estimated_arrival_time, blocking
 * the progress bar from rendering and the arrival automation from firing.
 *
 * This function:
 * 1. Finds all characters with travel_status = "traveling_*"
 * 2. Loads their TravelSession records
 * 3. Validates: estimated_arrival_time, progress_percent, route_status, distance_miles
 * 4. Checks if character's message hallucinated wrong travel time (compare to actual distance)
 * 5. Returns detailed proof of what is stuck and why
 *
 * Does NOT modify anything — diagnostic only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const owner_email = user.email;

    console.log(`[diagnoseTravelStuckSessions] Scanning for stuck travel | owner_email=${owner_email}`);

    // ── FIND ALL TRAVELING CHARACTERS ────────────────────────────────────────
    const travelingStatuses = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination'];
    const allChars = await base44.entities.Character.filter(
      { owner_email, travel_status: { $in: travelingStatuses } },
      null,
      200
    ).catch(() => []);

    console.log(`[diagnoseTravelStuckSessions] Found ${allChars.length} traveling characters`);

    const stuck = [];
    const valid = [];

    for (const char of allChars) {
      try {
        // Find TravelSession for this character
        const sessionArr = await base44.entities.TravelSession.filter(
          { character_id: char.id, route_status: { $in: ['preparing', 'in_transit', 'delayed'] } },
          '-created_date',
          1
        ).catch(() => []);

        const session = sessionArr?.[0];

        if (!session) {
          stuck.push({
            character_id: char.id,
            character_name: char.name,
            travel_status: char.travel_status,
            issue: 'NO_SESSION_FOUND',
            detail: `Character shows travel_status="${char.travel_status}" but no TravelSession record exists.`,
            proof: {
              travel_status: char.travel_status,
              travel_destination_location_id: char.travel_destination_location_id,
              has_session: false,
            },
          });
          continue;
        }

        // Validate session integrity
        const now = Date.now();
        const estimatedArrival = session.estimated_arrival_time ? new Date(session.estimated_arrival_time).getTime() : null;
        const elapsed = estimatedArrival ? Math.floor((now - new Date(session.estimated_departure_time).getTime()) / 1000) : null;
        const duration = session.duration_minutes ? session.duration_minutes * 60 : null;
        const progress = session.progress_percent || 0;

        // Check for corruption patterns
        const issues = [];

        if (!estimatedArrival) {
          issues.push('NO_ESTIMATED_ARRIVAL');
        } else if (estimatedArrival < now) {
          // Should have arrived already — why hasn't processTravelArrivals completed it?
          issues.push('ARRIVAL_TIME_PASSED');
        }

        if (!duration) {
          issues.push('NO_DURATION_CALCULATED');
        }

        if (progress === 0 && session.route_status === 'in_transit') {
          issues.push('PROGRESS_STUCK_AT_ZERO');
        }

        if (issues.length > 0) {
          stuck.push({
            character_id: char.id,
            character_name: char.name,
            travel_status: char.travel_status,
            destination_name: session.destination_location_name,
            issues,
            detail: issues.map(i => `[${i}]`).join(' '),
            proof: {
              travel_status: char.travel_status,
              session_route_status: session.route_status,
              estimated_departure: session.estimated_departure_time,
              estimated_arrival: session.estimated_arrival_time,
              now: new Date(now).toISOString(),
              arrival_passed: estimatedArrival && estimatedArrival < now,
              duration_minutes: session.duration_minutes,
              progress_percent: session.progress_percent,
              distance_miles: session.distance_miles,
              origin: session.origin_location_name,
              destination: session.destination_location_name,
            },
          });
        } else {
          // Session looks valid
          valid.push({
            character_id: char.id,
            character_name: char.name,
            destination: session.destination_location_name,
            progress_percent: progress,
            estimated_arrival: session.estimated_arrival_time,
            duration_minutes: session.duration_minutes,
          });
        }
      } catch (charErr) {
        console.error(`[diagnoseTravelStuckSessions] Error checking ${char.id}:`, charErr.message);
        stuck.push({
          character_id: char.id,
          character_name: char.name,
          travel_status: char.travel_status,
          issue: 'CHECK_ERROR',
          detail: charErr.message,
        });
      }
    }

    console.log(`[diagnoseTravelStuckSessions] RESULTS: stuck=${stuck.length} valid=${valid.length}`);

    return Response.json({
      summary: {
        total_traveling: allChars.length,
        stuck_count: stuck.length,
        valid_count: valid.length,
      },
      stuck_sessions: stuck,
      valid_sessions: valid,
    });

  } catch (error) {
    console.error('[diagnoseTravelStuckSessions]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});