import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const chars = await base44.entities.Character.list(null, 50);
    const activeCreated = chars.filter(c =>
      c.status === 'active' &&
      c.character_type === 'active_created_character' &&
      c.owner_email === 'murqart@gmail.com'
    );

    const sleeping = activeCreated.filter(c => c.resolved_presence_status === 'sleeping' || c.resolved_presence_status === 'napping');
    const awake   = activeCreated.filter(c => c.resolved_presence_status !== 'sleeping' && c.resolved_presence_status !== 'napping');

    return Response.json({
      total: activeCreated.length,
      sleeping: sleeping.length,
      awake: awake.length,
      sleepingDetails: sleeping.map(c => ({
        name: c.name,
        energy: c.energy_value,
        activity: c.current_activity,
        lastSleepStart: c.last_sleep_start,
        stayLock: c.presence_stay_lock,
        reason: c.presence_stay_lock_reason || c.resolved_source_reason,
        isAtHome: c.resolved_current_location_id === c.current_home_location_id,
      })),
      awakeDetails: awake.map(c => ({
        name: c.name,
        energy: c.energy_value,
        presence: c.resolved_presence_status,
        activity: c.current_activity,
        isJailed: c.is_jailed,
        houseArrest: c.house_arrest_active,
        explanation: c.resolved_source_reason || 'unknown',
      })),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});