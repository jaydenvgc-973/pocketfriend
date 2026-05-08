/**
 * usePageContext
 *
 * Registers the current page + active character/location in the simulation gate.
 * Call once per page (Chat, Scene, Travel, Home, CharacterProfile) on mount.
 *
 * This is the ONLY way the simulation gate learns what page is active.
 * All simulation callers read from the gate, not from component state.
 */

import { useEffect } from 'react';
import { setActiveContext, clearActiveContext, activateChatSafeMode } from '@/lib/simulationGate';

/**
 * @param {object} opts
 * @param {string} opts.page        — 'home' | 'chat' | 'scene' | 'travel' | 'profile'
 * @param {string} [opts.characterId] — active character id (chat/profile pages)
 * @param {string} [opts.locationId]  — active location id (scene page)
 */
export function usePageContext({ page, characterId = null, locationId = null }) {
  useEffect(() => {
    if (!page) return;
    setActiveContext({ page, characterId, locationId });

    // When Chat opens, proactively activate safe mode for 60s so any running
    // scheduled automations (autonomousCharacterMovement, returnActiveCharactersHome, etc.)
    // detect the flag and skip their next run cycle, keeping quota free for Chat.
    if (page === 'chat') {
      activateChatSafeMode(60000);
    }

    return () => {
      clearActiveContext(page);
    };
  }, [page, characterId, locationId]);
}