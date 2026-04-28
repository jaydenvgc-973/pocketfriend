import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ONE-TIME BACKFILL: Set owner_email on all Character records that are missing it.
 * 
 * Source of truth for ownership: owner_email ONLY.
 * This function reads the existing owner_email field on each record.
 * If owner_email is already set, the record is skipped.
 * If owner_email is missing but owner_user_id exists, we look up the user email from User records.
 * 
 * FORBIDDEN: created_by is NOT used as a source of ownership inference.
 * Records with no owner_email and no owner_user_id are flagged as unresolvable and skipped.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Require admin
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Load all Character records via service role (bypasses RLS to see all records)
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 1000);

    // Load all User records to resolve owner_user_id → email
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 500);
    const userIdToEmail = Object.fromEntries(allUsers.map(u => [u.id, u.email]));

    const results = {
      total: allChars.length,
      already_have_owner_email: 0,
      backfilled: 0,
      unresolvable: [],
      errors: [],
    };

    for (const char of allChars) {
      // Already has owner_email — skip
      if (char.owner_email) {
        results.already_have_owner_email++;
        continue;
      }

      // Try to resolve via owner_user_id
      let resolvedEmail = null;
      if (char.owner_user_id) {
        resolvedEmail = userIdToEmail[char.owner_user_id] || null;
      }

      if (!resolvedEmail) {
        // Cannot resolve — flag as unresolvable. Do NOT infer from created_by.
        results.unresolvable.push({ id: char.id, name: char.name, owner_user_id: char.owner_user_id || null });
        continue;
      }

      // Backfill owner_email
      try {
        await base44.asServiceRole.entities.Character.update(char.id, {
          owner_email: resolvedEmail,
        });
        results.backfilled++;
      } catch (e) {
        results.errors.push({ id: char.id, name: char.name, error: e.message });
      }
    }

    return Response.json({
      success: true,
      results,
      summary: `Backfilled ${results.backfilled} of ${results.total} characters. ${results.already_have_owner_email} already had owner_email. ${results.unresolvable.length} unresolvable (no owner_user_id).`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});