/**
 * DECOMMISSIONED — diagnosticMaceEthanRelationship
 *
 * This function used exact name equality matching (name === 'Ethan', name === 'Mace')
 * which is still fragile. Relationship diagnostics are available through the
 * standard comprehensiveCharacterDiagnostic function using exact character IDs.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'diagnosticMaceEthanRelationship has been disabled. Use comprehensiveCharacterDiagnostic with exact character_id values to inspect relationship data safely.',
    safe: true,
  });
});