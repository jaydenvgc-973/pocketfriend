/**
 * DECOMMISSIONED — auditEthanThompsonHome
 *
 * This function used loose name matching ("includes ethan") to find a character
 * and audit their home location. It has been disabled because loose name matching
 * is unsafe and could target the wrong character.
 *
 * Use the standard location audit tools with an exact character_id instead.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'auditEthanThompsonHome has been disabled. It used loose name matching. Use standard location audit tools with an exact character_id.',
    safe: true,
  });
});