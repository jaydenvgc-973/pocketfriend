/**
 * worldPhoneActionHandler.js
 *
 * Handles TWO World Phone character action paths:
 *
 * 1. Past-tense claims: "I texted her", "I called him", "I let them know"
 *    → Send the actual message immediately. If send fails, strip the false claim.
 *
 * 2. Future-tense commitments: "I'll text her", "I'll call him", "I'll reach out"
 *    → Also send the actual message immediately — the commitment IS the action.
 *    → Characters do not make plans they don't follow through on.
 *    → World Phone is canonical — if it says communication happened, it must exist there.
 *
 * Contract:
 * - Always sends a real World Phone message (creates DB record)
 * - Past-tense: if send fails, strips the false claim from responseText
 * - Future-tense: if send fails, no modification needed (it was a future statement)
 * - If send succeeds: strips any fabricated summary of what the recipient supposedly said back
 *
 * Returns: { responseText, worldPhoneSendResult, commitmentSendResult }
 */

import { detectCharacterWorldPhoneAction, detectCharacterCommunicationCommitment, stripFabricatedReplyFromResponse } from "@/lib/worldPhoneIntentDetector";
import { base44 } from "@/api/base44Client";

/**
 * Resolves a pronoun commitment to a real recipient name from recent conversation messages.
 */
function resolveCommitmentPronoun(pronoun, character, recentMessages) {
  if (!pronoun && !recentMessages?.length) return null;
  const knownNames = [
    ...(character?.fictional_relationships || []).map(r => r.person_name).filter(Boolean),
    ...(character?.family_members || []).map(f => f.name).filter(Boolean),
  ];
  if (knownNames.length === 0) return null;
  // Scan backwards through recent messages for a name mention
  for (let i = (recentMessages?.length || 0) - 1; i >= 0; i--) {
    const content = (recentMessages[i]?.content || '').toLowerCase();
    for (const name of knownNames) {
      if (name.length > 2 && content.includes(name.toLowerCase())) {
        return name;
      }
    }
  }
  return null;
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
      // Send failed — strip the false claim from the response
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
  // Commitments are obligations. Send the World Phone message immediately.
  // Characters do not make promises they don't keep.
  const commitment = detectCharacterCommunicationCommitment(modifiedResponseText, character.name);
  let commitmentSendResult = null;

  if (commitment) {
    let resolvedRecipient = commitment.recipient;

    // Resolve pronoun to actual name if possible
    if (!resolvedRecipient && commitment.pronounCommitment) {
      resolvedRecipient = resolveCommitmentPronoun(commitment.pronoun, character, recentMessages);
      if (resolvedRecipient) {
        console.log(`[WorldPhone] commitment pronoun "${commitment.pronoun}" resolved to "${resolvedRecipient}" from context`);
      } else {
        console.log(`[WorldPhone] commitment pronoun "${commitment.pronoun}" could not be resolved — skipping send`);
      }
    }

    if (resolvedRecipient) {
      console.log(`[WorldPhone] future commitment detected: "${character.name}" will contact "${resolvedRecipient}"`);

      const commitResult = await base44.functions.invoke('sendWorldPhoneMessage', {
        sender_character_id: characterId,
        recipient_identifier: resolvedRecipient,
        // Pass topic as context for message generation — backend LLM will generate natural content
        requested_message: null,
        user_instruction_context: commitment.topic || `${character.name} committed to contacting ${resolvedRecipient}`,
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
        console.warn(`[WorldPhone] commitment send failed: ${commitData?.error} — commitment was noted but not executed`);
      }
    }
  }

  return {
    responseText: modifiedResponseText,
    worldPhoneSendResult,
    commitmentSendResult,
  };
}