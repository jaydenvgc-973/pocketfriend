/**
 * DECOMMISSIONED — testEthanFullFeatures
 *
 * This function used loose name matching and wrote directly to character fields.
 * Replaced by standard character management pipeline.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'testEthanFullFeatures has been disabled. It used loose name matching and modified character data without safety checks.',
    safe: true,
  });
});