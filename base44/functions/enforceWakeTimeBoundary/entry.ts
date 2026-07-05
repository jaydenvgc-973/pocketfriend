import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ENFORCE WAKE TIME BOUNDARY
 *
 * Authoritative wake-time check for ALL active_created_characters.
 * Runs every 5 minutes. This is a STATE CHECK, not a transition trigger.
 *
 * Hard rule: If a character is marked sleeping/napping past their wake_up_time
 * with no valid medical/confinement reason, WAKE THEM IMMEDIATELY.
 *
 * This is the system-level guarantee that a missed transition event
 * does not trap a character in a stale sleep state.
 */

const VALID_SLEEP_EXCEPTIONS = [
  'hospitalized',
  'incarcerated',
  'confined',
  'house_arrest',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled execution */ }

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
    const nowETIso = nowET.toISOString();

    console.log(`[enforceWakeTimeBoundary] Running at ${nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} Eastern`);

    // Load all characters. Try user-scoped first, then service role.
    let allChars = [];
    try {
      allChars = await base44.entities.Character.filter({ status: 'active' }, null, 500);
    } catch {
      allChars = await base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500);
    }

    // Filter to active_created_character OR legacy characters (missing character_type but with owner_email)
    const eligibleChars = allChars.filter(c =>
      c.character_type === 'active_created_character' ||
      (!c.character_type && c.owner_email && c.status === 'active')
    );

    if (eligibleChars.length === 0) {
      return Response.json({ success: true, woken: 0, message: 'No eligible characters found', et_time: nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) });
    }

    const results = [];
    let wokenCount = 0;

    for (const char of eligibleChars) {
      // Skip if not sleeping. Naps are NOT wake-time-bound — they are governed by
      // the 3-hour nap cap in simulateActiveCharacterNeeds. A nap at any time of day
      // is valid; waking a character from a nap because "it's past their wake-up time"
      // is incorrect — wake_up_time is for overnight sleep, not midday rest.
      if (char.resolved_presence_status !== 'sleeping') continue;

      // Skip if valid exception (hospitalized, jailed, house arrest, etc.)
      if (VALID_SLEEP_EXCEPTIONS.includes(char.resolved_presence_status)) continue;
      if (char.is_jailed || char.house_arrest_active) continue;

      // Skip if sleep_lock is explicitly on (Vick Servicio only)
      if (char.sleep_lock === true) continue;

      // Parse wake_up_time (default 07:00)
      const wakeTime = char.wake_up_time || '07:00';
      const [wakeH, wakeM] = wakeTime.split(':').map(Number);
      if (isNaN(wakeH) || isNaN(wakeM)) continue;
      const wakeMinutes = wakeH * 60 + wakeM;

      // Only wake if current time is PAST wake_up_time
      if (currentMinutes < wakeMinutes) continue;

      // Only wake if at least 15 minutes past wake time (avoid premature wake from clock skew)
      if (currentMinutes < wakeMinutes + 15) continue;

      // ── 6-HOUR MINIMUM SLEEP GUARD ─────────────────────────────────────────
      // Canonical rule: normal sleep cannot end before 6 hours unless a verified
      // higher-priority interrupt exists. The wake_up_time clock boundary alone is
      // NOT a valid wake authority if the character has not yet slept 6 hours.
      // Verified higher-priority interrupts: medical emergency (health ≤ 15).
      // Energy 100%, chat activity, presence refresh, background recovery are NOT valid.
      if (char.last_sleep_start) {
        const elapsedSleepHours = (nowET.getTime() - new Date(char.last_sleep_start).getTime()) / 3600000;
        const isMedicalEmergency = (char.health_value ?? 80) <= 15;
        if (elapsedSleepHours < 6 && !isMedicalEmergency) {
          results.push({
            character_id: char.id,
            character_name: char.name,
            was_status: char.resolved_presence_status,
            woken: false,
            reason: `6h_sleep_minimum_guard_active (${elapsedSleepHours.toFixed(2)}h elapsed)`,
          });
          console.log(`[enforceWakeTimeBoundary] 6H_GUARD: ${char.name} slept ${elapsedSleepHours.toFixed(2)}h < 6h — not waking despite past wake_up_time`);
          // BLOCKED WAKE: No SleepTransition record is created.
          // A blocked wake is NOT a sleep_end. Creating transition evidence for an event
          // that did not occur corrupts the sleep timeline with contradictory state.
          continue;
        }
      }

      // WAKE THEM
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
      // Only actual-sleep wake writes last_wake_time. Nap wake does not reset the 19h awake timer.
      if (wasActualSleep) {
        wakePayload.last_wake_time = nowETIso;
      }
      // Snapshot for atomic revert if the proof record below fails.
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
        try {
          await writeScope.update(char.id, wakePayload);
        } catch {
          writeScope = base44.asServiceRole.entities.Character;
          await writeScope.update(char.id, wakePayload);
        }

        // ── AUTHORITATIVE TRANSITION RECORD — hard gate, atomic ──────────
        try {
          await base44.asServiceRole.entities.SleepTransition.create({
            character_id: char.id, character_name: char.name, owner_email: char.owner_email,
            transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'home',
            authority: 'wake_time_boundary',
            reason: `Wake-time boundary (${wakeTime}) reached — character woken.`,
            timestamp: nowETIso,
            state_start_ref: char.last_sleep_start || null,
          });
        } catch (transitionError) {
          let revertError = null;
          try { await writeScope.update(char.id, preWakeSnapshot); } catch (e) { revertError = e.message; }
          results.push({
            character_id: char.id, character_name: char.name,
            woken: false,
            reason: 'wake_time_boundary SleepTransition proof failed — Character state reverted, event is UNVERIFIED',
            transition_error: transitionError.message,
            revert_error: revertError,
          });
          continue;
        }

        // ── MANDATORY WAKE ACTIVITY — LifeEvent + CharacterMemory ──────────
        // Every wake must create a Recent Activity entry. Silent wake-up is forbidden.
        // This is created AFTER the SleepTransition proof is confirmed (atomic).
        try {
          const elapsedSleepHours = char.last_sleep_start
            ? Math.round(((nowET.getTime() - new Date(char.last_sleep_start).getTime()) / 3600000) * 100) / 100
            : null;
          await base44.asServiceRole.entities.LifeEvent.create({
            character_id: char.id, character_name: char.name,
            event_type: 'routine_positive_event', valence: 'positive', severity: 'minor',
            title: 'Woke up',
            description: `${char.name} woke up at their scheduled wake time (${wakeTime}).${elapsedSleepHours ? ` Slept ${elapsedSleepHours}h.` : ''} Energy at ${char.energy_value ?? 75}.`,
            emotional_impact: 'rested', triggered_by: 'life_simulation',
            timestamp: nowETIso, context_tags: ['sleep_end', 'woke_up', 'wake_time_boundary'],
          });
          await base44.asServiceRole.entities.CharacterMemory.create({
            character_id: char.id, memory_type: 'event',
            memory_text: `${char.name} woke up at ${wakeTime}.${elapsedSleepHours ? ` Slept ${elapsedSleepHours}h.` : ''} Feeling rested.`,
            memory_summary: `Woke up at scheduled time ${wakeTime}.`,
            importance_score: 3, permanence: 'short_term', related_character_id: char.id,
          });
        } catch (consequenceError) {
          console.warn(`[enforceWakeTimeBoundary] LifeEvent/Memory creation failed for ${char.name} (non-reverting): ${consequenceError.message}`);
        }

        results.push({
          character_id: char.id,
          character_name: char.name,
          was_status: char.resolved_presence_status,
          wake_up_time: wakeTime,
          previous_activity: char.current_activity || 'none',
          woken: true,
        });
        wokenCount++;
        console.log(`[enforceWakeTimeBoundary] WOKE ${char.name} | was=${char.resolved_presence_status} | wake_time=${wakeTime} | activity=${char.current_activity}`);
      } catch (err) {
        console.error(`[enforceWakeTimeBoundary] FAILED to wake ${char.name}: ${err.message}`);
        results.push({
          character_id: char.id,
          character_name: char.name,
          woken: false,
          error: err.message,
        });
      }
    }

    return Response.json({
      success: true,
      et_time: nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      et_hour: nowET.getHours(),
      total_checked: eligibleChars.length,
      sleeping_count: eligibleChars.filter(c => ['sleeping', 'napping'].includes(c.resolved_presence_status)).length,
      woken: wokenCount,
      results,
    });

  } catch (error) {
    console.error('[enforceWakeTimeBoundary] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});