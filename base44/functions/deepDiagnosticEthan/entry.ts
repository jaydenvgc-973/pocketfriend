/**
 * DECOMMISSIONED — deepDiagnosticEthan
 *
 * Replaced by the universal character diagnostic system.
 * This function used loose name matching ("includes ethan") which is unsafe.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'deepDiagnosticEthan has been disabled. It used loose name matching. Use comprehensiveCharacterDiagnostic with an exact character_id instead.',
    safe: true,
  });
});