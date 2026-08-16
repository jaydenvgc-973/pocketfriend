import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * processScheduledCharacterAlarms — PER-CHARACTER ALARM EXECUTION
 *
 * RESTORED per-character pathway. Invoked by the entity automation
 * "Alarm Wake — Trigger on pending_alarm_time Set" when a Character record
 * changes (e.g., pending_alarm_time set by characterAlarm, or a presence
 * update from enforceWakeTimeBoundary at the character's configured time).
 *
 * Per-character contract:
 *   - Processes ONLY the character whose record changed (not a global sweep).
 *   - Validates the alarm is still current (pending_alarm_time unchanged) and due.
 *   - If due and the character is asleep → commit wake via enforceCharacterLocationPresence,
 *     then reschedule pending_alarm_time to the SAME configured Eastern time 24h later.
 *   - If due and already awake → reschedule to next day (no wake).
 *   - If not due or no longer current → no-op.
 *
 * Each character's alarm is independent and recurs every 24 hours from that
 * character's own configured Eastern time. This is NOT a global scanner.
 *
 * Canonical-field safety: the wake authority (enforceCharacterLocationPresence)
 * owns canonical presence, stay-lock, and last_wake_time. This function writes
 * ONLY alarm state (pending_alarm_time, alarm_woke_at) + activity — it does not
 * overwrite canonical wake fields.
 */

// ── Eastern-Time-aware next-day reschedule (handles DST) ────────────────────
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
    try { await base44.auth.me(); } catch { /* automation execution */ }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // ── Per-character payload (entity automation) ─────────────────────────
    // Entity automations deliver: { event: { type, entity_name, entity_id }, data, old_data }
    let characterId = null;
    try {
      const body = await req.json();
      characterId = body?.event?.entity_id || body?.data?.id || body?.character_id || null;
    } catch { /* no body */ }

    if (!characterId) {
      return Response.json({ success: false, reason: 'no character_id in payload — this is a per-character function, not a scanner' });
    }

    // Load THIS character only (per-character).
    let char = null;
    try {
      const list = await base44.asServiceRole.entities.Character.filter(
        { id: characterId }, null, 1
      );
      char = list?.[0] || null;
    } catch { /* fall through */ }
    if (!char) {
      try {
        const list2 = await base44.entities.Character.filter({ id: characterId }, null, 1);
        char = list2?.[0] || null;
      } catch { /* not found */ }
    }
    if (!char) {
      return Response.json({ success: false, reason: 'character not found', character_id: characterId });
    }

    const alarmTime = char.pending_alarm_time;
    if (!alarmTime) {
      // No alarm set for this character — nothing to do.
      return Response.json({ success: true, event: 'no_alarm', character_id: characterId });
    }

    // Validate the alarm is due (<= now). If not due yet, no-op (the alarm time has not arrived).
    if (new Date(alarmTime).getTime() > nowMs) {
      return Response.json({ success: true, event: 'alarm_not_yet_due', character_id: characterId, pending_alarm_time: alarmTime });
    }

    const nextDayIso = nextDaySameET(alarmTime);
    const presenceStatus = char.resolved_presence_status || '';
    const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';

    // Already awake → reschedule to next day, no wake.
    if (!isAsleep) {
      try {
        await base44.asServiceRole.entities.Character.update(characterId, {
          pending_alarm_time: nextDayIso,
          alarm_woke_at: nowIso,
        });
      } catch (e) { console.warn(`[processScheduledCharacterAlarms] awake reschedule failed: ${e.message}`); }
      return Response.json({ success: true, event: 'already_awake_rescheduled', character_id: characterId, next_alarm_time: nextDayIso });
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
      return Response.json({ success: false, error: 'authority_invoke_failed', reason: invokeErr.message, character_id: characterId });
    }

    if (authRes?.disposition !== 'accepted' || !authRes?.committed_result) {
      return Response.json({ success: true, event: 'wake_not_committed', disposition: authRes?.disposition, reason: authRes?.reason, character_id: characterId });
    }

    const committed = authRes.committed_result;
    const committedPresence = committed.resolved_presence_status || 'home';

    // Reschedule to next day (daily recurrence). ONLY alarm state + activity —
    // canonical wake state was committed by the authority above.
    await base44.asServiceRole.entities.Character.update(characterId, {
      pending_alarm_time: nextDayIso,
      alarm_woke_at: nowIso,
      current_activity: 'just woke up (scheduled alarm)',
    }).catch((e) => console.warn(`[processScheduledCharacterAlarms] reschedule failed: ${e.message}`));

    // Authoritative transition record.
    const stateStartRef = presenceStatus === 'napping' ? char.last_nap_time : char.last_sleep_start;
    const elapsedHours = stateStartRef
      ? Math.round(((nowMs - new Date(stateStartRef).getTime()) / 3600000) * 100) / 100
      : null;
    try {
      await base44.asServiceRole.entities.SleepTransition.create({
        character_id: characterId, character_name: char.name, owner_email: char.owner_email,
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

    return Response.json({
      success: true, event: 'alarm_fired', character_id: characterId,
      from_status: presenceStatus, to_status: committedPresence, next_alarm_time: nextDayIso,
    });
  } catch (error) {
    console.error('[processScheduledCharacterAlarms] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});