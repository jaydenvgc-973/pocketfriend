/**
 * DECOMMISSIONED — simpleEthanFix
 *
 * This function used loose name matching and forced location/activity overwrites.
 * Disabled — location management is handled by the standard enforceCharacterWorkSchedule automation.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'simpleEthanFix has been disabled. Location and activity are now managed by the standard enforceCharacterWorkSchedule automation.',
    safe: true,
  });
});