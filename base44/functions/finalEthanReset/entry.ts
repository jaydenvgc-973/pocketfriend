/**
 * DECOMMISSIONED — finalEthanReset
 *
 * This function previously found a character by loose name match ("includes ethan")
 * and applied hardcoded fixes to location, activity, and system_prompt fields.
 *
 * It has been disabled because:
 *   - Loose name matching is unsafe — any character with "ethan" in the name could be targeted
 *   - It could confuse Ethan and Nathan if either name partially matched
 *   - It applied automatic changes without user confirmation
 *   - The same fix logic now exists in the standard character management system
 *
 * DO NOT RE-ENABLE. Ethan must be managed through the same standard pipeline as all characters.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'finalEthanReset has been permanently disabled. It used loose name matching and applied automatic character data changes without safety checks.',
    safe: true,
  });
});