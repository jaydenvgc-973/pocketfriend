/**
 * advanceAndCompleteTravelSessions — TRANSIT TRAVEL REMOVED
 *
 * Previously calculated progress_percent from elapsed time, set ETA-based
 * arrival_due, and triggered transit completion. That behavior is forbidden.
 *
 * Characters teleport instantly. There is no progress to advance.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    success: true,
    transit_travel_removed: true,
    reason: 'Transit travel has been removed. No progress to advance.',
    sessions_checked: 0,
    advanced: 0,
    arrival_due: 0,
  });
});