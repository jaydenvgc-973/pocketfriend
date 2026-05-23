/**
 * enforceSlowdownSleep
 *
 * During the app's overnight slowdown period (midnight–6 AM ET), every character
 * who should be asleep must have resolved_presence_status = 'sleeping' in the DB.
 *
 * This is not a forced sleep window for active created characters.
 * For active created characters, sleep is set only when autonomous evidence exists:
 *   - energy_value < 45 (tiredness threshold)
 *   - sleep_debt_hours > 0
 *   - resolved_presence_status already sleeping/napping (already correct, skip)
 *
 * For NPC / family / untyped characters, the schedule-window rule applies.
 *
 * HARD PROTECTIONS (never touched):
 *   - current location / location name
 *   - home assignment
 *   - roster/category/type
 *   - financial data
 *   - memories
 *   - mood/emotion fields
 *
 * Only writes: resolved_presence_status, resolved_source_reason, resolved_last_updated_at
 * Preserves: everything else.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function computeWakeMin(character, dayOfWeek) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;

  if (character.sleep_start_time && character.wake_up_time) {
    return toMinutes(character.wake_up_time);
  }

  let shiftStart = null;
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    const workToday = character.work_days.includes(dayOfWeek);
    const workTomorrow = character.work_days.includes((dayOfWeek + 1) % 7);
    if (workToday || workTomorrow) shiftStart = toMinutes(character.work_start_time);
  }
  if (!shiftStart && character.student_status === 'enrolled') shiftStart = 8 * 60;

  if (shiftStart !== null) return (shiftStart - PRE_SHIFT_BUFFER + 1440) % 1440;
  return null; // unknown wake time
}

function isInScheduledSleepWindow(character, nowMin, dayOfWeek) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;

  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMinutes(character.sleep_start_time);
    const w = toMinutes(character.wake_up_time);
    if (s === null || w === null) return false;
    if (s > w) return nowMin >= s || nowMin < w;
    return nowMin >= s && nowMin < w;
  }

  let shiftStart = null;
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    const workToday = character.work_days.includes(dayOfWeek);
    const workTomorrow = character.work_days.includes((dayOfWeek + 1) % 7);
    if (workToday || workTomorrow) shiftStart = toMinutes(character.work_start_time);
  }
  if (!shiftStart && character.student_status === 'enrolled') shiftStart = 8 * 60;

  if (shiftStart !== null) {
    const wakeTime = (shiftStart - PRE_SHIFT_BUFFER + 1440) % 1440;
    const sleepStart = (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440;
    if (sleepStart > wakeTime) return nowMin >= sleepStart || nowMin < wakeTime;
    return nowMin >= sleepStart && nowMin < wakeTime;
  }

  return false;
}

function hasVerifiedException(character, status) {
  // Active work shift
  if (status === 'at_work') return { exception: true, reason: 'active_work_shift' };
  if (status === 'at_school') return { exception: true, reason: 'active_school' };
  // Confinement
  if (character.is_jailed) return { exception: true, reason: 'incarcerated' };
  if (character.house_arrest_active) return { exception: true, reason: 'house_arrest' };
  // Explicit awake override
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  if (character.decided_to_stay_up_until && new Date(character.decided_to_stay_up_until) > nowET) {
    return { exception: true, reason: 'explicit_awake_override' };
  }
  return { exception: false, reason: null };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowHour = nowET.getHours();
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();
    const isSlowdownPeriod = nowHour >= 0 && nowHour < 6;

    if (!isSlowdownPeriod) {
      return Response.json({
        success: true,
        message: `Not in slowdown period (current ET hour: ${nowHour}). No action taken.`,
        slowdown_period: false,
      });
    }

    // Fetch all active characters for this user
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null, 200
    );

    const activeChars = allChars.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'moved_away' && c.status !== 'merged'
    );

    const results = [];
    let corrected = 0;
    let alreadyAsleep = 0;
    let skippedException = 0;
    let skippedNoEvidence = 0;

    for (const char of activeChars) {
      const status = char.resolved_presence_status || '';
      const charType = char.character_type || 'untyped';
      const isActiveCreated = charType === 'active_created_character';

      const entry = {
        id: char.id,
        name: char.name,
        character_type: charType,
        sleep_model: isActiveCreated ? 'autonomous' : 'forced_schedule',
        status_before: status,
        status_after: null,
        location_before: char.resolved_current_location_name || char.resolved_current_location_id || null,
        location_after: null,
        location_preserved: true,
        already_asleep: false,
        corrected: false,
        skipped: false,
        skip_reason: null,
        exception_found: null,
        energy: char.energy_value ?? null,
        sleep_debt: char.sleep_debt_hours ?? null,
        wake_min: computeWakeMin(char, dayOfWeek),
        miss_reason: null,
      };

      // Already asleep — do not touch
      if (status === 'sleeping' || status === 'napping') {
        entry.already_asleep = true;
        entry.status_after = status;
        entry.location_after = entry.location_before;
        alreadyAsleep++;
        results.push(entry);
        continue;
      }

      // Check verified exception
      const excCheck = hasVerifiedException(char, status);
      if (excCheck.exception) {
        entry.skipped = true;
        entry.skip_reason = excCheck.reason;
        entry.exception_found = excCheck.reason;
        entry.status_after = status;
        entry.location_after = entry.location_before;
        skippedException++;
        results.push(entry);
        continue;
      }

      // Determine if sleep should be applied
      let shouldSleep = false;
      let sleepReason = null;

      if (isActiveCreated) {
        // Autonomous evidence required
        const energyLow = char.energy_value !== undefined && char.energy_value < 45;
        const sleepDebt = char.sleep_debt_hours && char.sleep_debt_hours > 0;
        if (energyLow || sleepDebt) {
          shouldSleep = true;
          sleepReason = energyLow ? 'autonomous_energy_below_threshold' : 'autonomous_sleep_debt';
        } else {
          // No autonomous evidence — flag but do not force
          entry.skipped = true;
          entry.skip_reason = 'active_created_no_autonomous_evidence';
          entry.miss_reason = `active_created_character_awake_during_slowdown: energy=${char.energy_value ?? 'unknown'}, sleep_debt=${char.sleep_debt_hours ?? 0}, status=${status}. Autonomous sleep pipeline did not trigger. Field: resolved_presence_status written by locationResolutionEngine/simulateActiveCharacterNeeds.`;
          entry.status_after = status;
          entry.location_after = entry.location_before;
          skippedNoEvidence++;
          results.push(entry);
          continue;
        }
      } else {
        // NPC / family / untyped — use schedule window
        const inWindow = isInScheduledSleepWindow(char, nowMin, dayOfWeek);
        if (inWindow) {
          shouldSleep = true;
          sleepReason = 'npc_schedule_window';
        } else {
          // No schedule window covers this character — flag
          entry.skipped = true;
          entry.skip_reason = 'npc_no_schedule_window';
          entry.miss_reason = `NPC/family/untyped character has no schedule window covering current time. Missing: sleep_start_time/wake_up_time or work_start_time/work_days. status=${status}`;
          entry.status_after = status;
          entry.location_after = entry.location_before;
          skippedNoEvidence++;
          results.push(entry);
          continue;
        }
      }

      if (shouldSleep) {
        // Write sleep state — preserve ALL other fields
        const wakeMin = computeWakeMin(char, dayOfWeek);
        const wakeHour = wakeMin !== null ? Math.floor(wakeMin / 60) : null;
        const wakeMinPart = wakeMin !== null ? wakeMin % 60 : null;
        const wakeLabel = wakeHour !== null
          ? `${String(wakeHour).padStart(2, '0')}:${String(wakeMinPart).padStart(2, '0')}`
          : null;

        await base44.entities.Character.update(char.id, {
          resolved_presence_status: 'sleeping',
          resolved_source_reason: sleepReason,
          resolved_last_updated_at: nowET.toISOString(),
          // Preserve location — explicitly re-affirm current fields (no change)
          resolved_current_location_id: char.resolved_current_location_id || undefined,
          resolved_current_location_name: char.resolved_current_location_name || undefined,
        });

        // Readback proof
        const readback = await base44.entities.Character.filter({ id: char.id }, null, 1);
        const rb = readback[0];
        const proofStatus = rb?.resolved_presence_status;

        entry.corrected = true;
        entry.status_after = proofStatus || 'sleeping';
        entry.location_after = rb?.resolved_current_location_name || rb?.resolved_current_location_id || entry.location_before;
        entry.location_preserved = entry.location_after === entry.location_before || !entry.location_before;
        entry.miss_reason = `Missed sleep transition during slowdown. sleep_reason=${sleepReason}. DB status was "${status}". Corrected to "sleeping". Readback: ${proofStatus}.`;
        corrected++;
      }

      results.push(entry);
    }

    // Special: find Maria Vanessa Anderson diagnostic
    const maria = results.find(r => r.name && r.name.toLowerCase().includes('vanessa'));

    console.log(`[enforceSlowdownSleep] ET hour=${nowHour} | total=${activeChars.length} | already_asleep=${alreadyAsleep} | corrected=${corrected} | skipped_exception=${skippedException} | skipped_no_evidence=${skippedNoEvidence}`);

    return Response.json({
      success: true,
      slowdown_period: true,
      et_time: nowET.toISOString(),
      et_hour: nowHour,
      total_characters: activeChars.length,
      already_asleep: alreadyAsleep,
      corrected: corrected,
      skipped_verified_exception: skippedException,
      skipped_no_evidence: skippedNoEvidence,
      maria_vanessa_diagnostic: maria || null,
      results,
    });

  } catch (err) {
    console.error('[enforceSlowdownSleep]', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});