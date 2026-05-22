/**
 * TRAVEL DISPLAY INTEGRITY
 *
 * ONE TRUTH / ONE PRESENCE RULE:
 * A character must NOT display as "Traveling to…" unless a valid
 * in_transit TravelSession exists with complete render proof.
 *
 * ONLY route_status:"in_transit" may make the UI show travel.
 * "preparing", "delayed", "arrived", "blocked", "cancelled" must NOT.
 *
 * This module provides:
 *   1. validateTravelDisplay(character, sessions) — check if travel display is allowed
 *   2. applySessionProofToCharacters(characters, sessions) — merge session data onto char objects
 *   3. useTravelSessions(ownerEmail) — React hook that loads active sessions for an account
 */

import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// ── Required fields for a session to prove travel display ────────────────────
const REQUIRED_RENDER_FIELDS = [
  'character_id',
  'owner_email',
  'origin_location_id',
  'destination_location_id',
  'estimated_departure_time',
  'estimated_arrival_time',
  'duration_minutes',
  'progress_percent',
];

/**
 * Validate whether a character may display as "traveling".
 *
 * Returns:
 * {
 *   canDisplayTravel: boolean,
 *   reason: string,
 *   sessionId: string|null,
 *   statusBarDataExists: boolean,
 *   mapMovementDataExists: boolean,
 *   originExists: boolean,
 *   destinationExists: boolean,
 *   etaExists: boolean,
 *   durationExists: boolean,
 *   progressExists: boolean,
 * }
 *
 * @param {object} character - Character record
 * @param {object[]} activeSessions - Array of TravelSession records (already filtered to in_transit)
 */
export function validateTravelDisplay(character, activeSessions = []) {
  if (!character) {
    return { canDisplayTravel: false, reason: 'no_character', sessionId: null,
      statusBarDataExists: false, mapMovementDataExists: false, originExists: false,
      destinationExists: false, etaExists: false, durationExists: false, progressExists: false };
  }

  // Find a matching in_transit session for this character
  const session = activeSessions.find(s =>
    s.character_id === character.id &&
    s.route_status === 'in_transit'
  );

  if (!session) {
    return {
      canDisplayTravel: false,
      reason: 'no_in_transit_session',
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

  const originExists     = !!session.origin_location_id;
  const destinationExists = !!session.destination_location_id;
  const etaExists        = !!session.estimated_arrival_time;
  const durationExists   = !!session.duration_minutes;
  const progressExists   = session.progress_percent !== undefined && session.progress_percent !== null;

  // Status bar needs: destination, ETA, duration
  const statusBarDataExists = destinationExists && etaExists && durationExists;

  // Map movement needs: origin, destination, progress
  const mapMovementDataExists = originExists && destinationExists && progressExists;

  // All required fields must exist for full travel display
  const missingFields = REQUIRED_RENDER_FIELDS.filter(f => {
    const val = session[f];
    return val === undefined || val === null || val === '';
  });

  if (missingFields.length > 0) {
    return {
      canDisplayTravel: false,
      reason: `missing_render_fields:${missingFields.join(',')}`,
      sessionId: session.id,
      statusBarDataExists,
      mapMovementDataExists,
      originExists,
      destinationExists,
      etaExists,
      durationExists,
      progressExists,
    };
  }

  return {
    canDisplayTravel: true,
    reason: 'valid_in_transit_session',
    sessionId: session.id,
    session,
    statusBarDataExists: true,
    mapMovementDataExists: true,
    originExists: true,
    destinationExists: true,
    etaExists: true,
    durationExists: true,
    progressExists: true,
  };
}

/**
 * applySessionProofToCharacters — DEPRECATED
 *
 * TravelSession is no longer authoritative for character location.
 * Characters teleport instantly at scheduled time.
 * This function now simply returns characters unchanged.
 * All travel state is ignored — current_location_id is the only authority.
 */
export function applySessionProofToCharacters(characters, activeSessions = []) {
  if (!characters?.length) return characters || [];
  // Always return characters as-is. Travel sessions do not affect location display.
  return characters.map(char => ({ ...char, _travelDisplayValid: false, _travelSession: null }));
}

/**
 * useTravelSessions — DEPRECATED
 *
 * TravelSession polling is disabled. No longer authoritative.
 * Returns empty sessions always. Zero network calls.
 */
export function useTravelSessions(ownerEmail) {
  return { sessions: [], isLoading: false };
}