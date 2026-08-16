import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * processScheduledCharacterAlarms — USER-SET ALARM EXECUTION
 *
 * RESTORED regression behavior. pending_alarm_time is a USER-SET ALARM for
 * a specific character at a specific Eastern time — NOT a recurring daily
 * schedule. When the alarm time arrives, this function invokes the existing
 * authorized wake pipeline (enforceCharacterLocationPresence) for that
 * character, then CLEARS pending_alarm_time (one-time alarm, not recurring).
 *
 * Three distinct wake mechanisms (all converging on the existing authority):
 *   1. NORMAL sleep/wake — independent of pending_alarm_time (6-8h, handled
 *      by enforceWakeTimeBoundary 8h cap + simulateActiveCharacterNeeds).
 *   2. USER-SET ALARM — pending_alarm_time, fired by this function.
 *   3. RING NOW — characterAlarm ring_now, immediate wake, clears alarm.
 *
 * 6-hour minimum-sleep guard: if the character has slept less than 6 hours
 * and there is no verified higher-priority interrupt (medical emergency
 * health <= 15), the alarm is rescheduled to the 6-hour boundary instead
 * of firing. This protects the established 6-8 hour normal sleep duration.
 * The guard is a sleep-duration protection, NOT an alarm cadence.
 *
 * Canonical-field safety: the wake authority owns canonical presence,
 * stay-lock, and last_wake_time. This function writes ONLY alarm-owned
 * state (pending_alarm_time, alarm_woke_at, current_activity).
 *
 * Invocation: per-character from enforceWakeTimeBoundary (the existing 5-min
 * cron) when pending_alarm_time is due, OR standalone for testing/manual use.
 */

