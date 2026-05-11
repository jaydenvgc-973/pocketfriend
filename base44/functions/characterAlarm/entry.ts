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
    const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    const character = charList?.[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });
    if (character.owner_email !== user.email) {
      return Response.json({ error: 'Forbidden — character does not belong to your account' }, { status: 403 });
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
      await base44.asServiceRole.entities.Character.update(characterId, {
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

      await base44.asServiceRole.entities.Character.update(characterId, {
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

      // Calculate sleep debt impact
      const sleepStart = character.last_sleep_start ? new Date(character.last_sleep_start).getTime() : null;
      const wakeTime = character.wake_up_time || '07:00';
      const [wh, wm] = wakeTime.split(':').map(Number);
      const scheduledWake = new Date(now);
      scheduledWake.setHours(wh, wm, 0, 0);
      if (scheduledWake < now) scheduledWake.setDate(scheduledWake.getDate() + 1);

      const minutesEarly = scheduledWake > now ? Math.round((scheduledWake - now) / 60000) : 0;
      const isEarlyWake = minutesEarly > 30;

      let sleepDebtHours = character.sleep_debt_hours || 0;
      if (sleepStart) {
        const hoursSlept = (Date.now() - sleepStart) / 3600000;
        const neededHours = 7.5;
        if (hoursSlept < neededHours) {
          sleepDebtHours = Math.min(sleepDebtHours + (neededHours - hoursSlept), 24);
        }
      }

      const newEmotionalState = isEarlyWake || sleepDebtHours > 2 ? 'tired' : 'calm';
      const activityNote = isEarlyWake
        ? 'just woke up (alarm, earlier than usual)'
        : 'just woke up (alarm)';

      await base44.asServiceRole.entities.Character.update(characterId, {
        resolved_presence_status: 'home',
        location_status: 'home',
        current_activity: activityNote,
        emotional_state: newEmotionalState,
        sleep_debt_hours: Math.round(sleepDebtHours * 10) / 10,
        sleep_interrupted_at: nowIso,
        pending_alarm_time: null, // clear any pending alarm after firing
        resolved_last_updated_at: nowIso,
      });

      const timeLabel = now.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
      });

      // LifeEvent continuity — framed as character's own alarm, not user action
      base44.asServiceRole.entities.LifeEvent.create({
        character_id: characterId,
        character_name: character.name,
        event_type: 'routine_positive_event',
        valence: isEarlyWake ? 'mixed' : 'neutral',
        severity: 'minor',
        title: `Alarm went off at ${timeLabel}`,
        description: isEarlyWake
          ? `${character.name}'s alarm woke them up earlier than their usual schedule. They got up feeling groggy.`
          : `${character.name}'s alarm went off and they woke up to start their day.`,
        emotional_impact: isEarlyWake ? 'Tired, slightly disoriented from early wake' : 'Awake and starting their routine',
        triggered_by: 'scheduled_event',
        timestamp: nowIso,
        systems_updated: ['memory'],
        context_tags: ['alarm', 'wake_up', isEarlyWake ? 'early_wake' : 'on_schedule'],
      }).catch(() => {});

      const message = isEarlyWake
        ? `${firstName}'s alarm went off early. They're awake but tired.`
        : `${firstName}'s alarm went off. They're up and starting their day.`;

      return Response.json({
        success: true,
        woke_up: true,
        is_early: isEarlyWake,
        minutes_early: minutesEarly,
        new_emotional_state: newEmotionalState,
        message,
      });
    }

  } catch (error) {
    console.error('[characterAlarm] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});