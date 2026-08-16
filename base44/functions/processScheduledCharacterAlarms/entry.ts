import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * processScheduledCharacterAlarms — RECURRING DAILY ALARM SCANNER
 *
 * Runs on a recurring scheduled automation (interval > 2h). Each run scans all
 * active characters with a due pending_alarm_time (<= now) and fires the alarm
 * through the established authorized wake authority (enforceCharacterLocationPresence).
 *
 * Daily recurrence: after firing (or skipping an already-awake character), the
 * alarm is rescheduled to the SAME configured local (Eastern) time on the following
 * day. This makes the alarm a recurring daily alarm WITHOUT per-occurrence one-time
 * automation registration, WITHOUT 5-minute polling, and WITHOUT entity-update
 * triggers. A Character record changing is not what makes the alarm time arrive —
 * the recurring scheduled automation is.
 *
 * Validation per due alarm (re-read before wake to handle cancel/replace races):
 *   - character still has pending_alarm_time matching the due alarm (not cancelled/replaced)
 *   - character is asleep (sleeping/napping) → commit wake via the authority
 *   - character already awake → no wake, just reschedule to next day
 *
 * Replacement/reschedule safety: if the user changed or cancelled the alarm between
 * the batch load and processing, the re-read detects the mismatch and skips — a
 * replaced/cancelled alarm cannot wake the character from this invocation.
 *
 * The authorized wake itself goes through enforceCharacterLocationPresence, which
 * owns canonical presence, stay-lock release, and last_wake_time — preserving the
 * existing wake-race protections. This function does not write canonical wake state
 * directly.
 */

// ── Eastern-Time-aware next-day reschedule (handles DST) ────────────────────
// toLocaleString/toLocaleTimeString with timeZone works in the Deno sandbox;
// Intl.DateTimeFormat.formatToParts with timeZone does NOT.
function etHourMinute(iso) {
  const s = new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = s.split(':');
  return [parseInt(parts[0], 10) % 24, parseInt(parts[1], 10) || 0];
}

