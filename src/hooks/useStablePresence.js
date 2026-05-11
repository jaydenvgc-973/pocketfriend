/**
 * useStablePresence
 *
 * Wraps the unified presence resolver with last-known-good protection.
 *
 * Problem solved:
 * Background React Query revalidations can temporarily return fewer characters
 * (partial load, rate-limit, stale cache). When character array lengths change,
 * the unifiedPresenceEntities memo recalculates with a reduced set, making valid
 * "Who's here" participants disappear — which empties selectedNpcs and silences dialogue.
 *
 * Rule: Only replace the stable result when the fresh result is non-empty.
 * Brought characters (URL params) are ALWAYS authoritative regardless.
 *
 * Returns: stablePresenceEntities — safe to pass to WhosHereDropdown and hereNowFromPresence.
 */

import { useState, useEffect, useMemo } from 'react';

export function useStablePresence(freshPresenceEntities, locationId, broughtCharacters = [], allCharacters = []) {
  const [lastKnownGood, setLastKnownGood] = useState([]);

  // Update last-known-good whenever we receive a non-empty result
  useEffect(() => {
    if (freshPresenceEntities.length > 0) {
      setLastKnownGood(freshPresenceEntities);
    }
  }, [freshPresenceEntities]);

  const stableEntities = useMemo(() => {
    if (freshPresenceEntities.length > 0) return freshPresenceEntities;

    // Empty fresh result — guard against transient partial reload wiping valid participants
    const broughtIds = new Set(broughtCharacters.map(b => b.id));
    const retained = lastKnownGood.filter(e =>
      // Always keep brought characters
      broughtIds.has(e.id) ||
      // Keep others only if no conflicting authoritative location data shows they moved away
      !allCharacters.find(c =>
        c.id === e.id &&
        c.resolved_current_location_id &&
        c.resolved_current_location_id !== locationId
      )
    );

    if (retained.length > 0) {
      console.warn(
        `[useStablePresence] ⚠️ Presence returned empty for location ${locationId} — ` +
        `using last-known-good (${retained.length} entities) to prevent participant disappearance`
      );
      return retained;
    }

    return freshPresenceEntities;
  }, [freshPresenceEntities, lastKnownGood, locationId, broughtCharacters, allCharacters]);

  return stableEntities;
}