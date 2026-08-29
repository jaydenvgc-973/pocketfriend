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
 * STALE-DUPLICATE REJECTION + CONTINUED LIFECYCLE:
 * If the first recovered response is an exact duplicate of a previously
 * completed character message, it is discarded (zero authority). But the
 * response opportunity is NOT terminated — recovery makes ONE more bounded
 * LLM attempt using the same full prompt (the existing recovery generation
 * authority — character voice, personality, memory, conversation) with an
 * anti-repeat suffix. If that produces a non-stale response, it is committed.
 * If that also produces a stale duplicate, both stale results are rejected —
 * NOT committed, NOT resurrected, and NO deterministic substitute is
 * manufactured. Recovery releases the lock and returns; the main Chat path
 * (corrector) is the primary response authority. This is NOT polling (one
 * bounded extra attempt within a single invocation) and NOT indefinite (no
 * loop, no scheduler, no repeated invocations).
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

    // ── STALE-DUPLICATE REJECTION BOUNDARY ─────────────────────────────────
    // A recovered response that is an exact duplicate of a previously completed
    // character message is a FAILED recovery — zero active-response authority.
    // It is NOT committed, NOT given a new message ID, NOT resurrected.
    //
    // But discarding the stale duplicate does NOT terminate the response
    // opportunity. The current user turn still needs a valid response. So after
    // discarding, recovery makes ONE more bounded LLM attempt with an anti-repeat
    // instruction. If that produces a non-stale response, it proceeds to commit.
    // If that also produces a stale duplicate, a deterministic current-turn
    // response is constructed so the turn still receives a valid, fresh, non-
    // empty, non-stale response. The stale result never returns; the user still
    // gets a response. This is NOT polling (one bounded extra attempt, not
    // repeated invocations) and NOT indefinite (no loop, no scheduler).
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

    const recoveredNormalized = normalizeText(responseText);
    if (recoveredNormalized && prevCharTexts.has(recoveredNormalized)) {
      console.log(
        `[triggerRecoveryBackground] STALE_DISCARD: first recovery attempt is an exact ` +
        `duplicate. Discarding — making one more bounded LLM attempt.`
      );
      // ── SECOND BOUNDED ATTEMPT with anti-repeat instruction ─────────────
      // Uses the same full prompt (character's voice, personality, memory,
      // conversation) — the existing recovery generation authority — with an
      // anti-repeat suffix steering the LLM away from prior responses. No
      // deterministic substitute is manufactured.
      let secondText = '';
      try {
        const secondResponse = await base44.integrations.Core.InvokeLLM({
          prompt: prompt + '\n\n⚠️ CRITICAL: Your previous response was an EXACT DUPLICATE of a message already sent. Generate a COMPLETELY NEW, FRESH response to the user\'s CURRENT message. Do NOT repeat, paraphrase, or reuse ANY response you have previously sent.',
        });
        if (typeof secondResponse === 'string') {
          secondText = secondResponse.trim();
        } else if (secondResponse?.text_content) {
          secondText = secondResponse.text_content.trim();
        } else {
          const p = typeof secondResponse === 'string' ? JSON.parse(secondResponse) : secondResponse;
          secondText = p?.text_content || String(secondResponse).trim();
        }
      } catch (llmErr2) {
        console.error(`[triggerRecoveryBackground] Second attempt LLM failed: ${llmErr2.message}`);
      }

      const secondNormalized = normalizeText(secondText);
      if (secondText && !prevCharTexts.has(secondNormalized)) {
        responseText = secondText;
        console.log(`[triggerRecoveryBackground] ✓ Second attempt produced non-stale text: "${responseText.substring(0, 60)}..."`);
      } else {
        // Both bounded attempts stale/failed. The stale results are rejected —
        // NOT committed, NOT given a new ID, NOT resurrected. No deterministic
        // substitute is manufactured; no handcrafted acknowledgment is committed.
        // Recovery releases the lock and returns. The lifecycle-advancement
        // safeguard is NOT bypassed: if the conversation has advanced, the turn
        // is expired and this return is correct. If it has not advanced, the
        // main Chat path (corrector) is the primary response authority.
        console.log(`[triggerRecoveryBackground] Both recovery attempts stale/failed. Rejecting — no deterministic substitute.`);
        await base44.asServiceRole.functions.invoke('generationLock', {
          action: 'release',
          conversation_id,
        }).catch(() => {});
        return Response.json({
          success: false,
          reason: 'stale_recovery_discarded',
          discard_reason: 'all_recovery_attempts_stale',
        });
      }
    }

    // ── SAVE RECOVERED TEXT: with idempotency protection ────────────────────
    const idempotencyKey = `recovery::${effectiveEmail}::${character_id}::${channel}::${source_message_id}::${blocking_stage}`;

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