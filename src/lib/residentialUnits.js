import { isCharacterHome } from "@/lib/travelAvailability";

/**
 * RESIDENTIAL UNITS
 *
 * A multi-dwelling property is ONE location whose `residential_units` array — already
 * maintained by the Places page — describes the apartments inside it. The building is
 * the property; the unit is the household; a zone is a room.
 *
 * Nothing here creates, reassigns, or infers residency. It only reads what Places stores.
 */

export function getResidentialUnits(location) {
  return (location?.residential_units || []).filter((u) => u?.unit_id && u?.unit_name);
}

export function getUnitById(location, unitId) {
  if (!unitId) return null;
  return getResidentialUnits(location).find((u) => u.unit_id === unitId) || null;
}

/**
 * The occupant IDs of a unit who live in this property AND are actually home right now.
 * A neighbour in another apartment is never included — being in the building is not
 * being in this apartment.
 */
export function getUnitHomeOccupantIds(location, unitId, characters = []) {
  const unit = getUnitById(location, unitId);
  if (!location || !unit) return [];
  const byId = new Map((characters || []).map((c) => [c.id, c]));
  return [...new Set(unit.occupant_character_ids || [])].filter((id) => {
    const c = byId.get(id);
    if (!c) return false;
    if (c.current_home_location_id && c.current_home_location_id !== location.id) return false;
    return isCharacterHome(c);
  });
}

/** The apartment a character is assigned to in this property, if any. */
export function getUnitForCharacter(location, characterId) {
  if (!location || !characterId) return null;
  return getResidentialUnits(location).find((u) => (u.occupant_character_ids || []).includes(characterId)) || null;
}

/** Unit names are shown exactly as stored; a bare code gets the property's own lead-in. */
export function getUnitLabel(unitName, location) {
  if (!unitName || /\s/.test(unitName)) return unitName;
  if (location?.category === "hotel") return `Room ${unitName}`;
  if (location?.category === "home") return `Apartment ${unitName}`;
  return `Unit ${unitName}`;
}