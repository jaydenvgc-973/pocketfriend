import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { isForegroundActive } from '@/lib/foregroundPriority';

/**
 * Hook to generate catch-up narratives when user returns to a conversation
 * after time has passed. Ensures character is aware of time that passed.
 */
export function useCatchUpNarrative(conversationId, characterId, character) {
  useEffect(() => {
    if (!conversationId || !characterId || !character) return;

    const generateCatchUp = async () => {
      try {
        const res = await base44.functions.invoke('generateCatchUpNarrative', {
          characterId,
          conversationId,
          lastUserMessageTime: character?.last_interaction_at || null,
        });
        
        if (res?.data?.success && res.data.catchUpText) {
          console.log(`[useCatchUpNarrative] Catch-up narrative generated: ${res.data.catchUpNarrativeId} | ${res.data.hoursSinceLastInteraction.toFixed(1)} hours passed`);
          // Mark that catch-up was processed so we don't regenerate this session
          sessionStorage.setItem(`catchup_${conversationId}`, 'processed');
        } else if (res?.data?.reason === 'no_time_passed') {
          console.log(`[useCatchUpNarrative] No time passed, skipping catch-up`);
        }
      } catch (err) {
        console.error('[useCatchUpNarrative] Generation failed:', err.message);
      }
    };

    // Only generate catch-up if we haven't already done it this session
    const catchUpProcessed = sessionStorage.getItem(`catchup_${conversationId}`);
    if (!catchUpProcessed) {
      // Elapsed-time guard: only run if last interaction was 30+ minutes ago.
      // Without this guard, this fires on every convo open even for recent chats,
      // duplicating the call already gated in useChatPostLoadEffects.
      const lastInteraction = character?.last_interaction_at;
      if (lastInteraction) {
        const minutesElapsed = (Date.now() - new Date(lastInteraction).getTime()) / 60000;
        if (minutesElapsed < 30) {
          // Not enough time has passed — skip silently (mark as processed so we don't retry)
          sessionStorage.setItem(`catchup_${conversationId}`, 'processed');
          return;
        }
      }
      // Delay to let messages load first, and yield if a critical foreground task is active
      const baseDelay = isForegroundActive() ? 8000 : 1500;
      const timer = setTimeout(generateCatchUp, baseDelay);
      return () => clearTimeout(timer);
    }
  }, [conversationId, characterId, character]);
}