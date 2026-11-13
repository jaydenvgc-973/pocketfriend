/**
 * isDeletionCompleted
 *
 * Single source of truth for "has this character actually been removed?"
 *
 * A status value alone is not removal. A character is only removed once the
 * deletion pathway has run AND the record no longer occupies the world.
 * If the soft-delete write landed but the character still holds a location or
 * a home, the deletion did not complete — the record is still an occupant and
 * must stay manageable so the user can delete it manually.
 */
export function isDeletionCompleted(character) {
  if (!character) return false;
  if (character.status === "deleted" || character.status === "merged") return true;
  if (character.status !== "soft_deleted") return false;
  return !(
    character.resolved_current_location_id ||
    character.current_home_location_id ||
    character.temporary_housing_location_id
  );
}