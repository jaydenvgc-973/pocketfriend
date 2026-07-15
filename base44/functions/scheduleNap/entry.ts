import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * scheduleNap — User-Initiated Nap Authority
 *
 * Governing rules enforced here:
 * 1. User may command a nap regardless of current energy — no energy gate.
 * 2. System never autonomously triggers this path — only user-initiated.
 * 3. Places character into true 'napping' presence state.
 * 4. Records authoritative nap start time (last_nap_time).
 * 5. Writes nap start to LifeEvent (Recent Activity) immediately.
 * 6. Writes nap start to CharacterMemory (Life Journal) immediately.
 * 7. Applies stay lock so automations cannot override the nap.
 * 8. Schedules 2-hour auto-wake via pending_alarm_time (alarm system can still fire earlier).
 * 9. On wake: writes last_wake_time (resets consecutive-awake calculation).
 * 10. On wake: writes LifeEvent and CharacterMemory immediately.
 * 11. On wake: applies existing pass-out consequence reduction if applicable.
 *
 * Action param:
 *   (omitted / 'start') — start a nap
 *   'wake'              — end the nap and apply all wake consequences
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      characterId,
      napStartTime,
      napDurationMinutes = 120,
      action = 'start',
    } = body;

    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

    // ── LOAD CHARACTER ────────────────────────────────────────────────────
    const chars = await base44.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const char = chars[0];
    const charName = char.name || char.display_name || char.id;

    // ── NAP WAKE PATH ─────────────────────────────────────────────────────
    // Called by the 2-hour auto-wake scheduler or the alarm system.
    if (action === 'wake') {
      const wakeTime = nowIso;

      // Snapshot for atomic revert if the proof record below fails.
      const preWakeSnapshot = {
        resolved_presence_status: char.resolved_presence_status,
        current_activity: char.current_activity,
        last_wake_time: char.last_wake_time,
        presence_stay_lock: char.presence_stay_lock,
        presence_stay_lock_reason: char.presence_stay_lock_reason,
        presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
        pending_alarm_time: char.pending_alarm_time,
        last_need_simulated_at: char.last_need_simulated_at,
        mental_value: char.mental_value,
        comfort_value: char.comfort_value,
      };

      // ── RULE 9: Write last_wake_time — resets consecutive-awake timer ──
      const wakePayload = {
        resolved_presence_status: 'home',
        current_activity: '',
        last_wake_time: wakeTime,      // RESTORATIVE BOUNDARY — resets 19h awake timer
        presence_stay_lock: false,
        presence_stay_lock_reason: null,
        presence_stay_lock_release_condition: null,
        pending_alarm_time: null,      // clear the 2-hour wake alarm
        last_need_simulated_at: wakeTime,
      };

      // ── RULE 11: Pass-out consequence reduction ───────────────────────
      // If the character recently passed out, a nap reduces existing consequences.
      // Applied via mental/comfort recovery — no new systems invented.
      const hadRecentPassOut = char.last_pass_out_at &&
        (new Date(wakeTime).getTime() - new Date(char.last_pass_out_at).getTime()) < 24 * 3_600_000;

      if (hadRecentPassOut) {
        // Recover mental and comfort from pass-out embarrassment/exhaustion.
        // Clamp to 100 max.
        const mentalRecover  = Math.min(100, (char.mental_value  ?? 70) + 8);
        const comfortRecover = Math.min(100, (char.comfort_value ?? 70) + 6);
        wakePayload.mental_value  = Math.round(mentalRecover);
        wakePayload.comfort_value = Math.round(comfortRecover);
      }

      // ── ONE TRUTH: Route the canonical nap-end wake through enforceCharacterLocationPresence ──
      // scheduleNap retains domain intelligence (user-directed wake, pass-out recovery) but
      // does NOT directly write canonical presence, lock, or last_wake_time. The authority
      // commits the canonical wake; only an accepted committed result records the nap_end.
      let wakeAuthRes = null;
      try {
        const ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
          character_id: characterId, owner_email: char.owner_email,
          requested_presence_status: 'home',
          requested_source_reason: 'user_directed_nap_wake', requested_authority: 'scheduleNap',
          requested_timestamp: wakeTime,
        });
        wakeAuthRes = ir?.data || ir;
      } catch (invokeErr) {
        return Response.json({ success: false, error: 'authority_invoke_failed', reason: invokeErr.message }, { status: 500 });
      }
      if (wakeAuthRes?.disposition !== 'accepted' || !wakeAuthRes?.committed_result) {
        return Response.json({ success: false, error: 'wake_not_committed', disposition: wakeAuthRes?.disposition, reason: wakeAuthRes?.reason || 'Authority did not commit a wake state.' }, { status: 500 });
      }
      const committedWakePresence = wakeAuthRes.committed_result.resolved_presence_status || 'home';

      // Write only noncanonical caller-owned fields. The authority committed canonical
      // presence, lock release, and last_wake_time. mental/comfort recovery is noncanonical.
      const noncanonicalWakePayload = {
        current_activity: '',
        pending_alarm_time: null,
        last_need_simulated_at: wakeTime,
      };
      if (hadRecentPassOut) {
        noncanonicalWakePayload.mental_value = wakePayload.mental_value;
        noncanonicalWakePayload.comfort_value = wakePayload.comfort_value;
      }
      await base44.entities.Character.update(characterId, noncanonicalWakePayload);

      // ── NAP-END DOWNSTREAM RECORD — from the committed result ───────────
      try {
        await base44.entities.SleepTransition.create({
          character_id: characterId, character_name: charName, owner_email: char.owner_email,
          transition_type: 'nap_end', from_status: 'napping', to_status: committedWakePresence,
          authority: 'user_directed',
          reason: 'User-authorized nap completed (scheduled wake). last_wake_time reset.',
          timestamp: wakeTime, state_start_ref: char.last_nap_time,
          elapsed_hours: char.last_nap_time ? Math.round(((new Date(wakeTime).getTime() - new Date(char.last_nap_time).getTime()) / 3600000) * 100) / 100 : null,
          verified_higher_priority_interrupt: false,
        });
      } catch (transitionError) {
        // Canonical state is already committed by the authority — proof failure is reported, not reverted.
        return Response.json({
          success: true, action: 'wake', characterId, wakeTime,
          passout_recovery_applied: hadRecentPassOut,
          message: `${charName} woke from their nap (canonical state committed; nap_end proof write failed).`,
          consequence_write_failed: `nap_end proof write failed: ${transitionError.message}`,
        });
      }

      // ── RULE 10: Record nap wake — only reached because transition is proven.
      // A failure here is reported explicitly and does NOT invalidate the transition.
      let consequenceWriteFailed = null;
      try {
        await base44.entities.LifeEvent.create({
          character_id: characterId,
          character_name: charName,
          event_type: 'recovery_event',
          valence: 'positive',
          severity: 'minor',
          title: hadRecentPassOut ? 'Woke from nap feeling more in control' : 'Woke from a nap',
          description: hadRecentPassOut
            ? `${charName} woke from a nap feeling calmer and less exhausted. The rest helped ease some of the physical and emotional weight from earlier.`
            : `${charName} woke from a nap feeling more rested.`,
          emotional_impact: hadRecentPassOut ? 'calmer, less exhausted, more in control' : 'rested, refreshed',
          triggered_by: 'user_message',
          timestamp: wakeTime,
          context_tags: ['nap_wake', 'last_wake_time_reset', ...(hadRecentPassOut ? ['passout_recovery_nap'] : [])],  // backend metadata
        });
        await base44.entities.CharacterMemory.create({
          character_id: characterId,
          memory_type: 'event',
          memory_text: hadRecentPassOut
            ? `${charName} took a nap and woke up feeling calmer and less exhausted. The rest helped ease some of the physical weight from earlier. Felt more in control after getting some sleep.`
            : `${charName} took a two-hour nap and woke up feeling more rested.`,
          memory_summary: hadRecentPassOut ? `Napped and woke feeling calmer, less exhausted.` : `Took a two-hour nap, woke feeling rested.`,
          importance_score: hadRecentPassOut ? 6 : 3,
          permanence: 'short_term',
          related_character_id: characterId,
        });
      } catch (consequenceError) {
        consequenceWriteFailed = consequenceError.message;
      }

      return Response.json({
        success: true,
        action: 'wake',
        characterId,
        wakeTime,
        passout_recovery_applied: hadRecentPassOut,
        message: `${charName} woke from their nap. Consecutive-awake timer reset.`,
        consequence_write_failed: consequenceWriteFailed,
      });
    }

    // ── NAP START PATH ────────────────────────────────────────────────────
    if (!napStartTime) {
      return Response.json({ error: 'Missing napStartTime' }, { status: 400 });
    }

    const napStart    = new Date(napStartTime);
    const napEnd      = new Date(napStart.getTime() + napDurationMinutes * 60 * 1000);
    const napEndIso   = napEnd.toISOString();

    // Snapshot for atomic revert if the proof record below fails.
    const preNapSnapshot = {
      resolved_presence_status: char.resolved_presence_status,
      current_activity: char.current_activity,
      last_nap_time: char.last_nap_time,
      last_need_simulated_at: char.last_need_simulated_at,
      presence_stay_lock: char.presence_stay_lock,
      presence_stay_lock_reason: char.presence_stay_lock_reason,
      presence_stay_lock_authority: char.presence_stay_lock_authority,
      presence_stay_lock_set_at: char.presence_stay_lock_set_at,
      presence_stay_lock_created_by: char.presence_stay_lock_created_by,
      presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
      presence_stay_lock_expires_at: char.presence_stay_lock_expires_at,
      pending_alarm_time: char.pending_alarm_time,
    };

    // ── RULES 3–4: Place into real napping state with authoritative timestamp ──
    // Also write pending_alarm_time = napEndIso so the alarm system can fire
    // the 2-hour auto-wake (rule 7/8). A user-set alarm earlier will override this.
    // ── ONE TRUTH: Route the canonical nap-start through enforceCharacterLocationPresence ──
    // scheduleNap retains domain intelligence (user-directed, 2-hour alarm, duration) but
    // does NOT directly write canonical presence, lock, or last_nap_time. The authority
    // commits the canonical nap state; only an accepted committed 'napping' result records
    // the nap_start downstream record. A redirected request (e.g., napping at work) moves
    // home first via must_resubmit_sleep — no nap_start is recorded from the redirect.
    const napHomeId = char.current_home_location_id || char.resolved_current_location_id || null;
    let napAuthRes = null;
    try {
      const ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
        character_id: characterId, owner_email: char.owner_email,
        requested_presence_status: 'napping', requested_location_id: napHomeId,
        requested_source_reason: 'user_directed_nap', requested_authority: 'scheduleNap',
        requested_timestamp: napStart.toISOString(),
      });
      napAuthRes = ir?.data || ir;
    } catch (invokeErr) {
      return Response.json({ success: false, error: 'authority_invoke_failed', reason: invokeErr.message }, { status: 500 });
    }

    let napCommitted = null;
    if (napAuthRes?.must_resubmit_sleep === true) {
      // Redirected (e.g., at work → move home awake). No nap_start from the redirect.
      // Resubmit the napping request at the committed location — one redirect → one resubmit.
      const resubmitLocId = napAuthRes?.committed_result?.resolved_current_location_id || napHomeId;
      try {
        const rir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
          character_id: characterId, owner_email: char.owner_email,
          requested_presence_status: 'napping', requested_location_id: resubmitLocId,
          requested_source_reason: 'user_directed_nap', requested_authority: 'scheduleNap',
          requested_timestamp: napStart.toISOString(),
        });
        const rRes = rir?.data || rir;
        if (rRes?.disposition === 'accepted' && !rRes?.must_resubmit_sleep && rRes?.committed_result?.resolved_presence_status === 'napping') {
          napCommitted = rRes.committed_result;
        }
      } catch { /* non-fatal — fall through to failure */ }
    } else if (napAuthRes?.disposition === 'accepted' && napAuthRes?.committed_result?.resolved_presence_status === 'napping') {
      napCommitted = napAuthRes.committed_result;
    }

    if (!napCommitted) {
      return Response.json({ success: false, error: 'nap_not_committed', disposition: napAuthRes?.disposition, reason: napAuthRes?.reason || 'Authority did not commit a napping state.' }, { status: 500 });
    }

    // Write only noncanonical caller-owned fields (activity + 2-hour wake alarm + sim timer).
    // The authority already committed canonical presence, lock, and last_nap_time.
    await base44.entities.Character.update(characterId, {
      current_activity: `napping (${napDurationMinutes}min)`,
      pending_alarm_time: napEndIso,
      last_need_simulated_at: napStart.toISOString(),
    });

    // ── NAP-START DOWNSTREAM RECORD — from the committed result ──────────
    try {
      await base44.entities.SleepTransition.create({
        character_id: characterId, character_name: charName, owner_email: char.owner_email,
        transition_type: 'nap_start', from_status: char.resolved_presence_status || 'home', to_status: 'napping',
        authority: 'user_directed',
        reason: `User-authorized ${napDurationMinutes}-minute nap.`,
        timestamp: napStart.toISOString(),
        verified_higher_priority_interrupt: false,
      });
    } catch (transitionError) {
      // Canonical state is already committed by the authority — proof failure is reported, not reverted.
      return Response.json({
        success: true, action: 'start', characterId,
        napStartTime: napStart.toISOString(), napEndTime: napEndIso, durationMinutes: napDurationMinutes,
        message: `${charName} is now napping (canonical state committed; nap_start proof write failed).`,
        proof_write_failed: transitionError.message,
      });
    }

    // ── RULES 5–6: Record nap start — only reached because transition is proven.
    // A failure here is reported explicitly and does NOT invalidate the transition.
    let consequenceWriteFailed = null;
    try {
      await base44.entities.LifeEvent.create({
        character_id: characterId,
        character_name: charName,
        event_type: 'recovery_event',
        valence: 'positive',
        severity: 'minor',
        title: 'Decided to get some rest',
        description: `${charName} decided to take a nap and get some rest. They will wake up in about two hours.`,
        emotional_impact: 'resting, recovering',
        triggered_by: 'user_message',
        timestamp: napStart.toISOString(),
        context_tags: ['nap_start', 'user_directed_nap'],  // backend metadata — not character-facing
      });
      await base44.entities.CharacterMemory.create({
        character_id: characterId,
        memory_type: 'event',
        memory_text: `${charName} decided to take a nap and get some rest. They slept for a couple of hours and woke up feeling more refreshed.`,
        memory_summary: `Took a two-hour nap to rest.`,
        importance_score: 3,
        permanence: 'short_term',
        related_character_id: characterId,
      });
    } catch (consequenceError) {
      consequenceWriteFailed = consequenceError.message;
    }

    return Response.json({
      success: true,
      action: 'start',
      characterId,
      napStartTime: napStart.toISOString(),
      napEndTime:   napEndIso,
      durationMinutes: napDurationMinutes,
      message: `${charName} is now napping. They will wake in ${napDurationMinutes} minutes or when their alarm fires.`,
      consequence_write_failed: consequenceWriteFailed,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});