/**
 * repairAllStuckTravel
 *
 * Repair stuck travel for Andre, Khalil, and James all at once.
 * Returns proof of before/after for each.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const khalilId = '6a0299e0dd588e28cb48df8a';
    const andreId = '69cd1c421ecd8b69850b3a6a';
    const jamesId = '69ca5e6d8babe6fc03a3a8db'; // James Anderson

    const repairs = [];

    for (const { charId, name } of [
      { charId: andreId, name: 'Andre' },
      { charId: khalilId, name: 'Khalil' },
      { charId: jamesId, name: 'James' },
    ]) {
      try {
        const res = await base44.asServiceRole.functions.invoke('repairStuckTravelState', { character_id: charId });
        if (res?.data?.status === 'repaired' || res?.data?.status === 'repaired_no_session') {
          repairs.push(res.data);
        } else {
          repairs.push({ name, error: res?.data?.error || 'Unknown error' });
        }
      } catch (e) {
        repairs.push({ name, error: e.message });
      }
    }

    return Response.json({
      repairs,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[repairAllStuckTravel]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});