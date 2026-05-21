/**
 * forceSessionArrived
 *
 * Force a stuck TravelSession from "arrival_failed" to "arrived" status.
 * Used only to unblock sessions that failed due to Character.update() RLS issues.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 });

    const now = new Date();
    
    await base44.asServiceRole.entities.TravelSession.update(session_id, {
      route_status: 'arrived',
      actual_arrival_time: now.toISOString(),
    });

    const [sessionAfter] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: session_id }, null, 1
    );

    return Response.json({
      success: true,
      session_id,
      route_status: sessionAfter.route_status,
      actual_arrival_time: sessionAfter.actual_arrival_time,
    });
  } catch (error) {
    console.error('[forceSessionArrived]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});