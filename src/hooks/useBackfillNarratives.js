import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to backfill missing narratives when a conversation loads.
 * Detects time gaps between last user message and current time.
 * Generates and saves realistic timeline events for missing periods.
 */
export function useBackfillNarratives(conversationId, characterId, character) {
  useEffect(() => {
    if (!conversationId || !characterId || !character) return;

    const runBackfill = async () => {
      try {
        const res = await base44.functions.invoke('backfillMissingNarratives', {
          characterId,
          conversationId,
        });

        if (res?.data?.backfilled && res?.data?.narratives?.length > 0) {
          console.log(`[BACKFILL] Filled ${res.data.narratives.length} events for ${res.data.hoursGap}h gap`);
        } else if (!res?.data?.backfilled) {
          console.log(`[BACKFILL] Skipped (${res?.data?.reason || 'unknown'}): gap too small or first conversation`);
        }
      } catch (err) {
        console.error('[BACKFILL] Error:', err.message);
      }
    };

    // Run with slight delay to let messages load first
    const timer = setTimeout(runBackfill, 500);
    return () => clearTimeout(timer);
  }, [conversationId, characterId, character]);
}