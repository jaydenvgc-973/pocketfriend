import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * verifySleepConsequenceBranches — Test-only verification harness.
 * mode='setup': Puts 4 disposable test characters into states that trigger
 *   sleep_end (8h cap), nap_end (3h cap), pass_out_end (12h cap), nap_start.
 * mode='verify': Reads back SleepTransition + LifeEvent + CharacterMemory
 *   for each fixture to confirm all three record types were produced.
 * simulateActiveCharacterNeeds must be called separately between setup and verify.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const mode = payload.mode || 'setup';

    const fixtures = {
      sleepEnd:   '6a3983dac02e86d7175d14fa',
      napEnd:     '6a3983dafa6a0ad2dedf165d',
      passOutEnd: '6a3983da100ace8e196383ae',
      napStart:   '6a3a84d929c5041ef33f7215',
    };

    // ── SETUP MODE ─────────────────────────────────────────────────────
    if (mode === 'setup') {
      const now = new Date();
      const nineHoursAgo = new Date(now.getTime() - 9 * 3600000).toISOString();
      const fourHoursAgo = new Date(now.getTime() - 4 * 3600000).toISOString();
      const thirteenHoursAgo = new Date(now.getTime() - 13 * 3600000).toISOString();
      const tenMinAgo = new Date(now.getTime() - 10 * 60000).toISOString();

      const baseUpdate = {
        hunger_value: 60, social_value: 60, health_value: 80,
        mental_value: 70, hygiene_value: 70, comfort_value: 70,
        last_need_simulated_at: tenMinAgo, sleep_lock: false,
        needs_initialized: true,
        is_test_character: false, diagnostic_only: false,
        presence_stay_lock: false, presence_stay_lock_reason: null,
        presence_stay_lock_release_condition: null,
      };

      await base44.asServiceRole.entities.Character.update(fixtures.sleepEnd, {
        ...baseUpdate, resolved_presence_status: 'sleeping',
        last_sleep_start: nineHoursAgo, energy_value: 85, current_activity: 'sleeping',
      });
      await base44.asServiceRole.entities.Character.update(fixtures.napEnd, {
        ...baseUpdate, resolved_presence_status: 'napping',
        last_nap_time: fourHoursAgo, energy_value: 70, current_activity: 'napping',
      });
      await base44.asServiceRole.entities.Character.update(fixtures.passOutEnd, {
        ...baseUpdate, resolved_presence_status: 'passed_out',
        last_pass_out_at: thirteenHoursAgo, energy_value: 30,
        hunger_value: 50, health_value: 60, mental_value: 40, comfort_value: 40,
        current_activity: 'passed out',
      });
      await base44.asServiceRole.entities.Character.update(fixtures.napStart, {
        ...baseUpdate, resolved_presence_status: 'home',
        energy_value: 30, current_activity: '',
        last_sleep_start: null, last_nap_time: null, last_pass_out_at: null,
      });

      const setupCheck = {};
      for (const [key, id] of Object.entries(fixtures)) {
        const chars = await base44.asServiceRole.entities.Character.filter({ id }, null, 1);
        const c = chars[0];
        setupCheck[key] = c ? {
          name: c.name, resolved_presence_status: c.resolved_presence_status,
          energy_value: c.energy_value,
          last_sleep_start: c.last_sleep_start, last_nap_time: c.last_nap_time,
          last_pass_out_at: c.last_pass_out_at,
        } : { not_found: true };
      }
      return Response.json({ success: true, mode: 'setup', setupCheck });
    }

    // ── VERIFY MODE ────────────────────────────────────────────────────
    const readBack = async (label, charId, expectedType) => {
      const [transitions, lifeEvents, memories] = await Promise.all([
        base44.asServiceRole.entities.SleepTransition.filter(
          { character_id: charId, transition_type: expectedType }, '-timestamp', 1
        ),
        base44.asServiceRole.entities.LifeEvent.filter(
          { character_id: charId }, '-created_date', 3
        ),
        base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: charId }, '-created_date', 3
        ),
      ]);
      return {
        label, expected_transition: expectedType,
        transition_found: transitions.length > 0,
        transition_authority: transitions[0]?.authority || null,
        transition_elapsed: transitions[0]?.elapsed_hours || null,
        lifeEvent_found: lifeEvents.length > 0,
        lifeEvent_title: lifeEvents[0]?.title || null,
        lifeEvent_tags: lifeEvents[0]?.context_tags || null,
        memory_found: memories.length > 0,
        memory_summary: memories[0]?.memory_summary || null,
        all_three_present: transitions.length > 0 && lifeEvents.length > 0 && memories.length > 0,
      };
    };

    const verification = {};
    verification.sleep_end   = await readBack('sleep_end (8h cap)',     fixtures.sleepEnd,   'sleep_end');
    verification.nap_end     = await readBack('nap_end (3h cap)',       fixtures.napEnd,     'nap_end');
    verification.pass_out_end = await readBack('pass_out_end (12h cap)', fixtures.passOutEnd, 'pass_out_end');
    verification.nap_start   = await readBack('nap_start (corrective)', fixtures.napStart,   'nap_start');

    const postStates = {};
    for (const [key, id] of Object.entries(fixtures)) {
      const chars = await base44.asServiceRole.entities.Character.filter({ id }, null, 1);
      const c = chars[0];
      postStates[key] = c ? {
        name: c.name, resolved_presence_status: c.resolved_presence_status,
        energy_value: c.energy_value, last_wake_time: c.last_wake_time,
      } : { not_found: true };
    }

    return Response.json({ success: true, mode: 'verify', verification, postStates });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});