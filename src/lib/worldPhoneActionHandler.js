/**
 * worldPhoneActionHandler.js
 *
 * Handles TWO World Phone character action paths:
 *
 * 1. Past-tense claims: "I texted her", "I called him", "I let them know"
 *    → Send the actual message immediately. If send fails, strip the false claim.
 *
 * 2. Future-tense commitments: "I'll text her", "I'll call him", "I'll reach out"
 *    → Send the actual World Phone message immediately — the commitment IS the action.
 *    → If recipient cannot be resolved: write a persistent CharacterCommitment record
 *      so the commitment does not vanish. It remains actionable.
 *    → If send fails: write a pending CharacterCommitment record (not silent discard).
 *
 * Contract:
 * - Always sends a real World Phone message (creates DB record) when recipient is known
 * - Past-tense: if send fails, strips the false claim from responseText
 * - Future-tense unresolved: writes CharacterCommitment with status='active' for later follow-up
 * - Future-tense resolved + send fails: writes CharacterCommitment with status='blocked'
 * - If send succeeds: strips any fabricated summary of what the recipient supposedly said back
 *
 * Returns: { responseText, worldPhoneSendResult, commitmentSendResult }
 */

import { detectCharacterWorldPhoneAction, detectCharacterCommunicationCommitment, stripFabricatedReplyFromResponse } from "@/lib/worldPhoneIntentDetector";
import { base44 } from "@/api/base44Client";

/**
 * Resolves a pronoun commitment to a real recipient name from recent conversation messages.
 * Scans backwards through conversation — most recent mention wins.
 */
