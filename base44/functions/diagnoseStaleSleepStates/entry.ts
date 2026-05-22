/**
 * diagnoseStaleSleepStates
 *
 * Owner_email-scoped. Reports characters where:
 *   - DB says sleeping/napping
 *   - Canonical sleep/nap logic says the window has passed
 *   - Current time is past wake_up_time + grace period
 *   - No valid character-driven reason exists (illness, sleep debt, interrupted, shifted, user nap)
 *
 * Does NOT write anything. Purely diagnostic.
 *
 * Valid (preserved) reasons are clearly labeled per character.
 * Stale states are clearly labeled and repair-ready.
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

  // Priority 1: stored schedule
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time), w = toMin(character.wake_up_time);
    if (s !== null && w !== null) {
      return s > w ? (currentMin >= s || currentMin < w) : (currentMin >= s && currentMin < w);
    }
  }
  // Priority 2: work-derived
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
  if (!dbSleeping) return { classification: 'not_sleeping', isStale: false, isValid: false };

  const canonical = isCanonicallyAsleep(character, nowET);
  if (canonical) return { classification: 'within_sleep_window', isStale: false, isValid: true };

  // Past window — check valid reasons
  const sleepSource = character.resolved_source_reason || '';

  if (character.decided_to_stay_up_until && new Date(character.decided_to_stay_up_until) > new Date(Date.now() - 8 * 3600 * 1000)) {
    return { classification: 'shifted_sleep_stay_up', isStale: false, isValid: true };
  }
  if (sleepSource === 'user_directed_nap' || sleepSource.includes('nap')) {
    return { classification: 'user_directed_nap', isStale: false, isValid: true };
  }
  if ((character.sleep_debt_hours || 0) > 0 && character.resolved_presence_status === 'napping') {
    return { classification: 'recovery_nap', isStale: false, isValid: true };
  }
  if ((character.health_value || 100) < 30) {
    return { classification: 'illness_sleep', isStale: false, isValid: true };
  }
  if ((character.mental_value || 100) < 25) {
    return { classification: 'emotional_crash_sleep', isStale: false, isValid: true };
  }
  if ((character.sleep_debt_hours || 0) >= 2) {
    return { classification: 'oversleeping_sleep_debt', isStale: false, isValid: true };
  }
  if (character.sleep_interrupted_at && (Date.now() - new Date(character.sleep_interrupted_at).getTime()) / 3600000 < 4) {
    return { classification: 'interrupted_sleep_recovery', isStale: false, isValid: true };
  }

  // Grace period
  const wakeMin = toMin(character.wake_up_time);
  if (wakeMin !== null) {
    let pastWake = currentMin - wakeMin;
    if (pastWake < 0) pastWake += 1440;
    if (pastWake < STALE_GRACE_MINUTES) {
      return { classification: 'within_wake_grace_period', isStale: false, isValid: true };
    }
  }

  // NO GUESSING FROM NEEDS VALUES
  // Without explicit proof → stale/unverified
  return {
    classification: 'unverified_sleep_state',
    isStale: true,
    isValid: false,
    behavioral_state: null,
    recommended_label: 'Unverified sleep state — needs diagnosis',
    blocking_condition: null,
    diagnostic_notes: 'No proof found. Needs values alone are not sufficient to classify emotional/behavioral states.',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const characters = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      200
    );

    const active = characters.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'moved_away' &&
      !c.is_test_character && !c.diagnostic_only &&
      (c.resolved_presence_status === 'sleeping' || c.resolved_presence_status === 'napping')
    );

    const report = [];
    let stale_count = 0;
    let valid_count = 0;

    for (const char of active) {
      const result = classifySleep(char, nowET);
      const { classification, isStale, isValid } = result;
      const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
      const wakeMin = toMin(char.wake_up_time);
      let minutesPastWake = null;
      if (wakeMin !== null) {
        minutesPastWake = currentMin - wakeMin;
        if (minutesPastWake < 0) minutesPastWake += 1440;
      }

      report.push({
        character_id: char.id,
        name: char.name,
        db_presence: char.resolved_presence_status,
        db_source: char.resolved_source_reason,
        db_location: char.resolved_current_location_name,
        wake_up_time: char.wake_up_time || null,
        sleep_start_time: char.sleep_start_time || null,
        minutes_past_wake: minutesPastWake,
        sleep_debt_hours: char.sleep_debt_hours || 0,
        health_value: char.health_value ?? null,
        mental_value: char.mental_value ?? null,
        classification,
        is_stale: isStale,
        is_valid: isValid,
        repair_safe: isStale,
        et_time: `${nowET.getHours()}:${String(nowET.getMinutes()).padStart(2, '0')} ET`,
      });

      if (isStale) stale_count++;
      else if (isValid) valid_count++;
    }

    return Response.json({
      owner_email: user.email,
      et_time: `${nowET.getHours()}:${String(nowET.getMinutes()).padStart(2, '0')} ET`,
      total_sleeping_in_db: active.length,
      stale_count,
      valid_count,
      summary: stale_count > 0
        ? `${stale_count} character(s) have unverified/stale sleep states. No emotional assumptions made.`
        : `All sleeping characters have valid proof. ${valid_count} are in confirmed sleep/rest states.`,
      characters: report,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});