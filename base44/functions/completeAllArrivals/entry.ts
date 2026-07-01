/**
 * completeAllArrivals — TRANSIT TRAVEL REMOVED
 *
 * Previously orchestrated transit arrival completion by delegating to
 * completeTravelArrivalVerified for arrival_due sessions. That behavior is forbidden.
 *
 * Characters teleport instantly. There is no arrival_due state to process.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    success: true,
    transit_travel_removed: true,
    reason: 'Transit travel has been removed. No arrival_due sessions to process.',
    completed: 0,
  });
});