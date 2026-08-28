import { useState } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Handles narrative correction flows triggered from the delete modal.
 *
 * TIMELINE IMMUTABILITY RULE:
 * Corrections NEVER delete + recreate messages (which would break timeline order).
 * Instead, they overwrite the content of the EXISTING message, preserving:
 *   - original message ID
 *   - original timestamp
 *   - original timeline position
 */
export function useNarrativeCorrection({ characterId, conversationId, messages, setMessages, character }) {
  const [isRegeneratingNarrative, setIsRegeneratingNarrative] = useState(false);

  // Shared helper: regenerate content and overwrite in-place (never delete/recreate)
  const regenerateInPlace = async (msg, correctedText) => {
    if (!correctedText?.trim()) return;
    // 1. Update local state immediately (optimistic) — position and ID preserved
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: correctedText } : m));
    // 2. Persist to DB — overwrite content only, timestamp/ID untouched
    await base44.entities.Message.update(msg.id, { content: correctedText }).catch(() => {});
  };

  const handleNonsenseNarrative = async (msg) => {
    if (!msg) return;
    setIsRegeneratingNarrative(true);
    try {
      const recentContext = messages
        .slice(-10)
        .filter(m => m.id !== msg.id)
        .map(m => `${m.sender_type === 'user' ? 'User' : 'Character'}: ${m.content}`)
        .join('\n');

      // Infer original timestamp context so regeneration matches the time the message was created
      const originalTime = msg.timestamp || msg.created_date || new Date().toISOString();
      const originalDate = new Date(originalTime);
      const timeLabel = originalDate.toLocaleString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
      });

      const correctedText = await base44.integrations.Core.InvokeLLM({
        prompt: `The previous narrative was illogical or poorly constructed. Regenerate with improved realism and flow.
Keep the same general context but fix logic and narrative quality. Do not repeat the same issue.

IMPORTANT: This message was originally written at ${timeLabel}. The corrected version must reflect that same time — not the current time.

Original narrative: "${msg.content}"

Recent conversation:
${recentContext}

Write a corrected narrative message (1-2 sentences, natural and grounded):`,
      });

      await regenerateInPlace(msg, correctedText);
    } finally {
      setIsRegeneratingNarrative(false);
    }
  };

  const handleSleepViolationNarrative = async (msg) => {
    if (!msg) return;
    setIsRegeneratingNarrative(true);
    try {
      const recentContext = messages
        .slice(-10)
        .filter(m => m.id !== msg.id)
        .map(m => `${m.sender_type === 'user' ? 'User' : 'Character'}: ${m.content}`)
        .join('\n');

      // Use the original message's timestamp to reconstruct the time context at that moment
      const originalTime = msg.timestamp || msg.created_date || new Date().toISOString();
      const originalDate = new Date(originalTime);
      const originalET = new Date(originalDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hourET = originalET.getHours();
      const minET = originalET.getMinutes();
      const timeLabel = `${hourET % 12 || 12}:${String(minET).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;

      // Derive daypart at the ORIGINAL message time (not now)
      let daypartLabel = 'night';
      if (hourET < 4) daypartLabel = 'deep night (past midnight)';
      else if (hourET < 6) daypartLabel = 'pre-dawn';
      else if (hourET < 8) daypartLabel = 'early morning';
      else if (hourET < 12) daypartLabel = 'morning';
      else if (hourET < 17) daypartLabel = 'afternoon';
      else if (hourET < 20) daypartLabel = 'evening';
      else daypartLabel = 'night';

      const correctedText = await base44.integrations.Core.InvokeLLM({
        prompt: `The previous narrative violated the character's sleep state. Regenerate using ONLY sleep-valid behavior.

ORIGINAL MESSAGE TIME: ${timeLabel} (${daypartLabel})
The corrected narrative must match this exact time of day — NOT the current time.

ALLOWED during sleep:
- Describing the room, light quality, ambient sound, temperature
- Stillness, breathing, rest, minimal unconscious movement
- Dreams or half-conscious impressions (brief, max 1 clause)
- Environmental atmosphere consistent with ${daypartLabel}

STRICTLY FORBIDDEN:
- Eating, drinking, making coffee or tea
- Moving between rooms or locations
- Interacting with objects (phone, window, etc.)
- Any conversation or social interaction
- Any daytime "awake" behavior whatsoever

Original (invalid) narrative: "${msg.content}"

Recent conversation context:
${recentContext}

Write a corrected sleep-only narrative (1-2 sentences). The environment must reflect ${daypartLabel} at ${timeLabel}:`,
      });

      await regenerateInPlace(msg, correctedText);
    } finally {
      setIsRegeneratingNarrative(false);
    }
  };

  // ── REPEATED MESSAGE CORRECTION ───────────────────────────────────────────
  // User-selected action: "This is a repeated message"
  // An already-completed character response was reused as the active response to a
  // later, different user message. This is a failed response + continuity failure.
  //
  // ORDER: Regenerate FIRST (repair the conversation immediately), then investigate
  // to establish the actual execution boundary where the completed response became
  // active again. The investigation must NOT delay the regeneration.
  const handleRepeatedMessage = async (msg) => {
    if (!msg) return;
    setIsRegeneratingNarrative(true);
    try {
      const failedIndex = messages.findIndex(m => m.id === msg.id);
      const failedContent = (msg.content || '').trim();

      // Identify the user message this failed response was supposed to answer.
      const sourceMsgId = msg.source_message_id || msg.reply_to_message_id;
      const targetUserMsg = sourceMsgId ? messages.find(m => m.id === sourceMsgId) : null;
      const precedingUserMsg = targetUserMsg ||
        [...messages.slice(0, failedIndex > 0 ? failedIndex : 0)]
          .reverse().find(m => m.sender_type === 'user' && !m.is_narrative);

      // ── PHASE 1: REGENERATE (immediately repair) ───────────────────────────
      // Build context from the last four message bubbles at the failed response's
      // position, including any narrative that falls within those positions.
      const contextStart = Math.max(0, failedIndex - 4);
      const lastFour = messages.slice(contextStart, failedIndex > 0 ? failedIndex : 0);
      const contextLog = lastFour.map(m => {
        if (m.is_narrative) return `[NARRATIVE] ${m.content}`;
        return `${m.sender_type === 'user' ? 'User' : (character?.name || 'Character')}: ${m.content}`;
      }).join('\n');

      const userMessageContent = precedingUserMsg?.content || '(no preceding user message found)';
      const originalTime = msg.timestamp || msg.created_date || new Date().toISOString();
      const timeLabel = new Date(originalTime).toLocaleString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
      });

      const identityLines = [];
      if (character?.name) identityLines.push(`Name: ${character.name}`);
      if (character?.personality_summary) identityLines.push(`Personality: ${character.personality_summary}`);
      if (character?.communication_style) identityLines.push(`Communication style: ${character.communication_style}`);
      if (character?.emotional_state) identityLines.push(`Current emotional state: ${character.emotional_state}`);
      if (character?.personality_traits?.length) identityLines.push(`Traits: ${character.personality_traits.join(', ')}`);
      if (character?.backstory) identityLines.push(`Backstory: ${character.backstory.substring(0, 300)}`);
      const characterIdentity = identityLines.join('\n');

      const correctedText = await base44.integrations.Core.InvokeLLM({
        prompt: `The previous character response was a FAILED response — an already-completed character response from an earlier turn was incorrectly reused as the active response to a different user message. This is a system-level recycling failure, not intentional character repetition.

Regenerate the response that belongs at this exact conversational position.

REQUIREMENTS:
- The response must DIRECTLY respond to the user's preceding message.
- The response must maintain continuity with what was being discussed immediately before.
- Do NOT repeat or paraphrase the failed response content.
- Generate a completely new response that fits this exact moment.
- Stay in character — use the character's established voice, vocabulary, speech patterns, mannerisms, personality, and emotional behavior.

CHARACTER IDENTITY (must remain intact — this is a correction of one failed response, not a character reset):
${characterIdentity}

CONVERSATION CONTEXT (the last few messages at this point in the conversation, including any narrative):
${contextLog}

THE USER MESSAGE THIS RESPONSE MUST ANSWER:
"${userMessageContent}"

This message was originally at ${timeLabel} Eastern. The regenerated response must reflect that time.

Write ONLY the character's spoken dialogue (1-3 sentences, in the character's own voice and words). Do NOT include narrative actions, physical descriptions, or stage directions — only what the character says out loud:`,
      });

      await regenerateInPlace(msg, correctedText);

      // ── PHASE 2: INVESTIGATE (establish the actual cause) ──────────────────
      // Fetch the actual DB records to examine all evidence fields — the local
      // messages array may not carry every field needed for boundary tracing.
      let failedDbRecord = null;
      try {
        failedDbRecord = await base44.entities.Message.get(msg.id);
      } catch { /* record may be stale or deleted */ }

      // Search for an earlier completed character message with the same content
      const earlierMatch = messages.find(m =>
        m.id !== msg.id && m.sender_type === 'character' && !m.is_narrative &&
        (m.content || '').trim() === failedContent &&
        new Date(m.timestamp || m.created_date) < new Date(msg.timestamp || msg.created_date)
      );

      let earlierDbRecord = null;
      if (earlierMatch?.id) {
        try { earlierDbRecord = await base44.entities.Message.get(earlierMatch.id); } catch {}
      }

      const earlierSourceMsgId = earlierDbRecord?.source_message_id || earlierDbRecord?.reply_to_message_id || earlierMatch?.source_message_id || earlierMatch?.reply_to_message_id;
      const earlierOriginalUserMsg = earlierSourceMsgId ? messages.find(m => m.id === earlierSourceMsgId) : null;

      // ── EVIDENCE-BASED BOUNDARY TRACING ────────────────────────────────────
      // Examine actual field values to determine which execution boundary allowed
      // the completed response to become active. Do NOT classify by likelihood —
      // only state what the evidence actually establishes.
      const evidence = {
        failedMessageId: msg.id,
        failedContent: failedContent.substring(0, 200),
        failedTimestamp: msg.timestamp || msg.created_date,
        failedFields: {
          source_message_id: failedDbRecord?.source_message_id ?? msg.source_message_id ?? null,
          reply_to_message_id: failedDbRecord?.reply_to_message_id ?? msg.reply_to_message_id ?? null,
          generation_lock_id: failedDbRecord?.generation_lock_id ?? msg.generation_lock_id ?? null,
          recovery_signal: failedDbRecord?.recovery_signal ?? msg.recovery_signal ?? null,
          idempotency_key: failedDbRecord?.idempotency_key ?? msg.idempotency_key ?? null,
          channel: failedDbRecord?.channel ?? msg.channel ?? null,
        },
        precedingUserMessageId: precedingUserMsg?.id || null,
        precedingUserContent: (precedingUserMsg?.content || '').substring(0, 200),
        sourceMessageMatchesPreceding: !!(sourceMsgId && precedingUserMsg && sourceMsgId === precedingUserMsg.id),
        earlierMatch: earlierMatch ? {
          messageId: earlierMatch.id,
          timestamp: earlierMatch.timestamp || earlierMatch.created_date,
          content: (earlierMatch.content || '').substring(0, 200),
          fields: {
            source_message_id: earlierDbRecord?.source_message_id ?? earlierMatch.source_message_id ?? null,
            reply_to_message_id: earlierDbRecord?.reply_to_message_id ?? earlierMatch.reply_to_message_id ?? null,
            generation_lock_id: earlierDbRecord?.generation_lock_id ?? earlierMatch.generation_lock_id ?? null,
            recovery_signal: earlierDbRecord?.recovery_signal ?? earlierMatch.recovery_signal ?? null,
          },
          originallyAnsweredUserId: earlierSourceMsgId || null,
          originallyAnsweredUserContent: (earlierOriginalUserMsg?.content || '').substring(0, 200),
        } : null,
        contentMatchType: earlierMatch ? 'exact' : 'no_earlier_match_found',
      };

      // ── EXECUTION BOUNDARY ANALYSIS ────────────────────────────────────────
      // Trace the earliest proven boundary where the completed response became
      // active. Each boundary is only marked when the evidence actually supports it.
      const boundaryAnalysis = [];

      if (evidence.failedFields.recovery_signal === true) {
        boundaryAnalysis.push({
          boundary: 'recovery_fallback_path',
          evidence: 'failed message has recovery_signal=true',
          meaning: 'The recovery/fallback pipeline replaced the correct response with completed response content. The LLM may have produced correct output, but the recovery system substituted old content.',
        });
      }
      if (evidence.failedFields.generation_lock_id) {
        boundaryAnalysis.push({
          boundary: 'generation_lock_path',
          evidence: `failed message has generation_lock_id=${evidence.failedFields.generation_lock_id}`,
          meaning: 'The generation lock pipeline was involved in producing or committing this response. The lock may have served stale content from a prior generation cycle.',
        });
      }
      if (earlierMatch && !evidence.sourceMessageMatchesPreceding && sourceMsgId && earlierSourceMsgId && sourceMsgId !== earlierSourceMsgId) {
        boundaryAnalysis.push({
          boundary: 'retrieval_reuse_path',
          evidence: `failed response source_message_id (${sourceMsgId}) differs from earlier match source_message_id (${earlierSourceMsgId}), but content is identical`,
          meaning: 'The completed response from an earlier user turn was supplied as active response material before or during generation. The response was not generated fresh for the current user message.',
        });
      }
      if (earlierMatch && evidence.sourceMessageMatchesPreceding && sourceMsgId === earlierSourceMsgId) {
        boundaryAnalysis.push({
          boundary: 'same_source_message_reuse',
          evidence: `failed response and earlier match both reference the same source_message_id (${sourceMsgId})`,
          meaning: 'The same user message triggered both responses. The earlier completed response may not have been cleared, and the generation produced or committed identical content.',
        });
      }
      if (!earlierMatch && !evidence.failedFields.recovery_signal && !evidence.failedFields.generation_lock_id) {
        boundaryAnalysis.push({
          boundary: 'generation_output_boundary',
          evidence: 'no earlier exact match found, no recovery_signal, no generation_lock_id',
          meaning: 'The raw LLM output may have reproduced prior content from conversation history context. The duplication first appears at the generation/output boundary — the model repeated itself from context.',
        });
      }

      const investigation = { ...evidence, boundaryAnalysis, timestamp: new Date().toISOString() };
      console.warn('[REPEATED_MESSAGE_INVESTIGATION]', JSON.stringify(investigation, null, 2));
    } finally {
      setIsRegeneratingNarrative(false);
    }
  };

  return { isRegeneratingNarrative, handleNonsenseNarrative, handleSleepViolationNarrative, handleRepeatedMessage };
}