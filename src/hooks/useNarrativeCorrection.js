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
export function useNarrativeCorrection({ characterId, conversationId, messages, setMessages }) {
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

  return { isRegeneratingNarrative, handleNonsenseNarrative, handleSleepViolationNarrative };
}