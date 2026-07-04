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
import { resolveRelationshipRoleRecipient } from "@/lib/relationshipRoleResolver";

/**
 * stripWorldPhoneStateConfirmationClaims
 *
 * Strips backend-state confirmation claims from character responses.
 * These are claims that assert delivery, visibility, or verification of a World Phone
 * message — none of which the character can know without a backend lookup.
 *
 * Applies on BOTH the failure path (send failed, message doesn't exist) AND
 * the success path (message exists, but character still cannot claim to visually
 * verify it on the recipient's device/World Contacts).
 *
 * This covers the live failure class seen in screenshots:
 *   "It definitely sent."
 *   "I'm looking at it now."
 *   "I'm staring right at the message I just sent."
 *   "The message is right here on my phone."
 *   "It went through."
 *   "It should be there."
 *   "I can see it."
 */
function stripWorldPhoneStateConfirmationClaims(text) {
  if (!text) return text;

  // Patterns that assert delivery confirmation, visual verification, or "it's definitely there"
  const confirmationPatterns = [
    // "it definitely sent" / "that definitely sent" / "it definitely went through"
    /\b(?:it|that|the\s+message)\s+definitely\s+(?:sent|went\s+through|delivered|arrived|came\s+through)\b[^.!?]*[.!?]?/gi,
    // "I'm looking at it now" / "I'm staring at it"
    /\bI'?m\s+(?:looking|staring|looking\s+right)\s+at\s+it\s+(?:now|right\s+now)\b[^.!?]*[.!?]?/gi,
    // "the message is right here on my phone"
    /\bthe\s+message\s+is\s+(?:right\s+)?here\s+on\s+my\s+(?:phone|screen|contacts)\b[^.!?]*[.!?]?/gi,
    // "I can see it" / "I see it" — in context of sent messages
    /\bI\s+(?:can\s+)?see\s+(?:it|the\s+message|my\s+message)\b[^.!?]*[.!?]?/gi,
    // "it went through" / "it came through"
    /\b(?:it|that|the\s+message)\s+(?:went|came)\s+through\b[^.!?]*[.!?]?/gi,
    // "it should be there" / "it should have arrived"
    /\b(?:it|that|the\s+message)\s+should\s+(?:be\s+there|have\s+(?:arrived|sent|gone\s+through|delivered))\b[^.!?]*[.!?]?/gi,
    // "it delivered" / "it's delivered"
    /\b(?:it|that|the\s+message)\s+(?:is\s+)?delivered\b[^.!?]*[.!?]?/gi,
    // "I already sent it — it's there" / "I already sent it and it's there"
    /\bI\s+already\s+sent\s+it[^.!?]*(it'?s?\s+there|it\s+(?:went|came)\s+through|you\s+should\s+have\s+it)[^.!?]*[.!?]?/gi,
    // "I checked and it sent"
    /\bI\s+checked\s+and\s+it\s+(?:sent|went\s+through|delivered)\b[^.!?]*[.!?]?/gi,
    // "the phone is glitching" style deflections that still assert the message is there
    /\bif\s+(?:the\s+)?(?:phone|app|system)\s+(?:is\s+)?(?:glitching|bugging|acting\s+up)[^.!?]*(?:it\s+(?:did|definitely|still)\s+(?:go|went|send|sent|came)\s+through)[^.!?]*[.!?]?/gi,
  ];

  let result = text;
  for (const pattern of confirmationPatterns) {
    result = result.replace(pattern, '');
  }

  // Clean up double spaces and trim
  return result.replace(/\s{2,}/g, ' ').trim() || text;
}

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

/**
 * stripFabricatedIncomingReplyClaimsIfUnverified
 *
 * Strips claims about what another character "said" or "replied" when that claim
 * cannot be verified against an actual World Phone incoming message.
 *
 * Pattern: "She said she's fine", "He replied that he can come", "They texted back saying..."
 * These are fabricated unless a real incoming World Phone message exists in the thread.
 *
 * This function is CONSERVATIVE — it only strips patterns that are clearly
 * reporting speech from a third party (not self-speech or general narrative).
 *
 * Called BEFORE saving the response — not as a post-hoc strip.
 */
function stripFabricatedIncomingReplyClaims(responseText) {
  if (!responseText) return responseText;

  // Patterns: third-person attribution of speech/replies
  const fabricatedReplyPatterns = [
    // "She/he/they said [X]" — third-party speech attribution
    /\b(?:she|he|they)\s+said\s+(?:that\s+)?["']?[^.!?]{5,}["']?[.!]/gi,
    // "She/he/they replied [X]" / "She/he/they texted back [X]"
    /\b(?:she|he|they)\s+(?:replied|texted\s+back|messaged\s+back|wrote\s+back|responded)\s+(?:that\s+|saying\s+)?["']?[^.!?]{5,}["']?[.!]/gi,
    // "[Name] said/replied that..." — named third party
    /\b([A-Z][a-zA-Z]+)\s+(?:said|replied|texted\s+back|messaged\s+back|wrote\s+back|responded)\s+(?:that\s+|saying\s+)?["']?[^.!?]{5,}["']?[.!]/g,
    // "and she/he/they said..." — conjunction form
    /\band\s+(?:she|he|they)\s+said\s+(?:that\s+)?["']?[^.!?]{5,}["']?[.!]/gi,
  ];

  let result = responseText;
  for (const pattern of fabricatedReplyPatterns) {
    result = result.replace(pattern, '');
  }

  return result.replace(/\s{2,}/g, ' ').trim() || responseText;
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

    // ARCHITECTURAL RULE: The World Phone send must complete BEFORE narrative is confirmed.
    // If the send fails at any step, the character's claim must be removed from the response.
    // Regex stripping is a defensive fallback only — the primary enforcement is this result check.
    const candidateMessage = pastTenseAction.message || null;

    // ── RELATIONSHIP-ROLE RESOLUTION for past-tense claims ("I texted my dad") ──
    // Resolve the role against the acting character's authoritative family_members /
    // fictional_relationships. Conversation history is never consulted. If no
    // authoritative record matches, fail cleanly — no send, no guess — and strip the
    // false claim so the character cannot assert a communication that never occurred.
    let pastTenseRecipient = pastTenseAction.recipient;
    let roleUnresolved = false;
    if (!pastTenseRecipient && pastTenseAction.hasRelationshipRole) {
      const resolved = resolveRelationshipRoleRecipient(character, pastTenseAction.role);
      if (resolved) {
        pastTenseRecipient = resolved.characterId;
        console.log(`[WorldPhone] past-tense role "${pastTenseAction.role}" resolved to ${resolved.characterId} from authoritative data`);
      } else {
        roleUnresolved = true;
        console.warn(`[WorldPhone] past-tense role "${pastTenseAction.role}" unresolved — failing cleanly, no send`);
        const roleEscaped = pastTenseAction.role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pastVerb = '(?:texted|messaged|called|contacted|hit\\s+up|reached\\s+out\\s+to|let|told|asked|informed|notified|warned|updated|sent|shot|dropped|gave|checked\\s+(?:on|in\\s+with)|got\\s+in\\s+touch\\s+with)';
        modifiedResponseText = (modifiedResponseText
          .replace(new RegExp(`[^.!?]*\\bI\\s+(?:just\\s+|already\\s+)?${pastVerb}\\s+(?:a\\s+)?(?:text|message|dm|call)?\\s*(?:my|your|our)?\\s*${roleEscaped}[^.!?]*[.!?]`, 'gi'), ' ')
          .replace(new RegExp(`[^.!?]*\\b(?:already|just)\\s+${pastVerb}\\s+(?:my|your|our)?\\s*${roleEscaped}[^.!?]*[.!?]`, 'gi'), ' ')
          .replace(/\s{2,}/g, ' ').trim()) || '...';
      }
    }

    const result = roleUnresolved
      ? { data: { success: false, error: 'relationship_role_unresolvable', role: pastTenseAction.role } }
      : await base44.functions.invoke('sendWorldPhoneMessage', {
          sender_character_id: characterId,
          recipient_identifier: pastTenseRecipient,
          requested_message: candidateMessage,
          user_instruction_context: candidateMessage
            ? null
            : `${character.name} previously mentioned contacting ${pastTenseAction.recipient || `their ${pastTenseAction.role}`}`,
          source: 'character_action',
          current_conversation_id: conversationId,
          owner_email: ownerEmail,
        }).catch(err => ({ data: { success: false, error: err.message } }));

    worldPhoneSendResult = result;
    const data = result?.data;

    if (!data?.success) {
      // ARCHITECTURAL ENFORCEMENT: No World Phone record was created.
      // The character MUST NOT claim the communication happened.
      // Remove all communication-claim language from the response.
      console.warn('[WorldPhone] past-tense send FAILED — removing all communication claims from narrative. Error:', data?.error);

      // Step 1: Targeted removal of the specific claim sentence containing the recipient name
      let cleaned = modifiedResponseText;
      if (pastTenseAction.recipient) {
        // Remove any sentence that references the recipient and a communication verb
        const escapedName = pastTenseAction.recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleaned = cleaned
          .replace(new RegExp(`[^.!?]*\\b(texted|called|messaged|contacted|reached out to|sent\\s+\\w+\\s+a\\s+(text|message)|let\\s+\\w+\\s+know|told)\\b[^.!?]*${escapedName}[^.!?]*[.!?]`, 'gi'), ' ')
          .replace(new RegExp(`[^.!?]*${escapedName}[^.!?]*(texted|called|messaged|contacted|reached out)[^.!?]*[.!?]`, 'gi'), ' ');
      }
      // Step 2: Broad fallback — remove any remaining first-person communication claim
      cleaned = cleaned
        .replace(/I\s+(just\s+)?(texted|called|messaged|sent\s+\w+\s+a\s+(text|message|call)|reached\s+out\s+to|let\s+\w+\s+know|told\s+\w+)[^.!?]*[.!?]/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      // Step 3: Strip delivery-state confirmation claims — these are backend state claims
      // that must be stripped when the send failed. These are the class of failures
      // seen in live behavior: "it definitely sent", "I can see it", "I'm looking at it".
      cleaned = stripWorldPhoneStateConfirmationClaims(cleaned);

      modifiedResponseText = cleaned || '...';
    } else {
      // Send succeeded — a real Message record exists.
      // Now safe to allow the narrative claim, but strip any fabricated reply summary.
      // Character B's real response is in the World Phone record — not invented here.
      // Also strip delivery-state confirmation claims — even on success, the character
      // cannot claim to visually verify the message on the recipient's side.
      let stripped = stripFabricatedReplyFromResponse(modifiedResponseText);
      stripped = stripWorldPhoneStateConfirmationClaims(stripped);
      if (stripped !== modifiedResponseText) {
        console.log('[WorldPhone] past-tense: stripped fabricated reply summary and/or delivery-state claims');
      }
      modifiedResponseText = stripped;
      console.log(`[WorldPhone] past-tense send CONFIRMED | msg=${data.message_id} | conv=${data.conversation_id}`);
    }
  }

  // ── PATH 2: PROACTIVE OUTREACH ────────────────────────────────────────────
  // Character says they will contact someone. This is social/emotional behavior —
  // not an appointment, not travel, not movement. Send through World Phone now.
  const outreach = detectCharacterProactiveOutreach(modifiedResponseText, character.name);

  if (outreach) {
    let recipient = outreach.recipient;

    // ── RELATIONSHIP-ROLE RESOLUTION ("I'll text my/your dad") ──────────────────
    // Resolve from the acting character's authoritative family_members /
    // fictional_relationships BEFORE any conversation-history pronoun scan.
    if (!recipient && outreach.hasRelationshipRole) {
      const resolved = resolveRelationshipRoleRecipient(character, outreach.role);
      if (resolved) {
        recipient = resolved.characterId;
        console.log(`[WorldPhone] relationship role "${outreach.role}" resolved to ${resolved.characterId} from authoritative data`);
      }
    }

    // Resolve pronoun to actual name if needed (non-role pronouns only)
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
        console.log(`[WorldPhone] proactive send CONFIRMED: "${character.name}" → "${recipient}" | msg=${data.message_id} | conv=${data.conversation_id}`);
        // Real record exists. Strip fabricated reply summary AND delivery-state confirmation claims.
        // Even on success, the character cannot claim to visually verify delivery on recipient's end.
        modifiedResponseText = stripFabricatedReplyFromResponse(modifiedResponseText);
        modifiedResponseText = stripWorldPhoneStateConfirmationClaims(modifiedResponseText);
      } else {
        // ARCHITECTURAL ENFORCEMENT: Send failed — no World Phone record exists.
        // The proactive outreach claim ("I'll text her") may stay since it's future-tense intent,
        // but we must NOT allow any confirmation language to remain.
        console.warn(`[WorldPhone] proactive send FAILED — message NOT delivered. Error: ${data?.error}`);
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

  // ── PATH 3: STANDALONE FABRICATED REPLY GUARD ──────────────────────────────
  // Even when no send was detected, the character may have fabricated what another
  // character said back without a real World Phone incoming message existing.
  // This guard ONLY fires when no World Phone send happened this turn —
  // if a send succeeded, the recipient response is real and must not be stripped.
  //
  // Example failure: user asks "What did Maya say?" and character replies
  // "She said she's coming over tonight" — fabricated without a real WP message.
  //
  // CONSERVATIVE: only strips patterns that are unambiguously fabricated third-party
  // speech attribution. Never strips self-reporting or general narrative.
  if (!pastTenseAction && !outreach) {
    // No World Phone activity detected this turn — check for standalone fabricated replies.
    // Only apply the strip when the response contains third-party speech attribution patterns.
    const hasFabricatedReplyPattern = /\b(?:she|he|they)\s+(?:said|replied|texted\s+back|messaged\s+back|wrote\s+back|responded)\b/i.test(modifiedResponseText) ||
      /\b[A-Z][a-zA-Z]+\s+(?:replied|texted\s+back|messaged\s+back|wrote\s+back)\b/.test(modifiedResponseText);

    if (hasFabricatedReplyPattern) {
      const stripped = stripFabricatedIncomingReplyClaims(modifiedResponseText);
      if (stripped !== modifiedResponseText) {
        console.log('[WorldPhone] PATH 3: Stripped standalone fabricated incoming reply claim from response');
        modifiedResponseText = stripped;
      }
    }
  }

  return {
    responseText: modifiedResponseText,
    worldPhoneSendResult,
    proactiveSendResult,
  };
}