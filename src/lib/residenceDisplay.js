/**
 * Display-only residence labels for the Locations page.
 *
 * Reads the character's existing residence fields and the location records the
 * page already loaded. No writes, no residence logic — formatting only.
 */

/** Apartment / unit name inside a location, for one character. */
export function findResidenceUnitName(location, characterId) {
  if (!location || !characterId) return null;
  const unit = (location.residential_units || []).find(
    (u) => (u.occupant_character_ids || []).includes(characterId)
  );
  return unit?.unit_name || null;
}

/**
 * Where a character currently resides, ready to render beneath their name.
 * Returns { label, isCurrentLocation }.
 */
export function describeCharacterResidence(character, locations = [], currentLocationId = null) {
  const homeId =
    character?.current_home_location_id ||
    character?.temporary_housing_location_id ||
    null;

  if (!homeId) return { label: "No residence assigned", isCurrentLocation: false };

  const home = (locations || []).find((l) => l?.id === homeId);
  const unitName = findResidenceUnitName(home, character?.id);

  if (currentLocationId && homeId === currentLocationId) {
    return {
      label: unitName ? `Lives here · ${unitName}` : "Lives here",
      isCurrentLocation: true,
    };
  }

  if (!home) return { label: "Residence assigned", isCurrentLocation: false };

  return {
    label: `Residence: ${home.name}${unitName ? ` · ${unitName}` : ""}`,
    isCurrentLocation: false,
  };
}