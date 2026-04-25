import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

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
      // Delay slightly to let messages load first
      const timer = setTimeout(generateCatchUp, 1000);
      return () => clearTimeout(timer);
    }
  }, [conversationId, characterId, character]);
}