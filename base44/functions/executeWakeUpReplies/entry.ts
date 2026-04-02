import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * executeWakeUpReplies
 *
 * Runs on a schedule (every 5 minutes). Finds all pending wake_reply
 * CharacterAutonomyEvents whose scheduled_for time has passed, generates
 * a natural "just woke up" reply, and inserts it into the conversation thread.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow both scheduled (service role) and manual (user) invocations
    let user = null;
    try { user = await base44.auth.me(); } catch {}

    const now = new Date().toISOString();

    // Fetch all pending wake_reply events that are due
    const pendingEvents = await base44.asServiceRole.entities.CharacterAutonomyEvent.filter({
      event_type: 'follow_up_message',
      status: 'pending',
    });

    const dueEvents = pendingEvents.filter(ev => {
      const payload = ev.event_payload || {};
      return (
        payload.trigger_reason === 'user_message_while_asleep' &&
        ev.scheduled_for &&
        new Date(ev.scheduled_for) <= new Date()
      );
    });

    if (dueEvents.length === 0) {
      return Response.json({ success: true, processed: 0, message: 'No due wake-up events.' });
    }

    const results = [];

    for (const ev of dueEvents) {
      try {
        // Mark as executing to prevent double-processing
        await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ev.id, { status: 'executing' });

        const payload = ev.event_payload || {};
        const characterId = ev.character_id;
        const conversationId = payload.conversation_id;
        const originalMessage = payload.original_user_message || '';

        if (!characterId || !conversationId) {
          await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ev.id, { status: 'failed' });
          results.push({ id: ev.id, status: 'failed', reason: 'missing characterId or conversationId' });
          continue;
        }

        // Fetch character
        const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const character = chars[0];
        if (!character) {
          await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ev.id, { status: 'failed' });
          results.push({ id: ev.id, status: 'failed', reason: 'character not found' });
          continue;
        }

        // Verify character is actually awake now
        const { isCharacterAsleep } = await import('./sleepUtils.js').catch(() => ({ isCharacterAsleep: () => false }));
        // Simple time check fallback if import fails
        const wakeTime = character.wake_up_time || '07:00';
        const sleepTime = character.sleep_start_time || '23:00';
        const nowHour = new Date().getHours();
        const nowMin = new Date().getMinutes();
        const [wakeH, wakeM] = wakeTime.split(':').map(Number);
        const [sleepH, sleepM] = sleepTime.split(':').map(Number);
        const nowMins = nowHour * 60 + nowMin;
        const wakeMins = wakeH * 60 + wakeM;
        const sleepMins = sleepH * 60 + sleepM;

        // Determine if still asleep (delay event by 30 min if so)
        let stillAsleep = false;
        if (sleepMins > wakeMins) {
          // Normal schedule: sleep at night, wake in morning
          stillAsleep = nowMins < wakeMins || nowMins >= sleepMins;
        } else {
          // Night owl: sleep past midnight
          stillAsleep = nowMins < wakeMins && nowMins >= sleepMins;
        }

        if (stillAsleep) {
          // Push back by 30 minutes and keep pending
          const newSchedule = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ev.id, {
            status: 'pending',
            scheduled_for: newSchedule,
          });
          results.push({ id: ev.id, status: 'delayed', reason: 'character still asleep, rescheduled +30min' });
          continue;
        }

        // Generate wake-up reply
        const personality = character.personality_summary || '';
        const mood = character.emotional_state || 'calm';
        const friendship = character.friendship_level ?? 75;
        const name = character.name;

        const prompt = `You are ${name}. ${personality ? `Your personality: ${personality}.` : ''}
Your mood: ${mood}. Your friendship with the user: ${friendship}/100.

You just woke up and saw a message from the user while you were sleeping.
The user's message was: "${originalMessage}"

Write a short, natural wake-up reply. It should sound like you just woke up and are seeing this message for the first time.
Examples of tone:
- Casual/close: "just woke up lol, what's up?", "hey sorry I was knocked out, just saw this"
- Irritable: "I literally just woke up, what did you need"
- Warm: "morning 😊 just saw your text, sorry I was asleep"

Rules:
- 1-2 sentences max
- No punctuation formality — casual texting style
- Do NOT start with your name
- Respond ONLY with the plain text reply, no quotes, no JSON`;

        const reply = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });

        if (!reply || typeof reply !== 'string' || reply.trim().length === 0) {
          throw new Error('LLM returned empty reply');
        }

        const replyText = reply.trim();

        // Insert reply into conversation thread
        const newMsg = await base44.asServiceRole.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: name,
          content: replyText,
          emotional_state: mood,
          is_read: false, // unread so badge fires
          timestamp: new Date().toISOString(),
        });

        // Update conversation last_message
        await base44.asServiceRole.entities.Conversation.update(conversationId, {
          last_message_preview: replyText.substring(0, 100),
          last_message_date: new Date().toISOString(),
        });

        // Mark event as completed
        await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ev.id, {
          status: 'completed',
          executed_at: new Date().toISOString(),
        });

        results.push({ id: ev.id, status: 'completed', character: name, message: replyText });
      } catch (evErr) {
        console.error(`[WAKE-REPLY] Failed event ${ev.id}:`, evErr.message);
        await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ev.id, {
          status: 'failed',
        }).catch(() => {});
        results.push({ id: ev.id, status: 'failed', reason: evErr.message });
      }
    }

    return Response.json({
      success: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error('[executeWakeUpReplies]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});