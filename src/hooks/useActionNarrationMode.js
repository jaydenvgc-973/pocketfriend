/**
 * useActionNarrationMode
 *
 * Minimal hook for Character-Led Progressive Action Narration.
 * Manages step counter and last narration context.
 * Calls InvokeLLM directly via base44 integrations — no new backend function.
 * Posts result as a narrative message to the conversation.
 *
 * State:
 *   actionNarrationStep   — which step we're on (0 = first)
 *   lastActionNarrationContext — text from the previous step for continuation
 */

import { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { buildActionNarrationPrompt } from '@/lib/actionNarrationMode';

export function useActionNarrationMode({ character, characterId, conversationId, messages, setMessages, userSettings }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const stepRef = useRef(0);
  const lastContextRef = useRef(null);

  // Reset when character changes
  const lastCharIdRef = useRef(null);
  if (lastCharIdRef.current !== characterId) {
    lastCharIdRef.current = characterId;
    stepRef.current = 0;
    lastContextRef.current = null;
  }

  const triggerActionNarration = async () => {
    if (!character || !conversationId || isGenerating) return;
    setIsGenerating(true);

    try {
      const prompt = buildActionNarrationPrompt(
        character,
        messages,
        stepRef.current,
        lastContextRef.current,
        userSettings
      );

      const narrativeText = await base44.integrations.Core.InvokeLLM({ prompt });

      if (!narrativeText?.trim()) return;

      const cleaned = narrativeText.trim();

      // Post to conversation as a narrative message
      const msg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: character.name,
        content: cleaned,
        is_narrative: true,
        is_read: true,
        timestamp: new Date().toISOString(),
      });

      if (msg?.id && setMessages) {
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      }

      // Advance state for next continuation
      stepRef.current += 1;
      lastContextRef.current = cleaned;

    } catch (err) {
      console.error('[ActionNarration] Failed:', err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Expose reset so parent can clear on convo change if needed
  const resetNarration = () => {
    stepRef.current = 0;
    lastContextRef.current = null;
  };

  return { triggerActionNarration, isGenerating, resetNarration };
}