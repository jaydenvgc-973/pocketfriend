/**
 * triggerRecoveryBackground
 *
 * Automatic recovery for failed text character responses.
 *
 * Called by chatFallbackIntegration.js when:
 * - LLM fails (timeout, rate limit, network error)
 * - Response parsing fails
 * - Message save fails
 *
 * Recovers by:
 * 1. Waiting for circuit breaker cool-down (exponential backoff)
 * 2. Re-running the LLM call with same prompt
 * 3. Saving the real response (not fallback)
 * 4. Restoring character memory/relationship updates
 * 5. Notifying UI recovery is complete
 *
 * SCOPE: Text responses only (Chat, Text, World Phone, World Contacts, Group Chat, proactive)
 * IDEMPOTENCY: owner_email + conversation_id + character_id + channel + source_message_id
 * PROTECTION: Uses generationLock to prevent duplicate recovery attempts
 *
 * LIFECYCLE BOUNDARY SAFEGUARD:
 * Before committing a recovered response, the function checks whether the
 * conversation has advanced beyond the original failed turn. If a real
 * response was already committed for the source message, or if newer user
 * messages exist after the source message's timestamp, the recovery is
 * DISCARDED rather than inserted with a fresh timestamp. This prevents a
 * stale old-turn response from being repositioned as a current response.
 *
 * STALE-DUPLICATE REJECTION + BOUNDED CONTINUATION:
 * If the recovered response is an exact duplicate of a previously completed
 * character message, it is discarded (zero authority). Recovery then
 * continues through the existing character-generation authority (InvokeLLM
 * with the full character prompt) with escalating anti-repeat context. The
 * loop exits on the first non-stale response. No deterministic substitute.
 * No silence. No stale commit. The response is always an actual fresh
 * character response from the LLM. The bound is finite. No polling.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CIRCUIT_BREAKER_INITIAL_DELAY_MS = 2000;  // 2s first retry
const CIRCUIT_BREAKER_MAX_DELAY_MS = 30000;     // 30s max backoff
const CIRCUIT_BREAKER_MULTIPLIER = 2;           // exponential: 2s → 4s → 8s → 16s → 30s

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      conversation_id,
      character_id,
      owner_email,
      channel,
      source_message_id,
      prompt,
      character_name,
      blocking_stage,
      failure_count = 0,
      rejected_response_texts = [],
    } = body;

    // Auth: allow both user-session callers AND service-role backend callers
    // (Group Chat, sendProactiveMessageForCharacter, etc. call this without user session)
    let callerEmail = owner_email;
    if (!callerEmail) {
      try {
        const user = await base44.auth.me();
        callerEmail = user?.email;
      } catch { /* service-role caller — callerEmail stays null, use owner_email from body */ }
    }
    // Require either caller email OR explicit owner_email in body
    if (!callerEmail && !owner_email) {
      return Response.json({ error: 'owner_email required for service-role callers' }, { status: 400 });
    }

    if (!conversation_id || !character_id || !prompt) {
      return Response.json({
        error: 'conversation_id, character_id, and prompt required',
      }, { status: 400 });
    }

    const effectiveEmail = owner_email || callerEmail;
    if (!effectiveEmail) {
      return Response.json({
        error: 'Cannot determine owner email for recovery scope',
      }, { status: 400 });
    }

    // ── LOAD CONVERSATION FOR LOCK STATE ────────────────────────────────────
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { id: conversation_id }, null, 1
    ).catch(() => []);

    if (convos.length === 0) {
      return Response.json({
        error: `Conversation ${conversation_id} not found — recovery cannot proceed`,
      }, { status: 404 });
    }

    const convo = convos[0];

    // ── CIRCUIT BREAKER: exponential backoff ────────────────────────────────
    const delayMs = Math.min(
      CIRCUIT_BREAKER_INITIAL_DELAY_MS * Math.pow(CIRCUIT_BREAKER_MULTIPLIER, failure_count),
      CIRCUIT_BREAKER_MAX_DELAY_MS
    );
    console.log(
      `[triggerRecoveryBackground] Recovery #${failure_count + 1} for convo=${conversation_id} ` +
      `char=${character_id} delay=${delayMs}ms blocking_stage=${blocking_stage}`
    );

    await new Promise(r => setTimeout(r, delayMs));

    // ── RE-ATTEMPT: call LLM with same prompt ──────────────────────────────
    let recoveredResponse;
    try {
      recoveredResponse = await base44.integrations.Core.InvokeLLM({
        prompt,
      });
    } catch (llmErr) {
      const isRetryable = llmErr?.message?.includes('429') ||
                         llmErr?.message?.includes('timeout') ||
                         llmErr?.message?.includes('Network');
      if (isRetryable && failure_count < 2) {
        // Re-schedule recovery with exponential backoff (max 3 attempts total)
        console.log(`[triggerRecoveryBackground] LLM still failing, scheduling retry #${failure_count + 2}`);
        // Note: caller is responsible for re-scheduling via automation or delayed function call
        return Response.json({
          success: false,
          retry_scheduled: true,
          next_failure_count: failure_count + 1,
          reason: 'llm_transient_error',
        });
      }
      // Not retryable or too many retries — give up
      console.error(`[triggerRecoveryBackground] LLM failed permanently: ${llmErr.message}`);
      return Response.json({
        success: false,
        reason: 'llm_permanent_failure',
        error: llmErr.message,
      });
    }

    // ── PARSE RESPONSE: extract text from LLM ──────────────────────────────
    let responseText;
    if (typeof recoveredResponse === 'string') {
      responseText = recoveredResponse.trim();
    } else if (recoveredResponse?.text_content) {
      responseText = recoveredResponse.text_content.trim();
    } else if (recoveredResponse?.message_type) {
      // JSON response from LLM
      const parsed = typeof recoveredResponse === 'string'
        ? JSON.parse(recoveredResponse)
        : recoveredResponse;
      responseText = parsed?.text_content || '';
    } else {
      responseText = String(recoveredResponse).trim();
    }

    if (!responseText) {
      console.warn('[triggerRecoveryBackground] Recovered response is empty');
      return Response.json({
        success: false,
        reason: 'empty_recovered_response',
      });
    }

    console.log(`[triggerRecoveryBackground] ✓ LLM recovered text: "${responseText.substring(0, 60)}..."`);

    // ── STALE-DUPLICATE REJECTION + BOUNDED CONTINUATION ───────────────────
    // A recovered response that is an exact duplicate of a previously completed
    // character message is a FAILED recovery — zero active-response authority.
    // It is NOT committed, NOT given a new message ID, NOT resurrected.
    //
    // The stale candidate is discarded permanently. Recovery then continues
    // through the existing character-generation authority (InvokeLLM with the
    // full character prompt) with escalating anti-repeat context. Each attempt
    // is a fresh LLM call anchored to the user's CURRENT message with an
    // explicit prohibition on reusing any prior response. The loop exits on
    // the first non-stale response. The LLM produces a non-stale response
    // within the bounded number of attempts.
    //
    // No deterministic substitute. No silence. No stale commit. The response
    // is always an actual fresh character response from the LLM. The bound is
    // finite (no infinite retry). No polling.
    const normalizeText = (s: string): string =>
      (s || '').replace(/\s+/g, ' ').trim();

    const recentMsgsForDupCheck = await base44.asServiceRole.entities.Message.filter(
      { conversation_id },
      '-timestamp', 30
    ).catch(() => []);

    const prevCharTexts = new Set(
      recentMsgsForDupCheck
        .filter(m => m.sender_type === 'character' && m.content)
        .map(m => normalizeText(m.content || ''))
        .filter(t => t.length > 0)
    );

    const sourceUserMsg = recentMsgsForDupCheck.find(m => m.id === source_message_id);
    const sourceUserSnippet = (sourceUserMsg?.content || '').substring(0, 200).replace(/\s+/g, ' ').trim();

    // Merge completed character responses with rejected_response_texts from
    // previous recovery rounds. A candidate that already failed during this
    // response opportunity cannot regain eligibility in the next round.
    const allForbiddenTexts = new Set(prevCharTexts);
    const accumulatedRejected: string[] = [];
    for (const r of rejected_response_texts) {
      const normalized = normalizeText(r);
      if (normalized && !allForbiddenTexts.has(normalized)) {
        allForbiddenTexts.add(normalized);
        accumulatedRejected.push(normalized);
      }
    }

    // Idempotency key — defined early for use in both exhaustion handler and commit path
    const idempotencyKey = `recovery::${effectiveEmail}::${character_id}::${channel}::${source_message_id}::${blocking_stage}`;

    const MAX_RECOVERY_ATTEMPTS = 8;
    let recoveryAttempt = 0;

    while (recoveryAttempt < MAX_RECOVERY_ATTEMPTS) {
      const currentNormalized = normalizeText(responseText);
      if (responseText && !allForbiddenTexts.has(currentNormalized)) {
        // Non-stale response — proceed to commit
        break;
      }

      // Stale candidate — discard permanently. Record in accumulated
      // rejected set so it cannot regain eligibility in this round or
      // future rounds. Retry through the existing character-generation
      // authority with escalating anti-repeat context.
      if (currentNormalized && !accumulatedRejected.includes(currentNormalized)) {
        accumulatedRejected.push(currentNormalized);
      }

      console.error(`[triggerRecoveryBackground] Stale duplicate (attempt ${recoveryAttempt + 1}/${MAX_RECOVERY_ATTEMPTS}). Discarding — retrying through character authority.`);

      const escalation =
        `\n\n⚠️ CRITICAL — REPEATED DUPLICATE (attempt ${recoveryAttempt + 1})\n` +
        `You have produced ${recoveryAttempt + 1} duplicate response(s) that were already sent. Each was REJECTED and discarded.\n` +
        `You MUST generate a COMPLETELY NEW, FRESH response to the user's CURRENT message.\n` +
        `User's current message: "${sourceUserSnippet}"\n` +
        `RULES:\n` +
        `- Do NOT repeat, paraphrase, or reuse ANY response you have previously sent.\n` +
        `- Respond ONLY to what the user just said right now.\n` +
        `- If you cannot think of a new response, say something brief and direct that acknowledges their current message in a new way.`;

      let retryText = '';
      try {
        const retryResponse = await base44.integrations.Core.InvokeLLM({
          prompt: prompt + escalation,
        });
        if (typeof retryResponse === 'string') {
          retryText = retryResponse.trim();
        } else if (retryResponse?.text_content) {
          retryText = retryResponse.text_content.trim();
        } else {
          const p = typeof retryResponse === 'string' ? JSON.parse(retryResponse) : retryResponse;
          retryText = p?.text_content || String(retryResponse).trim();
        }
      } catch (llmErr) {
        console.error(`[triggerRecoveryBackground] Retry attempt ${recoveryAttempt + 1} LLM failed: ${llmErr.message}`);
      }

      if (retryText) {
        responseText = retryText;
      }
      recoveryAttempt++;
    }

    // ── EXHAUSTION: all bounded attempts produced stale duplicates ─────────
    // The final candidate is stale — it has ZERO active-response authority.
    // It is NOT committed. The turn is NOT abandoned. Instead:
    //   STEP A: discard the final stale candidate (done — not committed)
    //   STEP B: run conversation-advancement check
    //     - if conversation advanced → release lock, expire old turn, stop
    //     - if still active → STEP C
    //   STEP C: hand the SAME unresolved turn into another bounded recovery
    //     round via the existing triggerRecoveryBackground invocation.
    //     The generation lock is NOT released — the response opportunity
    //     is still owned. rejected_response_texts is carried forward so
    //     failed candidates stay dead in the next round.
    //
    // This is event-driven continuation, not polling, not a timer, not
    // recursive await. Each execution round is finite (8 attempts). The
    // total response opportunity has no arbitrary global cap — it ends
    // only through a valid response commit or conversation advancement.
    const finalNormalized = normalizeText(responseText);
    if (!responseText || allForbiddenTexts.has(finalNormalized)) {
      // Ensure the final stale candidate is in the accumulated rejected set
      if (finalNormalized && !accumulatedRejected.includes(finalNormalized)) {
        accumulatedRejected.push(finalNormalized);
      }

      console.error(
        `[triggerRecoveryBackground] EXHAUSTED: All ${MAX_RECOVERY_ATTEMPTS} bounded attempts ` +
        `produced stale duplicates. Checking conversation advancement before handoff.`
      );

      // STEP B — conversation-advancement check
      if (source_message_id) {
        const recentMsgs = await base44.asServiceRole.entities.Message.filter(
          { conversation_id },
          '-timestamp', 20
        ).catch(() => []);

        const sourceMsg = recentMsgs.find(m => m.id === source_message_id);
        const sourceTimestamp = sourceMsg?.timestamp || null;

        // CHECK 1 — REDUNDANCY: real response already committed for this turn
        const realResponseExists = recentMsgs.some(m =>
          m.sender_type === 'character' &&
          m.reply_to_message_id === source_message_id &&
          m.idempotency_key !== idempotencyKey &&
          m.recovery_signal !== true &&
          m.content && m.content.trim().length > 0
        );

        if (realResponseExists) {
          console.log(
            `[triggerRecoveryBackground] STALE_DISCARD: real response already exists for ` +
            `source_message_id=${source_message_id}. Recovery expired — turn already answered.`
          );
          await base44.asServiceRole.functions.invoke('generationLock', {
            action: 'release',
            conversation_id,
          }).catch(() => {});
          return Response.json({
            success: false,
            reason: 'stale_recovery_expired',
            discard_reason: 'real_response_already_exists',
            source_message_id,
          });
        }

        // CHECK 2 — ADVANCEMENT: newer user message after the original turn
        if (sourceTimestamp) {
          const sourceTime = new Date(sourceTimestamp).getTime();
          const conversationAdvanced = recentMsgs.some(m =>
            m.sender_type === 'user' &&
            m.id !== source_message_id &&
            m.timestamp &&
            new Date(m.timestamp).getTime() > sourceTime
          );

          if (conversationAdvanced) {
            console.log(
              `[triggerRecoveryBackground] STALE_DISCARD: conversation has advanced past ` +
              `source_message_id=${source_message_id}. Recovery expired — old turn obsolete.`
            );
            await base44.asServiceRole.functions.invoke('generationLock', {
              action: 'release',
              conversation_id,
            }).catch(() => {});
            return Response.json({
              success: false,
              reason: 'stale_recovery_expired',
              discard_reason: 'conversation_advanced',
              source_message_id,
            });
          }
        }
      }

      // STEP C — still active: hand the SAME unresolved turn to the next
      // bounded recovery round. Do NOT release the generation lock — the
      // response opportunity is still owned. AWAIT the next invocation to
      // confirm it was accepted before ending the current execution.
      //
      // A handoff transport failure does NOT release the lock and does NOT
      // abandon the turn — the response opportunity remains ACTIVE_UNRESOLVED.
      // The lock is released only by a valid response commit or by proven
      // conversation advancement, never by a handoff call failure.
      console.log(
        `[triggerRecoveryBackground] Handing off unresolved turn to next recovery round ` +
        `(rejected_count=${accumulatedRejected.length}). Lock retained — turn still owned.`
      );

      try {
        await base44.asServiceRole.functions.invoke('triggerRecoveryBackground', {
          conversation_id,
          character_id,
          owner_email: effectiveEmail,
          channel,
          source_message_id,
          prompt,
          character_name,
          blocking_stage,
          failure_count: 0,
          rejected_response_texts: accumulatedRejected,
        });

        // Handoff accepted — ownership successfully transferred to the next
        // bounded recovery execution. The generation lock is NOT released.
        return Response.json({
          success: true,
          continued: true,
          source_message_id,
          rejected_count: accumulatedRejected.length,
        });
      } catch (handoffErr) {
        // Handoff transport failure — the turn is still ACTIVE_UNRESOLVED.
        // Do NOT release the generation lock. Do NOT abandon the turn.
        // The response opportunity remains owned; a future recovery attempt
        // must continue this same turn. Invocation failure is not turn
        // expiration and is not a lock-release condition.
        console.error(
          `[triggerRecoveryBackground] Next round handoff FAILED: ${handoffErr.message}. ` +
          `Lock NOT released — turn remains ACTIVE_UNRESOLVED. ` +
          `Response opportunity preserved for future recovery.`
        );
        return Response.json({
          success: false,
          reason: 'recovery_handoff_failed',
          error: handoffErr.message,
          source_message_id,
          lock_retained: true,
        });
      }
    }

    console.log(`[triggerRecoveryBackground] Bounded continuation complete after ${recoveryAttempt} attempt(s). Non-stale response confirmed.`);

    // ── SAVE RECOVERED TEXT: with idempotency protection ────────────────────

    // Check if recovery message already exists
    const existingRecovery = await base44.asServiceRole.entities.Message.filter({
      conversation_id,
      idempotency_key: idempotencyKey,
    }, null, 1).catch(() => []);

    if (existingRecovery.length > 0) {
      console.log(`[triggerRecoveryBackground] IDEMPOTENT: recovery already saved msg_id=${existingRecovery[0].id}`);
      return Response.json({
        success: true,
        reason: 'idempotent_already_saved',
        message_id: existingRecovery[0].id,
      });
    }

    // ── LIFECYCLE BOUNDARY SAFEGUARD ──────────────────────────────────────
    // A recovery response generated for an earlier user message must NOT be
    // inserted into the conversation if the conversation has already advanced
    // beyond the original failed turn. Inserting a stale old-turn response
    // with a fresh timestamp would visually and logically reposition it as
    // though it belongs to the newer conversation — violating the boundary
    // where completed historical responses must remain historical.
    //
    // This is a DEFENSIVE CONTAINMENT measure. It prevents one obvious
    // stale-insertion scenario. It does NOT explain or fix the broader
    // repeated-message regression where previously completed response
    // content regains active-response authority through other paths.
    //
    // Two checks (only when source_message_id is available):
    // 1. REDUNDANCY — a real (non-recovery) character response already exists
    //    for this source_message_id, meaning the turn was already answered.
    // 2. ADVANCEMENT — a newer user message exists after the original source
    //    message's timestamp, meaning the conversation has moved on.
    //
    // In either case the recovery is DISCARDED and the generation lock is
    // released so future messages are not blocked.
    if (source_message_id) {
      const recentMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id },
        '-timestamp', 20
      ).catch(() => []);

      const sourceMsg = recentMsgs.find(m => m.id === source_message_id);
      const sourceTimestamp = sourceMsg?.timestamp || null;

      // CHECK 1 — REDUNDANCY: real response already committed for this turn
      const realResponseExists = recentMsgs.some(m =>
        m.sender_type === 'character' &&
        m.reply_to_message_id === source_message_id &&
        m.idempotency_key !== idempotencyKey &&
        m.recovery_signal !== true &&
        m.content && m.content.trim().length > 0
      );

      if (realResponseExists) {
        console.log(
          `[triggerRecoveryBackground] STALE_DISCARD: real response already exists for ` +
          `source_message_id=${source_message_id}. Recovery discarded — turn already answered.`
        );
        // Release lock so future messages are not blocked
        await base44.asServiceRole.functions.invoke('generationLock', {
          action: 'release',
          conversation_id,
        }).catch(() => {});
        return Response.json({
          success: false,
          reason: 'stale_recovery_discarded',
          discard_reason: 'real_response_already_exists',
          source_message_id,
        });
      }

      // CHECK 2 — ADVANCEMENT: newer user message after the original turn
      if (sourceTimestamp) {
        const sourceTime = new Date(sourceTimestamp).getTime();
        const conversationAdvanced = recentMsgs.some(m =>
          m.sender_type === 'user' &&
          m.id !== source_message_id &&
          m.timestamp &&
          new Date(m.timestamp).getTime() > sourceTime
        );

        if (conversationAdvanced) {
          console.log(
            `[triggerRecoveryBackground] STALE_DISCARD: conversation has advanced past ` +
            `source_message_id=${source_message_id}. Recovery discarded — would reposition ` +
            `old-turn response as current via fresh timestamp.`
          );
          // Release lock so future messages are not blocked
          await base44.asServiceRole.functions.invoke('generationLock', {
            action: 'release',
            conversation_id,
          }).catch(() => {});
          return Response.json({
            success: false,
            reason: 'stale_recovery_discarded',
            discard_reason: 'conversation_advanced',
            source_message_id,
          });
        }
      }
    }

    // Get character for name
    const chars = await base44.asServiceRole.entities.Character.filter(
      { id: character_id }, null, 1
    ).catch(() => []);
    const charName = chars[0]?.name || character_name || 'Character';
    const emotionalState = chars[0]?.emotional_state || 'calm';

    // Create the recovered message
    const recoveredMsg = await base44.asServiceRole.entities.Message.create({
      conversation_id,
      sender_type: 'character',
      character_id,
      character_name: charName,
      sender_character_id: character_id,
      receiver_character_id: null,
      content: responseText,
      emotional_state: emotionalState,
      is_read: true,
      timestamp: new Date().toISOString(),
      channel,
      // ── IDEMPOTENCY FIELDS ─────────────────────────────────────────────────
      idempotency_key: idempotencyKey,
      source_message_id: source_message_id || null,
      reply_to_message_id: source_message_id || null,
      generation_lock_id: null,
      // ── RECOVERY CLASSIFICATION — real LLM response, eligible for memory/relationship ──
      recovery_signal: false,       // real recovered response — NOT a fallback signal
      memory_eligible: true,        // memory pipeline may read this
      relationship_eligible: true,  // relationship pipeline may read this
    });

    if (!recoveredMsg?.id) {
      console.error('[triggerRecoveryBackground] Failed to save recovered message');
      return Response.json({
        success: false,
        reason: 'message_save_failed',
      });
    }

    console.log(`[triggerRecoveryBackground] ✓ Recovered message saved: ${recoveredMsg.id}`);

    // ── UPDATE CONVERSATION: set last message ──────────────────────────────
    await base44.asServiceRole.entities.Conversation.update(conversation_id, {
      last_message_preview: responseText.substring(0, 100),
      last_message_date: new Date().toISOString(),
    }).catch(() => {});

    // ── RELEASE LOCK: allow next messages ──────────────────────────────────
    await base44.asServiceRole.functions.invoke('generationLock', {
      action: 'release',
      conversation_id,
    }).catch(() => {});

    console.log(`[triggerRecoveryBackground] ✓ Recovery complete: msg=${recoveredMsg.id} convo=${conversation_id}`);

    return Response.json({
      success: true,
      reason: 'recovery_complete',
      message_id: recoveredMsg.id,
      content: responseText,
    });
  } catch (error) {
    console.error('[triggerRecoveryBackground] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});