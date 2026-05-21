/**
 * completeAllArrivals
 *
 * Scheduled function (runs every 5 minutes after processTravelArrivals).
 * For ALL sessions marked "arrived", calls completeCharacterArrival to write
 * the character's destination location.
 *
 * CRITICAL: This is what makes characters actually ARRIVE at their destination.
 * Without this, sessions sit in "arrived" state forever and characters stay
 * "in transit" even though they're already there.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find ALL sessions marked "arrived" (across all users we have access to)
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

    // For each arrived session, invoke completeCharacterArrival
    // (it will verify ownership and write the character's location)
    for (const session of arrivedSessions) {
      try {
        const res = await base44.functions.invoke('completeCharacterArrival', {
          session_id: session.id,
        }).catch(e => ({ data: { success: false, error: e.message } }));

        const cData = res?.data || {};
        if (cData.success) {
          completed++;
          results.push({
            session_id: session.id,
            character_name: session.character_name,
            destination: cData.destination_name,
            status: 'completed',
          });
          console.log(`[completeAllArrivals] ✅ ${session.character_name} arrived at ${cData.destination_name}`);
        } else {
          failed++;
          results.push({
            session_id: session.id,
            character_name: session.character_name,
            error: cData.error || 'unknown error',
            status: 'failed',
          });
          console.warn(`[completeAllArrivals] ⚠️ ${session.character_name} arrival completion failed: ${cData.error}`);
        }
      } catch (e) {
        failed++;
        results.push({
          session_id: session.id,
          character_name: session.character_name,
          error: e.message,
          status: 'error',
        });
        console.error(`[completeAllArrivals] Error processing session ${session.id}: ${e.message}`);
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