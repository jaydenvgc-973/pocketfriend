/**
 * auditAndRepairNPCSleepDebt
 * 
 * DEPRECATED: Sleep debt system has been completely removed.
 * Use removeSleepDebtLive instead for final cleanup.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    return Response.json({
      success: true,
      message: 'Sleep debt system removed — function deprecated',
      reason: 'Sleep debt is no longer active. Use removeSleepDebtLive for final cleanup.',
      status: 'deprecated',
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});