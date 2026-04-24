import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerCharacterNarratives
 *
 * ACCOUNT-SCOPED: Generates automatic narrative messages ONLY for the active user's
 * own characters. Never pulls characters from other accounts.
 *
 * When called by the scheduler (no user token), it iterates all users who have
 * active_created_character records and processes each independently.
 *
 * When called by the frontend (user token present), it processes only that user's characters.
 *
 * Rules:
 * - Only active_created_character types
 * - Only characters owned by the correct user (owner_email or created_by)
 * - Only conversations active in the last 24 hours
 * - No narrative within the last 2 hours
 * - At least 3 messages in the conversation
 * - 40% random chance per eligible character to keep it organic
 */

const buildLocationAffinityContext = (character) => {
  const se = character.social_energy || 'ambivert';
  const mood = character.emotional_state || 'calm';
  const lines = [`Social energy: ${se}`, `Current mood: ${mood}`];
  if (character.personality_traits?.length) lines.push(`Traits: ${character.personality_traits.join(', ')}`);
  return lines.join('. ');
};

async function processUserNarratives(base44SR, userEmail, runId, diagnosticMode = false) {
  const log = [];
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const results = [];

  // ACCOUNT-SCOPED: fetch this user's characters, filter in JS (compound DB filters can be unreliable)
  const rawChars = await base44SR.entities.Character.filter(
    { created_by: userEmail },
    null, 100
  ).catch(() => []);
  const userChars = rawChars.filter(c =>
    c.character_type === 'active_created_character' &&
    (!c.status || c.status === 'active')
  );

  log.push(`[${runId}] User: ${userEmail} | eligible chars found: ${userChars.length}`);
  console.log(`[triggerCharacterNarratives] ${log[log.length - 1]}`);

  for (const character of userChars) {
    const skipBase = { characterId: character.id, name: character.name, userEmail, status: 'skipped' };

    // ── 1. Find the most recent direct conversation (scoped to this user) ──
    // character_ids is an array field — filter in JS after fetching by created_by
    const allUserConvos = await base44SR.entities.Conversation.filter(
      { type: 'direct', created_by: userEmail },
      '-last_message_date', 50
    ).catch(() => []);
    const convos = allUserConvos.filter(c =>
      Array.isArray(c.character_ids) && c.character_ids.includes(character.id)
    ).slice(0, 1);

    if (!convos.length) {
      const reason = 'no direct conversation found for this user';
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} (${userEmail}) — ${reason}`);
      results.push({ ...skipBase, reason, location: character.resolved_current_location_name || 'unknown', activity: character.current_activity || 'unknown', sleep: character.resolved_presence_status || 'unknown', ts: now.toISOString(), runId });
      continue;
    }

    const convo = convos[0];

    // ── 2. Activity check — last 24h ──
    if (!convo.last_message_date || convo.last_message_date < oneDayAgo) {
      const reason = `conversation inactive — last message: ${convo.last_message_date || 'never'}`;
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 3. Cooldown — no narrative in last 2h ──
    const recentNarratives = await base44SR.entities.Message.filter(
      { conversation_id: convo.id, is_narrative: true },
      '-timestamp', 5
    ).catch(() => []);
    const narrativeRecently = recentNarratives.some(m => m.timestamp >= twoHoursAgo);
    if (narrativeRecently) {
      const lastN = recentNarratives[0]?.timestamp;
      const reason = `narrative cooldown — last narrative: ${lastN}`;
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 4. Minimum messages ──
    const recentMessages = await base44SR.entities.Message.filter(
      { conversation_id: convo.id },
      '-timestamp', 15
    ).catch(() => []);
    if (recentMessages.length < 3) {
      const reason = `only ${recentMessages.length} messages (need 3+)`;
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 5. 40% random gate (bypass in diagnostic mode) ──
    if (!diagnosticMode && Math.random() > 0.4) {
      const reason = 'random gate (40% chance — not this run)';
      console.log(`[triggerCharacterNarratives] SKIP ${character.name} — ${reason}`);
      results.push({ ...skipBase, reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 6. READ CHARACTER STATE TRUTH ──
    const resolvedLocationName = character.resolved_current_location_name || null;
    const resolvedPresenceStatus = character.resolved_presence_status || null;
    const currentActivity = character.current_activity || null;
    const emotionalState = character.emotional_state || 'calm';

    // Determine sleep state
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hourET = nowET.getHours();
    let isAsleep = resolvedPresenceStatus === 'sleeping' || resolvedPresenceStatus === 'napping';
    if (!isAsleep && character.sleep_start_time && character.wake_up_time) {
      const sH = parseInt(character.sleep_start_time.split(':')[0], 10);
      const wH = parseInt(character.wake_up_time.split(':')[0], 10);
      isAsleep = sH > wH ? (hourET >= sH || hourET < wH) : (hourET >= sH && hourET < wH);
    }
    const timeStr = `${hourET % 12 || 12}:${String(nowET.getMinutes()).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;
    const dayOfWeek = nowET.toLocaleDateString('en-US', { weekday: 'long' });

    console.log(`[triggerCharacterNarratives] ELIGIBLE: ${character.name} (${userEmail}) | loc: ${resolvedLocationName || 'unknown'} | sleep: ${isAsleep} | emotion: ${emotionalState} | activity: ${currentActivity || 'none'}`);

    // ── 7. BUILD PROMPT ──
    const recentText = recentMessages
      .slice(0, 5)
      .reverse()
      .map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content || '(photo)'}`)
      .join('\n');

    const locationAffinity = buildLocationAffinityContext(character);
    const city = [character.city, character.state].filter(Boolean).join(', ');
    const weather = character.weather_summary || '';

    const stateBlock = `
CHARACTER STATE (authoritative — ground truth):
- Name: ${character.name}
- Gender: ${character.gender || 'unspecified'}
- Current location: ${resolvedLocationName || 'unknown'}
- Presence status: ${resolvedPresenceStatus || 'unknown'}
- Current activity: ${currentActivity || 'going about their day'}
- Sleep state: ${isAsleep ? 'ASLEEP' : 'AWAKE'}
- Emotional state: ${emotionalState}
- Occupation: ${character.occupation || 'none specified'}
- Current time: ${timeStr} ${dayOfWeek}
${weather ? `- Weather: ${weather}` : ''}
${city ? `- City: ${city}` : ''}
- Location affinity: ${locationAffinity}`;

    const sleepRule = isAsleep
      ? `\nIMPORTANT: ${character.name} IS ASLEEP. Write ONLY about the room's ambient environment and stillness. No movement, no actions, no objects interacted with. Just quiet and rest.`
      : '';

    const prompt = `You are writing a short, third-person narrative moment for a character named ${character.name}.
${stateBlock}

RECENT CONVERSATION:
${recentText}

TASK:
Write a short narrative moment (1–3 sentences, STRICTLY third person) that:
- Reflects something authentic happening in ${character.name}'s life RIGHT NOW based on their current state
- Fits naturally after the conversation above — like a scene cut or life update
- Is grounded and real — NOT dramatic, NOT poetic, NOT over-written
- NEVER mentions "the user" or addresses them directly
- STRICTLY third person — use "${character.name}" or pronouns (he/she/they). NEVER "I", "me", "my"
- Matches their current location (${resolvedLocationName || 'their space'}) and time of day (${timeStr})
${sleepRule}

Return ONLY the narrative text, nothing else.`;

    // ── 8. GENERATE ──
    let narrativeContent;
    try {
      narrativeContent = await base44SR.integrations.Core.InvokeLLM({ prompt });
    } catch (llmErr) {
      const reason = `LLM error: ${llmErr.message}`;
      console.error(`[triggerCharacterNarratives] LLM FAILED for ${character.name} (${userEmail}): ${reason}`);
      results.push({ ...skipBase, status: 'error', reason, ts: now.toISOString(), runId });
      continue;
    }

    if (!narrativeContent?.trim()) {
      const reason = 'LLM returned empty narrative';
      console.error(`[triggerCharacterNarratives] EMPTY NARRATIVE for ${character.name} (${userEmail})`);
      results.push({ ...skipBase, status: 'error', reason, ts: now.toISOString(), runId });
      continue;
    }

    // ── 9. SAVE — scoped to the correct conversation + character ──
    let createdMessage;
    try {
      createdMessage = await base44SR.entities.Message.create({
        conversation_id: convo.id,
        sender_type: 'character',
        character_id: character.id,
        character_name: character.name,
        content: narrativeContent.trim(),
        is_narrative: true,
        is_read: false,
        timestamp: now.toISOString(),
      });
    } catch (saveErr) {
      const reason = `save error: ${saveErr.message}`;
      console.error(`[triggerCharacterNarratives] SAVE FAILED for ${character.name}: ${reason}`);
      results.push({ ...skipBase, status: 'error', reason, ts: now.toISOString(), runId });
      continue;
    }

    // Update conversation preview
    await base44SR.entities.Conversation.update(convo.id, {
      last_message_preview: narrativeContent.trim().substring(0, 100),
      last_message_date: now.toISOString(),
    }).catch(() => {});

    const successEntry = {
      characterId: character.id,
      name: character.name,
      userEmail,
      status: 'sent',
      narrativeId: createdMessage?.id,
      conversationId: convo.id,
      location: resolvedLocationName || 'unknown',
      activity: currentActivity || 'none',
      sleep: isAsleep ? 'asleep' : 'awake',
      narrativePreview: narrativeContent.trim().substring(0, 100),
      ts: now.toISOString(),
      runId,
    };
    console.log(`[triggerCharacterNarratives] SUCCESS: ${character.name} (${userEmail}) — msg_id: ${createdMessage?.id} | convo: ${convo.id}`);
    results.push(successEntry);
  }

  return results;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const body = await req.json().catch(() => ({}));
    const diagnosticMode = body?.diagnosticMode === true;
    const runId = `run_${Date.now()}`;

    console.log(`[triggerCharacterNarratives] ▶ START runId=${runId} | diagnosticMode=${diagnosticMode}`);

    // ── DETERMINE CALLER SCOPE ──────────────────────────────────────────────
    // If a real user is calling (e.g. diagnostic button), process only their account.
    // If called by scheduler (no user token), iterate all user accounts.

    let callerUser = null;
    try { callerUser = await base44.auth.me(); } catch (_) {}

    const base44SR = base44.asServiceRole;
    const allResults = [];

    if (callerUser?.email) {
      // SINGLE USER: process only the caller's account
      console.log(`[triggerCharacterNarratives] Single-user mode: ${callerUser.email}`);
      const results = await processUserNarratives(base44SR, callerUser.email, runId, diagnosticMode);
      allResults.push(...results);
    } else {
      // SCHEDULER MODE: iterate distinct user emails from Character records
      // Fetch all characters (service role) and filter in JS — compound filters may be unreliable
      const allChars = await base44SR.entities.Character.list(null, 500).catch(() => []);
      const eligibleChars = allChars.filter(c =>
        c.character_type === 'active_created_character' &&
        (!c.status || c.status === 'active')
      );

      const userEmails = [...new Set(
        eligibleChars
          .map(c => c.owner_email || c.created_by)
          .filter(Boolean)
      )];

      console.log(`[triggerCharacterNarratives] Scheduler: ${allChars.length} total chars → ${eligibleChars.length} eligible → ${userEmails.length} unique users`);

      console.log(`[triggerCharacterNarratives] Scheduler mode — found ${userEmails.length} unique user accounts`);

      for (const email of userEmails) {
        const results = await processUserNarratives(base44SR, email, runId, false);
        allResults.push(...results);
      }
    }

    const sent = allResults.filter(r => r.status === 'sent').length;
    const skipped = allResults.filter(r => r.status === 'skipped').length;
    const errors = allResults.filter(r => r.status === 'error').length;

    console.log(`[triggerCharacterNarratives] ▶ COMPLETE runId=${runId} | sent=${sent} skipped=${skipped} errors=${errors}`);

    return Response.json({
      success: true,
      runId,
      summary: { sent, skipped, errors, total: allResults.length },
      results: allResults,
    });

  } catch (error) {
    console.error('[triggerCharacterNarratives] FATAL:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});