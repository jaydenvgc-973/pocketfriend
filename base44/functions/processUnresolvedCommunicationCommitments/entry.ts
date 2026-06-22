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
    // Soft auth — this runs from scheduled automations without a user session
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const nowIso = now.toISOString();

    // Load pending commitments that are due (due_after <= now OR no due_after set)
    // Use asServiceRole since this runs from automation context without a live user session
    const sr = base44.asServiceRole;
    const allPending = await sr.entities.CommunicationCommitment.filter({
      status: 'pending',
    }, 'due_after', 50).catch(() => []);

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

    const actionable = due.filter(c => new Date(c.created_at || c.due_after) >= sevenDaysAgo).slice(0, 5);

    const results = [];

    for (const commitment of actionable) {
      try {
        // ── THIRD-PARTY RELAY ──────────────────────────────────────────────────
        if (commitment.commitment_type === 'third_party_relay') {
          const targetName = commitment.third_party_character_name;
          const relayMessage = commitment.third_party_message;

          if (!targetName || !relayMessage) {
            await base44.entities.CommunicationCommitment.update(commitment.id, {
              status: 'expired',
            }).catch(() => {});
            results.push({ id: commitment.id, type: 'third_party_relay', result: 'expired_missing_target' });
            continue;
          }

          // Look up the third-party character by name — use service role since no user session in automation
          const charOwnerEmail = commitment.owner_email || user.email;
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
          // This creates a proper World Phone message from the committing character to the target
          const wpResult = await base44.functions.invoke('triggerCharacterContact', {
            senderCharacterId: commitment.character_id,
            receiverCharacterId: targetChar.id,
            receiverCharacterName: targetChar.name,
            topic: `relaying a message: "${relayMessage.substring(0, 100)}"`,
            trigger_source: 'relationship',
            autonomy_marker: `commitment_relay::${commitment.id}`,
          }).catch(() => null);

          const wpSuccess = wpResult?.data?.success;

          await sr.entities.CommunicationCommitment.update(commitment.id, {
            status: wpSuccess ? 'fulfilled' : 'expired',
            fulfilled_at: wpSuccess ? nowIso : null,
            fulfilled_message_id: wpResult?.data?.messageId || null,
          }).catch(() => {});

          results.push({
            id: commitment.id,
            type: 'third_party_relay',
            result: wpSuccess ? 'fulfilled' : 'failed',
            target: targetChar.name,
            messageId: wpResult?.data?.messageId,
          });

        } else {
          // ── USER-DIRECTED FOLLOW-UP (all other types) ──────────────────────
          // Delegate to sendProactiveMessageForCharacter which handles the full
          // context-aware follow-up generation
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
      `pending=${allPending.length} | due=${due.length} | expired=${expired.length} | processed=${actionable.length}`
    );

    return Response.json({
      success: true,
      pending_total: allPending.length,
      due: due.length,
      expired_this_run: expired.length,
      processed: actionable.length,
      results,
      timestamp: nowIso,
    });

  } catch (error) {
    console.error('[processUnresolvedCommunicationCommitments] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});