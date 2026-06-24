/**
 * proofProductionPathVickIntegrity
 *
 * REAL PRODUCTION-PATH VERIFICATION — Vick → Ethan World Phone.
 *
 * STRICT RULES:
 * - 403 = FAIL. No excuses. No fallback.
 * - Blocked = FAIL.
 * - Skipped = FAIL.
 * - Inline logic = FAIL.
 * - Direct DB write = FAIL.
 * - Any real function returning non-2xx or success:false = FAIL.
 * - No third status category. PASS or FAIL only.
 *
 * This function must be called from the live authenticated app UI, not the
 * backend test harness. The test harness does not carry a user session token,
 * causing function-to-function invocation to return 403. That is reported as
 * FAIL honestly — not blocked, not skipped, not excused.
 *
 * Required case:
 *   Vick Servicio → Ethan Thompson
 *   Via the real deployed "sendWorldPhoneMessage" function.
 *   No inline logic. No mirrors. No copies.
 *
 * Cleanup: message and conversation artifacts deleted post-proof.
 * Ethan and Vick are never modified, deleted, or converted.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const user = await base44.auth.me().catch(() => null);
    if (!user?.email || user.role !== 'admin') {
      return Response.json({ error: 'Admin required' }, { status: 403 });
    }

    const ownerEmail = user.email;
    const results = [];
    const createdMessageIds = [];
    const createdConvoIds = [];

    function pass(step, detail = {}) {
      results.push({ step, status: 'PASS', ...detail });
      console.log(`[VickEthanProof] ✅ ${step}`, JSON.stringify(detail));
    }
    function fail(step, reason, detail = {}) {
      results.push({ step, status: 'FAIL', reason, ...detail });
      console.error(`[VickEthanProof] ❌ FAIL ${step}: ${reason}`, JSON.stringify(detail));
    }

    let vick = null;
    let ethan = null;
    let sendResult = null;

    // ── STEP 1: Resolve real Vick Servicio ────────────────────────────────────
    const vickArr = await sr.entities.Character.filter(
      { name: 'Vick Servicio', status: 'active' }, null, 5
    ).catch(() => []);
    vick = vickArr.find(c => c.is_world_service === true || c.character_type === 'npc_world_service') || vickArr[0];

    if (!vick) {
      fail('step_1_resolve_vick', 'Vick Servicio not found in database');
    } else {
      pass('step_1_resolve_vick', {
        vick_id: vick.id,
        vick_name: vick.name,
        character_type: vick.character_type,
        is_world_service: vick.is_world_service,
        status: vick.status,
      });
    }

    // ── STEP 2: Resolve real Ethan (owned by authenticated user) ──────────────
    if (vick) {
      const ethanArr = await sr.entities.Character.filter(
        { owner_email: ownerEmail, status: 'active' }, null, 200
      ).catch(() => []);
      ethan = ethanArr.find(c =>
        c.name?.toLowerCase().includes('ethan') &&
        c.character_type === 'active_created_character' &&
        c.status === 'active'
      );

      if (!ethan) {
        fail('step_2_resolve_ethan', `No active Ethan character found for owner_email=${ownerEmail}`);
      } else {
        pass('step_2_resolve_ethan', {
          ethan_id: ethan.id,
          ethan_name: ethan.name,
          character_type: ethan.character_type,
          owner_email: ethan.owner_email,
          status: ethan.status,
        });
      }
    } else {
      fail('step_2_resolve_ethan', 'Skipped — Vick not resolved in step 1');
    }

    // ── STEP 3: Check for pre-existing Vick/Ethan conversation (dedup baseline) ─
    let preExistingConvoId = null;
    if (vick && ethan) {
      const sortedIds = [vick.id, ethan.id].sort();
      const canonicalKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;
      const existing = await sr.entities.Conversation.filter(
        { shared_conversation_key: canonicalKey }, null, 5
      ).catch(() => []);
      if (existing.length > 0) {
        preExistingConvoId = existing[0].id;
        pass('step_3_dedup_baseline', {
          canonical_key: canonicalKey,
          pre_existing_conversation_id: preExistingConvoId,
          pre_existing_count: existing.length,
          note: 'Pre-existing thread found — dedup must be enforced after send',
        });
      } else {
        pass('step_3_dedup_baseline', {
          canonical_key: canonicalKey,
          pre_existing_conversation_id: null,
          note: 'No pre-existing thread — first contact will create one',
        });
      }
    }

    // ── CASE REQUIRED: REAL sendWorldPhoneMessage — Vick → Ethan ──────────────
    // This calls the ACTUAL DEPLOYED FUNCTION via base44.functions.invoke().
    // 403 = FAIL. No fallback. No inline logic. No DB write substitute.
    if (vick && ethan) {
      try {
        const invokeRes = await base44.functions.invoke('sendWorldPhoneMessage', {
          sender_character_id: vick.id,
          recipient_identifier: ethan.id,
          requested_message: "Hey Ethan, it's Vick — just reaching out to see how you're doing.",
          source: 'character_action',
          owner_email: ownerEmail,
          generate_recipient_response: false,
          autonomy_marker: 'vick_ethan_proof::production_path_verification',
        });
        sendResult = invokeRes?.data || invokeRes;
      } catch (e) {
        const is403 = e.message?.includes('403') || e.message?.includes('Forbidden');
        const is401 = e.message?.includes('401') || e.message?.includes('Unauthorized');
        fail('case_required_real_swpm_vick_to_ethan', `REAL DEPLOYED FUNCTION THREW: ${e.message}`, {
          function: 'sendWorldPhoneMessage',
          http_status: is403 ? 403 : is401 ? 401 : 'unknown',
          is_403: is403,
          is_401: is401,
          message_record_created: false,
          conversation_record_created: false,
          note: is403
            ? 'FAIL: 403 means this execution context lacks a live user session token. Call this function from the authenticated app UI, not the backend test harness.'
            : 'FAIL: Real deployed function threw an exception.',
        });
        sendResult = null;
      }

      if (sendResult !== null) {
        if (sendResult?.success === true) {
          pass('case_required_real_swpm_vick_to_ethan', {
            function: 'sendWorldPhoneMessage (REAL DEPLOYED — base44.functions.invoke)',
            message_id: sendResult.message_id,
            conversation_id: sendResult.conversation_id,
            shared_key: sendResult.shared_conversation_key,
            sender: vick.name,
            recipient: ethan.name,
          });
          if (sendResult.message_id) createdMessageIds.push(sendResult.message_id);
          if (sendResult.conversation_id) createdConvoIds.push(sendResult.conversation_id);
        } else {
          fail('case_required_real_swpm_vick_to_ethan',
            `REAL DEPLOYED FUNCTION RETURNED success:false — error: ${sendResult?.error || 'unknown'}`,
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
    } else {
      fail('case_required_real_swpm_vick_to_ethan', 'FAIL — Vick or Ethan not resolved, cannot execute production send', {
        vick_resolved: !!vick,
        ethan_resolved: !!ethan,
        message_record_created: false,
        conversation_record_created: false,
      });
    }

    // ── STEP 4: Verify Message record exists in DB ─────────────────────────────
    const sentMsgId = sendResult?.message_id;
    let verifiedMsg = null;
    if (sentMsgId) {
      verifiedMsg = (await sr.entities.Message.filter({ id: sentMsgId }, null, 1).catch(() => []))[0];
      if (!verifiedMsg) {
        fail('step_4_message_record_exists', `Message ${sentMsgId} not found in DB after real sendWorldPhoneMessage call`);
      } else if (verifiedMsg.sender_character_id !== vick.id) {
        fail('step_4_message_record_exists', `sender_character_id mismatch: expected ${vick.id}, got ${verifiedMsg.sender_character_id}`);
      } else if (verifiedMsg.receiver_character_id !== ethan.id) {
        fail('step_4_message_record_exists', `receiver_character_id mismatch: expected ${ethan.id}, got ${verifiedMsg.receiver_character_id}`);
      } else if (verifiedMsg.channel !== 'world_phone') {
        fail('step_4_message_record_exists', `Wrong channel: ${verifiedMsg.channel}`);
      } else if (!verifiedMsg.shared_conversation_key?.startsWith('world_phone::')) {
        fail('step_4_message_record_exists', `Invalid shared_conversation_key: ${verifiedMsg.shared_conversation_key}`);
      } else {
        pass('step_4_message_record_exists', {
          id: verifiedMsg.id,
          channel: verifiedMsg.channel,
          sender_character_id: verifiedMsg.sender_character_id,
          receiver_character_id: verifiedMsg.receiver_character_id,
          shared_conversation_key: verifiedMsg.shared_conversation_key,
          conversation_id: verifiedMsg.conversation_id,
          is_read: verifiedMsg.is_read,
          recovery_signal: verifiedMsg.recovery_signal,
          content_length: verifiedMsg.content?.length || 0,
          content_preview: (verifiedMsg.content || '').substring(0, 60),
        });
      }
    } else {
      fail('step_4_message_record_exists', 'No message_id returned — real function did not produce a Message record');
    }

    // ── STEP 5: Verify Conversation record exists ──────────────────────────────
    const sentConvoId = sendResult?.conversation_id;
    let verifiedConvo = null;
    if (sentConvoId) {
      verifiedConvo = (await sr.entities.Conversation.filter({ id: sentConvoId }, null, 1).catch(() => []))[0];
      if (!verifiedConvo) {
        fail('step_5_conversation_record_exists', `Conversation ${sentConvoId} not found in DB`);
      } else {
        pass('step_5_conversation_record_exists', {
          id: verifiedConvo.id,
          channel: verifiedConvo.channel,
          shared_conversation_key: verifiedConvo.shared_conversation_key,
          participant_character_ids: verifiedConvo.participant_character_ids,
          type: verifiedConvo.type,
        });
      }
    } else {
      fail('step_5_conversation_record_exists', 'No conversation_id returned — real function did not produce a Conversation record');
    }

    // ── STEP 6: World Contacts visibility (shared_conversation_key query) ───────
    if (sendResult?.shared_conversation_key) {
      const byKey = await sr.entities.Conversation.filter(
        { shared_conversation_key: sendResult.shared_conversation_key }, null, 5
      ).catch(() => []);
      const msgsByKey = await sr.entities.Message.filter(
        { shared_conversation_key: sendResult.shared_conversation_key, channel: 'world_phone' }, null, 10
      ).catch(() => []);

      if (byKey.length === 0) {
        fail('step_6_world_contacts_visibility', 'Conversation NOT found via shared_conversation_key — World Contacts would show empty thread');
      } else if (byKey.length > 1 && !preExistingConvoId) {
        fail('step_6_world_contacts_visibility', `${byKey.length} conversations for key — duplicate created`);
      } else {
        pass('step_6_world_contacts_visibility', {
          shared_key: sendResult.shared_conversation_key,
          conversations_found: byKey.length,
          messages_found: msgsByKey.length,
          pre_existing_merged: !!preExistingConvoId,
        });
      }
    } else {
      fail('step_6_world_contacts_visibility', 'No shared_conversation_key returned — World Contacts cannot find thread');
    }

    // ── STEP 7: World Phone message visibility ─────────────────────────────────
    if (sentConvoId && vick) {
      const wpMsgs = await sr.entities.Message.filter(
        { conversation_id: sentConvoId, sender_character_id: vick.id, channel: 'world_phone' }, null, 10
      ).catch(() => []);
      if (wpMsgs.length === 0) {
        fail('step_7_world_phone_visibility', 'Vick outbound message not visible via World Phone query');
      } else {
        pass('step_7_world_phone_visibility', {
          vick_outbound_messages: wpMsgs.length,
          conversation_id: sentConvoId,
        });
      }
    } else {
      fail('step_7_world_phone_visibility', 'Conversation not established — cannot verify World Phone visibility');
    }

    // ── STEP 8: No duplicate conversation ─────────────────────────────────────
    if (vick && ethan && sendResult?.shared_conversation_key) {
      const allConvos = await sr.entities.Conversation.filter(
        { shared_conversation_key: sendResult.shared_conversation_key }, null, 10
      ).catch(() => []);
      // Acceptable: 1 (new) or 1 (pre-existing reused). Never >1 net new.
      const newConvos = allConvos.filter(c => c.id !== preExistingConvoId);
      if (preExistingConvoId && sendResult.conversation_id !== preExistingConvoId) {
        // Pre-existing thread existed but send created a different one
        fail('step_8_no_duplicate_conversation', `Pre-existing thread ${preExistingConvoId} was not reused — new duplicate ${sendResult.conversation_id} created`);
      } else if (!preExistingConvoId && allConvos.length > 1) {
        fail('step_8_no_duplicate_conversation', `${allConvos.length} conversations for same canonical key — duplicates created`);
      } else {
        pass('step_8_no_duplicate_conversation', {
          total_for_key: allConvos.length,
          pre_existing_reused: !!preExistingConvoId && sendResult?.conversation_id === preExistingConvoId,
          conversation_id: sendResult.conversation_id,
        });
      }
    } else {
      fail('step_8_no_duplicate_conversation', 'Cannot verify — send did not complete');
    }

    // ── STEP 9: No false narrative claim ──────────────────────────────────────
    // Vick may only claim the send happened if the Message record is confirmed.
    // If sendResult.success !== true, the message was never sent — no claim is valid.
    if (sendResult?.success === true && verifiedMsg?.id) {
      pass('step_9_no_false_narrative_claim', {
        send_confirmed: true,
        message_id: verifiedMsg.id,
        note: 'Message record confirmed — Vick may accurately claim the send occurred',
      });
    } else if (sendResult?.success !== true) {
      pass('step_9_no_false_narrative_claim', {
        send_confirmed: false,
        note: 'Send did not succeed — worldPhoneActionHandler would strip any narrative claim. No false claim possible.',
      });
    } else {
      fail('step_9_no_false_narrative_claim', 'Send reported success but Message record not verified — claim state uncertain');
    }

    // ── STEP 10: Vick not modified, deleted, duplicated, or converted ──────────
    if (vick) {
      const vickAfter = (await sr.entities.Character.filter({ id: vick.id }, null, 1).catch(() => []))[0];
      if (!vickAfter) {
        fail('step_10_vick_integrity', 'Vick record not found after proof run — was deleted!');
      } else if (vickAfter.character_type !== vick.character_type) {
        fail('step_10_vick_integrity', `character_type changed: ${vick.character_type} → ${vickAfter.character_type}`);
      } else if (vickAfter.is_world_service !== vick.is_world_service) {
        fail('step_10_vick_integrity', `is_world_service changed: ${vick.is_world_service} → ${vickAfter.is_world_service}`);
      } else {
        pass('step_10_vick_integrity', {
          id: vickAfter.id,
          name: vickAfter.name,
          character_type: vickAfter.character_type,
          is_world_service: vickAfter.is_world_service,
          status: vickAfter.status,
          note: 'Vick was not modified, deleted, duplicated, or converted',
        });
      }
    }

    // ── STEP 11: Ethan not modified, deleted, duplicated, or converted ──────────
    if (ethan) {
      const ethanAfter = (await sr.entities.Character.filter({ id: ethan.id }, null, 1).catch(() => []))[0];
      if (!ethanAfter) {
        fail('step_11_ethan_integrity', 'Ethan record not found after proof run — was deleted!');
      } else if (ethanAfter.character_type !== ethan.character_type) {
        fail('step_11_ethan_integrity', `character_type changed: ${ethan.character_type} → ${ethanAfter.character_type}`);
      } else {
        pass('step_11_ethan_integrity', {
          id: ethanAfter.id,
          name: ethanAfter.name,
          character_type: ethanAfter.character_type,
          status: ethanAfter.status,
          note: 'Ethan was not modified, deleted, duplicated, or converted',
        });
      }
    }

    // ── CLEANUP ──────────────────────────────────────────────────────────────
    // Only delete proof-created artifacts. Never touch pre-existing threads.
    const cleanupResults = { messages: [], conversations: [] };

    // Delete the proof message (the Vick→Ethan test send)
    for (const msgId of [...new Set(createdMessageIds)]) {
      await sr.entities.Message.delete(msgId).catch(() => {});
      cleanupResults.messages.push({ id: msgId, deleted: true });
    }

    // Only delete the conversation if it was newly created by this proof
    // (i.e., there was no pre-existing thread before this run)
    for (const convoId of [...new Set(createdConvoIds)]) {
      if (preExistingConvoId && convoId === preExistingConvoId) {
        // Don't delete pre-existing thread — it belongs to real history
        cleanupResults.conversations.push({ id: convoId, deleted: false, note: 'pre-existing thread preserved' });
      } else {
        // This conversation was created by the proof — safe to delete
        // First remove any remaining messages inside it
        const leftoverMsgs = await sr.entities.Message.filter({ conversation_id: convoId }, null, 50).catch(() => []);
        for (const m of leftoverMsgs) {
          if (!createdMessageIds.includes(m.id)) {
            await sr.entities.Message.delete(m.id).catch(() => {});
            cleanupResults.messages.push({ id: m.id, deleted: true, note: 'leftover_in_proof_convo' });
          }
        }
        await sr.entities.Conversation.delete(convoId).catch(() => {});
        cleanupResults.conversations.push({ id: convoId, deleted: true });
      }
    }

    // ── FINAL RESULT ─────────────────────────────────────────────────────────
    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const overallPass = failCount === 0;

    // Determine if failure is specifically due to 403 (execution context issue)
    const has403Fail = results.some(r =>
      r.status === 'FAIL' && (r.http_status === 403 || r.reason?.includes('403') || r.reason?.includes('Forbidden'))
    );

    return Response.json({
      proof_type: 'REAL_PRODUCTION_PATH_VERIFICATION — Vick → Ethan World Phone',
      execution_note: has403Fail
        ? 'EXECUTION CONTEXT FAILURE: This proof must be called from the live authenticated app UI (not the backend test harness). The test harness does not carry a user session token, causing base44.functions.invoke() to return 403. 403 = FAIL. Call from Settings → Troubleshooting → Run Vick World Phone Production Proof.'
        : 'Executed via live authenticated session.',
      success: overallPass,
      overall_status: overallPass
        ? 'PASS — real deployed production path verified'
        : 'FAIL — real deployed production path not verified',
      proof_verified: overallPass,
      failure_is_accepted: false,
      summary: `${passCount} passed, ${failCount} failed`,
      required_case: {
        case: 'Vick Servicio → Ethan Thompson via real sendWorldPhoneMessage',
        result: results.find(r => r.step === 'case_required_real_swpm_vick_to_ethan')?.status || 'NOT_RUN',
        message_id: sendResult?.message_id || null,
        conversation_id: sendResult?.conversation_id || null,
        message_record_confirmed: !!verifiedMsg,
        conversation_record_confirmed: !!verifiedConvo,
      },
      results,
      cleanup: cleanupResults,
    });

  } catch (fatalErr) {
    console.error('[VickEthanProof] Fatal:', fatalErr.stack || fatalErr.message);
    return Response.json({
      proof_type: 'REAL_PRODUCTION_PATH_VERIFICATION — Vick → Ethan World Phone',
      success: false,
      overall_status: 'FAIL — real deployed production path not verified',
      proof_verified: false,
      failure_is_accepted: false,
      fatal_error: fatalErr.message,
    }, { status: 500 });
  }
});