import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { filterDashes } from "@/lib/dashFilter";

// Human-readable phrasing of the character's authoritative presence state.
// Used only to describe where the character already is — never to write it.
const PRESENCE_PHRASES = {
  home: "at home",
  at_work: "at work",
  at_school: "at school",
  visiting: "visiting this place",
  traveling: "here",
  under_supervision: "here under supervision",
  sleeping: "here, asleep",
  napping: "here, napping",
  passed_out: "here, unconscious from exhaustion",
  temporary_housing: "in temporary housing",
  incarcerated: "in custody at this facility",
  house_arrest: "under house arrest at this residence",
  confined: "confined at this facility",
  hospitalized: "in the hospital",
  rabbit_hole: "at this place",
};

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

  // ── INCORRECT LOCATION CORRECTION ─────────────────────────────────────────
  // User-selected action: "Incorrect location"
  // The message stated or implied a physical location that contradicts the
  // character's authoritative location. The message is rewritten so its dialogue,
  // actions and implied surroundings naturally belong to where the character
  // actually was.
  //
  // LOCATION AUTHORITY: the existing authoritative fields on the character
  // (resolved_current_location_id / resolved_current_location_name /
  // resolved_presence_status / resolved_location_type). Only when the character
  // has moved since the message was written is the existing LocationHistory
  // record covering that moment used. No location record is created or changed.
  const handleIncorrectLocation = async (msg) => {
    if (!msg) return;
    setIsRegeneratingNarrative(true);
    try {
      const failedIndex = messages.findIndex(m => m.id === msg.id);
      const originalTime = msg.timestamp || msg.created_date || new Date().toISOString();
      const originalMs = new Date(originalTime).getTime();

      // ── Time at the ORIGINAL message (Eastern) ─────────────────────────────
      const originalET = new Date(new Date(originalTime).toLocaleString("en-US", { timeZone: "America/New_York" }));
      const hourET = originalET.getHours();
      const timeLabel = `${hourET % 12 || 12}:${String(originalET.getMinutes()).padStart(2, "0")} ${hourET >= 12 ? "PM" : "AM"}`;
      let daypart = "night";
      if (hourET < 4) daypart = "deep night";
      else if (hourET < 6) daypart = "pre-dawn";
      else if (hourET < 8) daypart = "early morning";
      else if (hourET < 12) daypart = "morning";
      else if (hourET < 17) daypart = "afternoon";
      else if (hourET < 20) daypart = "evening";

      // ── Authoritative location at that point in the conversation ───────────
      // Read from the existing location history — never a later location, so a
      // message written before the character moved is corrected against where
      // they actually were when it was written.
      let locId = character?.resolved_current_location_id || null;
      let locName = character?.resolved_current_location_name || null;
      let locationSource = "current_authoritative";
      let signalPresence = null;
      let rabbitHoleAtMoment = false;

      const timeOf = (v) => (v ? new Date(v).getTime() : null);

      // 1. The location signal the app recorded for this same turn. It holds the
      //    authoritative location at the moment the message was generated, and it
      //    is the only record that carries a rabbit hole location.
      if (conversationId) {
        const windowMs = 15 * 60 * 1000;
        const signals = await base44.entities.Message.filter({
          conversation_id: conversationId,
          sender_type: "character",
          "location_share.location_name": { $exists: true },
          timestamp: {
            $gte: new Date(originalMs - windowMs).toISOString(),
            $lte: new Date(originalMs + windowMs).toISOString(),
          },
        }, "timestamp", 5).catch(() => []);
        const nearest = (Array.isArray(signals) ? signals : [])
          .filter(m => m.location_share?.location_name)
          .sort((a, b) => Math.abs(timeOf(a.timestamp) - originalMs) - Math.abs(timeOf(b.timestamp) - originalMs))[0];
        if (nearest) {
          locId = nearest.location_share.location_id || locId;
          locName = nearest.location_share.location_name.trim() || locName;
          signalPresence = nearest.location_share.presence_status || null;
          rabbitHoleAtMoment = locId === "rabbit_hole";
          locationSource = "location_signal";
        }
      }

      // 2. Location history covering that moment — never a later location, so a
      //    message written before the character moved is corrected against where
      //    they actually were when it was written.
      if (locationSource === "current_authoritative") {
        const history = await base44.entities.LocationHistory
          .filter({ character_id: characterId }, "-arrival_time", 40)
          .catch(() => []);
        const ascending = (Array.isArray(history) ? history : [])
          .filter(h => h.arrival_time)
          .slice()
          .sort((a, b) => new Date(a.arrival_time).getTime() - new Date(b.arrival_time).getTime());

        // The record whose stay spans the message
        const covering = ascending.find(h => {
          const arrived = timeOf(h.arrival_time);
          const left = timeOf(h.departure_time);
          if (arrived === null) return false;
          return arrived <= originalMs && (left === null || left >= originalMs);
        });

        if (covering?.location_id) {
          locId = covering.location_id;
          locName = covering.location_name || locName;
          locationSource = "location_history";
        } else {
          // No covering record. If the character arrived somewhere AFTER this
          // message, the record immediately before that arrival is where they
          // were — use it rather than the later location.
          const firstAfter = ascending.findIndex(h => timeOf(h.arrival_time) > originalMs);
          const prior = firstAfter > 0 ? ascending[firstAfter - 1] : null;
          if (prior?.location_id && prior.location_id !== locId) {
            const priorLeft = timeOf(prior.departure_time);
            if (priorLeft === null || priorLeft >= originalMs) {
              locId = prior.location_id;
              locName = prior.location_name || locName;
              locationSource = "location_history";
            }
          }
        }
      }

      // Existing location record for real detail about the place (never written to)
      let locationDetail = "";
      if (locId) {
        const locRecords = await base44.entities.LocationReference.filter({ id: locId }).catch(() => []);
        const loc = Array.isArray(locRecords) ? locRecords[0] : null;
        if (loc) {
          const bits = [];
          if (loc.category) bits.push(`Type: ${String(loc.category).replace(/_/g, " ")}`);
          if (loc.venue_identity) bits.push(`Identity: ${loc.venue_identity}`);
          if (loc.description) bits.push(`What it is: ${loc.description.substring(0, 400)}`);
          locationDetail = bits.join("\n");
        }
      }

      // A rabbit hole is a real location. It never gets replaced by home, work,
      // or a scheduled destination.
      const isRabbitHole = rabbitHoleAtMoment || (locationSource === "current_authoritative" && (
        character?.resolved_presence_status === "rabbit_hole" ||
        character?.resolved_location_type === "rabbit_hole"
      ));
      // Presence wording follows the resolved moment — the current presence is
      // only valid when the resolved location is the current one.
      const presencePhrase = isRabbitHole
        ? `at a place outside the mapped world (an off-screen location)${signalPresence && PRESENCE_PHRASES[signalPresence] ? `, ${PRESENCE_PHRASES[signalPresence]}` : ""}`
        : (locationSource === "current_authoritative"
          ? (PRESENCE_PHRASES[character?.resolved_presence_status] || null)
          : (PRESENCE_PHRASES[signalPresence] || null));

      const locationBlock = locName
        ? `AUTHORITATIVE LOCATION AT THIS POINT IN THE CONVERSATION (this is where the character actually was):
Where: ${locName}${presencePhrase ? `\nPresence: ${presencePhrase}` : ""}${locationDetail ? `\n${locationDetail}` : ""}${isRabbitHole ? "\nThis is a custom off-screen place. It is their real location at this point in the conversation. Never replace it with home, work, or a scheduled destination." : ""}`
        : `AUTHORITATIVE LOCATION AT THIS POINT IN THE CONVERSATION: the character was somewhere other than the place their message implied.`;

      // ── Conversation immediately before this message ───────────────────────
      const contextStart = Math.max(0, failedIndex - 6);
      const contextLog = messages.slice(contextStart, failedIndex > 0 ? failedIndex : 0)
        .map(m => m.is_narrative
          ? `[NARRATIVE] ${m.content}`
          : `${m.sender_type === "user" ? "User" : (character?.name || "Character")}: ${m.content}`)
        .join("\n");

      // ── Character identity (unchanged by this correction) ──────────────────
      const identityLines = [];
      if (character?.name) identityLines.push(`Name: ${character.name}`);
      if (character?.personality_summary) identityLines.push(`Personality: ${character.personality_summary}`);
      if (character?.communication_style) identityLines.push(`Communication style: ${character.communication_style}`);
      if (character?.emotional_state) identityLines.push(`Emotional state: ${character.emotional_state}`);
      if (character?.personality_traits?.length) identityLines.push(`Traits: ${character.personality_traits.join(", ")}`);
      if (character?.current_activity) identityLines.push(`What they were in the middle of: ${character.current_activity}`);

      const rawCorrected = await base44.integrations.Core.InvokeLLM({
        prompt: `The character's message below was written as though they were somewhere they were not. Rewrite that same message so it is naturally grounded in where the character actually was at that moment in the conversation.

The correction is not a location announcement. The reader should simply experience the character as someone who was already there.

${locationBlock}

TIME AT THIS POINT IN THE CONVERSATION: ${timeLabel} Eastern (${daypart}). The rewrite must fit this time, not the current time.

CHARACTER (identity must remain intact):
${identityLines.join("\n")}

CONVERSATION IMMEDIATELY BEFORE THIS MESSAGE:
${contextLog || "(start of the conversation)"}

THE MESSAGE TO REWRITE:
"${msg.content}"

REQUIREMENTS:
- Keep the same intent, subject, reaction and emotional register. This is the same message, grounded in the right place.
- Every action, object, sound, interruption and surrounding the message touches must be something that exists or happens where the character actually was.
- Keep the character's voice, vocabulary, rhythm and mannerisms exactly as established.
- ${msg.is_narrative
        ? "This message is a narrative description, not spoken dialogue. Keep it third-person narration of what the character was doing, in the same length and register as the original."
        : "Match the original format: spoken dialogue stays spoken dialogue, action beats stay action beats. Keep roughly the same length."}
- Do not announce, name or explain the location. Do not mention a correction, a mistake, or anything technical.
- Do not invent travel, arrivals, departures, or a scene change. The character has been where they are.
- Remove anything that belongs to a different place (a desk at work, their own bed, their apartment, a workplace they left).
- Never use em dashes, en dashes, or spaced hyphens.

Write only the rewritten message body. No quotes, no labels, no preamble:`,
      });

      const correctedText = filterDashes((rawCorrected || "").trim());
      if (!correctedText) return;

      // Overwrite in place: original id, timestamp and timeline position preserved.
      // The old location reference no longer exists in thread context.
      await regenerateInPlace(msg, correctedText);
      console.log(`[INCORRECT_LOCATION_CORRECTION] msg=${msg.id} | location_source=${locationSource} | location=${locName || "unknown"}`);
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

  return { isRegeneratingNarrative, handleNonsenseNarrative, handleSleepViolationNarrative, handleRepeatedMessage, handleIncorrectLocation };
}