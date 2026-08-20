import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ENFORCE WAKE TIME BOUNDARY
 *
 * Authoritative wake-time check for active_created_characters. Preserves the
 * exact 8-hour sleep cap and wake_up_time boundary logic. The 6-hour minimum-
 * sleep guard remains in force.
 *
 * TRIGGER: event-driven via an entity automation on Character update (filtered
 * to sleeping/napping characters), NOT a polling cron. A per-character
 * invocation processes only the character that changed. A legacy batch mode
 * remains for manual/diagnostic use.
 *
 * Entity payload: { event: { entity_id }, data: <character>, ... }.
 * HTTP/manual payload: { character_id } or {} (batch).
 */

const VALID_SLEEP_EXCEPTIONS = [
  'hospitalized',
  'incarcerated',
  'confined',
  'house_arrest',
];

// ── NEXT SLEEP/WAKE EXECUTION TIME ──────────────────────────────────────────
// Computes the next datetime at which the wake authority should be invoked,
// based on the character's current sleeping state and established rules.
// Returns an ISO string, or null if the character is not sleeping.
// Rules are unchanged — this only EXPOSES the existing deadline.
function computeNextSleepWakeExecutionTime(char, ctx) {
  const { currentMinutes, nowETIso } = ctx;

  const isSleeping = char.resolved_presence_status === 'sleeping';
  if (!isSleeping || !char.last_sleep_start) return null;

  const sleepStart = new Date(char.last_sleep_start);
  const T_cap = new Date(sleepStart.getTime() + 8 * 3600 * 1000);

  const isMedicalEmergency = (char.health_value ?? 80) <= 15;
  const guardHours = isMedicalEmergency ? 0 : 6;
  const T_guard = new Date(sleepStart.getTime() + guardHours * 3600 * 1000);

  const wakeTime = char.wake_up_time || '07:00';
  const [wakeH, wakeM] = wakeTime.split(':').map(Number);
  if (isNaN(wakeH) || isNaN(wakeM)) return null;
  const wakeMin = wakeH * 60 + wakeM;
  const wakeThreshold = wakeMin + 15;

  let minsToWakeThreshold;
  if (currentMinutes < wakeThreshold) {
    minsToWakeThreshold = wakeThreshold - currentMinutes;
  } else {
    minsToWakeThreshold = (1440 - currentMinutes) + wakeThreshold;
  }
  const now = new Date(nowETIso);
  const T_wakeThreshold = new Date(now.getTime() + minsToWakeThreshold * 60 * 1000);

  const T_wake = T_wakeThreshold > T_guard ? T_wakeThreshold : T_guard;
  const nextExecution = T_wake < T_cap ? T_wake : T_cap;

  return nextExecution.toISOString();
}

