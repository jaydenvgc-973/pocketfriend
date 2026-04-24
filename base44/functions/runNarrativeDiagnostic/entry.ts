import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * runNarrativeDiagnostic
 *
 * Developer-only diagnostic tool.
 * Runs the same logic as triggerCharacterNarratives but:
 * - Bypasses the 40% random gate
 * - Returns full detail on every character evaluated
 * - Explains exactly why each was skipped or sent
 * - Confirms where narratives were saved
 * - Does NOT require a scheduler token
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const runId = `diag_${Date.now()}`;
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    console.log(`[runNarrativeDiagnostic] ▶ START user=${user.email} runId=${runId}`);

    const report = {
      runId,
      user: user.email,
      timestamp: now.toISOString(),
      characters: [],
      summary: { total: 0, eligible: 0, skipped: 0, sent: 0, errors: 0 },
    };

    // ACCOUNT-SCOPED: fetch this user's characters, filter in JS
    const rawChars = await base44.entities.Character.filter(
      { created_by: user.email },
      null, 100
    ).catch(() => []);
    const userChars = rawChars.filter(c => !c.status || c.status === 'active');

    report.summary.total = userChars.length;
    console.log(`[runNarrativeDiagnostic] Found ${userChars.length} total active characters for ${user.email}`);

    for (const character of userChars) {
      const charReport = {
        characterId: character.id,
        name: character.name,
        type: character.character_type,
        status: null,
        reason: null,
        checks: {},
        stateSnapshot: {
          location: character.resolved_current_location_name || null,
          presenceStatus: character.resolved_presence_status || null,
          activity: character.current_activity || null,
          emotionalState: character.emotional_state || 'calm',
          sleepStartTime: character.sleep_start_time || null,
          wakeUpTime: character.wake_up_time || null,
          occupation: character.occupation || null,
        },
        narrativeCreated: null,
      };

      // Check 1: type
      charReport.checks.isActiveCreatedCharacter = character.character_type === 'active_created_character';
      if (!charReport.checks.isActiveCreatedCharacter) {
        charReport.status = 'skipped';
        charReport.reason = `character_type is "${character.character_type}" — only "active_created_character" receives auto-narratives`;
        report.summary.skipped++;
        report.characters.push(charReport);
        continue;
      }

      // Check 2: has conversation
      // character_ids is an array field — filter in JS after fetching by created_by
      const allConvos = await base44.entities.Conversation.filter(
        { type: 'direct', created_by: user.email },
        '-last_message_date', 50
      ).catch(() => []);
      const convos = allConvos.filter(c =>
        Array.isArray(c.character_ids) && c.character_ids.includes(character.id)
      ).slice(0, 1);
      charReport.checks.hasConversation = convos.length > 0;
      if (!charReport.checks.hasConversation) {
        charReport.status = 'skipped';
        charReport.reason = 'no direct conversation found for this user + character combination';
        report.summary.skipped++;
        report.characters.push(charReport);
        continue;
      }

      const convo = convos[0];
      charReport.conversationId = convo.id;
      charReport.lastMessageDate = convo.last_message_date;

      // Check 3: recent activity
      charReport.checks.conversationActiveIn24h = !!(convo.last_message_date && convo.last_message_date >= oneDayAgo);
      if (!charReport.checks.conversationActiveIn24h) {
        charReport.status = 'skipped';
        charReport.reason = `conversation inactive — last message: ${convo.last_message_date || 'never'} (needs to be within 24h)`;
        report.summary.skipped++;
        report.characters.push(charReport);
        continue;
      }

      // Check 4: narrative cooldown
      const recentNarratives = await base44.entities.Message.filter(
        { conversation_id: convo.id, is_narrative: true },
        '-timestamp', 5
      ).catch(() => []);
      const lastNarrativeTs = recentNarratives[0]?.timestamp || null;
      charReport.checks.narrativeCooldownClear = !recentNarratives.some(m => m.timestamp >= twoHoursAgo);
      charReport.lastNarrativeTimestamp = lastNarrativeTs;
      if (!charReport.checks.narrativeCooldownClear) {
        charReport.status = 'skipped';
        charReport.reason = `narrative cooldown active — last narrative was at ${lastNarrativeTs} (< 2h ago)`;
        report.summary.skipped++;
        report.characters.push(charReport);
        continue;
      }

      // Check 5: minimum messages
      const recentMessages = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        '-timestamp', 15
      ).catch(() => []);
      charReport.checks.hasEnoughMessages = recentMessages.length >= 3;
      charReport.messageCount = recentMessages.length;
      if (!charReport.checks.hasEnoughMessages) {
        charReport.status = 'skipped';
        charReport.reason = `only ${recentMessages.length} messages in conversation (need 3+)`;
        report.summary.skipped++;
        report.characters.push(charReport);
        continue;
      }

      // Determine sleep state for reporting
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hourET = nowET.getHours();
      let isAsleep = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
      if (!isAsleep && character.sleep_start_time && character.wake_up_time) {
        const sH = parseInt(character.sleep_start_time.split(':')[0], 10);
        const wH = parseInt(character.wake_up_time.split(':')[0], 10);
        isAsleep = sH > wH ? (hourET >= sH || hourET < wH) : (hourET >= sH && hourET < wH);
      }
      charReport.stateSnapshot.isAsleep = isAsleep;
      charReport.stateSnapshot.currentTimeET = `${hourET % 12 || 12}:${String(nowET.getMinutes()).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;

      // All checks passed — attempt to generate
      report.summary.eligible++;
      charReport.checks.allPassed = true;

      const recentText = recentMessages
        .slice(0, 5)
        .reverse()
        .map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content || '(photo)'}`)
        .join('\n');

      const sleepRule = isAsleep
        ? `\n${character.name} IS ASLEEP. Write ONLY about ambient environment and stillness.`
        : '';

      const prompt = `Write a short third-person narrative moment (1–3 sentences) for ${character.name}.
Location: ${character.resolved_current_location_name || 'their space'}
Sleep: ${isAsleep ? 'ASLEEP' : 'AWAKE'}
Emotion: ${character.emotional_state || 'calm'}
Activity: ${character.current_activity || 'going about their day'}
Time: ${charReport.stateSnapshot.currentTimeET}
${sleepRule}

Recent conversation:
${recentText}

Return ONLY the narrative text.`;

      try {
        const narrativeContent = await base44.integrations.Core.InvokeLLM({ prompt });
        if (!narrativeContent?.trim()) throw new Error('LLM returned empty narrative');

        const createdMsg = await base44.entities.Message.create({
          conversation_id: convo.id,
          sender_type: 'character',
          character_id: character.id,
          character_name: character.name,
          content: narrativeContent.trim(),
          is_narrative: true,
          is_read: false,
          timestamp: now.toISOString(),
        });

        await base44.entities.Conversation.update(convo.id, {
          last_message_preview: narrativeContent.trim().substring(0, 100),
          last_message_date: now.toISOString(),
        }).catch(() => {});

        charReport.status = 'sent';
        charReport.reason = 'all checks passed — narrative generated and saved';
        charReport.narrativeCreated = {
          messageId: createdMsg?.id,
          conversationId: convo.id,
          savedFor: user.email,
          preview: narrativeContent.trim().substring(0, 120),
        };
        report.summary.sent++;
        console.log(`[runNarrativeDiagnostic] ✓ SENT: ${character.name} — msgId=${createdMsg?.id}`);
      } catch (err) {
        charReport.status = 'error';
        charReport.reason = `generation/save error: ${err.message}`;
        report.summary.errors++;
        console.error(`[runNarrativeDiagnostic] ✗ ERROR: ${character.name} — ${err.message}`);
      }

      report.characters.push(charReport);
    }

    console.log(`[runNarrativeDiagnostic] ▶ COMPLETE: total=${report.summary.total} eligible=${report.summary.eligible} sent=${report.summary.sent} skipped=${report.summary.skipped} errors=${report.summary.errors}`);

    return Response.json({ success: true, report });

  } catch (error) {
    console.error('[runNarrativeDiagnostic] FATAL:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});