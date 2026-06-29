import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * parallelNapSleepTestMatrix — Test-only harness.
 * Sets up fixtures B–E via asServiceRole, runs processScheduledCharacterAlarms,
 * returns before/after states for all 5 fixtures. Does NOT test user-scoped
 * functions (scheduleNap, sendWorldPhoneMessage) — those are tested separately.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const fixtures = {
      A: '6a3983dac02e86d7175d14fa', // control (murqart)
      B: '6a3983dafa6a0ad2dedf165d', // nap lifecycle
      C: '6a3983da100ace8e196383ae', // energy recovery
      D: '6a3a84d929c5041ef33f7215', // missed alarm
      E: '6a3a84d9612fb6b449cb6d79', // communication (sleeping state)
    };

    const readState = async (id) => {
      const chars = await base44.asServiceRole.entities.Character.filter({ id }, null, 1);
      const c = chars[0];
      if (!c) return { not_found: true };
      const [lifeEvents, memories, transitions] = await Promise.all([
        base44.asServiceRole.entities.LifeEvent.filter({ character_id: id }, '-created_date', 3),
        base44.asServiceRole.entities.CharacterMemory.filter({ character_id: id }, '-created_date', 3),
        base44.asServiceRole.entities.SleepTransition.filter({ character_id: id }, '-timestamp', 3),
      ]);
      return {
        name: c.name,
        owner_email: c.owner_email,
        resolved_presence_status: c.resolved_presence_status,
        energy_value: c.energy_value,
        last_wake_time: c.last_wake_time,
        last_nap_time: c.last_nap_time,
        last_sleep_start: c.last_sleep_start,
        pending_alarm_time: c.pending_alarm_time,
        presence_stay_lock: c.presence_stay_lock,
        presence_stay_lock_reason: c.presence_stay_lock_reason,
        presence_stay_lock_expires_at: c.presence_stay_lock_expires_at,
        emotional_state: c.emotional_state,
        lifeEvents: lifeEvents.map(e => ({ title: e.title, event_type: e.event_type, context_tags: e.context_tags })),
        memories: memories.map(m => ({ memory_summary: m.memory_summary, memory_type: m.memory_type })),
        transitions: transitions.map(t => ({ transition_type: t.transition_type, authority: t.authority, from_status: t.from_status, to_status: t.to_status, elapsed_hours: t.elapsed_hours })),
      };
    };

    // ── READ BEFORE-STATE ──────────────────────────────────────────────
    const before = {};
    for (const [key, id] of Object.entries(fixtures)) {
      before[key] = await readState(id);
    }

    const now = new Date();
    const past10 = new Date(now.getTime() - 10 * 60000).toISOString();
    const past30 = new Date(now.getTime() - 30 * 60000).toISOString();
    // For energy re-test: use a 2-hour-ago nap start so recovery is meaningful (12 * 2 = 24 energy)
    const past2h = new Date(now.getTime() - 2 * 3600000).toISOString();

    // ── RE-TEST: Only setup C (energy recovery) — B, D already passed, E is control-sleeping
    // B and D already proved their paths in the prior run. Only C needs re-test with the
    // energy recovery patch. E stays as-is (sleeping, for communication check).
    await base44.asServiceRole.entities.Character.update(fixtures.C, {
      resolved_presence_status: 'napping',
      current_activity: 'napping (energy re-test)',
      energy_value: 30,
      last_nap_time: past2h,
      last_need_simulated_at: past2h,
      presence_stay_lock: true,
      presence_stay_lock_reason: 'nap_state',
      presence_stay_lock_authority: 'scheduleNap_user_directed',
      presence_stay_lock_set_at: past2h,
      presence_stay_lock_release_condition: 'nap_complete',
      presence_stay_lock_expires_at: past10,
      pending_alarm_time: past10,
    });

    // ── RUN ALARM PROCESSOR (real function) ────────────────────────────
    let alarmResult;
    try {
      const res = await base44.functions.invoke('processScheduledCharacterAlarms', {});
      alarmResult = res.data || res;
    } catch (e) {
      alarmResult = { error: e.message };
    }

    // ── READ AFTER-STATE ───────────────────────────────────────────────
    const after = {};
    for (const [key, id] of Object.entries(fixtures)) {
      after[key] = await readState(id);
    }

    // Compact comparison — only proof-relevant fields for C (energy re-test)
    const compact = {};
    for (const key of Object.keys(fixtures)) {
      const b = before[key];
      const a = after[key];
      compact[key] = {
        presence_b: b?.resolved_presence_status,
        presence_a: a?.resolved_presence_status,
        energy_b: b?.energy_value,
        energy_a: a?.energy_value,
        energy_delta: (a?.energy_value ?? 0) - (b?.energy_value ?? 0),
        last_wake_a: a?.last_wake_time,
        alarm_a: a?.pending_alarm_time,
        lock_a: a?.presence_stay_lock,
        nap_end: a?.transitions?.some(t => t.transition_type === 'nap_end'),
      };
    }
    return Response.json({
      success: true,
      compact,
      alarm_processed: alarmResult?.processed,
      alarm_chars: alarmResult?.characters?.map(c => ({ id: c.character_id, name: c.character_name, woke: c.woke_up })),
      alarm_skipped: alarmResult?.skipped_details,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});