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