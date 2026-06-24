/**
 * proofProductionPathVickIntegrity
 *
 * PATH A — REAL DEPLOYED FUNCTION EXECUTION FROM AUTHENTICATED UI SESSION
 *
 * This function is called FROM THE LIVE AUTHENTICATED APP UI (Settings → Troubleshooting → WP Proof).
 * When called from the UI with a real user session token, base44.functions.invoke() works correctly
 * because the user session is forwarded with the request.
 *
 * Platform constraint (documented, not an excuse):
 * - base44.functions.invoke() from backend function context → 403 (no forwarded session)
 * - sr.functions.invoke() from backend function context → 403 (service-role cannot invoke functions)
 * - base44.functions.invoke() from live authenticated UI → works (session token forwarded)
 *
 * PREVIOUS PROOF WAS INVALID:
 * The previous "Path B" used inline Message.create() inside the proof function.
 * That is forbidden. Inline is not shared. Direct DB write is not production-path proof.
 * That PASS result is rejected and invalid.
 *
 * THIS PROOF (when called from UI):
 * - Uses base44.functions.invoke() with the forwarded user session
 * - Calls the real deployed sendWorldPhoneMessage function
 * - Does NOT write any Message or Conversation records itself
 * - Verifies only by reading back what sendWorldPhoneMessage created
 *
 * When called from backend test harness (no session): returns honest FAIL with clear instructions.
 * When called from UI (live session): calls real deployed function, verifies records, returns PASS/FAIL.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    // Admin check — must have live authenticated session
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email || user.role !== 'admin') {
      return Response.json({
        error: 'Admin session required',
        instruction: 'This proof must be run from Settings → Troubleshooting → WP Proof tab in the live app UI.',
      }, { status: 403 });
    }

    const ownerEmail = user.email;
    const results = [];
    let sendResult = null;
    let verifiedMsg = null;
    let verifiedConvo = null;
    let preExistingConvoId = null;
    let sentMsgId = null;
    let sentConvoId = null;

    function pass(step, detail = {}) {
      results.push({ step, status: 'PASS', ...detail });
      console.log(`[VickEthanProof] ✅ PASS ${step}`);
    }
    function fail(step, reason, detail = {}) {
      results.push({ step, status: 'FAIL', reason, ...detail });
      console.error(`[VickEthanProof] ❌ FAIL ${step}: ${reason}`);
    }

    // ── STEP 1: Resolve real Vick Servicio ────────────────────────────────────
    let vick = null;
    const vickArr = await sr.entities.Character.filter(
      { name: 'Vick Servicio', status: 'active' }, null, 10
    ).catch(() => []);
    vick = vickArr.find(c => c.is_world_service === true || c.character_type === 'npc_world_service') || vickArr[0];

    if (!vick) {
      fail('step_1_resolve_vick', 'Vick Servicio not found');
    } else {
      pass('step_1_resolve_vick', {
        vick_id: vick.id,
        vick_name: vick.name,
        character_type: vick.character_type,
        is_world_service: vick.is_world_service,
      });
    }

    // ── STEP 2: Resolve real Ethan ───────────────────────────────────────────
    let ethan = null;
    if (vick) {
      const ethanArr = await sr.entities.Character.filter(
        { owner_email: ownerEmail, status: 'active' }, null, 200
      ).catch(() => []);
      ethan = ethanArr.find(c =>
        c.name?.toLowerCase().includes('ethan') &&
        c.character_type === 'active_created_character'
      );

      if (!ethan) {
        fail('step_2_resolve_ethan', `No active Ethan (active_created_character) for ${ownerEmail}`);
      } else {
        pass('step_2_resolve_ethan', {
          ethan_id: ethan.id,
          ethan_name: ethan.name,
          character_type: ethan.character_type,
          owner_email: ethan.owner_email,
        });
      }
    } else {
      fail('step_2_resolve_ethan', 'Skipped — Vick not resolved');
    }

    if (!vick || !ethan) {
      return Response.json({
        proof_type: 'PATH_A_REAL_DEPLOYED_FUNCTION — Vick → Ethan World Phone',
        previous_proof_status: 'INVALID — previous proof used inline Message.create(). That PASS is rejected.',
        success: false,
        overall_status: 'FAIL — real deployed production path not verified',
        proof_verified: false,
        failure_is_accepted: false,
        summary: `${results.filter(r => r.status === 'PASS').length} passed, ${results.filter(r => r.status === 'FAIL').length} failed`,
        results,
      });
    }

    // ── STEP 3: Dedup baseline ────────────────────────────────────────────────
    const sortedIds = [vick.id, ethan.id].sort();
    const canonicalKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;
    const existingByKey = await sr.entities.Conversation.filter(
      { shared_conversation_key: canonicalKey }, '-updated_date', 5
    ).catch(() => []);
    if (existingByKey.length > 0) {
      preExistingConvoId = existingByKey[0].id;
      pass('step_3_dedup_baseline', {
        canonical_key: canonicalKey,
        pre_existing_conversation_id: preExistingConvoId,
      });
    } else {
      pass('step_3_dedup_baseline', { canonical_key: canonicalKey, pre_existing_conversation_id: null });
    }

    // ── CASE REQUIRED: Call real deployed sendWorldPhoneMessage ───────────────
    // base44.functions.invoke() uses the forwarded user session from the UI request.
    // This is why this function MUST be called from the live authenticated UI — not the test harness.
    // The test harness does not forward a user session → 403.
    // The live UI does forward the user session → function invocation works.
    let invokeError = null;
    try {
      const invokeRes = await base44.functions.invoke('sendWorldPhoneMessage', {
        sender_character_id: vick.id,
        recipient_identifier: ethan.id,
        requested_message: "Hey Ethan, it's Vick — just reaching out to see how you're doing.",
        source: 'character_action',
        owner_email: ownerEmail,
        generate_recipient_response: false,
        autonomy_marker: 'vick_ethan_proof::path_a_ui_session',
      });
      sendResult = invokeRes?.data || invokeRes;
    } catch (e) {
      invokeError = e.message;
      const is403 = e.message?.includes('403') || e.message?.includes('Forbidden');
      fail('case_required_real_deployed_sendWorldPhoneMessage',
        is403
          ? 'REAL DEPLOYED FUNCTION RETURNED 403 — This proof must be run from the live authenticated app UI (Settings → Troubleshooting → WP Proof), not the backend test harness. The test harness does not forward a user session. 403 = FAIL.'
          : `REAL DEPLOYED FUNCTION THREW: ${e.message}`,
        {
          function: 'sendWorldPhoneMessage',
          invocation_method: 'base44.functions.invoke (requires forwarded user session from UI)',
          is_403: is403,
          message_record_created: false,
          conversation_record_created: false,
          required_action: 'Run this proof from Settings → Troubleshooting → WP Proof tab in the live app UI.',
        }
      );
    }

    if (!invokeError && sendResult !== null) {
      if (sendResult?.success === true) {
        sentMsgId = sendResult.message_id;
        sentConvoId = sendResult.conversation_id;
        pass('case_required_real_deployed_sendWorldPhoneMessage', {
          function: 'sendWorldPhoneMessage',
          invocation_method: 'base44.functions.invoke (user session forwarded from UI)',
          message_id: sentMsgId,
          conversation_id: sentConvoId,
          shared_key: sendResult.shared_conversation_key,
          sender: vick.name,
          recipient: ethan.name,
        });
      } else {
        fail('case_required_real_deployed_sendWorldPhoneMessage',
          `REAL DEPLOYED FUNCTION RETURNED success:false — ${sendResult?.error || 'unknown'}`,
          {
            function: 'sendWorldPhoneMessage',
            success: sendResult?.success,
            error: sendResult?.error,
            message_record_created: false,
            conversation_record_created: false,
          }
        );
      }
    }

    // ── STEP 4: Verify Message record (read-back only) ────────────────────────
    if (sentMsgId) {
      const readBack = await sr.entities.Message.filter({ id: sentMsgId }, null, 1).catch(() => []);
      verifiedMsg = readBack?.[0];
      if (!verifiedMsg) {
        fail('step_4_message_readback', `Message ${sentMsgId} not found in DB`);
      } else if (verifiedMsg.sender_character_id !== vick.id) {
        fail('step_4_message_readback', `sender_character_id mismatch`);
      } else if (verifiedMsg.receiver_character_id !== ethan.id) {
        fail('step_4_message_readback', `receiver_character_id mismatch`);
      } else if (verifiedMsg.channel !== 'world_phone') {
        fail('step_4_message_readback', `Wrong channel: ${verifiedMsg.channel}`);
      } else {
        pass('step_4_message_readback', {
          id: verifiedMsg.id,
          channel: verifiedMsg.channel,
          sender_character_id: verifiedMsg.sender_character_id,
          receiver_character_id: verifiedMsg.receiver_character_id,
          shared_conversation_key: verifiedMsg.shared_conversation_key,
          content_preview: (verifiedMsg.content || '').substring(0, 80),
          written_by: 'sendWorldPhoneMessage (real deployed function)',
        });
      }
    } else {
      fail('step_4_message_readback', 'No message_id — real function produced no Message record');
    }

    // ── STEP 5: Verify Conversation record ────────────────────────────────────
    if (sentConvoId) {
      verifiedConvo = (await sr.entities.Conversation.filter({ id: sentConvoId }, null, 1).catch(() => []))[0];
      if (!verifiedConvo) {
        fail('step_5_conversation_record', `Conversation ${sentConvoId} not found`);
      } else {
        pass('step_5_conversation_record', {
          id: verifiedConvo.id,
          channel: verifiedConvo.channel,
          shared_conversation_key: verifiedConvo.shared_conversation_key,
          participant_character_ids: verifiedConvo.participant_character_ids,
        });
      }
    } else {
      fail('step_5_conversation_record', 'No conversation_id returned');
    }

    // ── STEP 6: World Contacts visibility ────────────────────────────────────
    if (sendResult?.shared_conversation_key) {
      const byKey = await sr.entities.Conversation.filter(
        { shared_conversation_key: sendResult.shared_conversation_key }, null, 5
      ).catch(() => []);
      if (byKey.length === 0) {
        fail('step_6_world_contacts_visibility', 'Conversation NOT visible via shared_conversation_key query');
      } else {
        pass('step_6_world_contacts_visibility', {
          shared_key: sendResult.shared_conversation_key,
          conversations_found: byKey.length,
        });
      }
    } else {
      fail('step_6_world_contacts_visibility', 'No shared_conversation_key to query');
    }

    // ── STEP 7: World Phone visibility ────────────────────────────────────────
    if (sentConvoId) {
      const wpMsgs = await sr.entities.Message.filter(
        { sender_character_id: vick.id, channel: 'world_phone', conversation_id: sentConvoId }, null, 10
      ).catch(() => []);
      if (wpMsgs.length === 0) {
        fail('step_7_world_phone_visibility', 'Vick outbound message NOT visible via World Phone query');
      } else {
        pass('step_7_world_phone_visibility', { vick_outbound_messages: wpMsgs.length, conversation_id: sentConvoId });
      }
    } else {
      fail('step_7_world_phone_visibility', 'No conversation_id to query');
    }

    // ── STEP 8: No duplicate ──────────────────────────────────────────────────
    if (sendResult?.shared_conversation_key) {
      const allConvos = await sr.entities.Conversation.filter(
        { shared_conversation_key: sendResult.shared_conversation_key }, null, 10
      ).catch(() => []);
      if (preExistingConvoId && sentConvoId !== preExistingConvoId) {
        fail('step_8_no_duplicate', `Pre-existing thread not reused — duplicate created`);
      } else if (!preExistingConvoId && allConvos.length > 1) {
        fail('step_8_no_duplicate', `${allConvos.length} conversations for same key — duplicates exist`);
      } else {
        pass('step_8_no_duplicate', { total_for_key: allConvos.length, pre_existing_reused: !!preExistingConvoId });
      }
    } else {
      fail('step_8_no_duplicate', 'Cannot verify');
    }

    // ── STEP 9: Vick integrity ────────────────────────────────────────────────
    const vickAfter = (await sr.entities.Character.filter({ id: vick.id }, null, 1).catch(() => []))[0];
    if (!vickAfter) {
      fail('step_9_vick_integrity', 'Vick record missing');
    } else if (vickAfter.character_type !== vick.character_type) {
      fail('step_9_vick_integrity', `character_type changed: ${vick.character_type} → ${vickAfter.character_type}`);
    } else {
      pass('step_9_vick_integrity', { character_type: vickAfter.character_type, is_world_service: vickAfter.is_world_service });
    }

    // ── STEP 10: Ethan integrity ──────────────────────────────────────────────
    const ethanAfter = (await sr.entities.Character.filter({ id: ethan.id }, null, 1).catch(() => []))[0];
    if (!ethanAfter) {
      fail('step_10_ethan_integrity', 'Ethan record missing');
    } else if (ethanAfter.character_type !== ethan.character_type) {
      fail('step_10_ethan_integrity', `character_type changed`);
    } else {
      pass('step_10_ethan_integrity', { character_type: ethanAfter.character_type, status: ethanAfter.status });
    }

    // ── CLEANUP ───────────────────────────────────────────────────────────────
    const cleanupResults = { messages_deleted: [], conversations_deleted: [] };
    if (sentMsgId) {
      await sr.entities.Message.delete(sentMsgId).catch(() => {});
      cleanupResults.messages_deleted.push(sentMsgId);
    }
    if (sentConvoId && !preExistingConvoId) {
      const leftover = await sr.entities.Message.filter({ conversation_id: sentConvoId }, null, 50).catch(() => []);
      for (const m of leftover) {
        if (m.id !== sentMsgId) await sr.entities.Message.delete(m.id).catch(() => {});
      }
      await sr.entities.Conversation.delete(sentConvoId).catch(() => {});
      cleanupResults.conversations_deleted.push(sentConvoId);
    }

    // ── FINAL RESULT ──────────────────────────────────────────────────────────
    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const overallPass = failCount === 0;

    return Response.json({
      proof_type: 'PATH_A_REAL_DEPLOYED_FUNCTION — Vick → Ethan World Phone',
      invocation_method: 'base44.functions.invoke (user session forwarded from live UI)',
      previous_proof_status: 'INVALID — previous proof used inline Message.create(). That PASS is rejected.',
      execution_context: invokeError?.includes('403')
        ? 'WRONG CONTEXT: Called from backend test harness (no session). Must be called from Settings → Troubleshooting → WP Proof in the live app UI.'
        : 'CORRECT CONTEXT: Called from live authenticated UI session.',
      success: overallPass,
      overall_status: overallPass
        ? 'PASS — real deployed production path verified'
        : 'FAIL — real deployed production path not verified',
      proof_verified: overallPass,
      failure_is_accepted: false,
      summary: `${passCount} passed, ${failCount} failed`,
      required_case: {
        case: 'Vick Servicio → Ethan Thompson via real deployed sendWorldPhoneMessage',
        invocation: 'base44.functions.invoke("sendWorldPhoneMessage", ...)',
        result: results.find(r => r.step === 'case_required_real_deployed_sendWorldPhoneMessage')?.status || 'NOT_RUN',
        message_id: verifiedMsg?.id || null,
        conversation_id: sentConvoId || null,
        message_record_confirmed: !!verifiedMsg,
        conversation_record_confirmed: !!verifiedConvo,
        message_written_by: verifiedMsg ? 'sendWorldPhoneMessage (real deployed function)' : 'not written',
        content_preview: verifiedMsg ? (verifiedMsg.content || '').substring(0, 80) : null,
      },
      results,
      cleanup: cleanupResults,
    });

  } catch (fatalErr) {
    console.error('[VickEthanProof] Fatal:', fatalErr.stack || fatalErr.message);
    return Response.json({
      proof_type: 'PATH_A_REAL_DEPLOYED_FUNCTION — Vick → Ethan World Phone',
      previous_proof_status: 'INVALID — previous proof used inline Message.create(). That PASS is rejected.',
      success: false,
      overall_status: 'FAIL — real deployed production path not verified',
      proof_verified: false,
      failure_is_accepted: false,
      fatal_error: fatalErr.message,
    }, { status: 500 });
  }
});