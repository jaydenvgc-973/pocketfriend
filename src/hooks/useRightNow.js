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
    console.log('[RightNow] Clicked | character:', character?.name, 'conversationId:', conversationId, 'setMessages:', !!setMessages);
    
    if (!character) {
      console.warn('[RightNow] BLOCKED: No character');
      return;
    }
    if (!conversationId) {
      console.warn('[RightNow] BLOCKED: No conversationId');
      return;
    }
    if (!setMessages) {
      console.error('[RightNow] CRITICAL BLOCKER: setMessages not provided to hook!');
      return;
    }
    if (isGeneratingRightNow) {
      console.warn('[RightNow] BLOCKED: Already generating');
      return;
    }

    setIsGeneratingRightNow(true);
    try {
      console.log('[RightNow] → Calling generateAutomaticNarrative...');
      const res = await base44.functions.invoke('generateAutomaticNarrative', {
        characterId,
        trigger: 'manual_right_now',
        forceGenerate: true,
      });

      console.log('[RightNow] Response:', res?.data ? 'success' : 'null');
      const narrativeText = res?.data?.narrativeText;
      
      if (!narrativeText) {
        console.warn('[RightNow] No narrative text in response');
        return;
      }

      console.log('[RightNow] → Creating message in conversation...');
      const narrativeMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: character.name,
        content: narrativeText,
        is_narrative: true,
        is_read: true,
        timestamp: new Date().toISOString(),
      });

      console.log('[RightNow] ✓ Message created:', narrativeMsg.id);
      setMessages(prev => prev.some(m => m.id === narrativeMsg.id) ? prev : [...prev, narrativeMsg]);
      console.log('[RightNow] ✓ Added to local state, narrative displayed');
    } catch (err) {
      console.error('[RightNow] ERROR:', err.message);
    } finally {
      setIsGeneratingRightNow(false);
    }
  };

  return { handleRightNow, isGeneratingRightNow };
}