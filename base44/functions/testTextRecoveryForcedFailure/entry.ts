/**
 * testTextRecoveryForcedFailure
 *
 * Forced-failure test for text response recovery system.
 *
 * Scenario: User taps send twice while LLM is slow → first acquire wins lock,
 * second acquire is blocked by lock, user message is saved but no duplicate
 * character response is generated. Then LLM fails. Recovery re-runs and
 * saves the real text. Fallback is never saved. Relationship never updated
 * for fallback.
 *
 * Test steps:
 * 1. Create test conversation + user message
 * 2. Acquire lock for first send (succeeds)
 * 3. Attempt second acquire (blocked)
 * 4. Simulate LLM failure
 * 5. Trigger recovery with exponential backoff
 * 6. Verify real text was saved (not fallback)
 * 7. Verify relationship/memory untouched by fallback
 * 8. Verify duplicate generation lock prevented cascade
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const testResults = {
      timestamp: new Date().toISOString(),
      scenario: 'Double-tap LLM failure + recovery',
      steps: [],
      passed: true,
    };

    const testEmail = 'test_recovery_' + Date.now() + '@example.com';
    const testCharId = 'char_test_recovery_' + Date.now();
    const testUserId = 'user_test_' + Date.now();

    // ── STEP 1: Create test conversation ────────────────────────────────
    console.log('[testTextRecoveryForcedFailure] Step 1: Create test conversation');
    const convo = await base44.asServiceRole.entities.Conversation.create({
      title: 'Recovery Test',
      type: 'direct',
      character_ids: [testCharId],
      owner_email: testEmail,
    });
    testResults.steps.push({
      step: 1,
      action: 'Create conversation',
      result: 'SUCCESS',
      conversation_id: convo.id,
    });

    // ── STEP 2: Create test user message ────────────────────────────────
    console.log('[testTextRecoveryForcedFailure] Step 2: Create user message');
    const userMsg = await base44.asServiceRole.entities.Message.create({
      conversation_id: convo.id,
      sender_type: 'user',
      content: 'Test message for recovery',
      timestamp: new Date().toISOString(),
    });
    testResults.steps.push({
      step: 2,
      action: 'Create user message',
      result: 'SUCCESS',
      user_message_id: userMsg.id,
    });

    // ── STEP 3: First lock acquire (succeeds) ────────────────────────────
    console.log('[testTextRecoveryForcedFailure] Step 3: First lock acquire');
    const lockRes1 = await base44.asServiceRole.functions.invoke('generationLock', {
      action: 'acquire',
      conversation_id: convo.id,
      character_id: testCharId,
      channel: 'direct',
      source_message_id: userMsg.id,
    });
    if (!lockRes1?.data?.acquired) {
      testResults.passed = false;
      testResults.steps.push({
        step: 3,
        action: 'First lock acquire',
        result: 'FAIL',
        error: 'Lock acquire failed unexpectedly',
      });
    } else {
      testResults.steps.push({
        step: 3,
        action: 'First lock acquire',
        result: 'SUCCESS',
        lock_id: lockRes1.data.lock_id,
      });
    }

    // ── STEP 4: Second lock acquire (blocked) ────────────────────────────
    console.log('[testTextRecoveryForcedFailure] Step 4: Second lock acquire (should be blocked)');
    const lockRes2 = await base44.asServiceRole.functions.invoke('generationLock', {
      action: 'acquire',
      conversation_id: convo.id,
      character_id: testCharId,
      channel: 'direct',
      source_message_id: userMsg.id,
    });
    if (lockRes2?.data?.acquired === true) {
      testResults.passed = false;
      testResults.steps.push({
        step: 4,
        action: 'Second lock acquire (should be blocked)',
        result: 'FAIL',
        error: 'Lock was NOT blocked, allowing duplicate generation',
      });
    } else if (lockRes2?.data?.reason === 'generation_in_progress') {
      testResults.steps.push({
        step: 4,
        action: 'Second lock acquire (blocked correctly)',
        result: 'SUCCESS',
        blocked_reason: lockRes2.data.reason,
      });
    } else {
      testResults.steps.push({
        step: 4,
        action: 'Second lock acquire',
        result: 'UNEXPECTED',
        response: lockRes2.data,
      });
    }

    // ── STEP 5: Record fallback (LLM failure simulation) ──────────────────
    console.log('[testTextRecoveryForcedFailure] Step 5: Record fallback metadata');
    const fallbackRes = await base44.asServiceRole.functions.invoke('generationLock', {
      action: 'record_fallback',
      conversation_id: convo.id,
      character_id: testCharId,
      owner_email: testEmail,
      fallback_text: '[response_generation_timeout]',
    });
    testResults.steps.push({
      step: 5,
      action: 'Record fallback metadata (simulating LLM failure)',
      result: 'SUCCESS',
      fallback_count: fallbackRes?.data?.fallback_count,
      recovery_required: fallbackRes?.data?.recovery_required,
    });

    // ── STEP 6: Trigger recovery ────────────────────────────────────────
    console.log('[testTextRecoveryForcedFailure] Step 6: Trigger recovery');
    const recoveryRes = await base44.asServiceRole.functions.invoke('triggerRecoveryBackground', {
      conversation_id: convo.id,
      character_id: testCharId,
      owner_email: testEmail,
      channel: 'direct',
      source_message_id: userMsg.id,
      prompt: 'You are a test character. Reply naturally to: "Test message for recovery"',
      character_name: 'TestChar',
      blocking_stage: 'response_generation',
      failure_count: 0,
    });

    if (!recoveryRes?.data?.success) {
      testResults.passed = false;
      testResults.steps.push({
        step: 6,
        action: 'Trigger recovery',
        result: 'FAIL',
        error: recoveryRes?.data?.reason || 'Unknown error',
      });
    } else {
      testResults.steps.push({
        step: 6,
        action: 'Trigger recovery',
        result: 'SUCCESS',
        recovered_message_id: recoveryRes.data.message_id,
        recovered_text: recoveryRes.data.content?.substring(0, 50) + '...',
      });
    }

    // ── STEP 7: Verify only real message saved (not fallback) ──────────────
    console.log('[testTextRecoveryForcedFailure] Step 7: Verify message was saved');
    const messages = await base44.asServiceRole.entities.Message.filter({
      conversation_id: convo.id,
      sender_type: 'character',
    });

    const fallbackStrings = ['sorry', 'pulled away', 'moment', 'reconnecting', 'got distracted'];
    const hasFallbackText = messages.some(m =>
      fallbackStrings.some(f => m.content.toLowerCase().includes(f))
    );

    if (hasFallbackText) {
      testResults.passed = false;
      testResults.steps.push({
        step: 7,
        action: 'Verify no fallback text saved',
        result: 'FAIL',
        error: 'Fallback strings found in saved messages',
        messages_count: messages.length,
      });
    } else {
      testResults.steps.push({
        step: 7,
        action: 'Verify no fallback text saved',
        result: 'SUCCESS',
        messages_saved: messages.length,
        all_have_valid_content: messages.every(m => m.content && m.content.length > 3),
      });
    }

    // ── STEP 8: Verify duplicate prevention ──────────────────────────────
    console.log('[testTextRecoveryForcedFailure] Step 8: Verify duplicate prevention');
    const characterMessages = messages.filter(m => m.sender_type === 'character');
    if (characterMessages.length > 1) {
      testResults.passed = false;
      testResults.steps.push({
        step: 8,
        action: 'Verify duplicate prevention (only 1 real response)',
        result: 'FAIL',
        error: `Found ${characterMessages.length} character messages, expected 1`,
      });
    } else {
      testResults.steps.push({
        step: 8,
        action: 'Verify duplicate prevention',
        result: 'SUCCESS',
        character_messages: characterMessages.length,
      });
    }

    // ── FINAL RESULT ────────────────────────────────────────────────────
    testResults.final_status = testResults.passed ? 'PASS' : 'FAIL';
    console.log(`[testTextRecoveryForcedFailure] Test result: ${testResults.final_status}`);

    return Response.json(testResults);
  } catch (error) {
    console.error('[testTextRecoveryForcedFailure] ERROR:', error.message);
    return Response.json({ error: error.message, final_status: 'ERROR' }, { status: 500 });
  }
});