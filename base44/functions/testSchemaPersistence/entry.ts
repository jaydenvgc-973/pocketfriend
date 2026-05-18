/**
 * testSchemaPersistence
 *
 * Schema-first verification before forced-failure testing.
 *
 * Proves that Message and Conversation fields persist and are queryable:
 * - Message: source_message_id, reply_to_message_id, idempotency_key, generation_lock_id, recovery_signal, memory_eligible, relationship_eligible
 * - Conversation: generation_lock (with nested fields)
 *
 * Flow:
 * 1. Create test Conversation with generation_lock
 * 2. Read back — verify generation_lock persists
 * 3. Create test Message with idempotency fields
 * 4. Read back — verify all fields persist
 * 5. Query Message by source_message_id
 * 6. Query Message by idempotency_key
 * 7. Report results
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const results = {
    timestamp: new Date().toISOString(),
    tester_email: null,
    tests: [],
    all_pass: false,
  };

  try {
    const user = await base44.auth.me().catch(() => null);
    results.tester_email = user?.email || 'service_role';

    const ownerEmail = user?.email || 'test@example.com';

    // ── TEST 1: Conversation with generation_lock ──────────────────────────
    console.log('[testSchemaPersistence] Starting Conversation generation_lock test...');
    try {
      const convo = await base44.entities.Conversation.create({
        title: 'Test Convo for Schema Persistence',
        type: 'direct',
        character_ids: ['char1', 'char2'],
        owner_email: ownerEmail,
        generation_lock: {
          lock_id: 'test_lock_1',
          generation_in_progress: true,
          generation_started_at: new Date().toISOString(),
          character_id: 'char1',
          channel: 'direct',
          source_message_id: 'src_1',
          owner_email: ownerEmail,
          fallback_detected: false,
          fallback_count: 0,
          recovery_required: false,
          stale_lock: false,
        },
      });

      if (!convo || !convo.id) {
        results.tests.push({
          test: 'Conversation creation',
          result: 'FAIL',
          error: 'Conversation create returned empty',
        });
      } else {
        console.log(`[testSchemaPersistence] Conversation created: ${convo.id}`);

        // Read back
        const readBack = await base44.entities.Conversation.filter(
          { id: convo.id }, null, 1
        ).catch(err => null);

        if (!readBack || readBack.length === 0) {
          results.tests.push({
            test: 'Conversation read-back',
            result: 'FAIL',
            error: 'Could not read conversation back',
          });
        } else {
          const c = readBack[0];
          const hasLock = c.generation_lock && typeof c.generation_lock === 'object';
          const lockHasFields = hasLock && c.generation_lock.lock_id && c.generation_lock.generation_in_progress !== undefined;

          if (!hasLock) {
            results.tests.push({
              test: 'Conversation.generation_lock field persistence',
              result: 'FAIL',
              error: `generation_lock missing. Got: ${JSON.stringify(c.generation_lock)}`,
            });
          } else if (!lockHasFields) {
            results.tests.push({
              test: 'Conversation.generation_lock nested fields',
              result: 'FAIL',
              error: `lock_id or generation_in_progress missing`,
            });
          } else {
            results.tests.push({
              test: 'Conversation.generation_lock field persistence',
              result: 'PASS',
              detail: `lock_id=${c.generation_lock.lock_id}, generation_in_progress=${c.generation_lock.generation_in_progress}`,
            });
          }
        }
      }
    } catch (err) {
      results.tests.push({
        test: 'Conversation creation',
        result: 'ERROR',
        error: err.message,
      });
    }

    // ── TEST 2: Message with idempotency fields ───────────────────────────
    console.log('[testSchemaPersistence] Starting Message idempotency fields test...');
    try {
      const msg = await base44.entities.Message.create({
        conversation_id: 'convo_123',
        sender_type: 'character',
        character_id: 'char1',
        character_name: 'TestChar',
        content: 'Test message for persistence',
        source_message_id: 'source_msg_1',
        reply_to_message_id: 'reply_msg_1',
        idempotency_key: 'test::char1::convo_123::source_msg_1',
        generation_lock_id: 'test_lock_1',
        recovery_signal: false,
        memory_eligible: true,
        relationship_eligible: true,
        timestamp: new Date().toISOString(),
      });

      if (!msg || !msg.id) {
        results.tests.push({
          test: 'Message creation',
          result: 'FAIL',
          error: 'Message create returned empty',
        });
      } else {
        console.log(`[testSchemaPersistence] Message created: ${msg.id}`);

        // Read back
        const msgReadBack = await base44.entities.Message.filter(
          { id: msg.id }, null, 1
        ).catch(err => null);

        if (!msgReadBack || msgReadBack.length === 0) {
          results.tests.push({
            test: 'Message read-back',
            result: 'FAIL',
            error: 'Could not read message back',
          });
        } else {
          const m = msgReadBack[0];
          const hasSrc = m.source_message_id === 'source_msg_1';
          const hasReply = m.reply_to_message_id === 'reply_msg_1';
          const hasIdempotency = m.idempotency_key === 'test::char1::convo_123::source_msg_1';
          const hasLockId = m.generation_lock_id === 'test_lock_1';
          const hasRecoverySignal = m.recovery_signal === false;
          const hasMemElig = m.memory_eligible === true;
          const hasRelElig = m.relationship_eligible === true;

          if (!hasSrc || !hasReply || !hasIdempotency || !hasLockId || !hasRecoverySignal || !hasMemElig || !hasRelElig) {
            const missing = [];
            if (!hasSrc) missing.push('source_message_id');
            if (!hasReply) missing.push('reply_to_message_id');
            if (!hasIdempotency) missing.push('idempotency_key');
            if (!hasLockId) missing.push('generation_lock_id');
            if (!hasRecoverySignal) missing.push('recovery_signal');
            if (!hasMemElig) missing.push('memory_eligible');
            if (!hasRelElig) missing.push('relationship_eligible');

            results.tests.push({
              test: 'Message idempotency fields persistence',
              result: 'FAIL',
              error: `Missing fields: ${missing.join(', ')}`,
              actual: {
                source_message_id: m.source_message_id,
                reply_to_message_id: m.reply_to_message_id,
                idempotency_key: m.idempotency_key,
                generation_lock_id: m.generation_lock_id,
                recovery_signal: m.recovery_signal,
                memory_eligible: m.memory_eligible,
                relationship_eligible: m.relationship_eligible,
              },
            });
          } else {
            results.tests.push({
              test: 'Message idempotency fields persistence',
              result: 'PASS',
              detail: 'All fields present and correct',
            });
          }
        }
      }
    } catch (err) {
      results.tests.push({
        test: 'Message creation',
        result: 'ERROR',
        error: err.message,
      });
    }

    // ── TEST 3: Query Message by source_message_id ─────────────────────────
    console.log('[testSchemaPersistence] Testing query by source_message_id...');
    try {
      const bySource = await base44.entities.Message.filter(
        { source_message_id: 'source_msg_1' }, null, 5
      ).catch(err => {
        console.error('[testSchemaPersistence] Query by source_message_id failed:', err.message);
        return [];
      });

      if (bySource.length === 0) {
        results.tests.push({
          test: 'Query Message by source_message_id',
          result: 'FAIL',
          error: 'Query returned 0 results. Field may not be indexed or queryable.',
        });
      } else {
        const found = bySource.find(m => m.idempotency_key === 'test::char1::convo_123::source_msg_1');
        if (!found) {
          results.tests.push({
            test: 'Query Message by source_message_id',
            result: 'FAIL',
            error: 'Query returned results but test message not found',
          });
        } else {
          results.tests.push({
            test: 'Query Message by source_message_id',
            result: 'PASS',
            detail: `Found message: ${found.id}`,
          });
        }
      }
    } catch (err) {
      results.tests.push({
        test: 'Query Message by source_message_id',
        result: 'ERROR',
        error: err.message,
      });
    }

    // ── TEST 4: Query Message by idempotency_key ───────────────────────────
    console.log('[testSchemaPersistence] Testing query by idempotency_key...');
    try {
      const byIdempotency = await base44.entities.Message.filter(
        { idempotency_key: 'test::char1::convo_123::source_msg_1' }, null, 5
      ).catch(err => {
        console.error('[testSchemaPersistence] Query by idempotency_key failed:', err.message);
        return [];
      });

      if (byIdempotency.length === 0) {
        results.tests.push({
          test: 'Query Message by idempotency_key',
          result: 'FAIL',
          error: 'Query returned 0 results. Field may not be indexed or queryable.',
        });
      } else {
        results.tests.push({
          test: 'Query Message by idempotency_key',
          result: 'PASS',
          detail: `Found ${byIdempotency.length} message(s)`,
        });
      }
    } catch (err) {
      results.tests.push({
        test: 'Query Message by idempotency_key',
        result: 'ERROR',
        error: err.message,
      });
    }

    // ── SUMMARY ────────────────────────────────────────────────────────────
    const passed = results.tests.filter(t => t.result === 'PASS').length;
    const failed = results.tests.filter(t => t.result === 'FAIL').length;
    const errored = results.tests.filter(t => t.result === 'ERROR').length;

    results.all_pass = failed === 0 && errored === 0;
    results.summary = {
      total_tests: results.tests.length,
      passed,
      failed,
      errored,
      status: results.all_pass ? 'PASS' : 'FAIL',
    };

    console.log(`[testSchemaPersistence] Summary: ${passed}/${results.tests.length} PASS`);

    return Response.json(results);
  } catch (err) {
    console.error('[testSchemaPersistence] Unexpected error:', err.message);
    results.tests.push({
      test: 'Overall execution',
      result: 'ERROR',
      error: err.message,
    });
    results.summary = {
      total_tests: 1,
      passed: 0,
      failed: 0,
      errored: 1,
      status: 'FAIL',
    };
    return Response.json(results);
  }
});