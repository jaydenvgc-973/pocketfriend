/**
 * processScheduledCharacterAlarms — ONE-TIME, PER-ALARM EXECUTION
 *
 * Former behavior (REMOVED): a recurring global scan that fetched every active
 * character and woke any whose pending_alarm_time had passed. That was polling.
 *
 * Current behavior: a single one-time execution bound to ONE specific alarm.
 * It is invoked once, at the exact alarm timestamp, carrying the identity of the
 * specific character and the specific alarm that created it. It does NOT scan
 * characters. It does NOT scan alarm records. It validates exactly one alarm and,
 * if that alarm is still current, commits the wake through the existing canonical
 * authority (enforceCharacterLocationPresence) — the same authority scheduleNap's
 * wake path uses. It then clears the completed alarm fields and ends permanently.
 *
 * Invocation contract:
 *   payload: { character_id, alarm_time, owner_email? }
 *     - character_id: the specific character this execution is bound to
 *     - alarm_time:   the exact ISO timestamp this alarm was registered for
 *     - owner_email:  optional — scopes the character lookup
 *
 * Validation (the alarm must STILL be current):
 *   1. character.pending_alarm_time must exist and EXACTLY equal the supplied alarm_time
 *   2. character.resolved_presence_status must be 'sleeping' or 'napping'
 *   If either fails, the alarm was cancelled, replaced, cleared, already completed,
 *   or the character is already awake — exit WITHOUT changing any state.
 *
 * On a current alarm:
 *   - invoke enforceCharacterLocationPresence with the wake/nap-end transition
 *   - only if the authority commits an accepted 'home' result, clear the completed
 *     alarm fields (pending_alarm_time) and write the authoritative nap_end/sleep_end
 *     transition record + life event + memory FROM THE COMMITTED RESULT
 *   - the authority already released the stay lock and wrote last_wake_time
 *
 * No recurrence. No global scan. One execution. One alarm. Ends.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try { payload = await req.json(); } catch (_) { /* no body */ }

    const character_id = payload.character_id;
    const alarm_time = payload.alarm_time;
    const owner_email = payload.owner_email;

    // ── GUARD: this function is NOT a scanner ───────────────────────────────
    // Without a specific character_id + alarm_time it has nothing to validate.
    // It must NEVER fall back to scanning characters or alarm records.
    if (!character_id || !alarm_time) {
      return Response.json({
        success: false,
        executed: false,
        reason: 'missing_character_id_or_alarm_time',
        message: 'Single-alarm execution requires { character_id, alarm_time }. This function does not scan characters or alarms.',
      }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

    // ── LOAD THE ONE SPECIFIC CHARACTER ──────────────────────────────────────
    let characters = [];
    const filterQ = owner_email
      ? { id: character_id, owner_email }
      : { id: character_id };
    try {
      characters = await base44.asServiceRole.entities.Character.filter(filterQ, null, 1);
    } catch (_) { /* fall through to not-found */ }
    const character = characters && characters[0];
    if (!character) {
      return Response.json({
        success: true, executed: false, reason: 'character_not_found',
        character_id, alarm_time,
      });
    }

    // ── VALIDATE: the supplied alarm is STILL the character's current alarm ──
    // Exact match on pending_alarm_time proves the alarm was not cancelled,
    // replaced, cleared, or already completed (each of those sets pending_alarm_time
    // to null or to a different timestamp).
    const currentAlarm = character.pending_alarm_time;
    if (!currentAlarm || currentAlarm !== alarm_time) {
      return Response.json({
        success: true, executed: false, reason: 'alarm_no_longer_current',
        character_id, supplied_alarm_time: alarm_time, current_alarm_time: currentAlarm,
        message: 'Alarm was cancelled, replaced, cleared, or already completed — no state changed.',
      });
    }

    const presenceStatus = character.resolved_presence_status || '';
    const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';
    if (!isAsleep) {
      // Character is already awake (e.g., woken by another authority before this
      // execution fired). Clear the stale alarm field and exit without a wake.
      await base44.asServiceRole.entities.Character.update(character_id, {
        pending_alarm_time: null,
        alarm_woke_at: nowIso,
        resolved_last_updated_at: nowIso,
      }).catch(() => {});
      return Response.json({
        success: true, executed: false, reason: 'already_awake',
        character_id, presence_status: presenceStatus,
        message: 'Character already awake — stale alarm cleared, no wake committed.',
      });
    }

    // ── COMMIT THE WAKE THROUGH THE EXISTING CANONICAL AUTHORITY ─────────────
    // Same authority scheduleNap's wake path uses. This function does NOT write
    // canonical presence, lock, or last_wake_time directly.
    let authRes = null;
    try {
      const ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
        character_id,
        owner_email: character.owner_email,
        requested_presence_status: 'home',
        requested_source_reason: presenceStatus === 'napping' ? 'scheduled_nap_end_alarm' : 'scheduled_alarm_wake',
        requested_authority: 'processScheduledCharacterAlarms',
        requested_timestamp: nowIso,
      });
      authRes = ir?.data || ir;
    } catch (invokeErr) {
      return Response.json({
        success: false, executed: false, reason: 'authority_invoke_failed',
        character_id, error: invokeErr.message,
      }, { status: 500 });
    }

    if (authRes?.disposition !== 'accepted' || !authRes?.committed_result) {
      return Response.json({
        success: true, executed: false, reason: 'wake_not_committed',
        character_id, disposition: authRes?.disposition, authority_reason: authRes?.reason,
        message: 'Authority did not commit a wake state — no state changed.',
      });
    }

    const committed = authRes.committed_result;
    const committedPresence = committed.resolved_presence_status || 'home';

    // ── CLEAR COMPLETED ALARM FIELDS (noncanonical, this function owns these) ──
    // The authority already released the stay lock and wrote last_wake_time.
    await base44.asServiceRole.entities.Character.update(character_id, {
      pending_alarm_time: null,
      alarm_woke_at: nowIso,
      sleep_interrupted_at: nowIso,
      current_activity: 'just woke up (scheduled alarm)',
      resolved_last_updated_at: nowIso,
    }).catch((e) => console.warn(`[processScheduledCharacterAlarms] alarm field clear failed: ${e.message}`));

    // ── AUTHORITATIVE TRANSITION RECORD — from the committed result ──────────
    const stateStartRef = presenceStatus === 'napping' ? character.last_nap_time : character.last_sleep_start;
    const elapsedHours = stateStartRef
      ? Math.round(((new Date(nowIso).getTime() - new Date(stateStartRef).getTime()) / 3600000) * 100) / 100
      : null;
    try {
      await base44.asServiceRole.entities.SleepTransition.create({
        character_id, character_name: character.name, owner_email: character.owner_email,
        transition_type: presenceStatus === 'napping' ? 'nap_end' : 'sleep_end',
        from_status: presenceStatus, to_status: committedPresence,
        authority: 'scheduled_alarm',
        reason: presenceStatus === 'napping' ? 'Scheduled nap-end alarm fired.' : 'Scheduled alarm fired.',
        timestamp: nowIso, state_start_ref: stateStartRef,
        elapsed_hours: elapsedHours,
        verified_higher_priority_interrupt: false,
      });
    } catch (transitionError) {
      console.warn(`[processScheduledCharacterAlarms] transition record failed: ${transitionError.message}`);
    }

    // ── LIFE EVENT + MEMORY — from the committed result ─────────────────────
    const timeLabel = new Date(nowIso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
    });
    try {
      await base44.asServiceRole.entities.LifeEvent.create({
        character_id, character_name: character.name,
        event_type: 'routine_positive_event',
        valence: 'neutral', severity: 'minor',
        title: `Alarm went off at ${timeLabel}`,
        description: `${character.name}'s scheduled alarm went off and they woke up.`,
        emotional_impact: 'Awake and starting their routine',
        triggered_by: 'scheduled_event',
        timestamp: nowIso,
        systems_updated: ['memory'],
        context_tags: ['alarm', 'scheduled_alarm', 'wake_up', presenceStatus === 'napping' ? 'nap_end' : 'sleep_end'],
      });
    } catch (lifeEventError) {
      console.warn(`[processScheduledCharacterAlarms] life event failed: ${lifeEventError.message}`);
    }
    try {
      await base44.asServiceRole.entities.CharacterMemory.create({
        character_id,
        memory_type: 'event',
        memory_text: `My alarm went off at ${timeLabel}. Got up and started the day.`,
        memory_summary: `scheduled_alarm_fired::${nowIso}`,
        importance_score: 2,
        permanence: 'short_term',
      });
    } catch (memError) {
      console.warn(`[processScheduledCharacterAlarms] memory failed: ${memError.message}`);
    }

    return Response.json({
      success: true, executed: true, woke_up: true,
      character_id, character_name: character.name,
      from_status: presenceStatus, to_status: committedPresence,
      committed_result: committed,
      alarm_time, fired_at: nowIso,
      message: `${character.name}'s alarm fired and the wake was committed by the authority.`,
    });

  } catch (error) {
    console.error('[processScheduledCharacterAlarms] Fatal:', error.message);
    return Response.json({ success: false, executed: false, error: error.message }, { status: 500 });
  }
});