/**
 * processScheduledCharacterAlarms
 *
 * Scheduled checker — runs every 5 minutes via automation.
 *
 * For every character with pending_alarm_time <= now (UTC):
 *   - Verify owner_email exists (never use created_by)
 *   - Log diagnostic: character_id, pending_alarm_time, current EST time, sleep state
 *   - If sleeping/napping: wake them, write LifeEvent + CharacterMemory
 *   - Clear pending_alarm_time, write alarm_woke_at + sleep_interrupted_at
 *   - Return processed count and character IDs
 *
 * SAFETY RULES:
 *   - Uses asServiceRole for cross-user scanning (no auth user required)
 *   - owner_email is source of truth — never created_by
 *   - Only characters with pending_alarm_time set are touched
 *   - No other characters are modified
 *   - Legacy characters without newer fields are handled with safe fallbacks
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const nowUtc = new Date();
    const nowIso = nowUtc.toISOString();

    // EST display for diagnostics (UTC-5 standard, UTC-4 daylight — approximate via fixed offset)
    const estOffsetMs = 5 * 60 * 60 * 1000; // EST = UTC-5 (conservative; covers both ET variants for log display only)
    const nowEst = new Date(nowUtc.getTime() - estOffsetMs);
    const estDisplay = nowEst.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

    console.log(`[processScheduledCharacterAlarms] ── RUN START ──`);
    console.log(`[processScheduledCharacterAlarms] UTC now:  ${nowIso}`);
    console.log(`[processScheduledCharacterAlarms] EST now:  ${estDisplay}`);

    // PRIORITY RULE: Alarms MUST NOT yield to foreground activity.
    // A due alarm is Priority 4 — time-sensitive and user-facing.
    // The user may be actively using the app precisely because they are expecting the alarm to fire.
    // No foreground yield check here. Alarms always run.

    // ── FETCH CANDIDATES ──────────────────────────────────────────────────────
    // Pull characters with a pending_alarm_time field set.
    // The field filter is a string comparison — we fetch a broad set and filter in JS
    // to avoid relying on date comparison operators that may not be supported.
    // Cap at 200 to prevent runaway; alarms are user-set so volume will be low.
    const candidates = await base44.asServiceRole.entities.Character.filter(
      { status: 'active' },
      '-pending_alarm_time',
      200
    ).catch(err => {
      console.error(`[processScheduledCharacterAlarms] Failed to fetch candidates: ${err.message}`);
      return [];
    });

    // Filter to characters with a due alarm OR a napping character with an
    // expired stay lock (guaranteed nap completion recovery — catches missed
    // alarms where pending_alarm_time was cleared but the nap lock persists).
    const due = candidates.filter(c => {
      if (!c.owner_email) {
        console.warn(`[processScheduledCharacterAlarms] SKIP ${c.id} (${c.name}) — missing owner_email, cannot verify ownership`);
        return false;
      }
      // Path 1: pending alarm that has passed
      if (c.pending_alarm_time) {
        const alarmTime = new Date(c.pending_alarm_time);
        if (!isNaN(alarmTime.getTime()) && alarmTime <= nowUtc) return true;
      }
      // Path 2: Napping character with expired stay lock (missed alarm recovery)
      if (c.resolved_presence_status === 'napping' && c.presence_stay_lock_expires_at) {
        const expiresAt = new Date(c.presence_stay_lock_expires_at);
        if (!isNaN(expiresAt.getTime()) && expiresAt <= nowUtc) return true;
      }
      return false;
    });

    console.log(`[processScheduledCharacterAlarms] Candidates with pending alarm: ${candidates.filter(c => c.pending_alarm_time).length}`);
    console.log(`[processScheduledCharacterAlarms] Due now (alarm_time <= now): ${due.length}`);

    if (due.length === 0) {
      console.log(`[processScheduledCharacterAlarms] Nothing to process. Done.`);
      return Response.json({ success: true, processed: 0, characters: [] });
    }

    const processed = [];
    const skipped = [];

    for (const character of due) {
      const firstName = (character.name || 'Character').split(' ')[0];
      const presenceStatus = character.resolved_presence_status || character.location_status || '';
      const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';

      // ── DIAGNOSTIC LOG (per character) ─────────────────────────────────────
      console.log(`[processScheduledCharacterAlarms] ── CHARACTER: ${character.name} (${character.id}) ──`);
      console.log(`[processScheduledCharacterAlarms]   owner_email:          ${character.owner_email}`);
      console.log(`[processScheduledCharacterAlarms]   pending_alarm_time:   ${character.pending_alarm_time}`);
      console.log(`[processScheduledCharacterAlarms]   current EST time:     ${estDisplay}`);
      console.log(`[processScheduledCharacterAlarms]   resolved_presence:    ${presenceStatus || '(not set)'}`);
      console.log(`[processScheduledCharacterAlarms]   is_sleeping:          ${isAsleep}`);

      // ── COMPUTE WAKE STATE ─────────────────────────────────────────────────
      let sleepDebtHours = character.sleep_debt_hours || 0;
      const sleepStart = character.last_sleep_start ? new Date(character.last_sleep_start).getTime() : null;
      const wakeTime = character.wake_up_time || '07:00';
      const [wh, wm] = wakeTime.split(':').map(Number);
      const scheduledWake = new Date(nowUtc);
      scheduledWake.setUTCHours(wh + 5, wm, 0, 0); // rough EST→UTC for comparison
      if (scheduledWake < nowUtc) scheduledWake.setUTCDate(scheduledWake.getUTCDate() + 1);

      const minutesEarly = scheduledWake > nowUtc ? Math.round((scheduledWake - nowUtc) / 60000) : 0;
      const isEarlyWake = minutesEarly > 30;

      if (sleepStart && isAsleep) {
        const hoursSlept = (nowUtc.getTime() - sleepStart) / 3600000;
        const neededHours = 7.5;
        if (hoursSlept < neededHours) {
          sleepDebtHours = Math.min(sleepDebtHours + (neededHours - hoursSlept), 24);
        }
      }

      // ── 6-HOUR MINIMUM SLEEP GUARD ─────────────────────────────────────────
      // Canonical rule: normal sleep cannot end before 6 hours unless a verified
      // higher-priority interrupt exists. Energy reaching 100%, chat activity,
      // presence refresh, and background recovery are NOT valid wake authorities.
      // Verified higher-priority interrupts: medical emergency (health ≤ 15).
      // Naps are exempt — naps are short by definition and their scheduled wake
      // at the requested end time is always valid.
      const isNormalSleep = presenceStatus === 'sleeping';
      const isMedicalEmergency = (character.health_value ?? 80) <= 15;
      if (isNormalSleep && sleepStart && !isMedicalEmergency) {
        const elapsedSleepHours = (nowUtc.getTime() - sleepStart) / 3600000;
        if (elapsedSleepHours < 6) {
          // Reschedule the alarm to 6 hours after sleep start. Keep sleeping.
          const rescheduledAlarm = new Date(sleepStart + 6 * 3600000).toISOString();
          try {
            await base44.asServiceRole.entities.Character.update(character.id, {
              pending_alarm_time: rescheduledAlarm,
              resolved_last_updated_at: nowIso,
            });
            console.log(`[processScheduledCharacterAlarms]   6H_GUARD: sleep elapsed ${elapsedSleepHours.toFixed(2)}h < 6h — alarm rescheduled to ${rescheduledAlarm}, character remains sleeping`);
            base44.asServiceRole.entities.SleepTransition.create({
              character_id: character.id, character_name: character.name, owner_email: character.owner_email,
              transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'sleeping',
              authority: 'alarm_reschedule_6h_guard',
              reason: `Alarm fired after ${elapsedSleepHours.toFixed(2)}h sleep — rescheduled to 6h boundary. No verified higher-priority interrupt.`,
              timestamp: nowIso, state_start_ref: character.last_sleep_start,
              elapsed_hours: Math.round(elapsedSleepHours * 100) / 100,
              verified_higher_priority_interrupt: false,
            }).catch(() => {});
            skipped.push({ character_id: character.id, reason: '6h_sleep_minimum_guard_active', rescheduled_alarm: rescheduledAlarm });
          } catch (guardErr) {
            console.error(`[processScheduledCharacterAlarms]   6H_GUARD update FAILED: ${guardErr.message}`);
            skipped.push({ character_id: character.id, reason: `6h_guard_failed: ${guardErr.message}` });
          }
          continue;
        }
      }

      const newEmotionalState = (isEarlyWake || sleepDebtHours > 2) ? 'tired' : 'calm';
      const activityNote = isEarlyWake
        ? 'just woke up (scheduled alarm, earlier than usual)'
        : 'just woke up (scheduled alarm)';

      // ── WRITE CHARACTER UPDATE ──────────────────────────────────────────────
      const updatePayload = {
        pending_alarm_time: null,        // clear — alarm has fired
        alarm_woke_at: nowIso,           // audit trail
        sleep_interrupted_at: nowIso,    // continuity field
        resolved_last_updated_at: nowIso,
      };

      if (isAsleep) {
        // Only update presence fields if actually sleeping — don't override awake characters
        updatePayload.resolved_presence_status = 'home';
        updatePayload.location_status = 'home';
        updatePayload.current_activity = activityNote;
        updatePayload.emotional_state = newEmotionalState;
        updatePayload.sleep_debt_hours = Math.round(sleepDebtHours * 10) / 10;
        // Alarm wake from actual sleep — write last_wake_time for 19h awake enforcement
        updatePayload.last_wake_time = nowIso;
        // ── CLEAR STAY LOCK on wake ──────────────────────────────────────
        // The stay lock was set by scheduleNap (reason: 'nap_state') or by the
        // sleep/pass-out system. Once the character wakes, the lock has no
        // purpose. Failure to clear it leaves the character permanently locked.
        updatePayload.presence_stay_lock = false;
        updatePayload.presence_stay_lock_reason = null;
        updatePayload.presence_stay_lock_release_condition = null;
        updatePayload.presence_stay_lock_authority = null;
        updatePayload.presence_stay_lock_set_at = null;
        updatePayload.presence_stay_lock_expires_at = null;
        // Record the authoritative wake transition in the audit entity
        base44.asServiceRole.entities.SleepTransition.create({
          character_id: character.id, character_name: character.name, owner_email: character.owner_email,
          transition_type: presenceStatus === 'napping' ? 'nap_end' : 'sleep_end',
          from_status: presenceStatus, to_status: 'home',
          authority: 'scheduled_alarm',
          reason: isMedicalEmergency ? 'Medical emergency wake (health ≤ 15)' : (isEarlyWake ? 'Scheduled alarm (earlier than usual)' : 'Scheduled alarm'),
          timestamp: nowIso,
          state_start_ref: presenceStatus === 'napping' ? character.last_nap_time : character.last_sleep_start,
          elapsed_hours: presenceStatus === 'napping' && character.last_nap_time
            ? Math.round(((nowUtc.getTime() - new Date(character.last_nap_time).getTime()) / 3600000) * 100) / 100
            : (sleepStart ? Math.round(((nowUtc.getTime() - sleepStart) / 3600000) * 100) / 100 : null),
          verified_higher_priority_interrupt: isMedicalEmergency,
          interrupt_reason: isMedicalEmergency ? 'health_critical_15' : null,
        }).catch(() => {});
      }

      try {
        await base44.asServiceRole.entities.Character.update(character.id, updatePayload);

        const woke = isAsleep;
        console.log(`[processScheduledCharacterAlarms]   woke_up:              ${woke}`);
        console.log(`[processScheduledCharacterAlarms]   pending_alarm_cleared: true`);
        console.log(`[processScheduledCharacterAlarms]   new_presence:         ${woke ? 'home' : presenceStatus}`);
        console.log(`[processScheduledCharacterAlarms]   emotional_state:      ${woke ? newEmotionalState : '(unchanged)'}`);

        // ── LIFE EVENT (wake only) ────────────────────────────────────────────
        if (woke) {
          const timeLabel = nowEst.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          base44.asServiceRole.entities.LifeEvent.create({
            character_id: character.id,
            character_name: character.name,
            event_type: 'routine_positive_event',
            valence: isEarlyWake ? 'mixed' : 'neutral',
            severity: 'minor',
            title: `Scheduled alarm went off at ${timeLabel}`,
            description: isEarlyWake
              ? `${character.name}'s alarm woke them up earlier than their usual schedule. They got up feeling groggy.`
              : `${character.name}'s scheduled alarm went off and they woke up to start their day.`,
            emotional_impact: isEarlyWake ? 'Tired, groggy from early wake' : 'Awake and starting their routine',
            triggered_by: 'scheduled_event',
            timestamp: nowIso,
            systems_updated: ['memory'],
            context_tags: ['alarm', 'scheduled_alarm', 'wake_up', isEarlyWake ? 'early_wake' : 'on_schedule'],
          }).catch(err => console.warn(`[processScheduledCharacterAlarms]   LifeEvent write failed: ${err.message}`));

          // ── CHARACTER MEMORY ──────────────────────────────────────────────
          base44.asServiceRole.entities.CharacterMemory.create({
            character_id: character.id,
            memory_type: 'event',
            memory_text: `My alarm went off at ${timeLabel}${isEarlyWake ? ' — earlier than usual. Felt groggy.' : '. Got up and started the day.'}`,
            memory_summary: `scheduled_alarm_fired::${nowIso}`,
            importance_score: 2,
            permanence: 'short_term',
          }).catch(err => console.warn(`[processScheduledCharacterAlarms]   CharacterMemory write failed: ${err.message}`));
        } else {
          // Character had an alarm set but was already awake — just clear it, log it
          base44.asServiceRole.entities.CharacterMemory.create({
            character_id: character.id,
            memory_type: 'event',
            memory_text: `My scheduled alarm went off at ${estDisplay} — I was already awake.`,
            memory_summary: `scheduled_alarm_already_awake::${nowIso}`,
            importance_score: 1,
            permanence: 'short_term',
          }).catch(() => {});

          console.log(`[processScheduledCharacterAlarms]   NOTE: Character was already awake — alarm cleared, no presence change`);
        }

        processed.push({
          character_id: character.id,
          character_name: character.name,
          owner_email: character.owner_email,
          pending_alarm_time: character.pending_alarm_time,
          was_sleeping: isAsleep,
          woke_up: woke,
          pending_alarm_cleared: true,
          is_early_wake: isEarlyWake,
          new_emotional_state: woke ? newEmotionalState : null,
        });

      } catch (updateErr) {
        console.error(`[processScheduledCharacterAlarms]   ❌ Update FAILED for ${character.id}: ${updateErr.message}`);
        skipped.push({ character_id: character.id, reason: updateErr.message });
      }
    }

    console.log(`[processScheduledCharacterAlarms] ── RUN COMPLETE ──`);
    console.log(`[processScheduledCharacterAlarms] Processed: ${processed.length} | Skipped: ${skipped.length}`);

    return Response.json({
      success: true,
      run_at_utc: nowIso,
      run_at_est: estDisplay,
      processed: processed.length,
      skipped: skipped.length,
      characters: processed,
      skipped_details: skipped,
    });

  } catch (error) {
    console.error('[processScheduledCharacterAlarms] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});