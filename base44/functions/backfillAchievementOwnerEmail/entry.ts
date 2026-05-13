/**
 * backfillAchievementOwnerEmail
 *
 * One-time migration: finds UserAchievement records belonging to the authenticated user
 * that are missing owner_email and writes it in. Uses created_by as the lookup bridge
 * ONLY for this backfill operation — never for UI gating.
 *
 * Safe to run multiple times (idempotent — skips records that already have owner_email).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all UserAchievement records visible to this user (RLS-scoped to created_by)
    const allRecords = await base44.entities.UserAchievement.list('-created_date', 500);

    const missing = allRecords.filter(r => !r.owner_email);
    console.log(`[backfillAchievementOwnerEmail] user=${user.email} total=${allRecords.length} missing_owner_email=${missing.length}`);

    let patched = 0;
    let skipped = 0;
    const errors = [];

    // Sequential with 200ms between each write to stay under rate limits
    const WRITE_DELAY_MS = 200;

    for (const record of missing) {
      try {
        await base44.asServiceRole.entities.UserAchievement.update(record.id, { owner_email: user.email });
        patched++;
      } catch (err) {
        errors.push({ id: record.id, achievement_id: record.achievement_id, error: err.message });
        skipped++;
      }
      await new Promise(r => setTimeout(r, WRITE_DELAY_MS));
    }

    return Response.json({
      status: 'complete',
      user_email: user.email,
      total_records: allRecords.length,
      already_had_owner_email: allRecords.length - missing.length,
      patched,
      skipped,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});