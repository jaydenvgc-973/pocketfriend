/**
 * worldPhoneActionHandler.js
 *
 * Handles World Phone character communication paths — NOT appointment/travel/movement.
 *
 * This is a social behavior system. It answers:
 * "Did the character initiate real communication, and does it appear in World Phone?"
 *
 * Path 1 — Past-tense claims ("I texted her", "I called him")
 *   → Back-fill the real World Phone message.
 *   → If send fails: strip the false claim from responseText so the character
 *     doesn't reference communication that has no World Phone record.
 *
 * Path 2 — Proactive outreach ("I'll text her", "I'll call him")
 *   → Send the World Phone message immediately.
 *   → If recipient is resolved: send through World Phone.
 *   → If recipient is unresolved (pronoun could not be matched): preserve as
 *     unresolved proactive outreach in CharacterMemory (memory_type: 'fact',
 *     prefixed [proactive_communication_unresolved]). Do NOT create a meeting,
 *     travel commitment, appointment record, or use any destination field.
 *   → If World Phone send fails: preserve as failed proactive outreach in
 *     CharacterMemory (prefixed [proactive_communication_failed]).
 *   → If send succeeds: strip any fabricated summary of what the recipient
 *     supposedly said back (their real response comes from their own LLM call).
 *
 * This handler MUST NOT:
 * - create CharacterCommitment records
 * - store recipient names in destination fields
 * - interact with travel or movement logic
 * - use appointment or meeting commitment types
 *
 * Returns: { responseText, worldPhoneSendResult, proactiveSendResult }
 */

import { detectCharacterWorldPhoneAction, detectCharacterProactiveOutreach, stripFabricatedReplyFromResponse } from "@/lib/worldPhoneIntentDetector";
import { base44 } from "@/api/base44Client";
import { checkEcho } from "@/lib/worldPhoneEchoGuard";

/**
 * Resolves a pronoun to a real recipient name from recent conversation messages.
 * Scans backwards — most recent mention of a known contact wins.
 */
