import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * backfillUserSettingsOwnerEmail
 *
 * Safe migration: sets owner_email on UserSettings records that belong to
 * the current authenticated user but are missing owner_email.
 *
 * Strategy:
 *   1. Fetch ALL UserSettings via service role (bypasses RLS so we can see records missing owner_email).
 *   2. Match records to the current user using created_by_id (the platform-internal user UUID, NOT
 *      the email-based "created_by" field which is permanently forbidden for ownership logic).
 *      created_by_id is a stable platform UUID set by the platform itself — it is NOT the same as
 *      the forbidden "created_by" (email) field and is only used here for one-time migration matching.
 *   3. Write owner_email to any matched records that are missing it.
 *   4. Never touch records that cannot be matched to this user.
 *
 * This runs once per user session via useUserSettings if the fetch returns null.
 * After migration, all reads use owner_email exclusively.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Service role: see all settings records regardless of RLS
  const allSettings = await base44.asServiceRole.entities.UserSettings.list('-created_date', 200);

  // Records missing owner_email that belong to this user (matched via platform user UUID)
  const toRepair = allSettings.filter(s => {
    if (s.owner_email) return false;           // already has owner_email — no action needed
    if (s.created_by_id !== user.id) return false; // does not belong to this user
    return true;
  });

  const updated = [];
  const failed = [];

  for (const s of toRepair) {
    try {
      await base44.asServiceRole.entities.UserSettings.update(s.id, {
        owner_email: user.email,
        owner_user_id: user.id,
      });
      updated.push(s.id);
    } catch (err) {
      failed.push({ id: s.id, error: err.message });
    }
  }

  console.log(`[backfillUserSettingsOwnerEmail] user=${user.email} scanned=${allSettings.length} repaired=${updated.length} failed=${failed.length}`);

  return Response.json({
    user_email: user.email,
    scanned: allSettings.length,
    already_had_owner_email: allSettings.filter(s => s.owner_email).length,
    repaired: updated.length,
    failed: failed.length,
    ids_updated: updated,
    ids_failed: failed,
  });
});