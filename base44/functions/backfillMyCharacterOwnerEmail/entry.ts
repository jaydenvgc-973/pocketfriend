import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * backfillMyCharacterOwnerEmail
 *
 * Minimal-query backfill: repairs Character records missing owner_email for the current user.
 *
 * STRATEGY — single pass, two service-role queries only:
 *
 * Query A: service-role filter { owner_email: user.email }
 *   → Already-owned records. Count them. No writes needed.
 *
 * Query B: user-scoped RLS list (uses user token)
 *   → Returns ALL records the RLS engine grants this user access to.
 *   → Any record NOT already in Query A's ID set is missing owner_email.
 *   → These are repaired: write owner_email (and owner_user_id if also missing).
 *
 * This is safe because:
 *   - Query B is gated by the RLS engine which only returns records belonging to this user.
 *   - Cross-account safety: if owner_email is set to a different email, it is skipped.
 *   - No created_by is read, inferred, or used at any point.
 *
 * QUERY COUNT: 2 reads + N updates (where N = records missing owner_email).
 * This is the minimum possible to accomplish the task.
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

    // Query A: records already correctly owned (service role, scoped to this user's email)
    const alreadyOwned = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail },
      '-created_date',
      500
    );
    const alreadyOwnedIds = new Set(alreadyOwned.map(c => c.id));

    // Query B: all records visible to this user via RLS
    const rlsVisible = await base44.entities.Character.list('-created_date', 500);

    const results = {
      already_correct: alreadyOwned.length,
      rls_visible: rlsVisible.length,
      repaired_pass2: [],
      skipped_wrong_account: [],
      errors: [],
    };

    // Repair records that are RLS-visible but not in the already-owned set
    for (const char of rlsVisible) {
      if (alreadyOwnedIds.has(char.id)) continue; // already has correct owner_email

      // Cross-account safety: if owner_email is set to a different user, skip
      if (char.owner_email && char.owner_email !== ownerEmail) {
        results.skipped_wrong_account.push({
          id: char.id,
          name: char.name || '(unnamed)',
          existing_owner_email: char.owner_email,
          reason: 'owner_email belongs to different account',
        });
        continue;
      }

      // Safe to repair: RLS confirmed this record belongs to this user
      const patch = { owner_email: ownerEmail };
      if (!char.owner_user_id) patch.owner_user_id = ownerUserId;

      try {
        await base44.asServiceRole.entities.Character.update(char.id, patch);
        results.repaired_pass2.push({
          id: char.id,
          name: char.name || '(unnamed)',
          character_type: char.character_type || 'unknown',
          patched: Object.keys(patch),
        });
      } catch (e) {
        results.errors.push({ id: char.id, name: char.name || '(unnamed)', error: e.message });
      }
    }

    const totalAfter = alreadyOwned.length + results.repaired_pass2.length;

    // Build type breakdown from combined set
    const byType = {};
    for (const c of alreadyOwned) {
      const t = c.character_type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    }
    for (const r of results.repaired_pass2) {
      const t = r.character_type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    }

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      results,
      verification: {
        total_after_by_owner_email: totalAfter,
        by_character_type: byType,
      },
      summary: [
        `Already correct: ${results.already_correct}.`,
        `RLS-visible: ${results.rls_visible}.`,
        `Repaired: ${results.repaired_pass2.length}.`,
        `Skipped (cross-account): ${results.skipped_wrong_account.length}.`,
        `Errors: ${results.errors.length}.`,
        `Total after repair: ${totalAfter}.`,
      ].join(' | '),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});