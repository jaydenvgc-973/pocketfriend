import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get Ethan
    const chars = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = chars.find(c => c.name && c.name.toLowerCase().includes('ethan'));

    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    // The fix: Set current_work_location_id (the actual field that exists)
    // This tells the system where Ethan currently is for work
    const updates = {
      current_work_location_id: ethan.occupation_location_id,
      current_activity: 'working',
    };

    await base44.entities.Character.update(ethan.id, updates);

    // Verify
    const verify = await base44.entities.Character.filter({ id: ethan.id });
    const fixed = verify[0];

    return Response.json({
      timestamp: new Date().toISOString(),
      characterName: fixed.name,
      fixes: {
        currentWorkLocationId: {
          before: ethan.current_work_location_id || null,
          after: fixed.current_work_location_id,
          occupationLocationId: fixed.occupation_location_id,
        },
        currentActivity: {
          before: ethan.current_activity,
          after: fixed.current_activity,
        },
      },
      status: fixed.current_work_location_id === ethan.occupation_location_id ? 'FIXED' : 'INCOMPLETE',
      summary: 'Ethan\'s work location tracking is now properly set. He should display as "at work" on the home screen.',
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});