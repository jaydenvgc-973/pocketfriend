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

    const awake = activeCreated.filter(c =>
      c.resolved_presence_status !== 'sleeping' &&
      c.resolved_presence_status !== 'napping' &&
      c.resolved_presence_status !== 'passed_out'
    );

    return Response.json({
      awakeCount: awake.length,
      awake: awake.map(c => ({
        name: c.name,
        energy: c.energy_value,
        presence: c.resolved_presence_status,
        activity: c.current_activity,
        lastSleepStart: c.last_sleep_start,
        lastWakeTime: c.last_wake_time,
        sleepLock: c.sleep_lock,
        isJailed: c.is_jailed,
        houseArrest: c.house_arrest_active,
        inTravel: c.travel_status !== 'not_traveling' && !!c.travel_status,
        atWork: c.resolved_presence_status === 'at_work',
        atSchool: c.resolved_presence_status === 'at_school',
        resolvedSourceReason: c.resolved_source_reason,
        hasStayLock: c.presence_stay_lock,
        stayLockReason: c.presence_stay_lock_reason,
        isAtHome: c.resolved_current_location_id === c.current_home_location_id,
        sleepStartTime: c.sleep_start_time,
        wakeUpTime: c.wake_up_time,
      })),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});