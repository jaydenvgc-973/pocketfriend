/**
 * backfillAchievementOwnerEmail
 *
 * One-time migration: finds UserAchievement records belonging to the authenticated user
 * that are missing owner_email and writes it in.
 *
 * Safe to run multiple times (idempotent — skips records that already have owner_email).
 * Processes up to 40 records per run. Run again until remaining_after_this_run = 0.
 *
 * NOTE: owner_email is now a declared schema field. Writes will persist correctly.
 * Uses asServiceRole to update records (bypasses RLS for the write).
 * Ownership is proven by RLS-scoped list() — only this user's records are returned.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1200;
const MAX_PER_RUN = 40;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // RLS-scoped list — only returns records belonging to this user
    const allRecords = await base44.entities.UserAchievement.list('-created_date', 500);

    const missing = allRecords.filter(r => !r.owner_email);
    const toProcess = missing.slice(0, MAX_PER_RUN);

    console.log(`[backfillAchievementOwnerEmail] user=${user.email} total=${allRecords.length} missing=${missing.length} processing=${toProcess.length}`);

    let patched = 0;
    let rate_limited = 0;
    const errors = [];

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      for (const record of batch) {
        try {
          await base44.asServiceRole.entities.UserAchievement.update(record.id, { owner_email: user.email });
          patched++;
        } catch (err) {
          if (err.message?.includes('429') || err.message?.toLowerCase().includes('rate')) {
            rate_limited++;
          } else {
            errors.push({ id: record.id, achievement_id: record.achievement_id, error: err.message });
          }
        }
      }
      if (i + BATCH_SIZE < toProcess.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const remaining = missing.length - toProcess.length;

    return Response.json({
      status: remaining > 0 ? 'partial_run_again' : 'complete',
      user_email: user.email,
      total_records: allRecords.length,
      already_had_owner_email: allRecords.length - missing.length,
      patched,
      rate_limited,
      remaining_after_this_run: remaining,
      note: remaining > 0 ? 'Run again to continue' : 'All records have owner_email',
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});