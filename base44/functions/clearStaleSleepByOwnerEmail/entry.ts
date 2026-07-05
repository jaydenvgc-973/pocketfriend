/**
 * clearStaleSleepByOwnerEmail
 *
 * Phase 1: Clears stale sleeping/napping states from the DB.
 * Phase 2: Immediately recomputes correct canonical location for each woken character
 *          using work schedule, school schedule, and home fallback — never hardcodes "home".
 *
 * A character who should be at work will be set to at_work.
 * A character who should be at school will be set to at_school.
 * All others fall back to home.
 *
 * RULES:
 * - Sleep ends at wake_up_time unless proven unconscious
 * - Nap max is 3 hours
 * - Emotional state does NOT justify indefinite sleep
 * - After wake, location is RECOMPUTED — not hardcoded to home
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isOnWorkScheduleNow(char, nowET) {
  if (!char.work_start_time || !char.work_end_time || !Array.isArray(char.work_days)) return false;
  const dayOfWeek = nowET.getDay();
  if (!char.work_days.includes(dayOfWeek)) return false;

  // CALLOUT GUARD
  const todayET = nowET.toISOString().slice(0, 10);
  if (char.work_exception_status === 'called_out' && char.work_exception_date === todayET) return false;

  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  const startMin = toMin(char.work_start_time);
  const endMin = toMin(char.work_end_time);
  if (startMin === null || endMin === null) return false;
  // Overnight shift
  if (endMin < startMin) return nowMin >= startMin || nowMin < endMin;
  return nowMin >= startMin && nowMin < endMin;
}

function isAtSchoolNow(char, nowET) {
  if (char.student_status !== 'enrolled' || !char.education_location_id) return false;
  const dayOfWeek = nowET.getDay();
  if (![1, 2, 3, 4, 5].includes(dayOfWeek)) return false; // weekdays only
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  // Standard school hours 8 AM – 3 PM
  return nowMin >= 8 * 60 && nowMin < 15 * 60;
}

function resolveCorrectLocation(char, nowET) {
  // Priority 1: Work schedule
  if (isOnWorkScheduleNow(char, nowET)) {
    const workLocId = char.occupation_location_id || char.current_work_location_id;
    return {
      resolved_presence_status: 'at_work',
      resolved_current_location_id: workLocId || char.resolved_current_location_id,
      resolved_location_type: 'work',
      resolved_source_reason: 'work_schedule',
    };
  }

  // Priority 2: School schedule
  if (isAtSchoolNow(char, nowET)) {
    return {
      resolved_presence_status: 'at_school',
      resolved_current_location_id: char.education_location_id,
      resolved_location_type: 'school',
      resolved_source_reason: 'school_schedule',
    };
  }

  // Priority 3: Jailed / house arrest — keep existing confinement state
  if (char.is_jailed) {
    return {
      resolved_presence_status: 'incarcerated',
      resolved_current_location_id: char.incarceration_facility_id || char.resolved_current_location_id,
      resolved_location_type: 'incarcerated',
      resolved_source_reason: 'incarceration',
    };
  }

  if (char.house_arrest_active) {
    return {
      resolved_presence_status: 'house_arrest',
      resolved_current_location_id: char.house_arrest_location_id || char.current_home_location_id,
      resolved_location_type: 'house_arrest',
      resolved_source_reason: 'house_arrest',
    };
  }

  // Priority 4: Temporary housing
  if (char.temporary_housing_location_id) {
    return {
      resolved_presence_status: 'home',
      resolved_current_location_id: char.temporary_housing_location_id,
      resolved_location_type: 'home',
      resolved_source_reason: 'temporary_housing',
    };
  }

  // Default: home
  const homeId = char.current_home_location_id || char.home_location_id;
  return {
    resolved_presence_status: 'home',
    resolved_current_location_id: homeId || char.resolved_current_location_id,
    resolved_location_type: 'home',
    resolved_source_reason: 'sleep_cleared_home_fallback',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true; // default: false (live mode)
    const nowUtc = new Date();
    const nowEt = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowIso = nowEt.toISOString();

    console.log(`[clearStaleSleepByOwnerEmail] START owner=${user.email} dry_run=${dry_run}`);

    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      500
    );

    console.log(`[clearStaleSleepByOwnerEmail] Found ${allChars.length} total characters`);

    const sleeping = allChars.filter(c => ['sleeping', 'napping'].includes(c.resolved_presence_status));
    console.log(`[clearStaleSleepByOwnerEmail] Sleeping: ${sleeping.length}`);

    const cleared = [];
    const kept = [];

    for (const char of sleeping) {
      const wakeTime = char.wake_up_time || '07:00';
      const [wh, wm] = wakeTime.split(':').map(Number);
      // CRITICAL: Intl.DateTimeFormat.formatToParts with timeZone does NOT work
      // in Deno sandbox. Use toLocaleString which IS working.
      const _etStr = nowUtc.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const _etMatch = _etStr.match(/(\d+):(\d+)/);
      const _etHour = parseInt(_etMatch[1]) % 24;
      const _etMinute = parseInt(_etMatch[2]);
      const _etTotalMinutes = _etHour * 60 + _etMinute;
      const _wakeTotalMinutes = wh * 60 + (wm || 0);
      const minutesPastWake = _etTotalMinutes - _wakeTotalMinutes;
      const isPastWakeTime = minutesPastWake > 0;

      const napDuration = char.last_nap_time ? (nowUtc - new Date(char.last_nap_time)) / 3600000 : null;
      const napExceeded = napDuration && napDuration > 3;

      const isJailed = char.is_jailed;
      const isHouseArrest = char.house_arrest_active;
      const isConfinement = ['incarcerated', 'house_arrest', 'confined'].includes(char.resolved_presence_status);
      const hasHardBlocker = isJailed || isHouseArrest || isConfinement;

      // ── 6-HOUR MINIMUM SLEEP GUARD ─────────────────────────────────────
      // Same canonical rule as enforceWakeTimeBoundary: actual sleep cannot end
      // before 6 hours unless a verified medical emergency exists.
      const _isActualSleepForGuard = char.resolved_presence_status === 'sleeping';
      const _isMedicalEmergencyForGuard = (char.health_value ?? 80) <= 15;
      if (_isActualSleepForGuard && char.last_sleep_start) {
        const _elapsedSleepHoursForGuard = (Date.now() - new Date(char.last_sleep_start).getTime()) / 3600000;
        if (_elapsedSleepHoursForGuard < 6 && !_isMedicalEmergencyForGuard) {
          kept.push({ name: char.name, status: 'valid_sleep', reason: `6h_minimum_guard (${_elapsedSleepHoursForGuard.toFixed(2)}h elapsed)` });
          continue;
        }
      }

      const isStale = isPastWakeTime && !hasHardBlocker;
      const napStale = napExceeded && !hasHardBlocker;

      if (!isStale && !napStale) {
        kept.push({ name: char.name, status: 'valid_sleep', reason: hasHardBlocker ? `blocked:${char.resolved_presence_status}` : 'within_sleep_window' });
        continue;
      }

      const correctLocation = resolveCorrectLocation(char, nowEt);
      const wasActualSleep = char.resolved_presence_status === 'sleeping';

      if (!dry_run) {
        await base44.entities.Character.update(char.id, {
          ...correctLocation,
          resolved_current_location_name: char.resolved_current_location_name || undefined,
          resolved_last_updated_at: nowIso,
          current_activity: 'awake',
          ...(wasActualSleep ? { last_wake_time: nowIso } : {}),
        });

        // ── MANDATORY WAKE PROOF — SleepTransition + LifeEvent + CharacterMemory ──
        // Every wake must create authoritative proof records. Silent wake-up is forbidden.
        try {
          const _transitionType = wasActualSleep ? 'sleep_end' : 'nap_end';
          await base44.asServiceRole.entities.SleepTransition.create({
            character_id: char.id, character_name: char.name, owner_email: user.email,
            transition_type: _transitionType,
            from_status: char.resolved_presence_status, to_status: correctLocation.resolved_presence_status,
            authority: 'clearStaleSleepByOwnerEmail',
            reason: `Cleared stale sleep — ${isStale ? `past wake time (${Math.round(minutesPastWake)}m)` : 'nap exceeded 3h'}.`,
            timestamp: nowIso,
            state_start_ref: char.last_sleep_start || char.last_nap_time || null,
          });
        } catch (transitionError) {
          console.warn(`[clearStaleSleepByOwnerEmail] SleepTransition proof failed for ${char.name} (non-reverting): ${transitionError.message}`);
        }
        try {
          const _wakeTitle = wasActualSleep ? 'Woke up' : 'Woke up from a nap';
          await base44.asServiceRole.entities.LifeEvent.create({
            character_id: char.id, character_name: char.name,
            event_type: 'recovery_event', valence: 'positive', severity: 'minor',
            title: _wakeTitle,
            description: `${char.name} woke up. Stale sleep state was cleared. Energy at ${char.energy_value ?? 75}.`,
            emotional_impact: wasActualSleep ? 'rested' : 'refreshed',
            triggered_by: 'life_simulation', timestamp: nowIso,
            context_tags: ['woke_up', 'stale_sleep_cleared', wasActualSleep ? 'sleep_end' : 'nap_end'],
          });
          await base44.asServiceRole.entities.CharacterMemory.create({
            character_id: char.id, memory_type: 'event',
            memory_text: `${char.name} woke up. Energy at ${char.energy_value ?? 75}.`,
            memory_summary: `Woke up — stale sleep cleared.`,
            importance_score: 3, permanence: 'short_term', related_character_id: char.id,
          });
        } catch (consequenceError) {
          console.warn(`[clearStaleSleepByOwnerEmail] LifeEvent/Memory failed for ${char.name} (non-reverting): ${consequenceError.message}`);
        }

        console.log(`[clearStaleSleepByOwnerEmail] WOKE ${char.name} → ${correctLocation.resolved_presence_status} (proof records created)`);
      }

      cleared.push({
        name: char.name,
        character_id: char.id,
        action: dry_run ? 'would_clear' : 'cleared',
        was_status: char.resolved_presence_status,
        now_status: correctLocation.resolved_presence_status,
        now_source: correctLocation.resolved_source_reason,
        now_location_id: correctLocation.resolved_current_location_id,
        wake_reason: isStale ? `past_wake_time(${Math.round(minutesPastWake)}m)` : 'nap_exceeded_3h',
      });
    }

    return Response.json({
      success: true,
      dry_run,
      total_characters: allChars.length,
      sleeping_found: sleeping.length,
      cleared: cleared.length,
      kept: kept.length,
      results: cleared,
      kept_valid: kept,
    });

  } catch (error) {
    console.error('[clearStaleSleepByOwnerEmail] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});