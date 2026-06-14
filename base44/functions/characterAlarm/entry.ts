/**
 * characterAlarm
 *
 * Actions:
 *   ring_now   — Wake the character immediately (as if their alarm fired).
 *   schedule   — Store a pending alarm time on the character record.
 *   cancel     — Clear any pending alarm.
 *   status     — Return current alarm state without side effects.
 *
 * Framing: The character's OWN alarm went off. Not the user waking them.
 * Ownership: owner_email verified. Only the target character is affected.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, action, scheduled_time } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });
    if (!['ring_now', 'schedule', 'cancel', 'status'].includes(action)) {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Verify ownership — owner_email is source of truth. Never use created_by.
    //
    // LOOKUP STRATEGY: Character entity RLS is scoped by owner_email.
    // Service-role filter({ id }) alone returns empty on this entity — must include owner_email.
    // Primary path: user-scoped client (already carries user.email context).
    // Fallback path: service-role with explicit owner_email + id compound filter.
    let character = null;
    let lookupMethod = 'user_scoped';

    try {
      const charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
      character = charList?.[0] || null;
      lookupMethod = 'user_scoped';
    } catch (_e1) {
      // Primary path failed — try service-role with owner_email compound filter
      lookupMethod = 'service_role_owner_scoped';
    }

    if (!character) {
      try {
        const charList2 = await base44.asServiceRole.entities.Character.filter(
          { owner_email: user.email, id: characterId }, null, 1
        );
        character = charList2?.[0] || null;
        lookupMethod = 'service_role_owner_scoped';
      } catch (_e2) {
        // Both paths failed
      }
    }

    if (!character) {
      return Response.json({
        error: 'Character not found or lookup failed',
        diagnostic: {
          character_id: characterId,
          caller_email: user.email,
          lookup_method: lookupMethod,
          resolution: 'Both user-scoped and service-role owner-scoped lookups returned empty. ' +
            'The character may belong to a different account, be deleted, or the ID may be stale.',
        }
      }, { status: 404 });
    }

    if (character.owner_email !== user.email) {
      return Response.json({
        error: 'Forbidden — character does not belong to your account',
        diagnostic: {
          character_id: characterId,
          character_owner_email: character.owner_email,
          caller_email: user.email,
          mismatch: true,
        }
      }, { status: 403 });
    }

    const firstName = (character.name || 'They').split(' ')[0];
    const now = new Date();
    const nowIso = now.toISOString();

    // ── STATUS ──────────────────────────────────────────────────────────────
    if (action === 'status') {
      return Response.json({
        success: true,
        pending_alarm_time: character.pending_alarm_time || null,
        is_sleeping: ['sleeping', 'napping'].includes(character.resolved_presence_status),
        resolved_presence_status: character.resolved_presence_status || '',
      });
    }

    // ── CANCEL ──────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      await base44.entities.Character.update(characterId, {
        pending_alarm_time: null,
        resolved_last_updated_at: nowIso,
      });

      base44.asServiceRole.entities.CharacterMemory.create({
        character_id: characterId,
        memory_type: 'event',
        memory_text: `${character.name} canceled their scheduled alarm.`,
        memory_summary: 'alarm_canceled',
        importance_score: 2,
        permanence: 'short_term',
      }).catch(() => {});

      return Response.json({
        success: true,
        message: `${firstName}'s alarm has been canceled.`,
      });
    }

    // ── SCHEDULE ────────────────────────────────────────────────────────────
    if (action === 'schedule') {
      if (!scheduled_time) {
        return Response.json({ error: 'scheduled_time required for schedule action' }, { status: 400 });
      }

      await base44.entities.Character.update(characterId, {
        pending_alarm_time: scheduled_time,
        resolved_last_updated_at: nowIso,
      });

      // Format time for display
      let displayTime = scheduled_time;
      try {
        displayTime = new Date(scheduled_time).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
        });
      } catch {}

      base44.asServiceRole.entities.CharacterMemory.create({
        character_id: characterId,
        memory_type: 'event',
        memory_text: `${character.name} set an alarm for ${displayTime}.`,
        memory_summary: `alarm_scheduled::${scheduled_time}`,
        importance_score: 3,
        permanence: 'short_term',
      }).catch(() => {});

      return Response.json({
        success: true,
        pending_alarm_time: scheduled_time,
        message: `Alarm set for ${displayTime}.`,
      });
    }

    // ── RING NOW ────────────────────────────────────────────────────────────
    if (action === 'ring_now') {
      const isAsleep = ['sleeping', 'napping'].includes(character.resolved_presence_status);

      if (!isAsleep) {
        return Response.json({
          success: true,
          already_awake: true,
          message: `${firstName} is already awake.`,
        });
      }

      // Determine wake context from actual obligations — NOT from wake_up_time clock field.
      // wake_up_time is a stored preference / metadata. It has no authority here.
      // The alarm fires when it fires. What matters is: does the character have an active
      // obligation right now (work shift, school), and how long did they sleep?
      const sleepStart = character.last_sleep_start ? new Date(character.last_sleep_start).getTime() : null;
      const hoursSlept = sleepStart ? (Date.now() - sleepStart) / 3600000 : 0;

      // Determine if there is an active work obligation RIGHT NOW that the character missed.
      // This is the correct source of "late wake" context — not wake_up_time comparison.
      const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
      const dowNow = nowET.getDay();
      const todayET = nowET.toISOString().slice(0, 10);

      const toMinLocal = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

      // Check if character has an active work obligation RIGHT NOW.
      // TWO sources must both be checked — the work resolver reads BOTH:
      //   1. Character-level fields: work_days, work_start_time, work_end_time, occupation_location_id
      //   2. Location-side worker_shifts[character.id] on the work location record
      // Checking only character-level fields is the global bug: if the job is stored on the
      // location side (worker_shifts), character-level fields may be empty or stale.
      const hasCallout = character.work_exception_status === 'called_out' && character.work_exception_date === todayET;

      // Source 1: Character-level work schedule
      const hasWorkNowCharLevel = (() => {
        if (hasCallout) return false;
        if (!Array.isArray(character.work_days) || character.work_days.length === 0) return false;
        if (!character.work_start_time || !character.work_end_time || !character.occupation_location_id) return false;
        if (!character.work_days.includes(dowNow)) return false;
        const s = toMinLocal(character.work_start_time);
        const e = toMinLocal(character.work_end_time);
        if (s === null || e === null) return false;
        return e < s ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
      })();

      // Source 2: Location-side worker_shifts — load work locations and check shifts
      let hasWorkNowLocationLevel = false;
      if (!hasCallout) {
        const workLocIds = [];
        if (character.occupation_location_id) workLocIds.push(character.occupation_location_id);
        if (character.current_work_location_id && !workLocIds.includes(character.current_work_location_id)) {
          workLocIds.push(character.current_work_location_id);
        }
        if (Array.isArray(character.additional_occupation_locations)) {
          for (const entry of character.additional_occupation_locations) {
            if (entry.location_id && !workLocIds.includes(entry.location_id)) {
              workLocIds.push(entry.location_id);
            }
          }
        }
        if (workLocIds.length > 0) {
          try {
            const workLocs = await base44.asServiceRole.entities.LocationReference.filter(
              { owner_email: user.email },
              null,
              100
            );
            for (const loc of (workLocs || [])) {
              if (!workLocIds.includes(loc.id)) continue;
              const shift = loc.worker_shifts?.[character.id];
              if (!shift?.start || !shift?.end) continue;
              const shiftDays = Array.isArray(shift.days) && shift.days.length > 0 ? shift.days : null;
              if (shiftDays && !shiftDays.includes(dowNow)) continue;
              const s = toMinLocal(shift.start);
              const e = toMinLocal(shift.end);
              if (s === null || e === null) continue;
              const onShift = e < s ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
              if (onShift) { hasWorkNowLocationLevel = true; break; }
            }
          } catch { /* non-fatal — fall back to character-level only */ }
        }
      }

      const hasWorkNow = hasWorkNowCharLevel || hasWorkNowLocationLevel;

      // Check school obligation
      const hasSchoolNow = (() => {
        if (character.student_status !== 'enrolled' || !character.education_location_id) return false;
        if (![1, 2, 3, 4, 5].includes(dowNow)) return false;
        return nowMin >= 8 * 60 && nowMin < 15 * 60;
      })();

      // isLateWake: character has an active obligation they should be at right now
      const isLateWake = hasWorkNow || hasSchoolNow;
      // isShortSleep: slept less than 5 hours — genuinely tired wake
      const isShortSleep = hoursSlept < 5 && hoursSlept > 0;

      // Emotional state from actual circumstances, not from clock-field comparison
      const newEmotionalState = (isLateWake || isShortSleep) ? 'tired' : 'calm';
      const activityNote = isLateWake
        ? 'just woke up (alarm, running late)'
        : isShortSleep
        ? 'just woke up (alarm, short sleep)'
        : 'just woke up (alarm)';

      // ── ENERGY FINALIZATION — calculate partial recovery based on elapsed sleep time ──
      // Sleep recovery rate: +12 energy/hr. Full refill (0→100) takes ~8.3 hours.
      // We write the current calculated value so the bar reflects what actually happened.
      //
      // ALARM WAKE ENERGY RULE:
      //   1. Calculate sleep-recovered energy (last_sleep_start elapsed × 12/hr, capped at 100).
      //   2. Apply minimum awake threshold: if calculated energy < 45, raise to 45.
      //      (Character must be functional enough to wake — groggy, not comatose.)
      //   3. If calculated energy >= 45, keep it as-is. Never raise above earned value.
      //   4. Never set energy to 100 just because an alarm fired.
      //   5. Never lower energy below what was already earned during sleep.
      //
      // Examples:
      //   Slept from 20%, alarm at calculated 32%  → final = 45% (minimum floor applied)
      //   Slept from 20%, alarm at calculated 58%  → final = 58% (no floor needed)
      //   Slept from 80%, alarm at calculated 96%  → final = 96% (well rested)
      //
      // Only applies to active_created_character and npc_world_service.
      const ALARM_WAKE_MINIMUM_ENERGY = 45;
      const isEligibleForEnergyCalc = (
        character.character_type === 'active_created_character' ||
        character.character_type === 'npc_world_service' ||
        (!character.character_type && character.status === 'active') // legacy fallback
      );
      let finalizedEnergy = null;
      if (isEligibleForEnergyCalc && sleepStart) {
        const SLEEP_RECOVERY_PER_HOUR = 12;
        const currentEnergy = character.energy_value ?? 75;
        const recoveredEnergy = Math.min(100, currentEnergy + SLEEP_RECOVERY_PER_HOUR * hoursSlept);
        // Step 1: take the better of current vs recovered (sleep never decreases energy)
        const earnedEnergy = Math.max(currentEnergy, Math.round(recoveredEnergy));
        // Step 2: apply minimum awake threshold — alarm wakes need at least 45 to function
        finalizedEnergy = Math.max(earnedEnergy, ALARM_WAKE_MINIMUM_ENERGY);
        // Cap at 100 (already handled by recoveredEnergy cap above, but be explicit)
        finalizedEnergy = Math.min(100, finalizedEnergy);
      }

      // Character RLS is scoped by owner_email — try user-scoped write first.
      // If user-scoped fails (RLS mismatch, expired session), fall back to service-role.
      // Service role bypasses RLS and is safe here because ownership was already verified above.
      const wakeFields = {
        resolved_presence_status: 'home',
        location_status: 'home',
        current_activity: activityNote,
        emotional_state: newEmotionalState,
        sleep_interrupted_at: nowIso,
        pending_alarm_time: null,
        resolved_last_updated_at: nowIso,
        last_wake_time: nowIso,
        ...(finalizedEnergy !== null ? { energy_value: finalizedEnergy } : {}),
      };
      try {
        await base44.entities.Character.update(characterId, wakeFields);
      } catch (_writeErr) {
        // Fallback: service role — ownership verified above, safe to use
        await base44.asServiceRole.entities.Character.update(characterId, wakeFields);
      }

      const timeLabel = now.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
      });

      // LifeEvent continuity — framed as character's own alarm, not user action
      const lifeEventDesc = isLateWake
        ? `${character.name}'s alarm went off. They were supposed to be at work or school — they're running late.`
        : isShortSleep
        ? `${character.name}'s alarm went off after a short sleep. They're tired but awake.`
        : `${character.name}'s alarm went off and they woke up to start their day.`;

      const lifeEventImpact = isLateWake
        ? 'Stressed, rushing — running late for obligation'
        : isShortSleep
        ? 'Tired, groggy from short sleep'
        : 'Awake and starting their routine';

      base44.asServiceRole.entities.LifeEvent.create({
        character_id: characterId,
        character_name: character.name,
        event_type: 'routine_positive_event',
        valence: (isLateWake || isShortSleep) ? 'mixed' : 'neutral',
        severity: 'minor',
        title: `Alarm went off at ${timeLabel}`,
        description: lifeEventDesc,
        emotional_impact: lifeEventImpact,
        triggered_by: 'scheduled_event',
        timestamp: nowIso,
        systems_updated: ['memory'],
        context_tags: [
          'alarm', 'wake_up',
          isLateWake ? 'late_for_obligation' : 'on_schedule',
          isShortSleep ? 'short_sleep' : 'adequate_sleep',
        ],
      }).catch(() => {});

      const message = isLateWake
        ? `${firstName}'s alarm went off. They're awake but running late.`
        : isShortSleep
        ? `${firstName}'s alarm went off. They're up but tired — short sleep.`
        : `${firstName}'s alarm went off. They're up and starting their day.`;

      return Response.json({
        success: true,
        woke_up: true,
        is_late_wake: isLateWake,
        is_short_sleep: isShortSleep,
        hours_slept: Math.round(hoursSlept * 10) / 10,
        new_emotional_state: newEmotionalState,
        message,
      });
    }

  } catch (error) {
    console.error('[characterAlarm] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});