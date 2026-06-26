import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

/**
 * processUnresolvedCommunicationCommitments
 *
 * Processes pending CommunicationCommitment records that are past their due_after time.
 *
 * Handles:
 *   1. follow_up / check_in / will_let_you_know / event_follow_up:
 *      → calls sendProactiveMessageForCharacter with forceCommitmentId
 *      → character reaches out to user with natural follow-through
 *
 *   2. third_party_relay:
 *      → Character A was asked to relay a message to Character C
 *      → If Character C is an active character with a World Phone thread:
 *        sends via triggerCharacterContact so message routes through canonical World Phone path
 *      → If Character C is not found, marks commitment as expired with reason
 *
 * Caps: max 5 commitments processed per run to prevent overload.
 * Called by automation every 2 hours.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // This runs from scheduled automations without a user session.
    // All entity operations use asServiceRole — the auth.me() check was incorrectly
    // blocking automated runs. Replaced with service-role-only execution.
    await base44.auth.me().catch(() => null);

    const now = new Date();
    const nowIso = now.toISOString();

    // Load pending commitments that are due (due_after <= now OR no due_after set)
    // Use asServiceRole since this runs from automation context without a live user session
    const sr = base44.asServiceRole;
    const allPending = await sr.entities.CommunicationCommitment.filter({
      status: 'pending',
    }, 'due_after', 50).catch(() => []);

    // ── PROMISE-TRACK: Load ready_to_deliver commitments separately ──────────
    // These are Vick diagnostic commitments (metadata.promise_track === true) whose
    // investigation has reached a terminal state. They bypass due_after entirely —
    // the investigation completing IS the trigger. Normal commitments are unaffected.
    const allReadyToDeliver = await sr.entities.CommunicationCommitment.filter({
      status: 'ready_to_deliver',
    }, 'created_at', 20).catch(() => []);

    // Only Promise-Track commitments use the ready_to_deliver fast path
    const promiseTrackReady = allReadyToDeliver.filter(c => c.metadata?.promise_track === true);

    const due = allPending.filter(c => {
      if (!c.due_after) return true; // no due date = immediately due
      return new Date(c.due_after) <= now;
    });

    // Expire commitments older than 7 days (they are no longer relevant)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const expired = due.filter(c => new Date(c.created_at || c.due_after) < sevenDaysAgo);
    for (const c of expired) {
      await sr.entities.CommunicationCommitment.update(c.id, {
        status: 'expired',
      }).catch(() => {});
    }

    // Promise-Track commitments older than 7 days without delivery → failed_delivery
    for (const c of promiseTrackReady) {
      const age = (now.getTime() - new Date(c.created_at || now).getTime()) / (24 * 3600 * 1000);
      if (age > 7) {
        await sr.entities.CommunicationCommitment.update(c.id, {
          status: 'failed_delivery',
        }).catch(() => {});
      }
    }

    const actionable = due.filter(c => new Date(c.created_at || c.due_after) >= sevenDaysAgo).slice(0, 5);

    // ── PROMISE-TRACK DELIVERY LOOP ───────────────────────────────────────────
    // Runs BEFORE the normal commitment loop. Scoped strictly to promise_track commitments.
    // Does NOT affect normal follow_up / third_party_relay commitments.
    const promiseTrackResults = [];
    const promiseTrackToProcess = promiseTrackReady
      .filter(c => {
        const age = (now.getTime() - new Date(c.created_at || now).getTime()) / (24 * 3600 * 1000);
        return age <= 7;
      })
      .slice(0, 5);

    for (const commitment of promiseTrackToProcess) {
      try {
        const conversationId = commitment.metadata?.original_conversation_id;
        const investigationId = commitment.metadata?.investigation_id;
        const vickCharacterId = commitment.character_id;
        const ownerEmail = commitment.owner_email;

        if (!conversationId || !vickCharacterId) {
          console.warn(`[processUnresolvedCommunicationCommitments] Promise-Track ${commitment.id} missing conversationId or vickCharacterId — skipping`);
          promiseTrackResults.push({ id: commitment.id, result: 'skipped_missing_fields' });
          continue;
        }

        // Load the linked investigation to get findings text
        let findingsContent = commitment.commitment_text || 'Investigation complete — no findings text available.';
        if (investigationId) {
          const invRecords = await sr.entities.VickInvestigation.filter({ id: investigationId }, null, 1).catch(() => []);
          const inv = invRecords[0] || null;
          if (inv?.findings) {
            findingsContent = inv.findings;
          } else if (inv) {
            // Investigation exists but has no findings — report the status honestly
            const invStatus = inv.status || 'unknown';
            const bridgeStatus = commitment.metadata?.bridge_status || invStatus;
            const bridgeFreshness = commitment.metadata?.bridge_freshness || 'unknown';
            const nowET_deliver = new Date().toLocaleString('en-US', {
              timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
            }) + ' Eastern';
            findingsContent = `Investigation reached terminal state at ${nowET_deliver}.\nStatus: ${bridgeStatus} | Freshness: ${bridgeFreshness}\nNo prose findings were produced. This is itself a diagnostic result — the investigation ran but returned no text. This is not "no data" — it is a documented failure to produce findings.`;
          }
        }

        // Write the Vick-authored follow-up message directly to the original conversation.
        // fulfillment_message_id is set ONLY after confirmed message creation succeeds.
        const nowIso_deliver = new Date().toISOString();
        let deliveredMessageId = null;
        let deliveryError = null;

        try {
          const savedMsg = await sr.entities.Message.create({
            conversation_id: conversationId,
            sender_type: 'character',
            character_id: vickCharacterId,
            character_name: commitment.character_name || 'Vick Servicio',
            content: findingsContent,
            recovery_signal: false,
            memory_eligible: false,
            relationship_eligible: false,
            is_read: false,
            timestamp: nowIso_deliver,
          });
          deliveredMessageId = savedMsg?.id || null;
        } catch (msgErr) {
          deliveryError = msgErr.message;
          console.error(`[processUnresolvedCommunicationCommitments] Promise-Track message write failed for ${commitment.id}: ${msgErr.message}`);
        }

        if (deliveredMessageId) {
          // Message exists — mark fulfilled with proof
          await sr.entities.CommunicationCommitment.update(commitment.id, {
            status: 'fulfilled',
            fulfilled_at: nowIso_deliver,
            fulfilled_message_id: deliveredMessageId,
          }).catch(e => console.error('[processUnresolvedCommunicationCommitments] Commitment fulfill update failed:', e.message));

          // Mark the linked investigation as delivered
          if (investigationId) {
            await sr.entities.VickInvestigation.update(investigationId, {
              status: 'delivered',
              findings_delivered: true,
              delivered_at: nowIso_deliver,
            }).catch(() => {});
          }

          // Update conversation preview
          await sr.entities.Conversation.update(conversationId, {
            last_message_preview: findingsContent.substring(0, 100),
            last_message_date: nowIso_deliver,
          }).catch(() => {});

          promiseTrackResults.push({
            id: commitment.id,
            result: 'fulfilled',
            fulfillment_message_id: deliveredMessageId,
            investigation_id: investigationId,
          });
        } else {
          // Message write failed — mark failed_delivery, never mark fulfilled
          await sr.entities.CommunicationCommitment.update(commitment.id, {
            status: 'failed_delivery',
          }).catch(() => {});

          promiseTrackResults.push({
            id: commitment.id,
            result: 'failed_delivery',
            error: deliveryError || 'message_create_returned_no_id',
            investigation_id: investigationId,
          });
        }

        await new Promise(r => setTimeout(r, 300));
      } catch (ptErr) {
        console.error(`[processUnresolvedCommunicationCommitments] Promise-Track error for ${commitment.id}: ${ptErr.message}`);
        promiseTrackResults.push({ id: commitment.id, result: 'error', error: ptErr.message });
      }
    }

    const results = [];

    for (const commitment of actionable) {
      try {
        // ── THIRD-PARTY RELAY ──────────────────────────────────────────────────
        if (commitment.commitment_type === 'third_party_relay') {
          const targetName = commitment.third_party_character_name;
          const relayMessage = commitment.third_party_message;

          if (!targetName || !relayMessage) {
            await sr.entities.CommunicationCommitment.update(commitment.id, {
              status: 'expired',
            }).catch(() => {});
            results.push({ id: commitment.id, type: 'third_party_relay', result: 'expired_missing_target' });
            continue;
          }

          // Look up the third-party character by name — use service role since no user session in automation
          const charOwnerEmail = commitment.owner_email;
          const allChars = await sr.entities.Character.filter({
            owner_email: charOwnerEmail,
            status: 'active',
          }, null, 200).catch(() => []);

          const targetChar = allChars.find(c => {
            const name = (c.name || c.display_name || '').toLowerCase();
            return name.includes(targetName.toLowerCase()) || targetName.toLowerCase().includes(name);
          });

          if (!targetChar) {
            // Target character not found — expire this commitment
            await base44.entities.CommunicationCommitment.update(commitment.id, {
              status: 'expired',
            }).catch(() => {});
            results.push({ id: commitment.id, type: 'third_party_relay', result: 'expired_target_not_found', target: targetName });
            continue;
          }

          // If third_party_character_id not set yet, update it
          if (!commitment.third_party_character_id) {
            await sr.entities.CommunicationCommitment.update(commitment.id, {
              third_party_character_id: targetChar.id,
            }).catch(() => {});
          }

          // Send the relay via triggerCharacterContact → sendWorldPhoneMessage
          // This creates a proper World Phone message from the committing character to the target.
          // CAUSALITY: commitment is marked fulfilled ONLY after a verified messageId is returned.
          // If send fails, commitment stays pending for retry (not expired).
          const wpResult = await base44.functions.invoke('triggerCharacterContact', {
            senderCharacterId: commitment.character_id,
            receiverCharacterId: targetChar.id,
            receiverCharacterName: targetChar.name,
            topic: `relaying a message: "${relayMessage.substring(0, 100)}"`,
            trigger_source: 'relationship',
            autonomy_marker: `commitment_relay::${commitment.id}`,
          }).catch(() => null);

          const wpSuccess = wpResult?.data?.success;
          const wpMessageId = wpResult?.data?.messageId || null;

          if (wpSuccess && wpMessageId) {
            // CAUSALITY: fulfilled only after verified World Phone message_id
            await sr.entities.CommunicationCommitment.update(commitment.id, {
              status: 'fulfilled',
              fulfilled_at: nowIso,
              fulfilled_message_id: wpMessageId,
            }).catch(() => {});
          } else {
            // Send failed — keep pending for retry, not expired
            console.warn(`[processUnresolvedCommunicationCommitments] third_party_relay ${commitment.id} WP send failed. Keeping pending. Error: ${wpResult?.data?.error || 'unknown'}`);
            const daysOld = (now.getTime() - new Date(commitment.created_at || commitment.due_after).getTime()) / (24 * 3600 * 1000);
            if (daysOld > 3) {
              await sr.entities.CommunicationCommitment.update(commitment.id, {
                status: 'expired',
              }).catch(() => {});
            }
          }

          results.push({
            id: commitment.id,
            type: 'third_party_relay',
            result: (wpSuccess && wpMessageId) ? 'fulfilled' : 'deferred',
            channel: 'world_phone',
            target: targetChar.name,
            messageId: wpMessageId,
          });

        } else if (commitment.target_character_id) {
          // ── CHARACTER-TO-CHARACTER FOLLOW-UP ───────────────────────────────
          // The commitment targets a specific other character (not the user).
          // MANDATORY: must route through sendWorldPhoneMessage via triggerCharacterContact.
          // A direct message to the user CANNOT fulfill a character-to-character commitment.
          const wpResult = await base44.functions.invoke('triggerCharacterContact', {
            senderCharacterId: commitment.character_id,
            receiverCharacterId: commitment.target_character_id,
            receiverCharacterName: commitment.target_character_name || null,
            topic: commitment.context_summary || commitment.commitment_text?.substring(0, 100),
            trigger_source: 'relationship',
            autonomy_marker: `commitment_followup::${commitment.id}`,
          }).catch(() => null);

          const wpSuccess = wpResult?.data?.success;
          const wpMessageId = wpResult?.data?.messageId || null;

          if (wpSuccess && wpMessageId) {
            // CAUSALITY: mark fulfilled ONLY after verified World Phone message_id
            await sr.entities.CommunicationCommitment.update(commitment.id, {
              status: 'fulfilled',
              fulfilled_at: nowIso,
              fulfilled_message_id: wpMessageId,
            }).catch(() => {});
            results.push({
              id: commitment.id,
              type: commitment.commitment_type,
              result: 'fulfilled',
              channel: 'world_phone',
              messageId: wpMessageId,
              target: commitment.target_character_name,
            });
          } else {
            // Send failed — do NOT mark fulfilled, retry next run
            console.warn(`[processUnresolvedCommunicationCommitments] Character-to-character commitment ${commitment.id} WP send failed. Keeping pending for retry. Error: ${wpResult?.data?.error || 'unknown'}`);
            const daysOld = (now.getTime() - new Date(commitment.created_at || commitment.due_after).getTime()) / (24 * 3600 * 1000);
            if (daysOld > 3) {
              await sr.entities.CommunicationCommitment.update(commitment.id, {
                status: 'expired',
              }).catch(() => {});
            }
            results.push({
              id: commitment.id,
              type: commitment.commitment_type,
              result: 'deferred',
              channel: 'world_phone',
              reason: wpResult?.data?.error || 'wp_send_failed',
              target: commitment.target_character_name,
            });
          }

        } else {
          // ── CHARACTER-TO-USER FOLLOW-UP ────────────────────────────────────
          // No target_character_id = directed at the user. Route via direct chat.
          const proResult = await base44.functions.invoke('sendProactiveMessageForCharacter', {
            characterId: commitment.character_id,
            forceCommitmentId: commitment.id,
          }).catch(() => null);

          const proSuccess = proResult?.data?.success;

          if (!proSuccess) {
            // Don't expire on failure — retry next run unless it's been too long
            const daysOld = (now.getTime() - new Date(commitment.created_at || commitment.due_after).getTime()) / (24 * 3600 * 1000);
            if (daysOld > 3) {
              await sr.entities.CommunicationCommitment.update(commitment.id, {
                status: 'expired',
              }).catch(() => {});
            }
          }

          results.push({
            id: commitment.id,
            type: commitment.commitment_type,
            result: proSuccess ? 'fulfilled' : 'deferred',
            channel: 'direct',
            reason: proResult?.data?.reason,
          });
        }

        // Throttle between commitments
        await new Promise(r => setTimeout(r, 500));

      } catch (commitErr) {
        results.push({ id: commitment.id, error: commitErr.message });
      }
    }

    console.log(
      `[processUnresolvedCommunicationCommitments] ` +
      `pending=${allPending.length} | due=${due.length} | expired=${expired.length} | processed=${actionable.length} | promise_track_ready=${promiseTrackReady.length} | promise_track_processed=${promiseTrackToProcess.length}`
    );

    return Response.json({
      success: true,
      pending_total: allPending.length,
      due: due.length,
      expired_this_run: expired.length,
      processed: actionable.length,
      results,
      promise_track_ready: promiseTrackReady.length,
      promise_track_processed: promiseTrackToProcess.length,
      promise_track_results: promiseTrackResults,
      timestamp: nowIso,
    });

  } catch (error) {
    console.error('[processUnresolvedCommunicationCommitments] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});