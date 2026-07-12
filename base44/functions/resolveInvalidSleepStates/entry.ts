import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * resolveInvalidSleepStates
 *
 * Global repair: clears INVALID sleep/napping states for active_created_characters.
 *
 * An invalid sleep state is one where:
 *   - resolved_presence_status = 'sleeping' but the character is OUTSIDE their valid
 *     [sleep_start_time, wake_up_time] window, OR the 8-hour ordinary cap is exceeded
 *     with no valid recovery reason, OR a work/school blocker is active.
 *   - resolved_presence_status = 'napping' but no last_nap_time exists, OR the 3-hour
 *     nap cap is exceeded, OR a work/school blocker is active.
 *
 * For invalid states:
 *   - Set resolved_presence_status to the correct awake state ('home' when at home,
 *     'at_work' when on shift, 'at_school' when in school window).
 *   - Clear sleep current_activity text.
 *   - Preserve resolved_current_location_id / resolved_current_location_name.
 *   - Do NOT create fake sleep_end/nap_end records — no valid sleep was in progress.
 *
 * For valid states:
 *   - Sleeping inside window with < 8h elapsed → SKIP (legitimate sleep preserved).
 *   - Sleeping past 8h cap → WAKE with a real sleep_end SleepTransition (valid sleep_start
 *     existed; this is a legitimate cap wake, not a fake record).
 *
 * Applies to active_created_character only. NPCs are untouched.
 * No character-specific exceptions. No fixtures. No new authorities.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();
    const toMin = (t: string | null): number | null => {
      if (!t) return null;
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    };

    const allChars = await base44.asServiceRole.entities.Character.list(null, 500);
    const candidates = allChars.filter((c: any) =>
      c.character_type === 'active_created_character' &&
      c.status === 'active' &&
      (c.resolved_presence_status === 'sleeping' || c.resolved_presence_status === 'napping')
    );

    const repairs: any[] = [];
    const preserved: any[] = [];
    const capWakes: any[] = [];

    for (const c of candidates) {
      const status = c.resolved_presence_status;
      const sleepStartMin = toMin(c.sleep_start_time);
      const wakeMin = toMin(c.wake_up_time);

      // Work blocker
      let workBlocker = false;
      if (c.work_start_time && c.work_end_time && Array.isArray(c.work_days) && c.work_days.includes(dayOfWeek)) {
        const ws = toMin(c.work_start_time);
        const we = toMin(c.work_end_time);
        if (ws !== null && we !== null) {
          workBlocker = we < ws ? (nowMin >= ws || nowMin < we) : (nowMin >= ws && nowMin < we);
        }
      }

      // School blocker
      let schoolBlocker = false;
      if (c.student_status === 'enrolled' && c.education_location_id && [1,2,3,4,5].includes(dayOfWeek)) {
        const enrolls = c.education_enrollments;
        if (Array.isArray(enrolls) && enrolls.length > 0) {
          const active = enrolls.find((e: any) => e.status === 'active' && e.start_time && e.end_time);
          if (active) {
            const ss = toMin(active.start_time);
            const se = toMin(active.end_time);
            if (ss !== null && se !== null && nowMin >= ss && nowMin < se) schoolBlocker = true;
          }
        }
      }

      if (status === 'sleeping') {
        // Inside window?
        let insideWindow = false;
        if (sleepStartMin !== null && wakeMin !== null) {
          insideWindow = sleepStartMin > wakeMin
            ? (nowMin >= sleepStartMin || nowMin < wakeMin)
            : (nowMin >= sleepStartMin && nowMin < wakeMin);
        }

        // Sleep duration from last_sleep_start (correct clock)
        let sleepDurationH = null;
        if (c.last_sleep_start) {
          sleepDurationH = (now.getTime() - new Date(c.last_sleep_start).getTime()) / 3600000;
        }

        // VALID sleep — preserve if last_sleep_start proves recent sleep onset (< 8h)
        // regardless of whether sleep_start_time/wake_up_time metadata is set.
        // last_sleep_start is the authoritative sleep timer; schedule metadata is secondary.
        if (sleepDurationH !== null && sleepDurationH < 8 && !workBlocker && !schoolBlocker) {
          preserved.push({ id: c.id, name: c.name, reason: insideWindow ? 'valid_in_window_under_cap' : 'valid_last_sleep_start_under_cap_no_schedule' });
          continue;
        }

        // 8h cap exceeded — legitimate wake with real sleep_end record
        if (sleepDurationH !== null && sleepDurationH >= 8) {
          const update: any = {
            resolved_presence_status: 'home',
            current_activity: null,
            last_wake_time: now.toISOString(),
          };
          // CONDITIONAL CLAIM: only wake if character is still sleeping
          await base44.asServiceRole.entities.Character.updateMany(
            { id: c.id, resolved_presence_status: 'sleeping' },
            { $set: update }
          );
          // Read-back verification: confirm this invocation won the claim
          const _capWakeVerify = (await base44.asServiceRole.entities.Character.filter({ id: c.id }, null, 1))?.[0];
          if (!_capWakeVerify || _capWakeVerify.last_wake_time !== now.toISOString()) {
            console.log(`[resolveInvalidSleepStates] CLAIM_LOST: concurrent writer already woke ${c.name}`);
            continue;
          }
          // Real sleep_end — valid sleep_start existed
          await base44.asServiceRole.entities.SleepTransition.create({
            character_id: c.id,
            character_name: c.name,
            owner_email: c.owner_email,
            transition_type: 'sleep_end',
            from_status: 'sleeping',
            to_status: 'home',
            authority: 'sleep_cap_8h',
            reason: `8h ordinary sleep cap reached. Slept ${Math.round(sleepDurationH*10)/10}h from ${c.last_sleep_start}.`,
            timestamp: now.toISOString(),
            state_start_ref: c.last_sleep_start,
            elapsed_hours: Math.round(sleepDurationH * 100) / 100,
            verified_higher_priority_interrupt: false,
          });
          capWakes.push({ id: c.id, name: c.name, sleptHours: Math.round(sleepDurationH*10)/10 });
          continue;
        }

        // INVALID sleep — outside window, blocker, or no last_sleep_start
        const awakeStatus = workBlocker ? 'at_work' : schoolBlocker ? 'at_school' : 'home';
        const update: any = {
          resolved_presence_status: awakeStatus,
          current_activity: null,
        };
        // Preserve location — only override if home to ensure consistency
        if (awakeStatus === 'home' && c.current_home_location_id) {
          update.resolved_current_location_id = c.current_home_location_id;
        }
        await base44.asServiceRole.entities.Character.update(c.id, update);
        repairs.push({
          id: c.id,
          name: c.name,
          was: 'sleeping',
          now: awakeStatus,
          reason: !insideWindow ? 'outside_sleep_window' : workBlocker ? 'work_blocker' : schoolBlocker ? 'school_blocker' : 'no_last_sleep_start',
        });
        continue;
      }

      if (status === 'napping') {
        // Nap duration from last_nap_time (correct clock)
        let napDurationH = null;
        if (c.last_nap_time) {
          napDurationH = (now.getTime() - new Date(c.last_nap_time).getTime()) / 3600000;
        }

        // VALID nap — preserve
        if (napDurationH !== null && napDurationH < 3 && !workBlocker && !schoolBlocker) {
          preserved.push({ id: c.id, name: c.name, reason: 'valid_nap_under_cap' });
          continue;
        }

        // INVALID nap — no last_nap_time, past 3h cap, or blocker
        const awakeStatus = workBlocker ? 'at_work' : schoolBlocker ? 'at_school' : 'home';
        const update: any = {
          resolved_presence_status: awakeStatus,
          current_activity: null,
        };
        if (awakeStatus === 'home' && c.current_home_location_id) {
          update.resolved_current_location_id = c.current_home_location_id;
        }
        await base44.asServiceRole.entities.Character.update(c.id, update);
        repairs.push({
          id: c.id,
          name: c.name,
          was: 'napping',
          now: awakeStatus,
          reason: napDurationH === null ? 'no_last_nap_time' : napDurationH >= 3 ? 'nap_cap_3h_exceeded' : 'blocker',
        });
        continue;
      }
    }

    return Response.json({
      success: true,
      scanned: candidates.length,
      invalid_cleared: repairs.length,
      cap_wakes: capWakes.length,
      preserved_valid: preserved.length,
      repairs,
      capWakes,
      preserved,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});