function resolvePronounRecipient(character, recentMessages) {
  const knownNames = [
    ...(character?.fictional_relationships || []).map(r => r.person_name).filter(Boolean),
    ...(character?.family_members || []).map(f => f.name).filter(Boolean),
  ];
  if (!knownNames.length || !recentMessages?.length) return null;
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

export async function handleCharacterWorldPhoneAction({
  responseText,
  character,
  characterId,
  conversationId,
  ownerEmail,
  recentMessages,
}) {
  if (!responseText) return { responseText, worldPhoneSendResult: null, proactiveSendResult: null };

  let modifiedResponseText = responseText;
  let worldPhoneSendResult = null;
  let proactiveSendResult = null;

  // ── PATH 1: PAST-TENSE CLAIMS ─────────────────────────────────────────────
  // Character claims communication already happened. Back-fill the World Phone record
  // or strip the false claim if the send fails.
  const pastTenseAction = detectCharacterWorldPhoneAction(responseText, character.name);

  if (pastTenseAction) {
    console.log('[WorldPhone] past-tense claim detected:', pastTenseAction);

    // PIPELINE AUTHORITY: past-tense claim has an extracted message only if the character's
    // own response text contained it. We must NEVER use `responseText` (Character A's full
    // reply to the user) as the outbound message to Character B — it would send Character A's
    // user-facing dialogue verbatim to Character B.
    // If pastTenseAction.message is null, pass null and let sendWorldPhoneMessage generate
    // a character-voiced message using user_instruction_context as topic context only.
    const candidateMessage = pastTenseAction.message || null;

    const result = await base44.functions.invoke('sendWorldPhoneMessage', {
      sender_character_id: characterId,
      recipient_identifier: pastTenseAction.recipient,
      requested_message: candidateMessage,
      // Never pass responseText as outbound content — it's Character A's reply to the user
      user_instruction_context: candidateMessage
        ? null
        : `${character.name} previously mentioned contacting ${pastTenseAction.recipient}`,
      source: 'character_action',
      current_conversation_id: conversationId,
      owner_email: ownerEmail,
    }).catch(err => ({ data: { success: false, error: err.message } }));

    worldPhoneSendResult = result;
    const data = result?.data;

    if (!data?.success) {
      // No World Phone record — remove the false claim so it doesn't stand unsupported
      console.warn('[WorldPhone] past-tense send failed — stripping false claim:', data?.error);
      modifiedResponseText = responseText
        .replace(/I\s+(just\s+)?(texted|called|messaged|sent\s+\w+\s+a\s+(text|message|call))\s+[A-Z][a-z]+[^.!?]*[.!?]/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || '...';
    } else {
      // Strip any fabricated summary of what the recipient supposedly replied —
      // their real response is generated by their own LLM pipeline
      const stripped = stripFabricatedReplyFromResponse(modifiedResponseText);
      if (stripped !== modifiedResponseText) {
        console.log('[WorldPhone] past-tense: stripped fabricated reply summary');
      }
      modifiedResponseText = stripped;
    }
  }

  // ── PATH 2: PROACTIVE OUTREACH ────────────────────────────────────────────
  // Character says they will contact someone. This is social/emotional behavior —
  // not an appointment, not travel, not movement. Send through World Phone now.
  const outreach = detectCharacterProactiveOutreach(modifiedResponseText, character.name);

  if (outreach) {
    let recipient = outreach.recipient;

    // Resolve pronoun to actual name if needed
    if (!recipient && outreach.hasPronoun) {
      recipient = resolvePronounRecipient(character, recentMessages);
      if (recipient) {
        console.log(`[WorldPhone] pronoun resolved to "${recipient}" from conversation context`);
      }
    }

    if (recipient) {
      console.log(`[WorldPhone] proactive outreach: "${character.name}" → "${recipient}"`);

      const result = await base44.functions.invoke('sendWorldPhoneMessage', {
        sender_character_id: characterId,
        recipient_identifier: recipient,
        requested_message: null,
        user_instruction_context: outreach.topic || `${character.name} is reaching out to ${recipient}`,
        source: 'character_action',
        current_conversation_id: conversationId,
        owner_email: ownerEmail,
        generate_recipient_response: true,
      }).catch(err => ({ data: { success: false, error: err.message } }));

      proactiveSendResult = result;
      const data = result?.data;

      if (data?.success) {
        console.log(`[WorldPhone] proactive send complete: "${character.name}" → "${recipient}" | msg=${data.message_id}`);
        // Strip fabricated reply summary if present
        modifiedResponseText = stripFabricatedReplyFromResponse(modifiedResponseText);
      } else {
        // Send failed — preserve as failed proactive outreach in character memory.
        // This is a World Phone / communication event. NOT a travel or appointment record.
        console.warn(`[WorldPhone] proactive send failed: ${data?.error}`);
        base44.entities.CharacterMemory.create({
          character_id: characterId,
          memory_type: 'fact',
          memory_text: `[proactive_communication_failed] ${character.name} attempted to contact "${recipient}" via World Phone but the send failed. Failure reason: ${data?.error || 'unknown'}. Topic: ${outreach.topic || 'unspecified'}. This was a communication event — no appointment or travel action is involved.`,
          memory_summary: `Failed proactive outreach to "${recipient}" — World Phone send error.`,
          importance_score: 4,
          confidence_score: 1,
          permanence: 'short_term',
        }).catch(err => console.warn('[WorldPhone] failed to persist failed proactive send record:', err.message));
      }
    } else {
      // Recipient could not be resolved from conversation context or known contacts.
      // Preserve as unresolved proactive outreach in character memory.
      // This is a World Phone / communication event. NOT a travel or appointment record.
      // Do NOT create meeting records, travel records, or use destination fields.
      console.log(`[WorldPhone] proactive outreach: recipient unresolved — preserving as unresolved communication record`);
      base44.entities.CharacterMemory.create({
        character_id: characterId,
        memory_type: 'fact',
        memory_text: `[proactive_communication_unresolved] ${character.name} intended to contact someone via World Phone but the recipient could not be resolved. Pronoun used: "${outreach.pronoun || 'unknown'}". Topic context: ${outreach.topic || 'unspecified'}. This was a World Phone / communication event — no appointment or travel action is involved.`,
        memory_summary: `Unresolved proactive outreach — recipient pronoun could not be matched to a known contact.`,
        importance_score: 3,
        confidence_score: 0.6,
        permanence: 'short_term',
      }).catch(err => console.warn('[WorldPhone] failed to persist unresolved proactive outreach record:', err.message));
    }
  }

  return {
    responseText: modifiedResponseText,
    worldPhoneSendResult,
    proactiveSendResult,
  };
}