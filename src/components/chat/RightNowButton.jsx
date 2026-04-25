import { useState } from "react";
import { base44 } from "@/api/base44Client";

/**
 * RightNowButton — headless handler component.
 * Generates a state-accurate "Right Now" narrative using the existing
 * automatic narrative engine (generateAutomaticNarrative with trigger=manual_right_now).
 * Saves to CharacterAutomaticNarrative (same table), posts to chat, and stores to memory.
 *
 * Usage: mount once, call the exported hook or pass onGenerated callback.
 */
export function useRightNow({ character, characterId, conversationId, setMessages }) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleRightNow = async () => {
    if (!character || !conversationId || isGenerating) return;
    setIsGenerating(true);

    try {
      const res = await base44.functions.invoke('generateAutomaticNarrative', {
        characterId,
        trigger: 'manual_right_now',
        forceGenerate: true,
      });

      if (res?.data?.success && res?.data?.narrativeText) {
        // Post to conversation so it appears in chat immediately
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

        if (setMessages) {
          setMessages(prev =>
            prev.some(m => m.id === narrativeMsg.id) ? prev : [...prev, narrativeMsg]
          );
        }
      }
    } catch (err) {
      console.error('[RightNow] Failed:', err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return { handleRightNow, isGenerating };
}