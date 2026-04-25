/**
 * DECOMMISSIONED — clearNathanAvatar
 *
 * This function previously set avatar_url = null on a hardcoded character ID.
 * It has been disabled because:
 *   - It used a hardcoded ID that may have belonged to a different character than intended
 *   - Automatically clearing avatar_url is unsafe and violates avatar stability rules
 *   - The function name references Nathan but the ID may have targeted Ethan
 *
 * DO NOT RE-ENABLE this function without verifying the exact character_id,
 * owner_user_id, and intended operation.
 *
 * If you need to reset an avatar, use the universal repairCharacterImages function
 * which requires explicit character_id confirmation and user consent.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  return Response.json({
    status: 'DECOMMISSIONED',
    message: 'clearNathanAvatar has been permanently disabled. It used a hardcoded character ID and set avatar_url = null without safety checks. Use repairCharacterImages instead.',
    safe: true,
  });
});