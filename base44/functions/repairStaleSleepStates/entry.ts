/**
 * repairStaleSleepStates
 *
 * Owner_email-scoped only. Clears stale sleeping/napping DB states safely.
 *
 * RULES:
 * - Only clears if classifySleep() returns isStale === true
 * - Valid character-driven states (illness, sleep debt, interrupted, shifted, user nap) are NEVER touched
 * - Characters are returned to home/awake — NEVER moved to a public location
 * - Stale sleep source fields are cleared
 * - Consequence tags are attached for narrative generation (late_for_work, tired, etc.)
 * - Never uses created_by
 * - Dry-run mode available (dry_run: true in payload)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STALE_GRACE_MINUTES = 20;

function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isCanonicallyAsleep(character, nowET) {
  if (character.decided_to_stay_up_until && new Date() < new Date(character.decided_to_stay_up_until)) return false;
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const dayOfWeek = nowET.getDay();
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time), w = toMin(character.wake_up_time);
    if (s !== null && w !== null) {
      return s > w ? (currentMin >= s || currentMin < w) : (currentMin >= s && currentMin < w);
    }
  }
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    if (character.work_days.includes(dayOfWeek) || character.work_days.includes((dayOfWeek + 1) % 7)) {
      const ws = toMin(character.work_start_time), we = toMin(character.work_end_time);
      if (ws !== null && we !== null) {
        const isOvnt = we < ws;
        const wakeMin = (ws - 60 + 1440) % 1440;
        const sleepMin = isOvnt ? (we + 60) % 1440 : (wakeMin - 7 * 60 + 1440) % 1440;
        return sleepMin > wakeMin ? (currentMin >= sleepMin || currentMin < wakeMin) : (currentMin >= sleepMin && currentMin < wakeMin);
      }
    }
  }
  return false;
}

function classifySleep(character, nowET) {
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const dbSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
  if (!dbSleeping) return { isStale: false, isValid: false, classification: 'not_sleeping', consequence_tags: [] };
  if (isCanonicallyAsleep(character, nowET)) {
    return { isStale: false, isValid: true, classification: 'within_sleep_window', consequence_tags: [] };
  }
  const sleepSource = character.resolved_source_reason || '';
  if (character.decided_to_stay_up_until && new Date(character.decided_to_stay_up_until) > new Date(Date.now() - 8 * 3600 * 1000)) {
    return { isStale: false, isValid: true, classification: 'shifted_sleep_stay_up', consequence_tags: ['tired'] };
  }
  if (sleepSource === 'user_directed_nap' || sleepSource.includes('nap')) {
    return { isStale: false, isValid: true, classification: 'user_directed_nap', consequence_tags: [] };
  }
  if ((character.sleep_debt_hours || 0) > 0 && character.resolved_presence_status === 'napping') {
    return { isStale: false, isValid: true, classification: 'recovery_nap', consequence_tags: ['recovering'] };
  }
  if ((character.health_value || 100) < 30) {
    return { isStale: false, isValid: true, classification: 'illness_sleep', consequence_tags: ['sick', 'tired'] };
  }
  if ((character.mental_value || 100) < 25) {
    return { isStale: false, isValid: true, classification: 'emotional_crash_sleep', consequence_tags: ['exhausted', 'emotional'] };
  }
  if ((character.sleep_debt_hours || 0) >= 2) {
    return { isStale: false, isValid: true, classification: 'oversleeping_sleep_debt', consequence_tags: ['tired', 'oversleeping'] };
  }
  if (character.sleep_interrupted_at && (Date.now() - new Date(character.sleep_interrupted_at).getTime()) / 3600000 < 4) {
    return { isStale: false, isValid: true, classification: 'interrupted_sleep_recovery', consequence_tags: ['tired', 'interrupted'] };
  }
  const wakeMin = toMin(character.wake_up_time);
  if (wakeMin !== null) {
    let pastWake = currentMin - wakeMin;
    if (pastWake < 0) pastWake += 1440;
    if (pastWake < STALE_GRACE_MINUTES) {
      return { isStale: false, isValid: true, classification: 'within_wake_grace_period', consequence_tags: [] };
    }
  }

  // ── 6-HOUR MINIMUM SLEEP GUARD (CRITICAL) ────────────────────────────────
  // Even when a character's presence appears stale by clock-window logic, they MUST
  // have slept at least 6 hours before repair is allowed. Clock-window staleness alone
  // is not sufficient evidence — elapsed duration is the authoritative gate.
  if (character.resolved_presence_status === 'sleeping' && character.last_sleep_start) {
    const elapsedSleepHours = (nowET.getTime() - new Date(character.last_sleep_start).getTime()) / 3_600_000;
    const isMedicalEmergency = (character.health_value ?? 80) <= 15;
    if (elapsedSleepHours < 6 && !isMedicalEmergency) {
      return {
        isStale: false, isValid: true,
        classification: 'protected_by_6h_minimum',
        consequence_tags: [],
      };
    }
  }

  // Stale — build consequence tags
  const dayOfWeek = nowET.getDay();
  const consequenceTags = [];
  const hasWork = character.work_start_time && character.work_end_time &&
    Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek);
  if (hasWork) {
    const workStart = toMin(character.work_start_time);
    if (workStart !== null && currentMin > workStart) consequenceTags.push('late_for_work');
  }
  if (character.student_status === 'enrolled' && [1,2,3,4,5].includes(dayOfWeek) && currentMin > 8 * 60) {
    consequenceTags.push('late_for_school');
  }
  if (character.trait_anxious || (character.emotional_state || '').includes('anxious')) {
    consequenceTags.push('spiraling', 'rushing');
  } else if (character.trait_lazy) {
    consequenceTags.push('dismissive', 'may_call_out');
  } else if (character.trait_workaholic) {
    consequenceTags.push('panicking', 'guilty');
  } else {
    consequenceTags.push('groggy');
  }
  if ((character.energy_value || 75) < 40) consequenceTags.push('exhausted');

  return { isStale: true, isValid: false, classification: 'stale_system_sleep', consequence_tags: consequenceTags };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const characters = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      200
    );

    const sleeping = characters.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'moved_away' &&
      !c.is_test_character && !c.diagnostic_only &&
      (c.resolved_presence_status === 'sleeping' || c.resolved_presence_status === 'napping')
    );

    const repaired = [];
    const preserved = [];
    const errors = [];

    for (const char of sleeping) {
      const { isStale, isValid, classification, consequence_tags } = classifySleep(char, nowET);

      if (!isStale) {
        preserved.push({
          character_id: char.id,
          name: char.name,
          classification,
          reason: 'valid_sleep_preserved',
        });
        continue;
      }

      // Stale — resolve target location: stay at home, never move to public
      const homeId = char.current_home_location_id || char.temporary_housing_location_id || null;

      const repairPayload = {
        resolved_presence_status: 'home',
        resolved_source_reason: 'stale_sleep_cleared',
        resolved_last_updated_at: nowET.toISOString(),
        // If home is known, keep them there. If not, just clear the sleep status.
        ...(homeId ? {
          resolved_current_location_id: homeId,
          resolved_location_type: 'home',
        } : {}),
        // Attach consequence tags for narrative awareness (does not change behavior, just context)
        ...(consequence_tags?.length > 0 ? {
          last_oversleep_consequence_tags: consequence_tags,
          last_oversleep_cleared_at: nowET.toISOString(),
        } : {}),
      };

      if (dry_run) {
        repaired.push({
          character_id: char.id,
          name: char.name,
          classification,
          was: char.resolved_presence_status,
          would_set: 'home',
          consequence_tags,
          dry_run: true,
        });
        continue;
      }

      try {
        await base44.entities.Character.update(char.id, repairPayload);
        repaired.push({
          character_id: char.id,
          name: char.name,
          classification,
          was: char.resolved_presence_status,
          now: 'home',
          consequence_tags,
          home_id: homeId,
        });
        console.log(`[repairStaleSleepStates] ✓ ${char.name}: stale sleep cleared (${classification}) → home`);
      } catch (err) {
        errors.push({ character_id: char.id, name: char.name, error: err.message });
        console.error(`[repairStaleSleepStates] ✗ ${char.name}:`, err.message);
      }
    }

    return Response.json({
      dry_run,
      owner_email: user.email,
      et_time: `${nowET.getHours()}:${String(nowET.getMinutes()).padStart(2, '0')} ET`,
      total_sleeping_checked: sleeping.length,
      stale_repaired: repaired.length,
      valid_preserved: preserved.length,
      errors: errors.length,
      repaired,
      preserved,
      errors_detail: errors,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});