function nextDaySameET(alarmIso) {
  const orig = new Date(alarmIso);
  const plus24 = new Date(orig.getTime() + 24 * 3600 * 1000);
  const [oH, oM] = etHourMinute(orig.toISOString());
  const [pH, pM] = etHourMinute(plus24.toISOString());
  if (oH === pH && oM === pM) return plus24.toISOString();
  // DST transition shifted the ET wall time — adjust ±1h to restore it.
  for (const delta of [3600 * 1000, -3600 * 1000]) {
    const adj = new Date(plus24.getTime() + delta);
    const [aH, aM] = etHourMinute(adj.toISOString());
    if (aH === oH && aM === oM) return adj.toISOString();
  }
  return plus24.toISOString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled execution */ }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Load all active characters (service role for system-wide scan).
    let allChars = [];
    try {
      allChars = await base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500);
    } catch {
      allChars = await base44.entities.Character.filter({ status: 'active' }, null, 500);
    }

    // Characters with a due pending_alarm_time (<= now).
    const dueAlarms = allChars.filter(c =>
      c.pending_alarm_time &&
      new Date(c.pending_alarm_time).getTime() <= nowMs
    );

    const results = [];
    let firedCount = 0;

    for (const char of dueAlarms) {
      const alarmTime = char.pending_alarm_time;
      const nextDayIso = nextDaySameET(alarmTime);

      // Re-read to verify the alarm is still current (not cancelled/replaced
      // between the batch load and this processing step).
      let current = null;
      try {
        const re = await base44.asServiceRole.entities.Character.filter(
          { id: char.id, owner_email: char.owner_email }, null, 1
        );
        current = re?.[0] || null;
      } catch { current = char; }
      const currentAlarm = current?.pending_alarm_time;
      if (!currentAlarm || currentAlarm !== alarmTime) {
        results.push({ character_id: char.id, character_name: char.name, event: 'alarm_no_longer_current', current_alarm: currentAlarm || null });
        continue;
      }

      const presenceStatus = current.resolved_presence_status || '';
      const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';

      // Already awake → reschedule to next day, no wake.
      if (!isAsleep) {
        try {
          await base44.asServiceRole.entities.Character.update(char.id, {
            pending_alarm_time: nextDayIso,
            alarm_woke_at: nowIso,
            resolved_last_updated_at: nowIso,
          });
        } catch (e) { console.warn(`[processScheduledCharacterAlarms] awake reschedule failed: ${e.message}`); }
        results.push({ character_id: char.id, character_name: char.name, event: 'already_awake_rescheduled', next_alarm_time: nextDayIso });
        continue;
      }

      // Asleep and due → commit wake through the authorized wake authority.
      let authRes = null;
      try {
        const ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
          character_id: char.id,
          owner_email: char.owner_email,
          requested_presence_status: 'home',
          requested_source_reason: presenceStatus === 'napping' ? 'scheduled_nap_end_alarm' : 'scheduled_alarm_wake',
          requested_authority: 'processScheduledCharacterAlarms',
          requested_timestamp: nowIso,
        });
        authRes = ir?.data || ir;
      } catch (invokeErr) {
        results.push({ character_id: char.id, character_name: char.name, error: 'authority_invoke_failed', reason: invokeErr.message });
        continue;
      }

      if (authRes?.disposition !== 'accepted' || !authRes?.committed_result) {
        results.push({ character_id: char.id, character_name: char.name, event: 'wake_not_committed', disposition: authRes?.disposition, reason: authRes?.reason });
        continue;
      }

      const committed = authRes.committed_result;
      const committedPresence = committed.resolved_presence_status || 'home';

      // Reschedule to next day (daily recurrence). Only write alarm state + activity.
      // Canonical wake state (presence, last_wake_time, sleep_interrupted_at) was
      // committed by enforceCharacterLocationPresence above — do not overwrite it.
      await base44.asServiceRole.entities.Character.update(char.id, {
        pending_alarm_time: nextDayIso,
        alarm_woke_at: nowIso,
        current_activity: 'just woke up (scheduled alarm)',
      }).catch((e) => console.warn(`[processScheduledCharacterAlarms] reschedule failed: ${e.message}`));

      // Authoritative transition record — from the committed result.
      const stateStartRef = presenceStatus === 'napping' ? current.last_nap_time : current.last_sleep_start;
      const elapsedHours = stateStartRef
        ? Math.round(((nowMs - new Date(stateStartRef).getTime()) / 3600000) * 100) / 100
        : null;
      try {
        await base44.asServiceRole.entities.SleepTransition.create({
          character_id: char.id, character_name: char.name, owner_email: char.owner_email,
          transition_type: presenceStatus === 'napping' ? 'nap_end' : 'sleep_end',
          from_status: presenceStatus, to_status: committedPresence,
          authority: 'scheduled_alarm',
          reason: presenceStatus === 'napping' ? 'Scheduled nap-end alarm fired.' : 'Scheduled daily alarm fired.',
          timestamp: nowIso, state_start_ref: stateStartRef, elapsed_hours: elapsedHours,
          verified_higher_priority_interrupt: false,
        });
      } catch (transitionError) {
        console.warn(`[processScheduledCharacterAlarms] transition record failed: ${transitionError.message}`);
      }

      // Life event + memory.
      const timeLabel = new Date(nowIso).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
      });
      try {
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: char.id, character_name: char.name,
          event_type: 'routine_positive_event', valence: 'neutral', severity: 'minor',
          title: `Alarm went off at ${timeLabel}`,
          description: `${char.name}'s scheduled alarm went off and they woke up.`,
          emotional_impact: 'Awake and starting their routine',
          triggered_by: 'scheduled_event', timestamp: nowIso,
          systems_updated: ['memory'],
          context_tags: ['alarm', 'scheduled_alarm', 'wake_up', presenceStatus === 'napping' ? 'nap_end' : 'sleep_end'],
        });
      } catch (e) { console.warn(`[processScheduledCharacterAlarms] life event failed: ${e.message}`); }
      try {
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: char.id, memory_type: 'event',
          memory_text: `My alarm went off at ${timeLabel}. Got up and started the day.`,
          memory_summary: `scheduled_alarm_fired::${nowIso}`,
          importance_score: 2, permanence: 'short_term',
        });
      } catch (e) { console.warn(`[processScheduledCharacterAlarms] memory failed: ${e.message}`); }

      firedCount++;
      results.push({ character_id: char.id, character_name: char.name, event: 'alarm_fired', from_status: presenceStatus, to_status: committedPresence, next_alarm_time: nextDayIso });
    }

    return Response.json({
      success: true, scanned: allChars.length, due: dueAlarms.length, fired: firedCount, results,
    });
  } catch (error) {
    console.error('[processScheduledCharacterAlarms] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});