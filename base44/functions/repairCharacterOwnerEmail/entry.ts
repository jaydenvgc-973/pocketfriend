import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairCharacterOwnerEmail — Targeted per-character owner_email repair
 *
 * OWNERSHIP RULES:
 * - created_by is PERMANENTLY FORBIDDEN — never used, never referenced
 * - owner_email is the ONLY source of truth
 * - owner_user_id is supporting evidence ONLY
 *
 * REPAIR CRITERIA (strong evidence required):
 * A record can be repaired to the current user's owner_email ONLY if:
 *   1. Record exists (found via service role by ID)
 *   2. owner_email is currently null/empty
 *   3. owner_user_id on the record matches the authenticated user's ID
 *
 * If owner_user_id is also missing, the record cannot be auto-repaired.
 * If owner_email belongs to a different user, the repair is BLOCKED (cross-account).
 * Never infer ownership from name, relationship, or any other field.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email || !user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId } = await req.json();
    if (!characterId || typeof characterId !== 'string') {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    // Load via service role — needed because legacy records without owner_email
    // are invisible to RLS. We load to DIAGNOSE, not to bypass ownership.
    const results = await base44.asServiceRole.entities.Character.filter(
      { id: characterId }, null, 1
    ).catch(() => []);

    const record = results?.[0] || null;

    if (!record) {
      return Response.json({
        repaired: false,
        reason: 'RECORD_NOT_FOUND',
        message: `No character record found with ID "${characterId}". It may have been deleted or merged.`,
      });
    }

    // Case 1: owner_email already set — check if it matches current user
    if (record.owner_email) {
      if (record.owner_email === user.email) {
        return Response.json({
          repaired: false,
          reason: 'ALREADY_VALID',
          message: `This record already has owner_email set to "${record.owner_email}" which matches the current user. No repair needed.`,
          owner_email: record.owner_email,
        });
      } else {
        // Belongs to a different account — hard block
        return Response.json({
          repaired: false,
          reason: 'CROSS_ACCOUNT_BLOCKED',
          message: `This record belongs to a different account (owner_email: "${record.owner_email}"). Cross-account repair is forbidden.`,
        });
      }
    }

    // Case 2: owner_email is missing — check owner_user_id as supporting evidence
    if (!record.owner_user_id) {
      return Response.json({
        repaired: false,
        reason: 'INSUFFICIENT_EVIDENCE',
        message: `This record has neither owner_email nor owner_user_id. Cannot safely determine ownership without guessing. Manual admin repair required.`,
        record_id: record.id,
        record_name: record.name || null,
      });
    }

    // owner_user_id must match the authenticated user's ID exactly
    if (record.owner_user_id !== user.id) {
      return Response.json({
        repaired: false,
        reason: 'CROSS_ACCOUNT_BLOCKED',
        message: `This record's owner_user_id ("${record.owner_user_id}") does not match the current user ID ("${user.id}"). Cross-account repair is forbidden.`,
      });
    }

    // All evidence checks passed — safe to repair
    await base44.asServiceRole.entities.Character.update(characterId, {
      owner_email: user.email,
    });

    return Response.json({
      repaired: true,
      reason: 'REPAIRED_VIA_OWNER_USER_ID',
      message: `owner_email successfully set to "${user.email}" using owner_user_id as supporting evidence.`,
      character_id: characterId,
      character_name: record.name || null,
      owner_email: user.email,
    });

  } catch (error) {
    console.error('[repairCharacterOwnerEmail]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});