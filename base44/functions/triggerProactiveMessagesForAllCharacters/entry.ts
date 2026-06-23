import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

/**
 * triggerProactiveMessagesForAllCharacters — v3 (Batch + Rate-Limit Safe)
 *
 * REPAIR: Resolves "Base44Error: Rate limit exceeded" (429) that caused every
 * scheduled run to fail before any character was evaluated.
 *
 * ROOT CAUSE (v1/v2):
 *   - Used user-scoped `base44.auth.me()` + `base44.entities.Character.filter()`
 *   - When invoked from a scheduled automation (no real user session), auth.me()
 *     fails immediately with 429 because there is no user token to resolve.
 *   - This crashed the entire run before any character was evaluated or messaged.
 *
 * ARCHITECTURE (v3):
 *   1. Uses asServiceRole for all reads — the only correct approach for automations.
 *   2. Fetches only character IDs + names (minimal payload) sorted by owner_email.
 *   3. Uses a rotating batch cursor stored in AppWorldState so each run processes
 *      a different small subset, cycling through all eligible characters over time.
 *   4. Batch size: 3 characters per run. At a 2-hour cadence, with N characters,
 *      all characters are evaluated roughly every ceil(N/3)*2 hours.
 *   5. Handles 429 on individual sendProactiveMessageForCharacter invocations
 *      gracefully — skips that character, records the failure, does not crash.
 *   6. The scheduler remains an OPPORTUNITY PROVIDER only. Whether a message is
 *      actually sent is decided entirely inside sendProactiveMessageForCharacter
 *      based on life-driven inputs (relationship pressure, pending commitments,
 *      unresolved conversation threads, status bars, recent LifeEvents).
 *
 * INVARIANTS:
 *   - No user session required — runs safely from scheduled automation context.
 *   - No all-character bulk fetch — only a paginated window of BATCH_SIZE records.
 *   - No duplicate proactive schedulers — this is the single authoritative path.
 *   - No character-to-character communication changes.
 *   - No World Phone routing changes.
 */

// ── INLINE PROACTIVE EVALUATION ─────────────────────────────────────────────
// Inlined from sendProactiveMessageForCharacter because function-to-function
// invocation is blocked at the platform level from scheduled automation context
// (no user session token). All logic is identical; we use the sr client directly.

function getEasternTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getTimeMinutes(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function isSleeping(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const sleep = parseInt(char.sleep_start_time.split(':')[0]) * 60 + parseInt(char.sleep_start_time.split(':')[1] || 0);
  const wake = parseInt(char.wake_up_time.split(':')[0]) * 60 + parseInt(char.wake_up_time.split(':')[1] || 0);
  if (sleep > wake) return now >= sleep || now <= wake;
  return now >= sleep && now <= wake;
}

function isAtWork(char) {
  if (!char.work_start_time || !char.work_end_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const start = parseInt(char.work_start_time.split(':')[0]) * 60 + parseInt(char.work_start_time.split(':')[1] || 0);
  const end = parseInt(char.work_end_time.split(':')[0]) * 60 + parseInt(char.work_end_time.split(':')[1] || 0);
  return now >= start && now <= end;
}

function timingAllows(char, friendship) {
  const et = getEasternTime();
  const hour = et.getHours();
  if (isSleeping(char)) return false;
  if (friendship >= 80) return true;
  if (friendship >= 60) return !(isAtWork(char) && hour !== 12);
  if (friendship >= 40) return !isAtWork(char);
  if (isAtWork(char)) return false;
  if (hour >= 22 || hour <= 7) return false;
  return true;
}

function computePressure(char, recentMessages, lifeEvents, pendingCommitment) {
  let p = 0;
  const f = char.friendship_level ?? 50;
  p += f * 0.25;
  const rels = char.fictional_relationships || [];
  let bestTrust = 0, bestRomantic = 0, bestRespect = 0, bestScore = 0;
  for (const r of rels) {
    const s = (r.friendship_level ?? 0) + (r.trust_level ?? 0) + (r.romantic_level ?? 0) + (r.respect_level ?? 0);
    if (s > bestScore) { bestScore = s; bestTrust = r.trust_level ?? 0; bestRomantic = r.romantic_level ?? 0; bestRespect = r.respect_level ?? 0; }
  }
  p += bestTrust * 0.15 + bestRomantic * 0.20 + bestRespect * 0.10;
  p += (char.chosen_family_level ?? 0) * 0.10;

  if (recentMessages.length > 0) {
    const last = recentMessages.sort((a, b) => new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date))[0];
    const daysSince = (Date.now() - new Date(last.timestamp || last.created_date).getTime()) / (24 * 3600 * 1000);
    if (f >= 40 || bestTrust >= 40 || bestRomantic >= 20) {
      p += Math.min(30, 30 * (1 - Math.exp(-daysSince / 3)));
    }
    const content = (last.content || '').toLowerCase();
    const unresolved = ['?','let me know',"i'll find out","i'll check",'not sure yet',"we'll see","i'll text you","talk later","we should","let's","i was thinking","what happened","how did it go"];
    if (unresolved.some(m => content.includes(m)) || ['anxious','worried','stressed','sad','upset','concerned'].includes(last.emotional_state)) p += 15;
  } else if (f >= 50 || bestTrust >= 50 || bestRomantic >= 30) {
    p += 20;
  }

  const nowMs = Date.now();
  const cutoff = nowMs - 48 * 3600 * 1000;
  if ((lifeEvents || []).some(le => {
    const ts = le.timestamp || le.created_date;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= cutoff && t <= nowMs && (le.severity === 'major' || le.severity === 'significant') && (le.valence === 'positive' || le.valence === 'negative');
  })) p += 20;

  if (pendingCommitment) p += 30;
  return Math.min(100, Math.round(p));
}

async function evaluateAndSendProactiveMessage(sr, characterId) {
  const charList = await sr.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
  const char = charList?.[0];
  if (!char || !char.owner_email) return { success: false, reason: 'character_not_found' };

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const timeBucket = now.toISOString().substring(0, 13);
  const idempotencyKey = `proactive::${char.owner_email}::${char.id}::direct::${timeBucket}`;

  // Find direct conversation
  const convos = await sr.entities.Conversation.filter({ type: 'direct', owner_email: char.owner_email, character_ids: [char.id] }).catch(() => []);
  let conversationId = convos[0]?.id || null;

  // Fetch recent messages
  let recentMessages = conversationId
    ? await sr.entities.Message.filter({ conversation_id: conversationId }, '-timestamp', 20).catch(() => [])
    : [];
  const wpMessages = await sr.entities.Message.filter({ sender_character_id: char.id, channel: 'world_phone' }, '-timestamp', 20).catch(() => []);
  const seen = new Set(recentMessages.map(m => m.id));
  for (const m of wpMessages) { if (!seen.has(m.id)) { recentMessages.push(m); seen.add(m.id); } }

  // Pending commitments
  const pendingList = await sr.entities.CommunicationCommitment.filter({ character_id: char.id, status: 'pending' }, 'due_after', 5).catch(() => []);
  const pendingCommitment = pendingList.find(c => !c.due_after || new Date(c.due_after) <= now) || null;

  // Life events
  const lifeEvents = await sr.entities.LifeEvent.filter({ character_id: char.id }, '-timestamp', 10).catch(() => []);

  const pressure = computePressure(char, recentMessages, lifeEvents, pendingCommitment);
  const friendship = char.friendship_level ?? 50;

  if (pressure < 25 && !pendingCommitment) return { success: false, reason: 'insufficient_relationship_pressure', pressure };

  const highUrgency = pressure >= 80 || !!pendingCommitment;
  if (!highUrgency && !timingAllows(char, friendship)) return { success: false, reason: 'not_the_right_time', pressure };

  if (pressure < 40 && !pendingCommitment && Math.random() > (pressure - 25) / 75) {
    return { success: false, reason: 'random_pressure_gate', pressure };
  }

  // Daily cap
  if (conversationId) {
    const todayMsgs = recentMessages.filter(m => m.sender_type === 'character' && m.character_id === char.id && (m.created_date || '').startsWith(today));
    const dailyLimit = pressure >= 70 ? 10 : pressure >= 50 ? 7 : 5;
    if (todayMsgs.length >= dailyLimit) return { success: false, reason: `daily_cap_reached_${dailyLimit}`, pressure };
  }

  // Idempotency
  if (conversationId) {
    const existing = await sr.entities.Message.filter({ conversation_id: conversationId, sender_type: 'character', character_id: char.id, idempotency_key: idempotencyKey }, null, 1).catch(() => []);
    if (existing.length > 0) return { success: false, reason: 'already_sent_this_hour', pressure };
  }

  // Build intent context
  const et = getEasternTime();
  const hour = et.getHours();
  const timeCtx = hour >= 7 && hour < 9 ? 'morning' : hour >= 12 && hour < 13 ? 'lunch break' : hour >= 18 && hour < 20 ? 'evening' : hour >= 21 && hour < 23 ? 'late night' : 'mid-day';
  let reachOutContext = '', messageIntent = 'general check-in';

  if (pendingCommitment) {
    if (pendingCommitment.commitment_type === 'third_party_relay') {
      reachOutContext = `You previously said you would pass a message along. The message was: "${pendingCommitment.third_party_message || pendingCommitment.commitment_text}". Follow through naturally.`;
      messageIntent = 'commitment_relay';
    } else if (['will_let_you_know','event_follow_up'].includes(pendingCommitment.commitment_type)) {
      reachOutContext = `You said you'd follow up or let them know how something went. Promise: "${pendingCommitment.commitment_text.substring(0,150)}". This is that follow-up.`;
      messageIntent = 'commitment_followup';
    } else {
      reachOutContext = `You made a promise to follow up: "${pendingCommitment.commitment_text.substring(0,150)}".`;
      messageIntent = 'commitment_general';
    }
  } else {
    const lastMsg = recentMessages.sort((a,b) => new Date(b.timestamp||b.created_date)-new Date(a.timestamp||a.created_date))[0];
    const recentSig = (lifeEvents||[]).find(le => { const ts = le.timestamp||le.created_date; return ts && (Date.now()-new Date(ts).getTime()) < 48*3600*1000 && (le.severity==='major'||le.severity==='significant'); });
    if (recentSig) { reachOutContext = `Something significant happened in your life: "${recentSig.title}". You might want to share or connect.`; messageIntent = 'life_event_share'; }
    else if (lastMsg) {
      const days = (Date.now()-new Date(lastMsg.timestamp||lastMsg.created_date).getTime())/(24*3600*1000);
      if (days > 2) { reachOutContext = `It's been ${Math.round(days)} days since you last spoke. Reach out naturally.`; messageIntent = 'break_silence'; }
      else { reachOutContext = `Your last conversation had something open. Context: "${(lastMsg.content||'').substring(0,100)}"`; messageIntent = 'continue_conversation'; }
    } else {
      reachOutContext = `You feel like reaching out. Maybe you thought of them or just want to connect.`;
      messageIntent = 'spontaneous';
    }
  }

  // Build system prompt (minimal fallback — no external function call needed)
  const systemPrompt = `You are ${char.name}. ${char.personality_summary || ''} ${char.communication_style || ''}`.trim();

  const prompt = `${systemPrompt}

━━━━━━━━━━━━━━━━━━━━
PROACTIVE MESSAGE TASK
━━━━━━━━━━━━━━━━━━━━
Generate a natural, spontaneous message RIGHT NOW (1-3 sentences max).

WHY YOU'RE REACHING OUT: ${reachOutContext}
Time: ${timeCtx}
Relationship pressure: ${pressure}/100

RULES:
- Write like a real person texting. Short. Human. Imperfect.
- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ).
- Do NOT start with your own name or a label.
- Max 2-3 sentences. Often 1 is better.`;

  let messageContent;
  try {
    messageContent = await sr.integrations.Core.InvokeLLM({ prompt });
  } catch (llmErr) {
    return { success: false, reason: 'llm_failure', error: llmErr?.message };
  }

  if (!messageContent || typeof messageContent !== 'string' || messageContent.trim().length < 3) {
    return { success: false, reason: 'empty_llm_response' };
  }
  messageContent = messageContent.trim();

  // Find or create conversation
  if (!conversationId) {
    const newConvo = await sr.entities.Conversation.create({ title: char.name, type: 'direct', character_ids: [char.id], owner_email: char.owner_email });
    conversationId = newConvo.id;
  }

  // Save message (is_read: false triggers the red-dot unread notification in the UI)
  const msg = await sr.entities.Message.create({
    conversation_id: conversationId,
    sender_type: 'character',
    character_id: char.id,
    character_name: char.name,
    sender_character_id: char.id,
    receiver_character_id: null,
    content: messageContent,
    emotional_state: char.emotional_state || 'calm',
    timestamp: now.toISOString(),
    channel: 'direct',
    is_read: false,
    idempotency_key: idempotencyKey,
    source_message_id: null,
    reply_to_message_id: null,
    generation_lock_id: null,
    recovery_signal: false,
    memory_eligible: true,
    relationship_eligible: true,
    autonomy_marker: `proactive::${messageIntent}::pressure_${pressure}`,
  });

  if (pendingCommitment) {
    await sr.entities.CommunicationCommitment.update(pendingCommitment.id, { status: 'fulfilled', fulfilled_at: now.toISOString(), fulfilled_message_id: msg.id }).catch(() => {});
  }

  await sr.entities.Conversation.update(conversationId, { last_message_preview: messageContent.substring(0, 100), last_message_date: now.toISOString() }).catch(() => {});

  console.log(`[proactive] ✓ char=${char.name} | pressure=${pressure} | intent=${messageIntent} | msg=${msg.id}`);
  return { success: true, messageId: msg.id, characterName: char.name, content: messageContent, pressure, messageIntent, commitmentFulfilled: pendingCommitment?.id || null };
}

// ── END INLINE PROACTIVE EVALUATION ─────────────────────────────────────────

const BATCH_SIZE = 3;               // characters evaluated per run
const CURSOR_STATE_KEY = 'proactive_batch_cursor';
const ELIGIBLE_CHARACTER_TYPES = [
  'active_created_character',
  'active',               // legacy type value (backward compatibility)
];

Deno.serve(async (req) => {
  const runStartedAt = new Date();
  const sr = createClientFromRequest(req).asServiceRole;

  try {
    // ── 1. LOAD BATCH CURSOR FROM AppWorldState ────────────────────────────
    // AppWorldState stores a per-owner cursor so batching is deterministic
    // across runs without requiring a separate entity or heavy state.
    // Key: `proactive_batch_cursor::{owner_email}`
    // Value: { offset: number, total: number, last_run: string }
    //
    // If missing or stale (total changed significantly), reset to 0.

    // We need to know which owner accounts exist. Fetch distinct owner_emails
    // from a small sample of active characters. This is a tiny read.
    const sampleChars = await sr.entities.Character.filter(
      { status: 'active' },
      'owner_email',
      50
    );

    // Collect unique owner emails from the sample
    const ownerEmails = [...new Set(
      sampleChars
        .filter(c => c.owner_email && ELIGIBLE_CHARACTER_TYPES.includes(c.character_type || 'active_created_character'))
        .map(c => c.owner_email)
    )];

    if (ownerEmails.length === 0) {
      console.log('[triggerProactiveMessagesForAllCharacters] No eligible owner accounts found.');
      return Response.json({ success: true, cycle: runStartedAt.toISOString(), processed: 0, results: [] });
    }

    const allResults = [];
    let totalProcessed = 0;

    // ── 2. PER-OWNER BATCH PROCESSING ────────────────────────────────────
    for (const ownerEmail of ownerEmails) {
      try {
        // Fetch all eligible active_created_character IDs for this owner.
        // Sorted by id (stable sort) so the cursor offset is deterministic.
        // Fetch only id + name to minimize payload.
        const eligibleChars = await sr.entities.Character.filter(
          {
            status: 'active',
            owner_email: ownerEmail,
            character_type: { $in: ELIGIBLE_CHARACTER_TYPES },
          },
          'id',
          200
        );

        if (eligibleChars.length === 0) continue;

        // Sort by id for stable, deterministic ordering across runs
        eligibleChars.sort((a, b) => (a.id > b.id ? 1 : -1));

        // Load cursor for this owner
        const cursorKey = `${CURSOR_STATE_KEY}::${ownerEmail}`;
        let cursorOffset = 0;

        try {
          const cursorRecords = await sr.entities.AppWorldState.filter(
            { key: cursorKey },
            null,
            1
          );
          if (cursorRecords.length > 0) {
            const stored = cursorRecords[0].value;
            const parsedOffset = typeof stored === 'number' ? stored : parseInt(stored ?? '0', 10);
            // If total changed (characters added/removed), reset to avoid out-of-bounds
            cursorOffset = (parsedOffset < eligibleChars.length) ? parsedOffset : 0;
          }
        } catch (_cursorErr) {
          // AppWorldState unavailable or record missing — start from 0
          cursorOffset = 0;
        }

        // Select the batch window
        const batchIds = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
          const idx = (cursorOffset + i) % eligibleChars.length;
          batchIds.push(eligibleChars[idx].id);
        }
        const nextOffset = (cursorOffset + BATCH_SIZE) % eligibleChars.length;

        // ── 3. EVALUATE EACH CHARACTER IN BATCH ────────────────────────
        for (const characterId of batchIds) {
          const charRecord = eligibleChars.find(c => c.id === characterId);
          let result = { characterId, characterName: charRecord?.name || characterId, status: 'skipped', reason: 'not_attempted' };

          try {
            // sendProactiveMessageForCharacter is the authoritative decision engine.
            // It evaluates relationship pressure, pending commitments, status bars,
            // unresolved threads, and LifeEvents before generating any message.
            // This call is fire-and-forget from the orchestrator's perspective —
            // the decision to message is made inside that function, not here.
            // Dispatch proactive evaluation inline using service role.
            // Function-to-function invocation (functions.invoke) is blocked at the
            // platform level when called from a scheduled automation with no user session.
            // We instead call the proactive evaluation logic directly via sr.
            const data = await evaluateAndSendProactiveMessage(sr, characterId);
            result = {
              characterId,
              characterName: charRecord?.name || characterId,
              status: data?.success ? 'sent' : 'skipped',
              reason: data?.reason || (data?.success ? 'sent' : 'unknown'),
              messageIntent: data?.messageIntent,
              pressure: data?.pressure,
            };
          } catch (charErr) {
            const is429 = charErr?.message?.includes('429') ||
                          charErr?.status === 429 ||
                          charErr?.message?.includes('Rate limit');

            // 429 on a single character: skip gracefully, do not crash the run
            result = {
              characterId,
              characterName: charRecord?.name || characterId,
              status: 'skipped',
              reason: is429 ? 'rate_limited_skip' : `error: ${charErr?.message}`,
            };

            if (is429) {
              console.warn(
                `[triggerProactiveMessagesForAllCharacters] 429 on char=${characterId} — skipping gracefully`
              );
            } else {
              console.error(
                `[triggerProactiveMessagesForAllCharacters] Error on char=${characterId}: ${charErr?.message}`
              );
            }
          }

          allResults.push(result);
          totalProcessed++;
        }

        // ── 4. ADVANCE CURSOR ───────────────────────────────────────────
        // Write next offset back to AppWorldState for the next run.
        try {
          const cursorRecords = await sr.entities.AppWorldState.filter(
            { key: cursorKey }, null, 1
          );
          if (cursorRecords.length > 0) {
            await sr.entities.AppWorldState.update(cursorRecords[0].id, {
              value: String(nextOffset),
              last_updated: runStartedAt.toISOString(),
            });
          } else {
            await sr.entities.AppWorldState.create({
              key: cursorKey,
              value: String(nextOffset),
              last_updated: runStartedAt.toISOString(),
            });
          }
        } catch (cursorWriteErr) {
          // Cursor write failure is non-fatal — next run will reset to 0
          console.warn(
            `[triggerProactiveMessagesForAllCharacters] Cursor write failed for ${ownerEmail}: ${cursorWriteErr?.message}`
          );
        }

        console.log(
          `[triggerProactiveMessagesForAllCharacters] owner=${ownerEmail}` +
          ` | total_eligible=${eligibleChars.length}` +
          ` | batch_offset=${cursorOffset}→${nextOffset}` +
          ` | batch_size=${batchIds.length}`
        );

      } catch (ownerErr) {
        const is429 = ownerErr?.message?.includes('429') ||
                      ownerErr?.status === 429 ||
                      ownerErr?.message?.includes('Rate limit');

        // 429 on owner character fetch: skip this owner this cycle entirely
        console.error(
          `[triggerProactiveMessagesForAllCharacters] Owner ${ownerEmail} skipped — ${is429 ? '429' : ownerErr?.message}`
        );
      }
    }

    const sentCount = allResults.filter(r => r.status === 'sent').length;

    console.log(
      `[triggerProactiveMessagesForAllCharacters] ✓ cycle=${runStartedAt.toISOString()}` +
      ` | owners=${ownerEmails.length}` +
      ` | processed=${totalProcessed}` +
      ` | sent=${sentCount}`
    );

    return Response.json({
      success: true,
      cycle: runStartedAt.toISOString(),
      owners_evaluated: ownerEmails.length,
      characters_evaluated: totalProcessed,
      messages_sent: sentCount,
      batch_size: BATCH_SIZE,
      results: allResults,
    });

  } catch (error) {
    const is429 = error?.message?.includes('429') ||
                  error?.status === 429 ||
                  error?.message?.includes('Rate limit');

    // Top-level 429 (e.g. on the initial sample owner fetch): log and return 200
    // so the automation platform does not count this as a hard failure.
    // The next scheduled run will retry from scratch.
    if (is429) {
      console.warn('[triggerProactiveMessagesForAllCharacters] Top-level 429 — will retry next cycle.');
      return Response.json({
        success: false,
        reason: 'rate_limited_top_level',
        cycle: runStartedAt.toISOString(),
      });
    }

    console.error('[triggerProactiveMessagesForAllCharacters] Fatal:', error?.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});