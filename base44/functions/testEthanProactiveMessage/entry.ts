/**
 * DECOMMISSIONED — testEthanProactiveMessage
 *
 * This function used loose name matching to find Ethan and directly modified
 * location and activity fields. Replaced by standard character management.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'testEthanProactiveMessage has been disabled. It used loose name matching and modified character fields without safety checks.',
    safe: true,
  });
});