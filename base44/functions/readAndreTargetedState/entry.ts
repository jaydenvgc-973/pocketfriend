import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const andreId = '69cd1c421ecd8b69850b3a6a';

    // Try user-scoped first
    let chars = [];
    if (user?.email) {
      chars = await base44.entities.Character.filter({ owner_email: user.email, id: andreId }, null, 5);
    }
    if (!chars.length) {
      chars = await base44.asServiceRole.entities.Character.filter({ id: andreId }, null, 5);
    }
    if (!chars.length) {
      // Last resort: list all and find
      const all = await base44.asServiceRole.entities.Character.list(null, 500);
      chars = all.filter(c => c.id === andreId);
    }

    if (!chars.length) return Response.json({ error: 'not found', tried_user: !!user?.email }, { status: 404 });

    const c = chars[0];
    const userSettings = await base44.asServiceRole.entities.UserSettings.filter(
      { owner_email: c.owner_email || 'murqart@gmail.com' }, null, 1
    ).catch(() => []);

    return Response.json({
      character: {
        id: c.id,
        name: c.name,
        resolved_presence_status: c.resolved_presence_status,
        current_activity: c.current_activity,
        resolved_current_location_id: c.resolved_current_location_id,
        resolved_current_location_name: c.resolved_current_location_name,
        current_home_location_id: c.current_home_location_id,
        last_nap_time: c.last_nap_time,
        last_sleep_start: c.last_sleep_start,
        last_wake_time: c.last_wake_time,
        last_need_simulated_at: c.last_need_simulated_at,
        energy_value: c.energy_value,
        updated_date: c.updated_date,
        owner_email: c.owner_email,
      },
      user: userSettings[0] ? {
        user_presence_status: userSettings[0].user_presence_status,
        user_current_location_id: userSettings[0].user_current_location_id,
        user_current_location_name: userSettings[0].user_current_location_name,
      } : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});