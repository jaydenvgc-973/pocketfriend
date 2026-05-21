/**
 * travelSessionEngine.js
 *
 * Frontend utilities for Travel Session state — reading active sessions,
 * computing real-time progress, and formatting in-transit UI state.
 *
 * RULES:
 * - Does NOT modify database — read-only helpers
 * - Never uses created_by — queries by owner_email or character_id only
 */

import { base44 } from '@/api/base44Client';

/**
 * Fetch all active TravelSession records for a given owner.
 * Returns array of sessions with computed real-time progress.
 */
export async function getActiveTravelSessions(ownerEmail) {
  if (!ownerEmail) return [];
  const sessions = await base44.entities.TravelSession.filter(
    { owner_email: ownerEmail, route_status: 'in_transit' },
    '-created_at',
    50
  ).catch(() => []);
  return sessions.map(enrichSessionProgress);
}

/**
 * Fetch active TravelSession for a specific character.
 * Returns null if not in transit.
 */
export async function getCharacterTravelSession(characterId) {
  if (!characterId) return null;
  const sessions = await base44.entities.TravelSession.filter(
    { character_id: characterId, route_status: 'in_transit' },
    '-created_at',
    1
  ).catch(() => []);
  return sessions?.[0] ? enrichSessionProgress(sessions[0]) : null;
}

/**
 * Enriches a TravelSession with real-time computed progress.
 */
export function enrichSessionProgress(session) {
  if (!session) return null;
  const now = Date.now();
  const start = session.estimated_departure_time ? new Date(session.estimated_departure_time).getTime() : now;
  const end   = session.estimated_arrival_time   ? new Date(session.estimated_arrival_time).getTime()   : now + 60000;
  const total = end - start;
  const elapsed = now - start;
  const computedProgress = total > 0 ? Math.min(99, Math.round((elapsed / total) * 100)) : (session.progress_percent || 0);
  const msRemaining = Math.max(0, end - now);
  const minsRemaining = Math.round(msRemaining / 60000);
  const isOverdue = now > end;

  return {
    ...session,
    computed_progress: computedProgress,
    mins_remaining: minsRemaining,
    is_overdue: isOverdue,
    eta_display: formatETA(session.estimated_arrival_time),
    positioning_label: getPositioningLabel(session.positioning_mode),
  };
}

/**
 * Format ETA for display.
 */
function formatETA(isoString) {
  if (!isoString) return null;
  const eta = new Date(isoString);
  const now = new Date();
  const diffMs = eta - now;

  if (diffMs < 0) return 'Arriving now';
  if (diffMs < 60000) return 'Less than a minute away';

  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `~${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `~${hours}h ${rem}m` : `~${hours}h`;
}

/**
 * Human-readable label for positioning mode.
 */
function getPositioningLabel(mode) {
  if (mode === 'real_coordinates')      return null; // accurate — no disclaimer needed
  if (mode === 'fictional_coordinates') return 'VGC world coordinates';
  return 'Approximate travel — location is not fully positioned';
}

/**
 * Checks if a character is currently in transit.
 * Safe to call without DB — uses character fields only.
 */
export function isCharacterInTransit(character) {
  if (!character) return false;
  return (
    character.resolved_presence_status === 'traveling' ||
    character.travel_status === 'traveling_to_destination' ||
    character.travel_status === 'traveling_to_work' ||
    character.travel_status === 'traveling_to_school'
  );
}

/**
 * Get display text for a character's in-transit state.
 */
export function getInTransitLabel(character, session = null) {
  const destName = session?.destination_location_name || character?.traveling_to_location_name;
  if (!destName) return 'In transit...';
  const eta = session ? formatETA(session.estimated_arrival_time) : null;
  return eta ? `In transit to ${destName} (${eta})` : `In transit to ${destName}`;
}