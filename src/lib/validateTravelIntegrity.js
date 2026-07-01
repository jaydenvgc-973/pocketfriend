/**
 * validateTravelIntegrity.js — TRANSIT TRAVEL REMOVED
 *
 * Previously validated that Character.travel_status and TravelSession were
 * synchronized, checking for required session fields (estimated_arrival_time,
 * duration_minutes, progress_percent, route_status).
 * That transit integrity validation is forbidden.
 *
 * Characters teleport instantly. There is no travel_status to synchronize,
 * no session fields to validate. This function returns no-blockers.
 */
export function validateTravelIntegrity({ character, activeSession, locationsById = {} }) {
  return {
    blockers: [],
    proof: {
      character_id: character?.id,
      transit_travel_removed: true,
    },
  };
}