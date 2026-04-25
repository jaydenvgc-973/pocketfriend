/**
 * DECOMMISSIONED — recoverEthanImages
 *
 * This function previously used a hardcoded ETHAN_ID to scan all of Ethan's conversations
 * and regenerate images using only the first reference image as the source.
 *
 * It has been disabled because:
 *   - It ran character-specific recovery that bypassed the standard image pipeline
 *   - Using only the first reference image caused generated images to copy the raw uploaded photo
 *   - It could silently overwrite message image_url fields without user consent
 *   - The hardcoded ETHAN_ID may not match the actual Ethan character on the account
 *
 * DO NOT RE-ENABLE. Use repairCharacterImages instead, which is universal and requires
 * explicit character_id confirmation before making any changes.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'recoverEthanImages has been permanently disabled. It used a hardcoded character ID and overwrote message images using only the first reference photo as source, causing background/pose bleeding.',
    safe: true,
  });
});