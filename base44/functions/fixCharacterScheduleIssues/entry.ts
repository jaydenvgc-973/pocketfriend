import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fixes = [];
    const characters = await base44.entities.Character.filter({ created_by: user.email });

    for (const char of characters) {
      const updates = {};
      const issues = [];

      // Fix 1: Missing sleep schedule
      if (!char.sleep_start_time || !char.wake_up_time) {
        updates.sleep_start_time = '23:00';
        updates.wake_up_time = '07:00';
        issues.push('missing sleep schedule');
      }

      // Fix 2: Has job but no work hours
      if (char.work_details?.job_title && (!char.work_start_time || !char.work_end_time)) {
        updates.work_start_time = '09:00';
        updates.work_end_time = '17:00';
        issues.push('missing work hours');
      }

      // Fix 3: Has job but no work days
      if (char.work_details?.job_title && (!char.work_days || char.work_days.length === 0)) {
        updates.work_days = [1, 2, 3, 4, 5]; // Mon-Fri
        issues.push('missing work days');
      }

      if (Object.keys(updates).length > 0) {
        await base44.entities.Character.update(char.id, updates);
        fixes.push({
          characterId: char.id,
          characterName: char.name,
          fixes: issues,
        });
      }
    }

    return Response.json({
      success: true,
      fixedCount: fixes.length,
      fixes,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});