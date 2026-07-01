/**
 * backfillLocationHistoryFromTravelSessions — DISABLED
 *
 * This function previously wrote LocationHistory.create() directly, bypassing
 * writeVerifiedLocationHistory. That was a verified bypass of the single
 * authoritative LocationHistory writer.
 *
 * It cannot be safely repaired: backfill writes historical records for
 * locations the Character may no longer currently be at, but
 * writeVerifiedLocationHistory requires Character.resolved_current_location_id
 * to already match the target location (it documents a transition that already
 * happened, not a historical reconstruction). Routing backfill through the
 * verified writer would reject most records; keeping the direct write would
 * leave the bypass active.
 *
 * Per the repair mandate: if a function cannot meet the standard safely,
 * disable the canonical write and return a hard failure.
 *
 * This function now refuses to write LocationHistory. Admins who need
 * historical reconstruction must use a dedicated migration tool that writes
 * with is_current:false explicitly and does not interact with the live
 * is_current:true tracking.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    return Response.json({
      success: false,
      error: 'function_disabled',
      reason: 'Direct LocationHistory.create() bypasses writeVerifiedLocationHistory — the single authoritative writer. This function cannot safely route through the verified writer because backfill writes historical records for locations the Character may no longer be at, which the verified writer correctly rejects. Canonical write disabled per repair mandate.',
      suggestion: 'Use a dedicated migration tool that writes is_current:false historical records explicitly, separate from the live is_current:true tracking.',
    }, { status: 422 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});