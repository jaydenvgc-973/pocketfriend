import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const ownerEmail = payload.ownerEmail || null;

    const chars = await base44.entities.Character.list(null, 50);
    const activeCreated = chars.filter(c =>
      c.status === 'active' &&
      c.character_type === 'active_created_character' &&
      c.owner_email === (ownerEmail || c.owner_email)
    );

    return Response.json({
      count: activeCreated.length,
      characters: activeCreated.map(c => ({
        name: c.name,
        energy: c.energy_value,
        presence: c.resolved_presence_status,
        activity: c.current_activity,
        lastSleepStart: c.last_sleep_start,
        lastWakeTime: c.last_wake_time,
        stayLock: c.presence_stay_lock,
        stayLockReason: c.presence_stay_lock_reason,
        resolvedSourceReason: c.resolved_source_reason,
        lastNeedSim: c.last_need_simulated_at,
        sleepStartTime: c.sleep_start_time,
        wakeUpTime: c.wake_up_time,
        sleepLock: c.sleep_lock,
        isJailed: c.is_jailed,
        houseArrest: c.house_arrest_active,
        isAtHome: c.resolved_current_location_id === c.current_home_location_id,
        traitNightOwl: c.trait_night_owl,
      })).sort((a,b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});