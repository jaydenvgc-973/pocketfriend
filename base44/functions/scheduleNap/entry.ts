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

      await base44.entities.Character.update(characterId, wakePayload);

      // ── RULE 10: Record nap wake in LifeEvent (Recent Activity) ──────
      await base44.entities.LifeEvent.create({
        character_id: characterId,
        character_name: charName,
        event_type: 'recovery_event',
        valence: 'positive',
        severity: 'minor',
        title: 'Woke from nap',
        description: `${charName} woke from a user-directed nap. Consecutive-awake timer reset to now.${hadRecentPassOut ? ' Nap reduced post-pass-out embarrassment and exhaustion.' : ''}`,
        emotional_impact: 'rested, refreshed',
        triggered_by: 'user_message',
        timestamp: wakeTime,
        context_tags: ['nap_wake', 'last_wake_time_reset', ...(hadRecentPassOut ? ['passout_recovery_nap'] : [])],
      }).catch(() => {});

      // ── RULE 10: Record nap wake in CharacterMemory (Life Journal) ────
      await base44.entities.CharacterMemory.create({
        character_id: characterId,
        memory_type: 'event',
        memory_text: `${charName} took a 2-hour nap and woke up feeling more rested. The nap reset their consecutive-awake exposure.${hadRecentPassOut ? ' The rest helped ease some of the embarrassment and exhaustion from passing out earlier.' : ''}`,
        memory_summary: `Woke from 2-hour nap — awake timer reset.`,
        importance_score: hadRecentPassOut ? 6 : 3,
        permanence: 'short_term',
        related_character_id: characterId,
      }).catch(() => {});

      return Response.json({
        success: true,
        action: 'wake',
        characterId,
        wakeTime,
        passout_recovery_applied: hadRecentPassOut,
        message: `${charName} woke from their nap. Consecutive-awake timer reset.`,
      });
    }

    // ── NAP START PATH ────────────────────────────────────────────────────
    if (!napStartTime) {
      return Response.json({ error: 'Missing napStartTime' }, { status: 400 });
    }

    const napStart    = new Date(napStartTime);
    const napEnd      = new Date(napStart.getTime() + napDurationMinutes * 60 * 1000);
    const napEndIso   = napEnd.toISOString();

    // ── RULES 3–4: Place into real napping state with authoritative timestamp ──
    // Also write pending_alarm_time = napEndIso so the alarm system can fire
    // the 2-hour auto-wake (rule 7/8). A user-set alarm earlier will override this.
    await base44.entities.Character.update(characterId, {
      resolved_presence_status: 'napping',
      current_activity:         `napping — user-directed (${napDurationMinutes}min)`,
      last_nap_time:            napStart.toISOString(),  // authoritative nap-start timer
      last_need_simulated_at:   napStart.toISOString(),
      // Stay lock: prevent other automations from overriding this user-directed nap
      presence_stay_lock:                   true,
      presence_stay_lock_reason:            'nap_state',
      presence_stay_lock_authority:         'scheduleNap_user_directed',
      presence_stay_lock_set_at:            napStart.toISOString(),
      presence_stay_lock_created_by:        'user',
      presence_stay_lock_release_condition: 'nap_complete',
      presence_stay_lock_expires_at:        napEndIso,   // lock expires at nap end
      // ── RULE 8: Schedule 2-hour auto-wake via alarm system ───────────
      // pending_alarm_time is read by processScheduledCharacterAlarms to fire the wake.
      // A user-scheduled alarm at an earlier time will override this.
      pending_alarm_time: napEndIso,
    });

    // ── RULE 5: Write nap start to LifeEvent (Recent Activity) ───────────
    await base44.entities.LifeEvent.create({
      character_id: characterId,
      character_name: charName,
      event_type: 'recovery_event',
      valence: 'positive',
      severity: 'minor',
      title: 'Started a nap',
      description: `${charName} started a user-directed 2-hour nap. They are in a true napping state and will not be awake until the nap completes or an alarm fires.`,
      emotional_impact: 'resting, recovering',
      triggered_by: 'user_message',
      timestamp: napStart.toISOString(),
      context_tags: ['nap_start', 'user_directed_nap'],
    }).catch(() => {});

    // ── RULE 6: Write nap start to CharacterMemory (Life Journal) ─────────
    await base44.entities.CharacterMemory.create({
      character_id: characterId,
      memory_type: 'event',
      memory_text: `${charName} took a 2-hour nap (user-directed). They rested and will wake up refreshed.`,
      memory_summary: `Started a 2-hour user-directed nap.`,
      importance_score: 3,
      permanence: 'short_term',
      related_character_id: characterId,
    }).catch(() => {});

    return Response.json({
      success: true,
      action: 'start',
      characterId,
      napStartTime: napStart.toISOString(),
      napEndTime:   napEndIso,
      durationMinutes: napDurationMinutes,
      message: `${charName} is now napping. They will wake in ${napDurationMinutes} minutes or when their alarm fires.`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});