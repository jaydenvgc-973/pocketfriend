import { useState } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Handles narrative correction flows triggered from the delete modal:
 * - "This is nonsense" → delete + regenerate with better logic
 * - "Violates sleep state" → delete + regenerate with sleep-only behavior
 */
export function useNarrativeCorrection({ characterId, conversationId, messages, setMessages }) {
  const [isRegeneratingNarrative, setIsRegeneratingNarrative] = useState(false);

  const handleNonsenseNarrative = async (msg) => {
    if (!msg) return;
    setIsRegeneratingNarrative(true);
    try {
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      await base44.entities.Message.delete(msg.id).catch(() => {});
      const res = await base44.functions.invoke('generateNarrative', {
        characterId,
        conversationId,
        instruction: 'The previous narrative was illogical or poorly constructed. Regenerate with improved realism and flow. Keep the same general context but fix logic and narrative quality. Do not repeat the same issue.',
        recentMessages: messages.slice(-10).filter(m => m.id !== msg.id),
        correctionType: 'nonsense',
        originalContent: msg.content,
      });
      if (res?.data?.message) {
        setMessages(prev => prev.some(m => m.id === res.data.message.id) ? prev : [...prev, res.data.message]);
      }
    } finally {
      setIsRegeneratingNarrative(false);
    }
  };

  const handleSleepViolationNarrative = async (msg) => {
    if (!msg) return;
    setIsRegeneratingNarrative(true);
    try {
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      await base44.entities.Message.delete(msg.id).catch(() => {});
      const res = await base44.functions.invoke('generateNarrative', {
        characterId,
        conversationId,
        instruction: 'The previous narrative violated the character sleep state. Regenerate using ONLY sleep-valid behavior: resting, bedroom environment, stillness, dreams, nighttime atmosphere. Absolutely NO going out, working, socializing, running errands, or any active daytime behavior.',
        recentMessages: messages.slice(-10).filter(m => m.id !== msg.id),
        correctionType: 'sleep_violation',
        originalContent: msg.content,
      });
      if (res?.data?.message) {
        setMessages(prev => prev.some(m => m.id === res.data.message.id) ? prev : [...prev, res.data.message]);
      }
    } finally {
      setIsRegeneratingNarrative(false);
    }
  };

  return { isRegeneratingNarrative, handleNonsenseNarrative, handleSleepViolationNarrative };
}