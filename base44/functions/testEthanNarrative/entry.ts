/**
 * DECOMMISSIONED — testEthanNarrative
 *
 * This function used a hardcoded ETHAN_ID to generate and inject narrative messages.
 * Replaced by standard narrative generation which applies universally to all characters.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'testEthanNarrative has been disabled. It used a hardcoded character ID. Narrative generation is now handled universally by triggerCharacterNarratives.',
    safe: true,
  });
});