function etHourMinute(iso) {
  const s = new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = s.split(':');
  return [parseInt(parts[0], 10) % 24, parseInt(parts[1], 10) || 0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled execution */ }

    let body = {};
    try { body = await req.json(); } catch { /* no body */ }
    const singleCharacterId = body.character_id || null;
    const occurrenceTime = body.occurrence_time || null;
    const testCharacterIds = Array.isArray(body.test_character_ids) ? body.test_character_ids : null;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // ── PER-CHARACTER MODE: process one character ───────────────────────
    if (singleCharacterId) {
      const result = await processOneCharacter(base44, singleCharacterId, nowMs, nowIso, occurrenceTime);
      return Response.json({ success: true, ...result });
    }

    // ── SCANNER MODE: load all characters (for testing/manual use) ───────
    let allChars = [];
    try {
      allChars = await base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500);
    } catch {
      allChars = await base44.entities.Character.filter({ status: 'active' }, null, 500);
    }

    let eligibleChars = allChars;
    if (testCharacterIds) {
      eligibleChars = allChars.filter(c => testCharacterIds.includes(c.id));
    }

    const dueAlarms = eligibleChars.filter(c =>
      c.pending_alarm_time &&
      new Date(c.pending_alarm_time).getTime() <= nowMs
    );

    const results = [];
    let firedCount = 0;
    for (const char of dueAlarms) {
      const r = await processOneCharacter(base44, char.id, nowMs, nowIso, null);
      results.push({ character_id: char.id, character_name: char.name, ...r });
      if (r.event === 'alarm_fired') firedCount++;
    }

    return Response.json({
      success: true, scanned: eligibleChars.length, due: dueAlarms.length, fired: firedCount, results,
    });
  } catch (error) {
    console.error('[processScheduledCharacterAlarms] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

// ── PER-CHARACTER PROCESSING ─────────────────────────────────────────────
async function processOneCharacter(base44, characterId, nowMs, nowIso, occurrenceTime) {
  // Load THIS character only.
  let char = null;
  try {
    const list = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    char = list?.[0] || null;
  } catch { /* fall through */ }
  if (!char) {
    try {
      const list2 = await base44.entities.Character.filter({ id: characterId }, null, 1);
      char = list2?.[0] || null;
    } catch { /* not found */ }
  }
  if (!char) return { event: 'character_not_found' };

  const alarmTime = char.pending_alarm_time;
  if (!alarmTime) return { event: 'no_alarm' };

  // ── OCCURRENCE VALIDATION ────────────────────────────────────────────
  // When invoked by a one-time scheduled automation, occurrence_time is
  // supplied. Validate that the current pending_alarm_time still matches
  // the occurrence that triggered this execution. If the alarm was changed
  // or cancelled after this occurrence was registered, the times will not
  // match and we exit without waking.
  if (occurrenceTime) {
    const currentMs = new Date(alarmTime).getTime();
    const occurrenceMs = new Date(occurrenceTime).getTime();
    if (currentMs !== occurrenceMs) {
      return {
        event: 'occurrence_mismatch',
        current_pending_alarm_time: alarmTime,
        occurrence_time: occurrenceTime,
        reason: 'Alarm was changed or cancelled after this occurrence was registered.',
      };
    }
  }

  if (new Date(alarmTime).getTime() > nowMs) return { event: 'alarm_not_yet_due', pending_alarm_time: alarmTime };

  const presenceStatus = char.resolved_presence_status || '';
  const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';

  // Already awake → clear the alarm (one-time alarm, no recurrence).
  if (!isAsleep) {
    try {
      await base44.asServiceRole.entities.Character.update(characterId, {
        pending_alarm_time: null,
        alarm_woke_at: nowIso,
      });
    } catch (e) { console.warn(`[processScheduledCharacterAlarms] awake clear failed: ${e.message}`); }
    return { event: 'already_awake_cleared' };
  }

  // ── 6-HOUR MINIMUM-SLEEP GUARD ──────────────────────────────────────
  const sleepStart = char.last_sleep_start ? new Date(char.last_sleep_start).getTime() : null;
  const isMedicalEmergency = (char.health_value ?? 80) <= 15;
  if (sleepStart && !isMedicalEmergency) {
    const elapsedSleepHours = (nowMs - sleepStart) / 3600000;
    if (elapsedSleepHours < 6) {
      const sixHourBoundaryIso = new Date(sleepStart + 6 * 3600000).toISOString();
      try {
        await base44.asServiceRole.entities.Character.update(characterId, {
          pending_alarm_time: sixHourBoundaryIso,
        });
      } catch (e) { console.warn(`[processScheduledCharacterAlarms] 6h guard reschedule failed: ${e.message}`); }
      try {
        await base44.asServiceRole.entities.SleepTransition.create({
          character_id: characterId, character_name: char.name, owner_email: char.owner_email,
          transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'sleeping',
          authority: 'alarm_reschedule_6h_guard',
          reason: `Alarm fired after ${Math.round(elapsedSleepHours * 100) / 100}h sleep — rescheduled to 6h boundary. No verified higher-priority interrupt.`,
          timestamp: nowIso, state_start_ref: char.last_sleep_start,
          elapsed_hours: Math.round(elapsedSleepHours * 100) / 100,
          verified_higher_priority_interrupt: false,
        });
      } catch (e) { console.warn(`[processScheduledCharacterAlarms] 6h guard transition failed: ${e.message}`); }
      return { event: 'alarm_rescheduled_6h_guard', elapsed_sleep_hours: Math.round(elapsedSleepHours * 100) / 100, next_alarm_time: sixHourBoundaryIso };
    }
  }

  // Asleep and due → commit wake through the authorized wake authority.
  let authRes = null;
  try {
    const ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
      character_id: characterId,
      owner_email: char.owner_email,
      requested_presence_status: 'home',
      requested_source_reason: presenceStatus === 'napping' ? 'scheduled_nap_end_alarm' : 'scheduled_alarm_wake',
      requested_authority: 'processScheduledCharacterAlarms',
      requested_timestamp: nowIso,
    });
    authRes = ir?.data || ir;
  } catch (invokeErr) {
    return { event: 'authority_invoke_failed', error: invokeErr.message };
  }

  if (authRes?.disposition !== 'accepted' || !authRes?.committed_result) {
    return { event: 'wake_not_committed', disposition: authRes?.disposition, reason: authRes?.reason };
  }

  const committed = authRes.committed_result;
  const committedPresence = committed.resolved_presence_status || 'home';

  // CLEAR the alarm (one-time user alarm, NOT recurring). Only alarm state + activity —
  // canonical wake state was committed by the authority above.
  await base44.asServiceRole.entities.Character.update(characterId, {
    pending_alarm_time: null,
    alarm_woke_at: nowIso,
    current_activity: 'just woke up (scheduled alarm)',
  }).catch((e) => console.warn(`[processScheduledCharacterAlarms] clear failed: ${e.message}`));

  // Authoritative transition record.
  const stateStartRef = presenceStatus === 'napping' ? char.last_nap_time : char.last_sleep_start;
  const elapsedHours = stateStartRef
    ? Math.round(((nowMs - new Date(stateStartRef).getTime()) / 3600000) * 100) / 100
    : null;
  const [aH, aM] = etHourMinute(alarmTime);
  const wakeUpTime = char.wake_up_time || '07:00';
  const [wuH, wuM] = wakeUpTime.split(':').map(Number);
  const alarmMinutes = aH * 60 + aM;
  const wakeMinutes = (isNaN(wuH) ? 7 : wuH) * 60 + (isNaN(wuM) ? 0 : wuM);
  const earlierThanUsual = alarmMinutes < wakeMinutes;
  const reason = earlierThanUsual ? 'Scheduled alarm (earlier than usual)' : 'Scheduled alarm';
  try {
    await base44.asServiceRole.entities.SleepTransition.create({
      character_id: characterId, character_name: char.name, owner_email: char.owner_email,
      transition_type: presenceStatus === 'napping' ? 'nap_end' : 'sleep_end',
      from_status: presenceStatus, to_status: committedPresence,
      authority: 'scheduled_alarm',
      reason, timestamp: nowIso, state_start_ref: stateStartRef, elapsed_hours: elapsedHours,
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
      character_id: characterId, character_name: char.name,
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
      character_id: characterId, memory_type: 'event',
      memory_text: `My alarm went off at ${timeLabel}. Got up and started the day.`,
      memory_summary: `scheduled_alarm_fired::${nowIso}`,
      importance_score: 2, permanence: 'short_term',
    });
  } catch (e) { console.warn(`[processScheduledCharacterAlarms] memory failed: ${e.message}`); }

  return { event: 'alarm_fired', from_status: presenceStatus, to_status: committedPresence, reason };
}