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
      
      const recentContext = messages.slice(-10).filter(m => m.id !== msg.id).map(m => `${m.sender_type === 'user' ? 'User' : 'Character'}: ${m.content}`).join('\n');
      const correctedText = await base44.integrations.Core.InvokeLLM({
        prompt: `The previous narrative was illogical or poorly constructed. Regenerate with improved realism and flow. Keep the same general context but fix logic and narrative quality. Do not repeat the same issue.

Original narrative: "${msg.content}"

Recent conversation:
${recentContext}

Write a corrected narrative message (1-2 sentences, natural dialogue or scene description):`,
      });
      
      if (correctedText) {
        const newMsg = await base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: 'Narrator',
          content: correctedText,
          is_narrative: true,
          timestamp: new Date().toISOString(),
        });
        setMessages(prev => [...prev, newMsg]);
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
      
      const recentContext = messages.slice(-10).filter(m => m.id !== msg.id).map(m => `${m.sender_type === 'user' ? 'User' : 'Character'}: ${m.content}`).join('\n');
      const correctedText = await base44.integrations.Core.InvokeLLM({
        prompt: `The previous narrative violated the character sleep state. Regenerate using ONLY sleep-valid behavior: resting, bedroom environment, stillness, dreams, nighttime atmosphere. Absolutely NO going out, working, socializing, running errands, or any active daytime behavior.

Original narrative: "${msg.content}"

Recent conversation:
${recentContext}

Write a corrected sleep-only narrative message (1-2 sentences, describing rest/sleep activity):`,
      });
      
      if (correctedText) {
        const newMsg = await base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: 'Narrator',
          content: correctedText,
          is_narrative: true,
          timestamp: new Date().toISOString(),
        });
        setMessages(prev => [...prev, newMsg]);
      }
    } finally {
      setIsRegeneratingNarrative(false);
    }
  };

  return { isRegeneratingNarrative, handleNonsenseNarrative, handleSleepViolationNarrative };
}