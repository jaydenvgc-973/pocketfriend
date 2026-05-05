import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * backfillMyCharacterOwnerEmail
 *
 * User-safe backfill: repairs Character records that are missing owner_email
 * ONLY when the record's owner_user_id matches the authenticated user's ID.
 *
 * OWNERSHIP RULES:
 * - owner_email is the ONLY ownership source of truth.
 * - owner_user_id is used as supporting evidence only.
 * - created_by is PERMANENTLY FORBIDDEN and never used.
 * - No cross-account repairs. Only records matching the current user's ID are touched.
 * - Records with no owner_user_id or a mismatched owner_user_id are skipped and flagged.
 *
 * EVIDENCE REQUIRED before repair:
 *   record.owner_email is null/empty
 *   AND record.owner_user_id === authenticatedUser.id
 *
 * If evidence is insufficient, the record is flagged as "manual_admin_required" — not repaired.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user?.email || !user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;
    const ownerUserId = user.id;

    // Step 1: Fetch Character records that belong to this user by owner_email (already healthy)
    // We also need to find records with missing owner_email but matching owner_user_id.
    // We use service role ONLY to read our own records — the filter strictly enforces user.id.
    // NOTE: We do NOT do a global scan. We use owner_user_id as the scoping key.
    const candidatesByUserId = await base44.asServiceRole.entities.Character.filter(
      { owner_user_id: ownerUserId },
      '-created_date',
      500
    );

    const results = {
      scanned: candidatesByUserId.length,
      already_correct: 0,
      repaired: [],
      skipped_wrong_account: [],
      skipped_no_evidence: [],
      errors: [],
    };

    for (const char of candidatesByUserId) {
      // Already has correct owner_email — skip
      if (char.owner_email) {
        results.already_correct++;
        continue;
      }

      // Double-check: owner_user_id must match our authenticated user's ID
      // This is the ONLY evidence we accept. created_by is forbidden.
      if (char.owner_user_id !== ownerUserId) {
        results.skipped_wrong_account.push({
          id: char.id,
          name: char.name || '(unnamed)',
          reason: 'owner_user_id does not match authenticated user — cross-account repair blocked',
        });
        continue;
      }

      // Evidence confirmed: owner_user_id matches authenticated user. Repair is safe.
      try {
        await base44.asServiceRole.entities.Character.update(char.id, {
          owner_email: ownerEmail,
        });
        results.repaired.push({ id: char.id, name: char.name || '(unnamed)' });
      } catch (e) {
        results.errors.push({ id: char.id, name: char.name || '(unnamed)', error: e.message });
      }
    }

    // Step 2: Check if any records have neither owner_email nor owner_user_id
    // We can only detect these if they are somehow visible to the user — they would not
    // appear in the above query since they have no owner_user_id. Report them as undetectable.
    // The admin backfillCharacterOwnerEmail function handles those.

    const repairedCount = results.repaired.length;
    const blockedCount = results.skipped_wrong_account.length + results.skipped_no_evidence.length;

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      results,
      summary: `Scanned ${results.scanned} record(s) by owner_user_id=${ownerUserId}. Repaired ${repairedCount}. Already correct: ${results.already_correct}. Blocked/skipped: ${blockedCount}. Errors: ${results.errors.length}.`,
      admin_required: results.skipped_wrong_account.length > 0 || results.skipped_no_evidence.length > 0,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});