/**
 * enforceSlowdownSleep — PERMANENTLY DISABLED
 *
 * This function previously wrote resolved_presence_status = 'sleeping' to ALL characters
 * during the midnight–6 AM slowdown window. That behavior is the confirmed root cause of
 * characters being trapped as asleep/unavailable in the Travel page.
 *
 * SLEEP DEBT AND AUTONOMOUS SLEEP ENFORCEMENT HAVE BEEN REMOVED.
 * This function is now a NO-OP. It returns success but makes ZERO writes.
 *
 * It cannot be re-enabled without explicit architectural decision and live proof.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  return Response.json({
    success: true,
    disabled: true,
    message: 'enforceSlowdownSleep is permanently disabled. Sleep debt enforcement has been removed from this system. No characters were written.',
    owner_email: user.email,
    corrected: 0,
    timestamp: new Date().toISOString(),
  });
});