// ── PER-CHARACTER WAKE EVALUATION ──────────────────────────────────────────
// Extracted from the former batch loop. Returns a result describing what
// happened. Performs the SAME writes (Character.update + SleepTransition +
// LifeEvent + CharacterMemory) as the original logic.
async function processWakeForCharacter(base44, char, ctx) {
  const { currentMinutes, etTimeStr, nowETIso } = ctx;

  const isSleeping = char.resolved_presence_status === 'sleeping';
  const isNapping = char.resolved_presence_status === 'napping';
  if (!isSleeping && !isNapping) return { event: 'not_sleeping' };

  if (VALID_SLEEP_EXCEPTIONS.includes(char.resolved_presence_status)) return { event: 'exception_state' };
  if (char.is_jailed || char.house_arrest_active) return { event: 'confinement_lock' };
  if (char.sleep_lock === true) return { event: 'sleep_lock' };

  // Only sleeping characters get the 8h cap and wake_up_time boundary.
  // Naps are governed by the 3-hour nap cap in simulateActiveCharacterNeeds.
  if (!isSleeping) return { event: 'napping_skipped' };

  // ── 8-HOUR SLEEP CAP ──
  if (char.last_sleep_start) {
    const _sleepDurH = (Date.now() - new Date(char.last_sleep_start).getTime()) / 3600000;
    if (_sleepDurH >= 8) {
      const fromStatus = char.resolved_presence_status;
      const _cap8Payload = {
        resolved_presence_status: 'home', resolved_location_type: 'home', location_status: 'home',
        current_activity: null, resolved_source_reason: 'sleep_cap_8h', resolved_last_updated_at: nowETIso,
        sleep_interrupted_at: nowETIso, last_wake_time: nowETIso,
      };
      const _cap8Revert = {
        resolved_presence_status: char.resolved_presence_status, resolved_location_type: char.resolved_location_type,
        location_status: char.location_status, current_activity: char.current_activity,
        resolved_source_reason: char.resolved_source_reason, resolved_last_updated_at: char.resolved_last_updated_at,
        sleep_interrupted_at: char.sleep_interrupted_at, last_wake_time: char.last_wake_time,
      };
      try {
        let _ws = base44.entities.Character;
        try { await _ws.update(char.id, _cap8Payload); }
        catch { _ws = base44.asServiceRole.entities.Character; await _ws.update(char.id, _cap8Payload); }
        try {
          await base44.asServiceRole.entities.SleepTransition.create({
            character_id: char.id, character_name: char.name, owner_email: char.owner_email,
            transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'home', authority: 'sleep_cap_8h',
            reason: `Sleep completed 8-hour cap (${Math.round(_sleepDurH * 100) / 100}h elapsed).`,
            timestamp: nowETIso, state_start_ref: char.last_sleep_start, elapsed_hours: Math.round(_sleepDurH * 100) / 100,
          });
        } catch (transitionError) {
          let _re = null; try { await _ws.update(char.id, _cap8Revert); } catch (e) { _re = e.message; }
          return { event: 'cap8_proof_failed', transition_error: transitionError.message, revert_error: _re };
        }
        try {
          await base44.asServiceRole.entities.LifeEvent.create({
            character_id: char.id, character_name: char.name, event_type: 'routine_positive_event',
            valence: 'positive', severity: 'minor', title: 'Woke up after full sleep',
            description: `${char.name} slept ${Math.round(_sleepDurH * 100) / 100}h and woke rested.`,
            emotional_impact: 'rested', triggered_by: 'life_simulation', timestamp: nowETIso,
            context_tags: ['sleep_end', 'woke_up', 'sleep_cap_8h'],
          });
          await base44.asServiceRole.entities.CharacterMemory.create({
            character_id: char.id, memory_type: 'event',
            memory_text: `${char.name} slept ${Math.round(_sleepDurH * 100) / 100}h and woke rested.`,
            memory_summary: `Slept ${Math.round(_sleepDurH * 100) / 100}h — woke rested.`,
            importance_score: 4, permanence: 'short_term', related_character_id: char.id,
          });
        } catch (e) { console.warn(`[enforceWakeTimeBoundary] 8h cap LifeEvent/Memory failed: ${e.message}`); }
        return { event: 'woke_cap8', wake_trigger: 'sleep_cap_8h', sleep_duration_hours: Math.round(_sleepDurH * 100) / 100 };
      } catch (err) {
        console.error(`[enforceWakeTimeBoundary] FAILED 8h cap wake ${char.name}: ${err.message}`);
        return { event: 'cap8_error', error: err.message };
      }
    }
  }

  // ── WAKE_UP_TIME BOUNDARY (with 6-hour guard) ──
  const wakeTime = char.wake_up_time || '07:00';
  const [wakeH, wakeM] = wakeTime.split(':').map(Number);
  if (isNaN(wakeH) || isNaN(wakeM)) return { event: 'invalid_wake_time' };
  const wakeMinutes = wakeH * 60 + wakeM;

  if (currentMinutes < wakeMinutes) return { event: 'before_wake_time' };
  if (currentMinutes < wakeMinutes + 15) return { event: 'within_15min_grace' };

  // 6-hour minimum sleep guard
  if (char.last_sleep_start) {
    const elapsedSleepHours = (Date.now() - new Date(char.last_sleep_start).getTime()) / 3600000;
    const isMedicalEmergency = (char.health_value ?? 80) <= 15;
    if (elapsedSleepHours < 6 && !isMedicalEmergency) {
      return { event: 'blocked_6h_guard', elapsed_sleep_hours: elapsedSleepHours.toFixed(2) };
    }
  }

  // Wake via direct write (existing behavior) + proof record.
  const wasActualSleep = char.resolved_presence_status === 'sleeping';
  const wakePayload = {
    resolved_presence_status: 'home',
    resolved_location_type: 'home',
    location_status: 'home',
    current_activity: null,
    resolved_source_reason: 'wake_time_boundary_enforcement',
    resolved_last_updated_at: nowETIso,
    sleep_interrupted_at: nowETIso,
  };
  if (wasActualSleep) wakePayload.last_wake_time = nowETIso;
  const preWakeSnapshot = {
    resolved_presence_status: char.resolved_presence_status,
    resolved_location_type: char.resolved_location_type,
    location_status: char.location_status,
    current_activity: char.current_activity,
    resolved_source_reason: char.resolved_source_reason,
    resolved_last_updated_at: char.resolved_last_updated_at,
    sleep_interrupted_at: char.sleep_interrupted_at,
    last_wake_time: char.last_wake_time,
  };

  try {
    let writeScope = base44.entities.Character;
    try { await writeScope.update(char.id, wakePayload); }
    catch { writeScope = base44.asServiceRole.entities.Character; await writeScope.update(char.id, wakePayload); }

    try {
      await base44.asServiceRole.entities.SleepTransition.create({
        character_id: char.id, character_name: char.name, owner_email: char.owner_email,
        transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'home',
        authority: 'wake_time_boundary',
        reason: `Wake-time boundary (${wakeTime}) reached — character woken.`,
        timestamp: nowETIso, state_start_ref: char.last_sleep_start || null,
      });
    } catch (transitionError) {
      let revertError = null;
      try { await writeScope.update(char.id, preWakeSnapshot); } catch (e) { revertError = e.message; }
      return { event: 'boundary_proof_failed', transition_error: transitionError.message, revert_error: revertError };
    }

    try {
      const elapsedSleepHours = char.last_sleep_start
        ? Math.round(((Date.now() - new Date(char.last_sleep_start).getTime()) / 3600000) * 100) / 100
        : null;
      await base44.asServiceRole.entities.LifeEvent.create({
        character_id: char.id, character_name: char.name, event_type: 'routine_positive_event',
        valence: 'positive', severity: 'minor', title: 'Woke up',
        description: `${char.name} woke up at their scheduled wake time (${wakeTime}).${elapsedSleepHours ? ` Slept ${elapsedSleepHours}h.` : ''} Energy at ${char.energy_value ?? 75}.`,
        emotional_impact: 'rested', triggered_by: 'life_simulation', timestamp: nowETIso,
        context_tags: ['sleep_end', 'woke_up', 'wake_time_boundary'],
      });
      await base44.asServiceRole.entities.CharacterMemory.create({
        character_id: char.id, memory_type: 'event',
        memory_text: `${char.name} woke up at ${wakeTime}.${elapsedSleepHours ? ` Slept ${elapsedSleepHours}h.` : ''} Feeling rested.`,
        memory_summary: `Woke up at scheduled time ${wakeTime}.`,
        importance_score: 3, permanence: 'short_term', related_character_id: char.id,
      });
    } catch (e) { console.warn(`[enforceWakeTimeBoundary] LifeEvent/Memory failed: ${e.message}`); }

    return { event: 'woke_boundary', wake_up_time: wakeTime, was_status: char.resolved_presence_status };
  } catch (err) {
    console.error(`[enforceWakeTimeBoundary] FAILED to wake ${char.name}: ${err.message}`);
    return { event: 'wake_error', error: err.message };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled/entity execution */ }

    let body = {};
    try { body = await req.json(); } catch { /* no body */ }

    // ── EASTERN TIME (authoritative) ──
    const _now = new Date();
    const _etStr = _now.toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const _etMatch = _etStr.match(/(\d+):(\d+)/);
    const etHour = parseInt(_etMatch[1]) % 24;
    const etMinute = parseInt(_etMatch[2]);
    const currentMinutes = etHour * 60 + etMinute;
    const nowETIso = _now.toISOString();
    const etTimeStr = _now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    const ctx = { currentMinutes, etHour, etMinute, etTimeStr, nowETIso };

    // ── PER-CHARACTER MODE (entity trigger or explicit character_id) ──
    const singleCharacterId = body.character_id || body.event?.entity_id || null;
    if (singleCharacterId) {
      let char = body.data || null;
      if (!char) {
        try {
          const list = await base44.asServiceRole.entities.Character.filter({ id: singleCharacterId }, null, 1);
          char = list?.[0] || null;
        } catch { /* fall through */ }
      }
      if (!char) return Response.json({ success: true, event: 'character_not_found' });
      const result = await processWakeForCharacter(base44, char, ctx);
      const _wokeEvents = ['woke_cap8', 'woke_boundary'];
      const _nextExec = _wokeEvents.includes(result.event) ? null : computeNextSleepWakeExecutionTime(char, ctx);
      return Response.json({ success: true, character_id: char.id, character_name: char.name, et_time: etTimeStr, next_execution_time: _nextExec, ...result });
    }

    // ── BATCH MODE (manual/diagnostic use) ──
    let allChars = [];
    try {
      allChars = await base44.entities.Character.filter({ status: 'active' }, null, 500);
    } catch {
      allChars = await base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500);
    }
    const eligibleChars = allChars.filter(c =>
      c.character_type === 'active_created_character' ||
      (!c.character_type && c.owner_email && c.status === 'active')
    );

    const results = [];
    let wokenCount = 0;
    for (const char of eligibleChars) {
      const r = await processWakeForCharacter(base44, char, ctx);
      if (r.event === 'woke_cap8' || r.event === 'woke_boundary') wokenCount++;
      const _wokeEvtsBatch = ['woke_cap8', 'woke_boundary'];
      const _nextExecBatch = _wokeEvtsBatch.includes(r.event) ? null : computeNextSleepWakeExecutionTime(char, ctx);
      results.push({ character_id: char.id, character_name: char.name, next_execution_time: _nextExecBatch, ...r });
    }

    return Response.json({
      success: true, et_time: etTimeStr, et_hour: etHour,
      total_checked: eligibleChars.length,
      woken: wokenCount, results,
    });
  } catch (error) {
    console.error('[enforceWakeTimeBoundary] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});