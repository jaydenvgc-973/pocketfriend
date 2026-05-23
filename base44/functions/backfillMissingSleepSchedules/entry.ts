/**
 * backfillMissingSleepSchedules
 *
 * Finds all NPC/family/non-active-created characters owned by the calling user
 * that are missing sleep_start_time or wake_up_time, assigns the safe default
 * (23:00–07:00), and immediately corrects their resolved_presence_status to
 * "sleeping" if the current ET time is within the overnight slowdown window (midnight–6 AM)
 * and no verified exception exists.
 *
 * NEVER:
 * - applies to active_created_character (autonomous sleep — must keep its own rhythm)
 * - overwrites existing valid sleep schedules
 * - changes location, roster, category, memories, finances, or relationships
 * - uses created_by
 * - hardcodes character IDs
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isInSleepWindow(sleepStart, wakeUp, nowMin) {
  const s = toMinutes(sleepStart);
  const w = toMinutes(wakeUp);
  if (s === null || w === null) return false;
  if (s > w) return nowMin >= s || nowMin < w;
  return nowMin >= s && nowMin < w;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowHour = nowET.getHours();
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const isSlowdown = nowHour >= 0 && nowHour < 6;

    const DEFAULT_SLEEP = '23:00';
    const DEFAULT_WAKE = '07:00';

    // Fetch all non-active characters owned by this user
    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, null, 200);
    const eligible = allChars.filter(c => {
      if (c.status === 'deleted' || c.status === 'soft_deleted' || c.status === 'moved_away' || c.status === 'merged') return false;
      // Active created characters manage their own sleep rhythm — do not touch
      if (c.character_type === 'active_created_character') return false;
      return true;
    });

    const results = [];
    let backfilled = 0;
    let correctedToSleep = 0;
    let alreadyHadSchedule = 0;
    let alreadyAsleep = 0;

    for (const char of eligible) {
      const hasSleepStart = !!char.sleep_start_time;
      const hasWakeUp = !!char.wake_up_time;
      const needsBackfill = !hasSleepStart || !hasWakeUp;

      const entry = {
        id: char.id,
        name: char.name,
        character_type: char.character_type || 'untyped',
        status_before: char.resolved_presence_status || 'unknown',
        status_after: null,
        location: char.resolved_current_location_name || char.resolved_current_location_id || null,
        location_preserved: true,
        sleep_start_before: char.sleep_start_time || null,
        wake_up_before: char.wake_up_time || null,
        sleep_start_after: null,
        wake_up_after: null,
        backfilled: false,
        corrected_to_sleep: false,
        already_asleep: false,
        already_had_schedule: !needsBackfill,
        exception_found: null,
        readback_status: null,
        readback_sleep_start: null,
        readback_wake_up: null,
      };

      // Already asleep — no action needed
      const currentStatus = char.resolved_presence_status || '';
      if (currentStatus === 'sleeping' || currentStatus === 'napping') {
        entry.already_asleep = true;
        entry.status_after = currentStatus;
        entry.sleep_start_after = char.sleep_start_time;
        entry.wake_up_after = char.wake_up_time;
        alreadyAsleep++;

        // Still backfill sleep fields if missing, even if already asleep
        if (needsBackfill) {
          const patch = {};
          if (!hasSleepStart) patch.sleep_start_time = DEFAULT_SLEEP;
          if (!hasWakeUp) patch.wake_up_time = DEFAULT_WAKE;
          if (char.sleep_debt_hours === undefined || char.sleep_debt_hours === null) patch.sleep_debt_hours = 0;
          await base44.entities.Character.update(char.id, patch);
          entry.backfilled = true;
          entry.sleep_start_after = patch.sleep_start_time || char.sleep_start_time;
          entry.wake_up_after = patch.wake_up_time || char.wake_up_time;
          backfilled++;
        }
        results.push(entry);
        continue;
      }

      // Check verified exception
      if (char.is_jailed) { entry.exception_found = 'incarcerated'; entry.status_after = currentStatus; results.push(entry); continue; }
      if (char.house_arrest_active) { entry.exception_found = 'house_arrest'; entry.status_after = currentStatus; results.push(entry); continue; }
      if (currentStatus === 'at_work') { entry.exception_found = 'at_work'; entry.status_after = currentStatus; results.push(entry); continue; }
      if (currentStatus === 'at_school') { entry.exception_found = 'at_school'; entry.status_after = currentStatus; results.push(entry); continue; }
      if (char.decided_to_stay_up_until && new Date(char.decided_to_stay_up_until) > nowET) {
        entry.exception_found = 'explicit_awake_override'; entry.status_after = currentStatus; results.push(entry); continue;
      }

      // Build the patch — backfill sleep fields if missing
      const patch = {};
      if (!hasSleepStart) patch.sleep_start_time = DEFAULT_SLEEP;
      if (!hasWakeUp) patch.wake_up_time = DEFAULT_WAKE;
      if (char.sleep_debt_hours === undefined || char.sleep_debt_hours === null) patch.sleep_debt_hours = 0;

      const effectiveSleepStart = patch.sleep_start_time || char.sleep_start_time;
      const effectiveWakeUp = patch.wake_up_time || char.wake_up_time;

      // If in slowdown and within sleep window (using effective schedule), correct to sleeping
      const inWindow = isSlowdown && isInSleepWindow(effectiveSleepStart, effectiveWakeUp, nowMin);
      if (inWindow) {
        patch.resolved_presence_status = 'sleeping';
        patch.resolved_source_reason = needsBackfill ? 'npc_schedule_backfill_sleep' : 'npc_schedule_window';
        patch.resolved_last_updated_at = nowET.toISOString();
      }

      if (Object.keys(patch).length > 0) {
        await base44.entities.Character.update(char.id, patch);
        if (needsBackfill) backfilled++;
        if (patch.resolved_presence_status === 'sleeping') correctedToSleep++;
      } else {
        alreadyHadSchedule++;
      }

      // Readback proof
      const rb = await base44.entities.Character.filter({ id: char.id }, null, 1).then(r => r[0]);
      entry.backfilled = needsBackfill;
      entry.corrected_to_sleep = !!patch.resolved_presence_status;
      entry.sleep_start_after = rb?.sleep_start_time || null;
      entry.wake_up_after = rb?.wake_up_time || null;
      entry.status_after = rb?.resolved_presence_status || null;
      entry.readback_status = rb?.resolved_presence_status || null;
      entry.readback_sleep_start = rb?.sleep_start_time || null;
      entry.readback_wake_up = rb?.wake_up_time || null;
      entry.location_preserved = (rb?.resolved_current_location_id === char.resolved_current_location_id);

      results.push(entry);
    }

    console.log(`[backfillMissingSleepSchedules] eligible=${eligible.length} backfilled=${backfilled} corrected_to_sleep=${correctedToSleep} already_asleep=${alreadyAsleep} already_had_schedule=${alreadyHadSchedule}`);

    return Response.json({
      success: true,
      et_time: nowET.toISOString(),
      et_hour: nowHour,
      slowdown_period: isSlowdown,
      eligible_count: eligible.length,
      backfilled,
      corrected_to_sleep: correctedToSleep,
      already_asleep: alreadyAsleep,
      already_had_schedule: alreadyHadSchedule,
      results,
    });

  } catch (err) {
    console.error('[backfillMissingSleepSchedules]', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});