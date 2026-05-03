import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Wrapper component that runs backfill narratives when a conversation is active.
 * Detects time gaps and generates missing timeline events.
 * Place this inside Chat page to activate.
 */
export default function BackfillNarrativesWrapper({ conversationId, characterId, character }) {
  useEffect(() => {
    if (!conversationId || !characterId || !character) return;

    // Only run once per session per character — prevents re-running on every navigation or re-mount
    const sessionKey = `backfill_done_${characterId}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');

    const runBackfill = async () => {
      try {
        const res = await base44.functions.invoke('backfillMissingNarratives', {
          characterId,
          conversationId,
        });

        if (res?.data?.backfilled && res?.data?.narratives?.length > 0) {
          console.log(`[BACKFILL] Filled ${res.data.narratives.length} events for ${res.data.hoursGap}h gap`);
        } else if (!res?.data?.backfilled) {
          console.log(`[BACKFILL] Skipped (${res?.data?.reason})`);
        }
      } catch (err) {
        console.error('[BACKFILL] Error:', err.message);
      }
    };

    const timer = setTimeout(runBackfill, 500);
    return () => clearTimeout(timer);
  }, [conversationId, characterId, character]);

  return null; // This component is invisible — it only runs the effect
}