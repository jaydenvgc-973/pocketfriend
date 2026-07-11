import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * passOutCallerCorrection — Legacy Data Correction for Pass-Out Awake-Timer
 *
 * PROBLEM:
 *   Before the fix in simulateActiveCharacterNeeds/entry.ts, every pass-out
 *   initiation path wrote last_pass_out_at but did NOT write last_wake_time.
 *   If a pass-out was later cleared without setting last_wake_time (by an
 *   external repair, a failed SleepTransition, or a stale-data path), the
 *   19-hour awake check reused the old last_wake_time and immediately fired
 *   another pass-out — producing repeated consecutive pass-outs.
 *
 * FIX (in simulateActiveCharacterNeeds/entry.ts):
 *   Every pass-out initiation now writes last_wake_time: nowIso alongside
 *   last_pass_out_at. The 19-hour awake check also includes last_pass_out_at
 *   as an awake-timer boundary, so even if last_wake_time is stale, a recent
 *   pass-out prevents the old awake period from being reused.
 *
 * THIS FUNCTION:
 *   One-time correction for legacy characters whose last_pass_out_at is more
 *   recent than last_wake_time (or last_wake_time is missing entirely).
 *   Sets last_wake_time = last_pass_out_at so the 19-hour timer starts from
 *   the pass-out boundary instead of the pre-pass-out awake period.
 *
 *   Does NOT initiate, clear, or modify any pass-out state.
 *   Does NOT touch resolved_presence_status, presence_stay_lock, or any
 *   sleep/nap/timer fields other than last_wake_time.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let payload: any = {};
    try { payload = await req.json(); } catch (_) { /* GET request */ }
    const dryRun = payload.dry_run === true;
    const ownerEmail = payload.ownerEmail || user?.email;

    const allChars = await base44.asServiceRole.entities.Character.list(null, 500);

    // Only active_created_characters with a last_pass_out_at
    const candidates = allChars.filter((c: any) =>
      c.character_type === 'active_created_character' &&
      c.status === 'active' &&
      !c.is_world_service &&
      c.last_pass_out_at
    );

    const corrections: any[] = [];
    const skipped: any[] = [];

    for (const c of candidates) {
      const passOutMs = new Date(c.last_pass_out_at).getTime();
      const wakeMs = c.last_wake_time ? new Date(c.last_wake_time).getTime() : null;

      // Correction needed: last_wake_time is missing, OR last_pass_out_at is
      // more recent than last_wake_time (pass-out happened after the last wake).
      const needsCorrection = wakeMs === null || passOutMs > wakeMs;

      if (!needsCorrection) {
        skipped.push({ id: c.id, name: c.name, reason: 'last_wake_time already newer than last_pass_out_at' });
        continue;
      }

      const prevWakeTime = c.last_wake_time || null;

      if (!dryRun) {
        await base44.asServiceRole.entities.Character.update(c.id, {
          last_wake_time: c.last_pass_out_at,
        });
      }

      corrections.push({
        id: c.id,
        name: c.name,
        prev_last_wake_time: prevWakeTime,
        new_last_wake_time: c.last_pass_out_at,
        last_pass_out_at: c.last_pass_out_at,
        dry_run: dryRun,
      });
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      owner_email: ownerEmail,
      scanned: candidates.length,
      corrected: corrections.length,
      skipped: skipped.length,
      corrections,
      skipped_sample: skipped.slice(0, 10),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});