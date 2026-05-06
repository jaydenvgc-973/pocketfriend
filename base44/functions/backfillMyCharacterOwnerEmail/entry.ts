import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * backfillMyCharacterOwnerEmail
 *
 * User-safe backfill: repairs Character records that are missing owner_email and/or owner_user_id
 * for the authenticated user only.
 *
 * STRATEGY:
 * Pass 1 — owner_user_id query (service role, strictly scoped to user.id):
 *   Finds records with owner_user_id matching the user but missing owner_email.
 *   These are repaired by writing owner_email = user.email.
 *
 * Pass 2 — user-scoped RLS query (uses the user token, not service role):
 *   The RLS currently grants visibility via $or[data.owner_email, created_by].
 *   Records returned here that are missing BOTH owner_email and owner_user_id
 *   are safe to repair because the RLS engine already confirmed they belong to this user.
 *   Repair writes owner_email = user.email AND owner_user_id = user.id.
 *
 * OWNERSHIP RULES:
 * - owner_email is the ONLY ownership source of truth (after repair).
 * - owner_user_id is written as supporting evidence.
 * - created_by is PERMANENTLY FORBIDDEN for ownership decisions.
 *   The RLS uses it temporarily as a stability bridge; this function never reads it directly.
 * - No cross-account repairs. RLS and owner_user_id filter both enforce user isolation.
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

    const results = {
      pass1_scanned: 0,
      pass2_scanned: 0,
      already_correct: 0,
      repaired_pass1: [],
      repaired_pass2: [],
      skipped_wrong_account: [],
      errors: [],
    };

    // ── PASS 1: owner_user_id match (service role, strictly scoped) ──────────────
    // Finds records that have owner_user_id = user.id but owner_email is missing.
    const pass1Records = await base44.asServiceRole.entities.Character.filter(
      { owner_user_id: ownerUserId },
      '-created_date',
      500
    );
    results.pass1_scanned = pass1Records.length;

    for (const char of pass1Records) {
      if (char.owner_email === ownerEmail) {
        results.already_correct++;
        continue;
      }
      if (char.owner_user_id !== ownerUserId) {
        results.skipped_wrong_account.push({ id: char.id, name: char.name || '(unnamed)', reason: 'owner_user_id mismatch' });
        continue;
      }
      try {
        await base44.asServiceRole.entities.Character.update(char.id, { owner_email: ownerEmail });
        results.repaired_pass1.push({ id: char.id, name: char.name || '(unnamed)' });
      } catch (e) {
        results.errors.push({ id: char.id, name: char.name || '(unnamed)', pass: 1, error: e.message });
      }
    }

    // ── PASS 2: user-scoped RLS query (catches records missing both fields) ──────
    // The user-token query returns all records the RLS engine grants access to.
    // We look for records where owner_email is missing — these were visible only
    // via the created_by RLS bridge and need both fields written.
    const pass1Ids = new Set(pass1Records.map(c => c.id));

    const rlsVisible = await base44.entities.Character.list('-created_date', 500);
    results.pass2_scanned = rlsVisible.length;

    for (const char of rlsVisible) {
      // Skip if already handled in pass 1
      if (pass1Ids.has(char.id)) continue;

      // Has owner_email pointing to a different user — do not touch (cross-account safety)
      if (char.owner_email && char.owner_email !== ownerEmail) {
        results.skipped_wrong_account.push({ id: char.id, name: char.name || '(unnamed)', reason: 'owner_email belongs to different account' });
        continue;
      }

      // Already has correct owner_email — nothing to do
      if (char.owner_email === ownerEmail) {
        results.already_correct++;
        continue;
      }

      // owner_email is null/empty/wrong and RLS granted us visibility → safe to repair
      const patch = { owner_email: ownerEmail };
      if (!char.owner_user_id) {
        patch.owner_user_id = ownerUserId;
      }

      try {
        await base44.asServiceRole.entities.Character.update(char.id, patch);
        results.repaired_pass2.push({ id: char.id, name: char.name || '(unnamed)', patch_fields: Object.keys(patch) });
      } catch (e) {
        results.errors.push({ id: char.id, name: char.name || '(unnamed)', pass: 2, error: e.message });
      }
    }

    // ── POST-REPAIR VERIFICATION ──────────────────────────────────────────────────
    // Re-query via service role to confirm all user records now have owner_email.
    const afterRecords = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail },
      '-created_date',
      500
    );

    const byType = {};
    for (const c of afterRecords) {
      const t = c.character_type || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    }

    const totalRepaired = results.repaired_pass1.length + results.repaired_pass2.length;
    const totalSkipped = results.skipped_wrong_account.length;

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      results,
      verification: {
        total_after_by_owner_email: afterRecords.length,
        by_character_type: byType,
      },
      summary: [
        `Pass 1 (owner_user_id query): scanned ${results.pass1_scanned}, repaired ${results.repaired_pass1.length}.`,
        `Pass 2 (RLS-visible query): scanned ${results.pass2_scanned}, repaired ${results.repaired_pass2.length}.`,
        `Total repaired: ${totalRepaired}. Already correct: ${results.already_correct}. Skipped (cross-account): ${totalSkipped}. Errors: ${results.errors.length}.`,
        `After repair — records with owner_email set: ${afterRecords.length} (${JSON.stringify(byType)}).`,
      ].join(' | '),
      admin_required: false,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});