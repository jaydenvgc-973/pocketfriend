/**
 * verifyAndCompleteArrival — TRANSIT TRAVEL REMOVED
 *
 * Previously checked ETA-based arrival, set route_status:arrived with
 * progress_percent:100, and restored to prior verified destinations.
 * That behavior is forbidden.
 *
 * Characters teleport instantly. There is no ETA-based arrival to verify.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    success: true,
    transit_travel_removed: true,
    reason: 'Transit travel has been removed. No ETA-based arrival to verify.',
  });
});