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

    // For each arrived session, call achieveCharacterDestination directly (service role)
    // This bypasses user-scoped RLS and writes the destination.
    for (const session of arrivedSessions) {
      try {
        const res = await base44.asServiceRole.functions.invoke('achieveCharacterDestination', {
          character_id:              session.character_id,
          destination_location_id:   session.destination_location_id,
          destination_location_name: session.destination_location_name,
          presence_status:           session.travel_source === 'work_schedule' ? 'at_work' :
                                     session.travel_source === 'school_schedule' ? 'at_school' : 'visiting',
          location_type:             'visit',
          source_reason:             `travel_session_completion:${session.id}`,
          owner_email:               session.owner_email,
        }).catch(e => ({ data: { success: false, error: e.message } }));

        const aData = res?.data || {};
        if (aData.success) {
          completed++;
          results.push({
            session_id: session.id,
            character_name: session.character_name,
            destination: aData.destination_name,
            status: 'completed',
          });
          console.log(`[completeAllArrivals] ✅ ${session.character_name} arrived at ${aData.destination_name}`);
        } else {
          failed++;
          results.push({
            session_id: session.id,
            character_name: session.character_name,
            error: aData.error || 'unknown error',
            status: 'failed',
          });
          console.warn(`[completeAllArrivals] ⚠️ ${session.character_name} arrival completion failed: ${aData.error}`);
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