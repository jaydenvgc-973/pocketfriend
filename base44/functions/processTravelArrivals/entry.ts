/**
 * processTravelArrivals — TRANSIT TRAVEL REMOVED
 *
 * Previously checked ETA-based arrival thresholds, set route_status:arrival_due,
 * and updated progress_percent for in-transit sessions. That behavior is forbidden.
 *
 * Characters teleport instantly. There is no in-transit phase to process.
 * Promise teleport is handled by processScheduledRelocations.
 *
 * This function now returns immediately. It is kept as a no-op endpoint so
 * stale callers do not crash, but it performs no transit behavior.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    success: true,
    transit_travel_removed: true,
    reason: 'Transit travel has been removed. Characters teleport instantly. Promise teleport is handled by processScheduledRelocations.',
    checked: 0,
    arrival_due_set: 0,
  });
});