function resolveCommitmentPronoun(character, recentMessages) {
  const knownNames = [
    ...(character?.fictional_relationships || []).map(r => r.person_name).filter(Boolean),
    ...(character?.family_members || []).map(f => f.name).filter(Boolean),
  ];
  if (knownNames.length === 0 || !recentMessages?.length) return null;
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const content = (recentMessages[i]?.content || '').toLowerCase();
    for (const name of knownNames) {
      if (name.length > 2 && content.includes(name.toLowerCase())) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Persists an unresolved or failed communication commitment so it does not vanish.
 * Uses the existing CharacterCommitment entity — same one travel commitments use.
 * status='active' = pending resolution/execution by a future pass.
 * status='blocked' = send was attempted but failed; needs retry or user awareness.
 */
async function persistUnresolvedCommitment({ characterId, character, ownerEmail, commitmentText, recipientName, status, cancellationReason }) {
  try {
    await base44.entities.CharacterCommitment.create({
      character_id: characterId,
      character_name: character?.name || '',
      owner_email: ownerEmail,
      commitment_type: 'meeting', // closest existing type for a communication commitment
      destination_location_id: null,
      destination_location_name: recipientName || 'unknown recipient',
      commitment_source: 'character_communication_intent',
      commitment_text: (commitmentText || '').substring(0, 300),
      interruptible: true,
      status: status || 'active',
      cancellation_reason: cancellationReason || null,
      created_at: new Date().toISOString(),
    });
    console.log(`[WorldPhone] Unresolved commitment persisted for "${character?.name}" → "${recipientName || 'unknown'}" | status=${status}`);
  } catch (err) {
    // Non-fatal — log but don't interrupt caller
    console.warn(`[WorldPhone] Failed to persist unresolved commitment: ${err.message}`);
  }
}

export async function handleCharacterWorldPhoneAction({
  responseText,
  character,
  characterId,
  conversationId,
  ownerEmail,
  recentMessages,
}) {
  if (!responseText) return { responseText, worldPhoneSendResult: null, commitmentSendResult: null };

  // ── PATH 1: PAST-TENSE CLAIMS ─────────────────────────────────────────────
  // "I texted her", "I called him", "I let them know" — character claims action already done.
  // Must back-fill the real World Phone message or strip the false claim.
  const pastTenseIntent = detectCharacterWorldPhoneAction(responseText, character.name);
  let modifiedResponseText = responseText;
  let worldPhoneSendResult = null;

  if (pastTenseIntent) {
    console.log('[WorldPhone] past-tense claim detected:', pastTenseIntent);
    const messageToSend = pastTenseIntent.message || responseText;

    const pastResult = await base44.functions.invoke('sendWorldPhoneMessage', {
      sender_character_id: characterId,
      recipient_identifier: pastTenseIntent.recipient,
      requested_message: messageToSend,
      source: 'character_action',
      current_conversation_id: conversationId,
      owner_email: ownerEmail,
    }).catch(err => ({ data: { success: false, error: err.message } }));

    worldPhoneSendResult = pastResult;
    const pastData = pastResult?.data;

    if (!pastData?.success) {
      // Send failed — strip the false claim from the response so the character doesn't
      // reference a communication that doesn't exist in World Phone.
      console.warn('[WorldPhone] past-tense send failed — removing false claim:', pastData?.error);
      modifiedResponseText = responseText
        .replace(/I\s+(just\s+)?(texted|called|messaged|sent\s+\w+\s+a\s+(text|message|call))\s+[A-Z][a-z]+[^.!?]*[.!?]/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || '...';
    } else {
      // Succeeded — strip any fabricated summary of what the recipient supposedly replied
      const stripped = stripFabricatedReplyFromResponse(modifiedResponseText);
      if (stripped !== modifiedResponseText) {
        console.log('[WorldPhone] past-tense: stripped fabricated reply summary');
      }
      modifiedResponseText = stripped;
    }
  }

  // ── PATH 2: FUTURE-TENSE COMMITMENTS ─────────────────────────────────────
  // "I'll text her", "I'll call him", "I'll reach out" — character commits to communication.
  // Commitments are obligations — they must produce a real World Phone message or a
  // persistent record. They must never vanish silently.
  const commitment = detectCharacterCommunicationCommitment(modifiedResponseText, character.name);
  let commitmentSendResult = null;

  if (commitment) {
    let resolvedRecipient = commitment.recipient;

    // Resolve pronoun to actual name from recent conversation context
    if (!resolvedRecipient && commitment.pronounCommitment) {
      resolvedRecipient = resolveCommitmentPronoun(character, recentMessages);
      if (resolvedRecipient) {
        console.log(`[WorldPhone] commitment pronoun "${commitment.pronoun}" resolved to "${resolvedRecipient}" from context`);
      }
    }

    if (resolvedRecipient) {
      // Recipient known — attempt real World Phone send immediately
      console.log(`[WorldPhone] future commitment: "${character.name}" → "${resolvedRecipient}" — sending now`);

      const commitResult = await base44.functions.invoke('sendWorldPhoneMessage', {
        sender_character_id: characterId,
        recipient_identifier: resolvedRecipient,
        requested_message: null,
        user_instruction_context: commitment.topic || `${character.name} said they would contact ${resolvedRecipient}`,
        source: 'character_commitment',
        current_conversation_id: conversationId,
        owner_email: ownerEmail,
        generate_recipient_response: true,
      }).catch(err => ({ data: { success: false, error: err.message } }));

      commitmentSendResult = commitResult;
      const commitData = commitResult?.data;

      if (commitData?.success) {
        console.log(`[WorldPhone] commitment fulfilled: "${character.name}" → "${resolvedRecipient}" | msg_id=${commitData.message_id}`);
      } else {
        // Send failed — persist as blocked commitment so it doesn't vanish
        console.warn(`[WorldPhone] commitment send failed: ${commitData?.error}`);
        persistUnresolvedCommitment({
          characterId,
          character,
          ownerEmail,
          commitmentText: commitment.topic || modifiedResponseText.substring(0, 200),
          recipientName: resolvedRecipient,
          status: 'blocked',
          cancellationReason: `World Phone send failed: ${commitData?.error || 'unknown error'}`,
        });
      }
    } else {
      // Recipient could not be resolved from name or pronoun context.
      // Persist as an active unresolved commitment — it does not vanish.
      console.log(`[WorldPhone] commitment recipient unresolved — persisting for later follow-up`);
      persistUnresolvedCommitment({
        characterId,
        character,
        ownerEmail,
        commitmentText: commitment.topic || modifiedResponseText.substring(0, 200),
        recipientName: null,
        status: 'active',
        cancellationReason: 'Recipient could not be resolved from conversation context or relationship list',
      });
    }
  }

  return {
    responseText: modifiedResponseText,
    worldPhoneSendResult,
    commitmentSendResult,
  };
}