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
import { setActiveContext, clearActiveContext } from '@/lib/simulationGate';

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
    return () => {
      clearActiveContext(page);
    };
  }, [page, characterId, locationId]);
}