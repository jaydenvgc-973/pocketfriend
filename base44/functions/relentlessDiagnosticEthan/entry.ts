/**
 * DECOMMISSIONED — relentlessDiagnosticEthan
 *
 * This function used loose name matching and wrote directly to character location fields.
 * Disabled — use standard character location management instead.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'relentlessDiagnosticEthan has been disabled. It used loose name matching and auto-wrote location fields.',
    safe: true,
  });
});