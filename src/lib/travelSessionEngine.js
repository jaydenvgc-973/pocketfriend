/**
 * travelSessionEngine.js — TRANSIT TRAVEL REMOVED
 *
 * Previously provided utilities for reading TravelSession records and computing
 * real-time progress (enrichSessionProgress, ETA formatting, mins_remaining).
 * That transit display behavior is forbidden.
 *
 * Characters teleport instantly. There is no in-transit state, no progress,
 * no ETA to compute. These functions now return empty/null results to preserve
 * import signatures without displaying transit UI.
 */
import { base44 } from '@/api/base44Client';

/**
 * Fetch all active TravelSession records for a given owner.
 * Returns [] — no in-transit sessions exist.
 */
export async function getActiveTravelSessions(ownerEmail) {
  return [];
}

/**
 * Fetch active TravelSession for a specific character.
 * Returns null — no in-transit state.
 */
export async function getCharacterTravelSession(characterId) {
  return null;
}

/**
 * Previously enriched a TravelSession with computed progress.
 * Returns null — no progress to compute.
 */
export function enrichSessionProgress(session) {
  return null;
}