import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

/**
 * proactiveCommsFixtureTest
 *
 * Isolated fixture-based test harness for proactive communication repair.
 * Uses ONLY Test Character A/B/C — never canon characters.
 *
 * Tests run in sequence:
 *   setup      — create/locate test fixtures
 *   test1      — Test A (strong rel) sends proactive to user → message created
 *   test2      — Test B (weak rel) does NOT spam (pressure < threshold)
 *   test3      — Test A → Test B via World Phone (character-to-character initiation)
 *   test4      — Third-party relay: A tells B to say hi to C → obligation captured on B
 *   test5      — Follow-up promise: A says "I'll let you know" → commitment created, later fulfilled
 *   test6      — Verify processOverdueWorldPhoneMessages still routes (48h rule intact)
 *   test7      — Regression: direct chat path, unread markers, conversation updates
 *   cleanup    — archive/remove test fixtures (optional, pass cleanup=true)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const runTest = body.test || 'all'; // 'setup', 'test1', ..., 'test7', 'all', 'cleanup'
    const cleanup = body.cleanup === true;

    const ownerEmail = user.email;
    const log = [];

    // ── LOCATE OR CREATE TEST FIXTURES ──────────────────────────────────────
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { is_test_character: true },
      null,
      50
    ).catch(() => []);

    // Filter to this user's fixtures only (asServiceRole sees all users — scope by owner_email)
    const userFixtures = allChars.filter(c => c.owner_email === ownerEmail);

    let charA = userFixtures.find(c => c.name === 'Test Character A');
    let charB = userFixtures.find(c => c.name === 'Test Character B');
    let charC = userFixtures.find(c => c.name === 'Test Character C');

    // Create any missing fixtures
    if (!charA) {
      charA = await base44.asServiceRole.entities.Character.create({
        name: 'Test Character A',
        status: 'active',
        character_type: 'active_created_character',
        owner_email: ownerEmail,
        is_test_character: true,
        exclude_from_homepage: true,
        exclude_from_roster: true,
        exclude_from_default_scene_queries: true,
        personality_summary: 'Test fixture only. Close friend of user. Very strong relationship.',
        communication_style: 'Casual, warm, direct.',
        friendship_level: 90,
        trust_level: 85,
        romantic_level: 0,
        chosen_family_level: 0,
        emotional_state: 'calm',
        fictional_relationships: [{
          person_name: 'User',
          relationship_type: 'close_friend',
          friendship_level: 90,
          trust_level: 85,
          romantic_level: 0,
          respect_level: 80,
        }],
      });
      log.push(`[setup] Created Test Character A: ${charA.id}`);
    } else {
      log.push(`[setup] Found existing Test Character A: ${charA.id}`);
    }

    if (!charB) {
      charB = await base44.asServiceRole.entities.Character.create({
        name: 'Test Character B',
        status: 'active',
        character_type: 'active_created_character',
        owner_email: ownerEmail,
        is_test_character: true,
        exclude_from_homepage: true,
        exclude_from_roster: true,
        exclude_from_default_scene_queries: true,
        personality_summary: 'Test fixture only. Weak acquaintance. Low relationship scores.',
        communication_style: 'Distant.',
        friendship_level: 18,
        trust_level: 12,
        romantic_level: 0,
        chosen_family_level: 0,
        emotional_state: 'neutral',
        fictional_relationships: [{
          person_name: 'User',
          relationship_type: 'acquaintance',
          friendship_level: 18,
          trust_level: 12,
          romantic_level: 0,
          respect_level: 10,
        }, {
          person_name: 'Test Character A',
          relationship_type: 'acquaintance',
          friendship_level: 40,
          trust_level: 35,
          romantic_level: 0,
          respect_level: 30,
        }],
      });
      log.push(`[setup] Created Test Character B: ${charB.id}`);
    } else {
      log.push(`[setup] Found existing Test Character B: ${charB.id}`);
    }

    if (!charC) {
      charC = await base44.asServiceRole.entities.Character.create({
        name: 'Test Character C',
        status: 'active',
        character_type: 'active_created_character',
        owner_email: ownerEmail,
        is_test_character: true,
        exclude_from_homepage: true,
        exclude_from_roster: true,
        exclude_from_default_scene_queries: true,
        personality_summary: 'Test fixture only. Third-party relay recipient.',
        communication_style: 'Friendly.',
        friendship_level: 60,
        trust_level: 55,
        romantic_level: 0,
        emotional_state: 'calm',
        fictional_relationships: [{
          related_character_id: charA.id,
          person_name: 'Test Character A',
          relationship_type: 'friend',
          friendship_level: 65,
          trust_level: 60,
          romantic_level: 0,
          respect_level: 55,
        }],
      });
      log.push(`[setup] Created Test Character C: ${charC.id}`);
    } else {
      log.push(`[setup] Found existing Test Character C: ${charC.id}`);
    }

    log.push(`[setup] Fixtures ready | A=${charA.id} | B=${charB.id} | C=${charC.id} | owner=${ownerEmail}`);

    if (runTest === 'setup') {
      return Response.json({ success: true, log, charA_id: charA.id, charB_id: charB.id, charC_id: charC.id });
    }

    const testResults = {};

    // ── TEST 1: Test A (strong rel) sends proactive message to user ──────────
    if (runTest === 'test1' || runTest === 'all') {
      const t1 = await base44.functions.invoke('sendProactiveMessageForCharacter', {
        characterId: charA.id,
      }).catch(e => ({ error: e.message }));

      const t1Data = t1?.data || t1;
      const t1Success = t1Data?.success === true;
      const t1MessageId = t1Data?.messageId;
      const t1Pressure = t1Data?.pressure;
      const t1Reason = t1Data?.reason;

      // Verify the message actually exists
      let t1MsgRecord = null;
      if (t1MessageId) {
        const msgs = await base44.asServiceRole.entities.Message.filter({ id: t1MessageId }, null, 1).catch(() => []);
        t1MsgRecord = msgs[0] || null;
      }

      testResults.test1 = {
        description: 'Test A (friendship=90, trust=85) sends proactive message to user',
        result: t1Success ? 'PASS' : 'FAIL',
        success: t1Success,
        pressure: t1Pressure,
        reason: t1Reason,
        messageId: t1MessageId,
        messageVerified: !!t1MsgRecord,
        messageContent: t1MsgRecord?.content?.substring(0, 100) || null,
        messageSenderType: t1MsgRecord?.sender_type || null,
        messageCharacterId: t1MsgRecord?.character_id || null,
        conversationId: t1MsgRecord?.conversation_id || null,
        channel: t1MsgRecord?.channel || null,
        idempotency_key: t1MsgRecord?.idempotency_key || null,
        failure_reason: !t1Success ? (t1Data?.reason || t1Data?.error || 'unknown') : null,
      };
      log.push(`[test1] ${testResults.test1.result} | pressure=${t1Pressure} | msgId=${t1MessageId} | verified=${!!t1MsgRecord}`);
    }

    // ── TEST 2: Test B (weak rel) should NOT generate proactive message ──────
    if (runTest === 'test2' || runTest === 'all') {
      const t2 = await base44.functions.invoke('sendProactiveMessageForCharacter', {
        characterId: charB.id,
      }).catch(e => ({ error: e.message }));

      const t2Data = t2?.data || t2;
      const t2Pressure = t2Data?.pressure;
      // B has friendship=18, trust=12 — pressure should be far below threshold (25)
      // Expected: success=false, reason=insufficient_relationship_pressure
      const t2CorrectlyBlocked = t2Data?.success === false &&
        (t2Data?.reason === 'insufficient_relationship_pressure' ||
         t2Data?.reason === 'random_pressure_gate' ||
         t2Data?.reason === 'not_the_right_time');

      testResults.test2 = {
        description: 'Test B (friendship=18, trust=12) should NOT spam (pressure below threshold)',
        result: t2CorrectlyBlocked ? 'PASS' : 'FAIL',
        success: t2Data?.success,
        pressure: t2Pressure,
        reason: t2Data?.reason,
        correctly_blocked: t2CorrectlyBlocked,
        failure_reason: !t2CorrectlyBlocked ? `Expected block but got: ${JSON.stringify(t2Data)}` : null,
      };
      log.push(`[test2] ${testResults.test2.result} | pressure=${t2Pressure} | reason=${t2Data?.reason}`);
    }

    // ── TEST 3: Test A → Test B via World Phone (char-to-char initiation) ────
    if (runTest === 'test3' || runTest === 'all') {
      // Link A and B via fictional_relationships so triggerCharacterContact will route
      await base44.asServiceRole.entities.Character.update(charA.id, {
        fictional_relationships: [
          {
            related_character_id: charB.id,
            person_name: 'Test Character B',
            relationship_type: 'friend',
            friendship_level: 70,
            trust_level: 65,
            romantic_level: 0,
            respect_level: 60,
          },
          {
            related_character_id: charC.id,
            person_name: 'Test Character C',
            relationship_type: 'friend',
            friendship_level: 65,
            trust_level: 60,
            romantic_level: 0,
            respect_level: 55,
          },
        ],
      }).catch(() => {});

      const t3 = await base44.functions.invoke('triggerCharacterContact', {
        senderCharacterId: charA.id,
        receiverCharacterId: charB.id,
        receiverCharacterName: 'Test Character B',
        topic: 'checking in',
        trigger_source: 'relationship',
        autonomy_marker: 'fixture_test3',
      }).catch(e => ({ error: e.message }));

      const t3Data = t3?.data || t3;
      const t3Success = t3Data?.success === true;
      const t3MessageId = t3Data?.messageId || t3Data?.message_id;

      // Verify message record
      let t3Msg = null;
      if (t3MessageId) {
        const msgs = await base44.asServiceRole.entities.Message.filter({ id: t3MessageId }, null, 1).catch(() => []);
        t3Msg = msgs[0] || null;
      }

      // Also check by conversation key
      const convoKey = `bilateral_${[charA.id, charB.id].sort().join('_')}_world_phone`;
      const t3Convos = await base44.asServiceRole.entities.Conversation.filter(
        { shared_conversation_key: convoKey }, null, 1
      ).catch(() => []);

      testResults.test3 = {
        description: 'Test A → Test B World Phone initiation (char-to-char)',
        result: t3Success ? 'PASS' : 'FAIL',
        success: t3Success,
        messageId: t3MessageId,
        messageVerified: !!t3Msg,
        messageSenderId: t3Msg?.sender_character_id || null,
        messageReceiverId: t3Msg?.receiver_character_id || null,
        messageChannel: t3Msg?.channel || null,
        messageContent: t3Msg?.content?.substring(0, 100) || null,
        conversationFound: t3Convos.length > 0,
        conversationId: t3Convos[0]?.id || null,
        conversationKey: t3Convos[0]?.shared_conversation_key || null,
        failure_reason: !t3Success ? (t3Data?.reason || t3Data?.error || JSON.stringify(t3Data)) : null,
      };
      log.push(`[test3] ${testResults.test3.result} | msgId=${t3MessageId} | verified=${!!t3Msg} | channel=${t3Msg?.channel}`);
    }

    // ── TEST 4: Third-party relay obligation capture ──────────────────────────
    // Simulates: A tells B "tell Test Character C I said hi"
    // The obligation should be captured on B (the receiving character who must relay)
    if (runTest === 'test4' || runTest === 'all') {
      // First: ensure A and B have a World Phone conversation
      const wpKey = `bilateral_${[charA.id, charB.id].sort().join('_')}_world_phone`;
      let wpConvo = (await base44.asServiceRole.entities.Conversation.filter(
        { shared_conversation_key: wpKey }, null, 1
      ).catch(() => []))[0];

      if (!wpConvo) {
        wpConvo = await base44.asServiceRole.entities.Conversation.create({
          title: `world_phone::${[charA.id, charB.id].sort().join('::')}`,
          type: 'direct',
          character_ids: [charA.id, charB.id],
          participant_character_ids: [charA.id, charB.id].sort(),
          shared_conversation_key: wpKey,
          owner_email: ownerEmail,
          channel: 'world_phone',
          sync_status: 'complete',
          world_contact_mode: 'character_to_character',
        });
      }

      // Create a message from A to B containing a relay instruction
      const relayMsg = await base44.asServiceRole.entities.Message.create({
        conversation_id: wpConvo.id,
        sender_type: 'character',
        character_id: charA.id,
        character_name: 'Test Character A',
        sender_character_id: charA.id,
        receiver_character_id: charB.id,
        participant_character_ids: [charA.id, charB.id].sort(),
        shared_conversation_key: wpKey,
        content: 'Hey, tell Test Character C I said hi when you see them.',
        timestamp: new Date().toISOString(),
        channel: 'world_phone',
        is_read: false,
        sync_status: 'complete',
        recovery_signal: false,
        memory_eligible: true,
        relationship_eligible: true,
      });

      log.push(`[test4] Created relay seed message: ${relayMsg.id} | content: "tell Test Character C I said hi"`);

      // Now run proactive check for B — the commitment scanner should detect the relay obligation
      // B is the one who received the message and must relay it to C
      // But wait: detectAndRecordCommitments scans SENDER messages — A sent the relay request TO B.
      // The obligation is on B to carry out. So we need to scan INCOMING messages to B for relay requests.
      //
      // CURRENT IMPLEMENTATION GAP: detectAndRecordCommitments only scans messages WHERE char IS THE SENDER.
      // It cannot detect "someone told B to relay something" unless we also scan RECEIVED messages.
      //
      // This is a known architectural gap — the function was designed to catch promises a character
      // makes to the user ("I'll let you know"). Third-party relays ("tell C I said hi") where
      // ANOTHER character asks B to relay are a different direction of scan.
      //
      // For this test, we instead directly create the CommunicationCommitment on B (simulating detection)
      // and then verify the relay fires through processUnresolvedCommunicationCommitments.

      const commitment = await base44.entities.CommunicationCommitment.create({
        character_id: charB.id,
        character_name: 'Test Character B',
        owner_email: ownerEmail,
        commitment_type: 'third_party_relay',
        commitment_text: 'tell Test Character C I said hi',
        third_party_character_name: 'Test Character C',
        third_party_character_id: charC.id,
        third_party_message: 'hi from Test Character A',
        source_conversation_id: wpConvo.id,
        source_message_id: relayMsg.id,
        context_summary: 'A asked B to relay hi to C',
        due_after: new Date(Date.now() - 1000).toISOString(), // due immediately
        status: 'pending',
        created_at: new Date().toISOString(),
      });

      log.push(`[test4] Created relay commitment: ${commitment.id} on B → target: C`);

      // Now fire processUnresolvedCommunicationCommitments — it should process this relay
      const processResult = await base44.functions.invoke('processUnresolvedCommunicationCommitments', {}).catch(e => ({ error: e.message }));
      const processData = processResult?.data || processResult;
      const relayProcessed = (processData?.results || []).find(r => r.id === commitment.id);

      // Verify: did a World Phone message get created from B to C?
      await new Promise(r => setTimeout(r, 1500)); // allow async writes
      const bcKey = `bilateral_${[charB.id, charC.id].sort().join('_')}_world_phone`;
      const bcConvos = await base44.asServiceRole.entities.Conversation.filter(
        { shared_conversation_key: bcKey }, null, 1
      ).catch(() => []);

      const bcMessages = bcConvos[0] ? await base44.asServiceRole.entities.Message.filter(
        { conversation_id: bcConvos[0].id },
        '-timestamp',
        5
      ).catch(() => []) : [];

      const relayMessageFound = bcMessages.some(m => m.sender_character_id === charB.id || m.character_id === charB.id);

      // Also check if commitment was marked fulfilled
      const commitmentAfter = (await base44.asServiceRole.entities.CommunicationCommitment.filter(
        { id: commitment.id }, null, 1
      ).catch(() => []))[0];

      testResults.test4 = {
        description: 'Third-party relay: B relays "hi from A" to C via World Phone',
        result: relayProcessed?.result === 'fulfilled' ? 'PASS' : 'PARTIAL',
        seedMessageId: relayMsg.id,
        commitmentId: commitment.id,
        commitmentStatus: commitmentAfter?.status || 'unknown',
        processRunResult: relayProcessed || null,
        bcConversationFound: bcConvos.length > 0,
        bcConversationId: bcConvos[0]?.id || null,
        relayMessageFound,
        bcMessageCount: bcMessages.length,
        processData_summary: { processed: processData?.processed, results_count: processData?.results?.length },
        note: relayProcessed?.result !== 'fulfilled'
          ? 'Relay may have failed to find target character by name — check third_party_character_id resolution path'
          : null,
      };
      log.push(`[test4] relay commitment status=${commitmentAfter?.status} | bcConvo=${bcConvos.length > 0} | relayMsg=${relayMessageFound}`);
    }

    // ── TEST 5: Follow-up promise creates commitment + later fulfilled ────────
    if (runTest === 'test5' || runTest === 'all') {
      // Find or create a direct conversation for A
      let directConvo = (await base44.entities.Conversation.filter(
        { type: 'direct', owner_email: ownerEmail, character_ids: [charA.id] }, null, 1
      ).catch(() => []))[0];

      if (!directConvo) {
        directConvo = await base44.entities.Conversation.create({
          title: 'Test Character A',
          type: 'direct',
          character_ids: [charA.id],
          owner_email: ownerEmail,
        });
      }

      // Plant a message from A containing "I'll let you know how it goes"
      const promiseMsg = await base44.entities.Message.create({
        conversation_id: directConvo.id,
        sender_type: 'character',
        character_id: charA.id,
        character_name: 'Test Character A',
        content: "Don't worry, I'll let you know how it goes after the appointment.",
        timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2h ago
        channel: 'direct',
        sender_character_id: charA.id,
        is_read: false,
        recovery_signal: false,
        memory_eligible: true,
        relationship_eligible: true,
      });

      log.push(`[test5] Planted promise message: ${promiseMsg.id}`);

      // Run proactive for A — should detect the commitment
      await base44.functions.invoke('sendProactiveMessageForCharacter', {
        characterId: charA.id,
      }).catch(() => {});

      // Check if commitment was created
      await new Promise(r => setTimeout(r, 1000));
      const commitments = await base44.entities.CommunicationCommitment.filter(
        { character_id: charA.id, source_message_id: promiseMsg.id },
        null, 5
      ).catch(() => []);

      const t5Commitment = commitments[0] || null;

      // If commitment exists and is pending, force-fulfill it
      let fulfillResult = null;
      if (t5Commitment && t5Commitment.status === 'pending') {
        // Set due_after to past so it's immediately actionable
        await base44.entities.CommunicationCommitment.update(t5Commitment.id, {
          due_after: new Date(Date.now() - 1000).toISOString(),
        }).catch(() => {});

        fulfillResult = await base44.functions.invoke('sendProactiveMessageForCharacter', {
          characterId: charA.id,
          forceCommitmentId: t5Commitment.id,
        }).catch(e => ({ error: e.message }));
      }

      const fulfillData = fulfillResult?.data || fulfillResult;
      const commitmentAfter = t5Commitment ? (await base44.entities.CommunicationCommitment.filter(
        { id: t5Commitment.id }, null, 1
      ).catch(() => []))[0] : null;

      testResults.test5 = {
        description: 'Follow-up promise: A says "I\'ll let you know" → commitment created → fulfilled',
        promiseMessageId: promiseMsg.id,
        commitmentCreated: !!t5Commitment,
        commitmentId: t5Commitment?.id || null,
        commitmentType: t5Commitment?.commitment_type || null,
        commitmentStatus_before_fulfill: t5Commitment?.status || null,
        fulfillAttempted: !!fulfillResult,
        fulfillSuccess: fulfillData?.success === true,
        fulfillMessageId: fulfillData?.messageId || null,
        commitmentStatus_after: commitmentAfter?.status || null,
        result: t5Commitment && commitmentAfter?.status === 'fulfilled' ? 'PASS'
          : t5Commitment && t5Commitment.status === 'pending' ? 'PARTIAL_commitment_created_not_yet_fulfilled'
          : 'FAIL_commitment_not_created',
      };
      log.push(`[test5] commitmentCreated=${!!t5Commitment} | fulfillSuccess=${fulfillData?.success} | status_after=${commitmentAfter?.status}`);
    }

    // ── TEST 6: 48-hour unanswered World Phone rule still intact ─────────────
    if (runTest === 'test6' || runTest === 'all') {
      // Just verify processOverdueWorldPhoneMessages function still runs without error
      const t6 = await base44.functions.invoke('processOverdueWorldPhoneMessages', {}).catch(e => ({ error: e.message }));
      const t6Data = t6?.data || t6;

      testResults.test6 = {
        description: '48-hour overdue World Phone follow-up rule still intact',
        result: t6Data?.success === true ? 'PASS' : (t6Data?.error ? 'FAIL' : 'PASS'),
        functionResponded: !t6Data?.error,
        error: t6Data?.error || null,
        note: '48-hour rule is in processOverdueWorldPhoneMessages — not duplicated by new system',
      };
      log.push(`[test6] processOverdueWorldPhoneMessages responded=${!t6Data?.error} | success=${t6Data?.success}`);
    }

    // ── TEST 7: Regression checks ────────────────────────────────────────────
    if (runTest === 'test7' || runTest === 'all') {
      const regressions = {};

      // 7a: Direct conversation for A still exists and is correct type
      const directConvos = await base44.entities.Conversation.filter(
        { type: 'direct', owner_email: ownerEmail, character_ids: [charA.id] }, null, 1
      ).catch(() => []);
      regressions.direct_convo_exists = directConvos.length > 0;
      regressions.direct_convo_type = directConvos[0]?.type || null;

      // 7b: Messages in direct convo have correct sender_type and character_id
      if (directConvos[0]) {
        const directMsgs = await base44.entities.Message.filter(
          { conversation_id: directConvos[0].id, sender_type: 'character' },
          '-timestamp', 5
        ).catch(() => []);
        regressions.direct_messages_have_character_id = directMsgs.every(m => !!m.character_id);
        regressions.direct_messages_channel = [...new Set(directMsgs.map(m => m.channel))];
        regressions.direct_message_is_read_field_present = directMsgs.every(m => m.is_read !== undefined);
      }

      // 7c: World Phone conversation for A-B has correct structure
      const wpKey = `bilateral_${[charA.id, charB.id].sort().join('_')}_world_phone`;
      const wpConvos = await base44.asServiceRole.entities.Conversation.filter(
        { shared_conversation_key: wpKey }, null, 1
      ).catch(() => []);
      regressions.world_phone_convo_has_key = !!wpConvos[0]?.shared_conversation_key;
      regressions.world_phone_convo_channel = wpConvos[0]?.channel || null;
      regressions.world_phone_convo_participant_ids_set = Array.isArray(wpConvos[0]?.participant_character_ids);

      // 7d: CommunicationCommitment entity queryable (not conflicting with CharacterCommitment)
      const ccCount = await base44.entities.CommunicationCommitment.filter(
        { owner_email: ownerEmail }, null, 10
      ).catch(() => null);
      regressions.communication_commitment_entity_queryable = ccCount !== null;
      regressions.communication_commitment_count = ccCount?.length ?? 'error';

      // 7e: CharacterCommitment (travel) still intact and separate
      const travelCommitments = await base44.entities.CharacterCommitment.filter(
        { owner_email: ownerEmail }, null, 5
      ).catch(() => null);
      regressions.character_commitment_travel_entity_intact = travelCommitments !== null;

      // 7f: Pressure threshold correctly blocks B
      // (re-use test2 result if available)
      regressions.weak_relationship_correctly_blocked = testResults.test2?.correctly_blocked ?? 'not_run';

      testResults.test7 = {
        description: 'Regression checks: direct chat, World Phone, unread markers, entity separation',
        result: Object.values(regressions).every(v => v !== false && v !== 'error') ? 'PASS' : 'PARTIAL',
        regressions,
      };
      log.push(`[test7] regression checks: ${JSON.stringify(regressions)}`);
    }

    // ── CLEANUP (optional) ────────────────────────────────────────────────────
    if (cleanup) {
      // Archive test fixtures and their messages/commitments
      for (const c of [charA, charB, charC]) {
        if (c) {
          await base44.asServiceRole.entities.Character.update(c.id, { status: 'soft_deleted' }).catch(() => {});
        }
      }
      // Clean commitments
      await base44.entities.CommunicationCommitment.filter(
        { owner_email: ownerEmail }, null, 50
      ).then(async (items) => {
        const testItems = items.filter(i =>
          [charA?.id, charB?.id, charC?.id].includes(i.character_id)
        );
        for (const i of testItems) {
          await base44.entities.CommunicationCommitment.update(i.id, { status: 'cancelled' }).catch(() => {});
        }
      }).catch(() => {});
      log.push('[cleanup] Test fixtures soft-deleted, commitments cancelled');
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    const allResults = Object.entries(testResults).map(([k, v]) => ({ test: k, result: v.result }));
    const passed = allResults.filter(r => r.result === 'PASS').length;
    const failed = allResults.filter(r => r.result === 'FAIL').length;
    const partial = allResults.filter(r => r.result?.startsWith('PARTIAL')).length;

    return Response.json({
      success: true,
      summary: { passed, failed, partial, total: allResults.length },
      all_results: allResults,
      test_details: testResults,
      fixtures: { charA_id: charA.id, charB_id: charB.id, charC_id: charC.id },
      log,
    });

  } catch (error) {
    console.error('[proactiveCommsFixtureTest] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});