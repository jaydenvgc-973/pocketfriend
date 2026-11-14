import { isCharacterHome } from "@/lib/travelAvailability";

/**
 * UNIT ASSIGNMENTS (apartments, patient rooms, prison cells)
 *
 * A property with internal spaces is ONE location whose `residential_units` array —
 * already maintained by the Places page — describes the spaces inside it: apartments in
 * a building, patient rooms in a hospital or clinic, cells in a prison or jail.
 *
 * The facility is the location; the unit is the assigned space; a zone is a room inside
 * the facility and stays shared across all units.
 *
 * Nothing here creates, reassigns, or infers an assignment. It only reads what Places stores.
 */

export function getResidentialUnits(location) {
  return (location?.residential_units || []).filter((u) => u?.unit_id && u?.unit_name);
}

const UNIT_KINDS = {
  home: {
    label: "Apartment",
    plural: "Apartments",
    heading: "Apartment",
    none: "Whole building",
    unassigned: "No apartment assigned",
    placeholder: "e.g. Apartment 1, Unit 4B...",
    emptyHint: "Add residents to the building first, then create apartments to organize them.",
    contextNoun: "building",
  },
  medical: {
    label: "Room",
    plural: "Patient Rooms",
    heading: "Patient Room",
    none: "Whole facility",
    unassigned: "No room assigned",
    placeholder: "e.g. 204, ICU-3...",
    emptyHint: "Patients hospitalized at this facility can be assigned to a patient room.",
    contextNoun: "facility",
  },
  jail_prison: {
    label: "Cell",
    plural: "Cells",
    heading: "Cell",
    none: "Whole facility",
    unassigned: "No cell assigned",
    placeholder: "e.g. B2, Cellblock C...",
    emptyHint: "Incarcerated characters at this facility can be assigned to a cell.",
    contextNoun: "facility",
  },
  hotel: {
    label: "Room",
    plural: "Rooms / Units",
    heading: "Room / Unit",
    none: "Whole property",
    unassigned: "No room assigned",
    placeholder: "e.g. Room 101, Unit 4B...",
    emptyHint: "Add guests to the hotel first, then create rooms to organize them.",
    contextNoun: "hotel",
  },
};

/** How this property's internal spaces are named. Unknown categories fall back to apartments. */
export function getUnitKind(location) {
  const category = location?.category;
  return UNIT_KINDS[category] || UNIT_KINDS.home;
}

/**
 * Which facilities carry internal unit assignments.
 * Residential buildings, hospitals/clinics, and prisons/jails. Everything else is unchanged.
 */
export function supportsUnitAssignments(location) {
  return ["home", "medical", "jail_prison"].includes(location?.category);
}

/** The units of a location that can actually be assigned and visited, or [] when it has none. */
export function getAssignableUnits(location) {
  return supportsUnitAssignments(location) ? getResidentialUnits(location) : [];
}

export function getUnitById(location, unitId) {
  if (!unitId) return null;
  return getResidentialUnits(location).find((u) => u.unit_id === unitId) || null;
}

/**
 * Whether a person is physically inside this facility right now.
 *
 * A residence: home presence, from the existing home check.
 * A hospital or correctional facility: the location itself must say the character is there.
 * A status alone (hospitalized / jailed) never places someone in a specific building, so an
 * unknown location falls back to the status only when no location is recorded at all.
 */
export function isCharacterInFacilitySpace(location, character) {
  if (!location || !character) return false;
  if (["deceased", "deleted", "merged"].includes(character.life_status)) return false;
  if (["deceased", "deleted", "merged"].includes(character.status)) return false;

  const category = location.category;
  if (category === "home" || category === "hotel") {
    if (character.current_home_location_id && character.current_home_location_id !== location.id) return false;
    return isCharacterHome(character);
  }

  if (character.resolved_current_location_id) return character.resolved_current_location_id === location.id;
  if (category === "medical") return character.resolved_presence_status === "hospitalized";
  if (category === "jail_prison") {
    return character.is_jailed === true || ["incarcerated", "confined"].includes(character.resolved_presence_status);
  }
  return false;
}

/**
 * The occupant IDs of a unit who are assigned to it AND actually present in that space
 * right now. A patient in another room, or an inmate in another cell, is never included:
 * being in the same facility is not being in this room.
 */
export function getUnitPresentOccupantIds(location, unitId, characters = []) {
  const unit = getUnitById(location, unitId);
  if (!location || !unit) return [];
  const byId = new Map((characters || []).map((c) => [c.id, c]));
  return [...new Set(unit.occupant_character_ids || [])].filter((id) => {
    const c = byId.get(id);
    if (!c) return false;
    return isCharacterInFacilitySpace(location, c);
  });
}

/** The apartment / room / cell a character is assigned to in this property, if any. */
export function getUnitForCharacter(location, characterId) {
  if (!location || !characterId) return null;
  return getResidentialUnits(location).find((u) => (u.occupant_character_ids || []).includes(characterId)) || null;
}

/** Unit names are shown exactly as stored; a bare code gets the property's own lead-in. */
export function getUnitLabel(unitName, location) {
  if (!unitName || /\s/.test(unitName)) return unitName;
  return `${getUnitKind(location).label} ${unitName}`;
}