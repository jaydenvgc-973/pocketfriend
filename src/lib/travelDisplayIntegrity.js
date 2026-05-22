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
 * Merge session proof onto character objects.
 *
 * For each character:
 *   - If a valid in_transit session exists → inject _travelSession and _travelDisplayValid = true
 *   - If NOT → set _travelDisplayValid = false, clear stale travel display fields in-memory
 *     (does NOT write to DB — that is handled by completeStuckTravelUserScoped / autonomousMovement)
 *
 * Returns a new array (does not mutate input).
 */
export function applySessionProofToCharacters(characters, activeSessions = []) {
  if (!characters?.length) return characters || [];

  const sessionsByCharId = {};
  for (const s of activeSessions) {
    if (s.route_status === 'in_transit' && s.character_id) {
      // Keep most recent if multiple (shouldn't happen, but be safe)
      if (!sessionsByCharId[s.character_id]) {
        sessionsByCharId[s.character_id] = s;
      }
    }
  }

  const travelingStates = new Set([
    'traveling_to_work', 'traveling_to_school', 'traveling_to_destination', 'traveling'
  ]);
  const travelingPresenceStates = new Set(['traveling', 'in_transit']);

  return characters.map(char => {
    const session = sessionsByCharId[char.id];
    const charShowsTravel = travelingStates.has(char.travel_status) ||
      travelingPresenceStates.has(char.resolved_presence_status);

    if (!charShowsTravel) {
      // Character doesn't claim travel — no intervention needed
      return { ...char, _travelSession: null, _travelDisplayValid: false };
    }

    if (!session) {
      // Character claims travel but no valid in_transit session — CLEAR display in memory
      // IMPORTANT: Only clear the display fields used by UI. Do NOT touch resolved_current_location.
      return {
        ...char,
        // Override these fields so UI shows correct state without waiting for DB repair
        travel_status: 'not_traveling',
        traveling_to_location_id: null,
        traveling_to_location_name: null,
        travel_destination_location_id: null,
        // Preserve resolved_presence_status only if it wasn't 'traveling'
        // If it was 'traveling', downgrade to the last known static location state
        resolved_presence_status: travelingPresenceStates.has(char.resolved_presence_status)
          ? (char.resolved_location_type === 'home' ? 'home'
            : char.resolved_location_type === 'work' ? 'at_work'
            : char.resolved_location_type === 'school' ? 'at_school'
            : 'home') // safe fallback
          : char.resolved_presence_status,
        _travelSession: null,
        _travelDisplayValid: false,
        _travelOrphanCleared: true,
      };
    }

    // Validate session has complete render proof
    const validation = validateTravelDisplay(char, [session]);
    if (!validation.canDisplayTravel) {
      // Session exists but missing render fields — clear display until session is repaired
      return {
        ...char,
        travel_status: 'not_traveling',
        traveling_to_location_id: null,
        traveling_to_location_name: null,
        travel_destination_location_id: null,
        resolved_presence_status: travelingPresenceStates.has(char.resolved_presence_status)
          ? 'home'
          : char.resolved_presence_status,
        _travelSession: session,
        _travelDisplayValid: false,
        _travelSessionIncomplete: true,
        _travelSessionMissingFields: validation.reason,
      };
    }

    // Valid session — inject session proof
    return {
      ...char,
      // Ensure display fields match session destination (in case they drifted)
      traveling_to_location_id: session.destination_location_id,
      traveling_to_location_name: session.destination_location_name,
      travel_destination_location_id: session.destination_location_id,
      _travelSession: session,
      _travelDisplayValid: true,
    };
  });
}

/**
 * React hook: load all active in_transit TravelSessions for the owner.
 * Session-aware — only fetches once per 2 minutes.
 * Returns { sessions, isLoading }
 */
export function useTravelSessions(ownerEmail) {
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['travelSessions', ownerEmail],
    queryFn: async () => {
      if (!ownerEmail) return [];
      return base44.entities.TravelSession.filter(
        { owner_email: ownerEmail, route_status: 'in_transit' },
        '-updated_date',
        50
      ).catch(() => []);
    },
    enabled: !!ownerEmail,
    staleTime: 2 * 60 * 1000,   // 2 min — travel changes slowly
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchInterval: 30 * 1000, // poll every 30s to catch new arrivals
  });

  return { sessions, isLoading };
}