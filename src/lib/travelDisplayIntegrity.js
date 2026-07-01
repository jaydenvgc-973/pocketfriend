/**
 * travelDisplayIntegrity.js — TRANSIT TRAVEL REMOVED
 *
 * Previously validated whether a character may display as "traveling" by
 * checking for in_transit TravelSession records with required render fields
 * (estimated_arrival_time, duration_minutes, progress_percent).
 * That transit display validation is forbidden.
 *
 * Characters teleport instantly. There is no "traveling" display state.
 * These functions now return no-travel results to preserve import signatures.
 */
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Validate whether a character may display as "traveling".
 * Returns canDisplayTravel: false — no transit display.
 */
export function validateTravelDisplay(character, activeSessions = []) {
  return {
    canDisplayTravel: false,
    reason: 'transit_travel_removed',
    sessionId: null,
    statusBarDataExists: false,
    mapMovementDataExists: false,
    originExists: false,
    destinationExists: false,
    etaExists: false,
    durationExists: false,
    progressExists: false,
  };
}

/**
 * Previously merged session data onto character objects for transit display.
 * Returns characters unchanged — no session proof to apply.
 */
export function applySessionProofToCharacters(characters, sessions) {
  return characters;
}

/**
 * React hook that loads active sessions for an account.
 * Returns empty — no in-transit sessions.
 */
export function useTravelSessions(ownerEmail) {
  const { data, isLoading } = useQuery({
    queryKey: ['travelSessions', ownerEmail],
    queryFn: async () => [],
    enabled: !!ownerEmail,
    staleTime: Infinity,
  });
  return { sessions: data || [], isLoading };
}