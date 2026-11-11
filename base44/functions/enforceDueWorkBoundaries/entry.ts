import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * WORK BOUNDARY SWEEP
 *
 * The schedule authority (enforceCharacterWorkSchedule) records, per character, the exact
 * instant of the next established boundary — a shift start or a shift end. This sweep runs
 * once a minute and enforces every boundary whose instant has arrived. A character whose
 * shift ended leaves work at that minute instead of waiting for an unrelated cycle to reach
 * them, and a character whose shift starts is dispatched at that minute.
 *
 * Nothing is enforced early: a boundary is only acted on once its recorded instant has
 * passed. Enforcement recomputes and re-records the following boundary, so each boundary is
 * consumed exactly once.
 */

const DUE_GRACE_MS = 5000;      // act as soon as the instant has arrived
const MAX_LEASES_PER_RUN = 150; // bounded work per sweep

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const now = Date.now();

    // ── 1. Boundaries whose instant has arrived ────────────────────────────
    const leases = await base44.asServiceRole.entities.WorkBoundaryLease.filter(
      { kind: 'work' }, null, MAX_LEASES_PER_RUN
    );
    const due = [];
    const unarmed = [];
    for (const lease of leases || []) {
      if (!lease?.character_id) continue;
      if (!lease.next_boundary_at) { unarmed.push(lease); continue; }
      const boundaryMs = new Date(lease.next_boundary_at).getTime();
      if (!Number.isFinite(boundaryMs)) { unarmed.push(lease); continue; }
      if (boundaryMs <= now + DUE_GRACE_MS) due.push({ lease, boundaryMs, lateMinutes: Math.floor((now - boundaryMs) / 60000) });
    }

    // ── 2. Characters present at work with no boundary held at all ──────────
    // Self-healing: a character who is at work but was never armed is given a
    // boundary here, so this sweep is never blind to them.
    let unheld = [];
    try {
      const atWork = await base44.asServiceRole.entities.Character.filter(
        { resolved_presence_status: 'at_work', status: 'active' }, null, 100
      );
      const heldIds = new Set((leases || []).map((l) => l.character_id));
      unheld = (atWork || []).filter((c) => c?.id && !heldIds.has(c.id));
    } catch (_) { /* a failed read must not stop the due boundaries */ }

    const calls = [];
    for (const { lease } of due) {
      calls.push({
        characterId: lease.character_id,
        expected_occurrence_time: lease.next_boundary_at,
        system_mode: true,
      });
    }
    for (const lease of unarmed) calls.push({ characterId: lease.character_id, system_mode: true });
    for (const character of unheld) calls.push({ characterId: character.id, system_mode: true });

    // ── 3. Enforce one at a time, paced ────────────────────────────────────
    // Every enforcement shares this app's single service token, so the entity read
    // budget is shared too. A burst of boundaries at the same minute must not race
    // that budget: pacing keeps the sweep under the limit, and a boundary refused by
    // the limiter stays due and is retried here — never reported as done.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    for (const args of calls) {
      let attempt = 0;
      let done = false;
      while (!done && attempt < 3) {
        attempt++;
        try {
          const response = await base44.asServiceRole.functions.invoke('enforceCharacterWorkSchedule', args);
          const data = response?.data || response;
          results.push({ characterId: args.characterId, reason: data?.reason || null, updated: data?.updated ?? null });
          done = true;
        } catch (error) {
          const message = String(error?.response?.data?.error || error?.message || error);
          const rateLimited = message.includes('Rate limit');
          if (rateLimited && attempt < 3) {
            const waitMatch = message.match(/Retry after (\d+)/);
            await sleep(Math.min(parseInt(waitMatch?.[1] || '10', 10) * 1000, 15000));
            continue;
          }
          results.push({ characterId: args.characterId, error: message.slice(0, 200) });
          done = true;
        }
      }
      await sleep(250);
    }

    const lateBoundaries = due.map(({ lease, lateMinutes }) => ({
      character_id: lease.character_id,
      character_name: lease.character_name || null,
      boundary_at: lease.next_boundary_at,
      late_minutes: lateMinutes,
    }));

    return Response.json({
      swept_at: new Date(now).toISOString(),
      due_boundaries: due.length,
      unarmed_leases: unarmed.length,
      unheld_characters: unheld.length,
      enforced: results.filter((r) => !r.error).length,
      failures: results.filter((r) => r.error),
      late_boundaries: lateBoundaries,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});