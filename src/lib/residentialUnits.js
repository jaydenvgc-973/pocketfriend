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

const UNIT_NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Alphabetical + natural numerical order: Unit 2 before Unit 10, A2 before A10, Room 100 before Room 110. */
export function compareUnitNames(a, b) {
  return UNIT_NAME_COLLATOR.compare(a?.unit_name || '', b?.unit_name || '');
}

/** The same units in display order — never renamed, never reordered in storage. */
export function sortUnits(units = []) {
  return [...units].sort(compareUnitNames);
}

export function getResidentialUnits(location) {
  return sortUnits((location?.residential_units || []).filter((u) => u?.unit_id && u?.unit_name));
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

/**
 * WHETHER A SPACE ASSIGNMENT IS STILL ACTIVE.
 *
 * An apartment in a residence is a standing arrangement and always stands.
 * A patient room and a prison cell are TEMPORARY: they exist only while that
 * character is actually hospitalized or incarcerated at that facility. The moment
 * the stay ends — discharged, released — the assignment has ended on its own. No
 * clock, sweep, or extra process is involved: the status the release/discharge
 * authority already wrote is the whole rule.
 *
 * ESTABLISHED HOME — LIVING THERE IS NOT THE STAY ENDING.
 * A facility listed as the character's home (current_home_location_id) makes that space
 * where they live, so it is never read as lapsed and never pruned from the property just
 * because a status field is not set. This only protects the SPACE. It never writes,
 * clears, or extends patient or inmate status: a home hospital or jail keeps the
 * character a patient or inmate exactly as before, and an actual discharge or release
 * still runs its established authority, which frees the room or cell as it always has.
 */
export function isTemporaryUnitAssignmentActive(location, character) {
  if (!location || !character) return false;
  // Home space stands on its own — never removed because the facility is their home.
  if (character.current_home_location_id && character.current_home_location_id === location.id) return true;
  if (location.category === "medical") {
    if (character.resolved_presence_status !== "hospitalized") return false;
    return !character.resolved_current_location_id || character.resolved_current_location_id === location.id;
  }
  if (location.category === "jail_prison") {
    const confined = character.is_jailed === true
      || ["incarcerated", "confined"].includes(character.resolved_presence_status);
    if (!confined) return false;
    const facilityId = character.incarceration_facility_id || character.resolved_current_location_id;
    return !facilityId || facilityId === location.id;
  }
  return true;
}

/**
 * The assigned occupants whose assignment still stands. A character whose stay has
 * ended is gone from the room/cell, so the space is free to be assigned again —
 * the space itself, and everyone else in it, are untouched. An id whose character
 * record is not loaded is never dropped: reading can never erase an assignment.
 */
export function getActiveUnitOccupantIds(location, unit, characters = []) {
  const byId = new Map((characters || []).map((c) => [c.id, c]));
  return [...new Set(unit?.occupant_character_ids || [])].filter((id) => {
    const c = byId.get(id);
    // An id whose character record is not loaded is never dropped: reading can never
    // erase an assignment it cannot verify.
    if (!c) return true;
    return isTemporaryUnitAssignmentActive(location, c);
  });
}

/**
 * THE ZONE THAT IDENTIFIES THIS SPACE.
 *
 * A room or cell identifies WHICH space inside a facility; the zone identifies WHAT KIND
 * of space. A hospital's patient room is shown by its existing "Patient Room" zone and a
 * jail's cell by its existing "Cell" zone — the facility's own zone references and images,
 * never a per-room zone. Returns null when the facility has no such zone (and for every
 * other kind of property, which keeps its current behavior).
 */
export function getUnitZoneName(location) {
  const zones = (location?.zones || []).map((z) => z?.zone_name).filter(Boolean);
  if (zones.length === 0) return null;
  if (location.category === 'medical') return zones.find((z) => /patient room/i.test(z)) || null;
  if (location.category === 'jail_prison') {
    return zones.find((z) => /^cell$/i.test(z)) || zones.find((z) => /\bcell\b/i.test(z)) || null;
  }
  return null;
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