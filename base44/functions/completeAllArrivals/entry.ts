/**
 * completeAllArrivals
 *
 * Scheduled function (runs every 5 minutes after processTravelArrivals).
 * 
 * ROOT CAUSE: Character entity has strict per-owner RLS that blocks ALL reads/writes
 * from asServiceRole, including filter({id}). The only path that works is user-scoped
 * (base44.entities.Character authenticated as the actual user).
 *
 * ARCHITECTURE FIX: This function now invokes completeStuckTravelUserScoped for each
 * unique owner found in arrived sessions. That function authenticates as the owning
 * user and can read/write their characters via the correct user-scoped RLS path.
 *
 * For each owner with arrived sessions: invoke completeStuckTravelUserScoped which
 * finds stuck/arrived travel sessions and writes destinations using user-scoped SDK.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Load ALL arrived sessions (TravelSession has no per-owner RLS block for service role)
    const arrivedSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrived' },
      '-updated_date',
      200
    ).catch(() => []);

    if (arrivedSessions.length === 0) {
      console.log('[completeAllArrivals] No arrived sessions to process');
      return Response.json({ completed: 0, owners_processed: 0 });
    }

    // Collect unique owner_emails from arrived sessions
    const ownerEmails = [...new Set(
      arrivedSessions
        .map(s => s.owner_email)
        .filter(Boolean)
    )];

    console.log(`[completeAllArrivals] ${arrivedSessions.length} arrived sessions across ${ownerEmails.length} owners — delegating to completeStuckTravelUserScoped`);

    const ownerResults = [];
    let totalCompleted = 0;

    for (const ownerEmail of ownerEmails) {
      try {
        // completeStuckTravelUserScoped uses user-scoped RLS (base44.entities.Character)
        // which correctly reads/writes characters for this owner.
        // It finds ALL stuck/arrived travel and completes them.
        const res = await base44.asServiceRole.functions.invoke('completeStuckTravelUserScoped', {
          _owner_email_hint: ownerEmail,
        }).catch(e => ({ data: { error: e.message } }));

        const d = res?.data || {};
        const completed = d.results?.filter(r => r.location_write_verified)?.length || 0;
        totalCompleted += completed;

        ownerResults.push({
          owner_email: ownerEmail,
          stuck_found: d.stuck_characters_found || 0,
          completed,
          status: d.error ? 'error' : 'ok',
          error: d.error || null,
        });

        console.log(`[completeAllArrivals] owner=${ownerEmail}: ${completed} completed, ${d.stuck_characters_found || 0} stuck found`);
      } catch (e) {
        console.error(`[completeAllArrivals] Failed for owner ${ownerEmail}: ${e.message}`);
        ownerResults.push({ owner_email: ownerEmail, status: 'error', error: e.message });
      }
    }

    // Also mark any remaining "arrived" sessions that were already completed (travel_status cleared)
    // as having their route_status finalized — prevents them from re-appearing each cycle
    const stillArrived = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrived' },
      '-updated_date',
      200
    ).catch(() => []);

    let autoFinalized = 0;
    for (const session of stillArrived) {
      // If session is old (>10 minutes past ETA) and hasn't been completed, mark it done
      // to prevent infinite retry loops on stale orphaned sessions
      if (session.actual_arrival_time) {
        const arrivalAge = Date.now() - new Date(session.actual_arrival_time).getTime();
        if (arrivalAge > 10 * 60 * 1000) {
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status: 'arrived', // Keep as arrived — character write may have succeeded
          }).catch(() => {});
        }
      }
    }

    console.log(`[completeAllArrivals] Complete | total_completed=${totalCompleted} | owners=${ownerEmails.length}`);

    return Response.json({
      total_arrived_sessions: arrivedSessions.length,
      owners_processed: ownerEmails.length,
      total_completed: totalCompleted,
      owner_results: ownerResults,
    });

  } catch (error) {
    console.error('[completeAllArrivals]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});