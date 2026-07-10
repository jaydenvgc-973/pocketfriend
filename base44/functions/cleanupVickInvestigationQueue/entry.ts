import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Admin-only: this is a lifecycle management operation
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });
    }

    const now = new Date();
    const STALE_AWAITING_MS = 2 * 60 * 60 * 1000; // 2 hours

    // Fetch all non-archived investigations across all owners
    const all = await base44.asServiceRole.entities.VickInvestigation.list('-created_date', 200);

    let archivedTerminal = 0;
    let expiredStale = 0;
    const actions = [];

    for (const inv of all) {
      // Skip already-archived records
      if (inv.status === 'archived') continue;

      // ── TERMINAL STATES: delivered or findings_ready+delivered/read → archive ──
      if (inv.status === 'delivered') {
        await base44.asServiceRole.entities.VickInvestigation.update(inv.id, {
          status: 'archived',
          archived_at: now.toISOString(),
        });
        archivedTerminal++;
        actions.push({ id: inv.id, action: 'archived_delivered', title: inv.title });
        continue;
      }

      // findings_ready that has been delivered or read = effectively complete
      if (inv.status === 'findings_ready' && (inv.findings_delivered || inv.findings_read)) {
        await base44.asServiceRole.entities.VickInvestigation.update(inv.id, {
          status: 'archived',
          archived_at: now.toISOString(),
        });
        archivedTerminal++;
        actions.push({ id: inv.id, action: 'archived_findings_consumed', title: inv.title });
        continue;
      }

      // ── STALE AWAITING EVIDENCE: expired transient failure → expire ──
      if (inv.status === 'awaiting_evidence' && !inv.requires_user_input) {
        const ref = inv.updated_date || inv.created_date;
        if (!ref || (now.getTime() - new Date(ref).getTime()) > STALE_AWAITING_MS) {
          await base44.asServiceRole.entities.VickInvestigation.update(inv.id, {
            status: 'archived',
            resolution: 'unable_to_verify',
            archived_at: now.toISOString(),
          });
          expiredStale++;
          actions.push({ id: inv.id, action: 'expired_stale_awaiting', title: inv.title });
          continue;
        }
      }
    }

    return Response.json({
      success: true,
      checked: all.length,
      archivedTerminal,
      expiredStale,
      actions,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});