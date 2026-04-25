import { useState } from "react";
import { base44 } from "@/api/base44Client";

/**
 * useRightNow — manual trigger of the existing automatic narrative system.
 * Calls generateAutomaticNarrative with trigger='manual_right_now' and
 * saves the result as a narrative message in the conversation thread.
 */
export function useRightNow({ characterId, conversationId, character, setMessages }) {
  const [isGeneratingRightNow, setIsGeneratingRightNow] = useState(false);

  const handleRightNow = async () => {
    if (!character || !conversationId || isGeneratingRightNow) return;
    setIsGeneratingRightNow(true);
    try {
      const res = await base44.functions.invoke('generateAutomaticNarrative', {
        characterId,
        trigger: 'manual_right_now',
        forceGenerate: true,
      });
      if (res?.data?.success && res?.data?.narrativeText) {
        const narrativeMsg = await base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: res.data.narrativeText,
          is_narrative: true,
          is_read: true,
          timestamp: new Date().toISOString(),
        });
        setMessages(prev => prev.some(m => m.id === narrativeMsg.id) ? prev : [...prev, narrativeMsg]);
      }
    } catch (err) {
      console.error('[RightNow] Failed:', err.message);
    } finally {
      setIsGeneratingRightNow(false);
    }
  };

  return { handleRightNow, isGeneratingRightNow };
}