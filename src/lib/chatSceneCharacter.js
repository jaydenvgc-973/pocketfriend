import { resolveCharacterLocation } from "@/lib/locationResolutionEngine";

/**
 * buildCharacterInScene
 *
 * Returns the character record the prompt must describe for THIS turn: the stored
 * record with its physical location replaced by the live resolver's answer — the
 * same answer the homepage character card and the Chat geolocation tag display.
 *
 * Why this exists: the stored resolved_* fields can lag the schedule (they are only
 * rewritten when the scheduled location pathway commits a change). When they lag,
 * individual prompt blocks disagreed with each other — one declared "you are at
 * home" while the card showed work — and the generated message followed the stale
 * place. Every block now receives this one snapshot, so the turn has a single
 * physical location.
 *
 * An activity recorded at a place the character has since left describes the past,
 * not the present: the location is authoritative and the activity string is not, so
 * a stale activity is dropped rather than narrated as the current scene.
 */
export function buildCharacterInScene(character, locationMap = {}) {
  if (!character) return character;

  const live = resolveCharacterLocation(character, locationMap) || {};
  const liveId = live.resolved_current_location_id ?? character.resolved_current_location_id ?? null;
  const liveName = live.resolved_current_location_name ?? character.resolved_current_location_name ?? null;
  const movedSinceStored = !!liveId && !!character.resolved_current_location_id &&
    liveId !== character.resolved_current_location_id;

  return {
    ...character,
    resolved_current_location_id: liveId,
    resolved_current_location_name: liveName,
    resolved_location_type: live.resolved_location_type ?? character.resolved_location_type,
    resolved_presence_status: live.resolved_presence_status ?? character.resolved_presence_status,
    resolved_source_reason: live.resolved_source_reason ?? character.resolved_source_reason,
    current_activity: movedSinceStored ? null : character.current_activity,
  };
}