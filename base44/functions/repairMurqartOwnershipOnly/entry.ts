import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairMurqartOwnershipOnly
 *
 * SCOPE: Hardcoded to murqart@gmail.com ONLY.
 * PURPOSE: Write owner_email to Character records that are:
 *   1. Visible via murqart@gmail.com's RLS token (i.e. belong to that user)
 *   2. Currently missing owner_email (null or empty)
 *
 * SAFETY RULES:
 *   - Only runs if the authenticated user IS murqart@gmail.com
 *   - Only reads via user-scoped RLS (not service role) — so only that user's visible records are candidates
 *   - Skips any record where owner_email is already set to a DIFFERENT email
 *   - Only writes: owner_email, owner_user_id (if missing)
 *   - Does NOT touch: character_type, status, locations, travel, any other fields
 *   - Uses service role ONLY for the write step (update), not for the read/discovery step
 *
 * If service-role update is still blocked by RLS: reports the blocked IDs and stops.
 * Does NOT weaken global RLS under any circumstance.
 */

const HARDCODED_TARGET_EMAIL = 'murqart@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1. Authenticate — must be the exact target user
    const user = await base44.auth.me();
    if (!user?.email || !user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.email !== HARDCODED_TARGET_EMAIL) {
      return Response.json({
        error: `This function is locked to ${HARDCODED_TARGET_EMAIL} only. Authenticated as: ${user.email}`
      }, { status: 403 });
    }

    const ownerEmail = HARDCODED_TARGET_EMAIL;
    const ownerUserId = user.id;

    // 2. Read via user-scoped RLS — only records this user can see
    // This is the safety gate: if RLS allows it, it belongs to this user.
    const rlsVisible = await base44.entities.Character.list('-created_date', 500);

    // 3. Filter to only records missing owner_email
    const needsRepair = rlsVisible.filter(c => {
      // Must have no owner_email set
      if (c.owner_email && c.owner_email.trim() !== '') return false;
      return true;
    });

    // 4. Safety: ensure none of these have a DIFFERENT owner_email (belt-and-suspenders)
    const safeToRepair = needsRepair.filter(c => {
      if (c.owner_email && c.owner_email !== ownerEmail) return false;
      return true;
    });

    const skippedCrossAccount = needsRepair.filter(c =>
      c.owner_email && c.owner_email !== ownerEmail
    ).map(c => ({ id: c.id, name: c.name, existing_owner_email: c.owner_email }));

    if (safeToRepair.length === 0) {
      return Response.json({
        success: true,
        message: 'Nothing to repair — all RLS-visible records already have owner_email set.',
        rls_visible_total: rlsVisible.length,
        skipped_cross_account: skippedCrossAccount,
        repaired: [],
        blocked: [],
      });
    }

    // 5. Attempt service-role update for each candidate
    const repaired = [];
    const blocked = [];
    const errors = [];

    for (const char of safeToRepair) {
      const patch = { owner_email: ownerEmail };
      if (!char.owner_user_id) {
        patch.owner_user_id = ownerUserId;
      }

      try {
        await base44.asServiceRole.entities.Character.update(char.id, patch);
        repaired.push({
          id: char.id,
          name: char.name || '(unnamed)',
          character_type: char.character_type || 'unknown',
          patched_fields: Object.keys(patch),
        });
      } catch (e) {
        const is403 = e.message?.includes('403') || e.message?.includes('Permission denied');
        const is429 = e.message?.includes('429') || e.message?.includes('Rate limit');

        if (is403) {
          blocked.push({
            id: char.id,
            name: char.name || '(unnamed)',
            character_type: char.character_type || 'unknown',
            reason: 'Service-role update blocked by RLS — requires dashboard/admin-level data edit',
            error: e.message,
          });
        } else if (is429) {
          blocked.push({
            id: char.id,
            name: char.name || '(unnamed)',
            reason: 'Rate limited — re-run to continue',
            error: e.message,
          });
        } else {
          errors.push({
            id: char.id,
            name: char.name || '(unnamed)',
            error: e.message,
          });
        }
      }
    }

    const requiresDashboardEdit = blocked.filter(b => b.reason?.includes('dashboard'));

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      rls_visible_total: rlsVisible.length,
      candidates_needing_repair: safeToRepair.length,
      repaired_count: repaired.length,
      blocked_count: blocked.length,
      repaired,
      blocked,
      errors,
      skipped_cross_account: skippedCrossAccount,
      ...(requiresDashboardEdit.length > 0 ? {
        action_required: `${requiresDashboardEdit.length} record(s) could not be updated by service role due to RLS. ` +
          `These require a manual data edit in the Base44 dashboard (Admin > Data > Character). ` +
          `Set owner_email = "${ownerEmail}" for each blocked record ID listed above.`,
        blocked_ids: requiresDashboardEdit.map(b => b.id),
      } : {}),
      summary: [
        `RLS-visible: ${rlsVisible.length}.`,
        `Needed repair: ${safeToRepair.length}.`,
        `Repaired: ${repaired.length}.`,
        `Blocked by RLS: ${blocked.length}.`,
        `Errors: ${errors.length}.`,
        `Cross-account skipped: ${skippedCrossAccount.length}.`,
      ].join(' | '),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});