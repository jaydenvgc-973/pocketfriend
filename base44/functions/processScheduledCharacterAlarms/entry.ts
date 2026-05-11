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

    // Filter to only those with a pending_alarm_time that has passed
    const due = candidates.filter(c => {
      if (!c.pending_alarm_time) return false;
      if (!c.owner_email) {
        // Legacy character without owner_email — skip, do not modify
        console.warn(`[processScheduledCharacterAlarms] SKIP ${c.id} (${c.name}) — missing owner_email, cannot verify ownership`);
        return false;
      }
      const alarmTime = new Date(c.pending_alarm_time);
      if (isNaN(alarmTime.getTime())) {
        console.warn(`[processScheduledCharacterAlarms] SKIP ${c.id} (${c.name}) — invalid pending_alarm_time: ${c.pending_alarm_time}`);
        return false;
      }
      return alarmTime <= nowUtc;
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