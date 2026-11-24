/**
 * sceneImmediateArea.js
 *
 * WHOLE FACILITY IS NOT ONE ROOM.
 *
 * A property is one location. The apartments, patient rooms, cells, dorm rooms and
 * workplaces inside it are separate occupied spaces that Places already maintains.
 * Opening the whole facility means the user is in the property's shared area — not
 * inside every one of those spaces at once.
 *
 * Someone inside a space of their own is elsewhere in the building. They stay
 * available through Who's Here and join the scene only when the user actually selects
 * them. Being inside the same facility is not being in the same immediate area.
 *
 * This file only reads what the records already say. Nobody is moved, reassigned,
 * renamed, created or removed, no space is created, and no second presence system is
 * introduced: presence is still the existing resolved location. It answers exactly one
 * question — "is this person inside a space of their own inside this property right
 * now?"
 *
 * A single-household home has no such spaces, so nothing here applies to it and its
 * normal residential Scenes behavior is untouched.
 */
import { getResidentialUnits, getActiveUnitOccupantIds } from '@/lib/residentialUnits';
import { getLocationWorkplaces } from '@/lib/locationWorkspaces';
import { isCharacterAtWork } from '@/lib/workScheduleUtils';
import { isCharacterHome } from '@/lib/travelAvailability';

function isAtLocation(character, location) {
  if (!location?.id || !character?.id) return false;
  return character.resolved_current_location_id === location.id;
}

/**
 * The ids of the people who are inside a separate occupied space of this property.
 * Empty for an ordinary venue or a single-household home.
 */
export function getPrivateSpaceOccupantIds(location, characters = []) {
  const ids = new Set();
  if (!location?.id) return ids;
  const list = characters || [];

  // 1. ASSIGNED SPACES — apartments, patient rooms, cells, dorm rooms, hotel rooms. The
  //    assignment Places already stores is the authority, and an ended stay is no
  //    assignment. Only an occupant who is actually at this property is inside it.
  getResidentialUnits(location).forEach((unit) => {
    getActiveUnitOccupantIds(location, unit, list).forEach((id) => {
      const character = list.find((c) => c.id === id);
      if (!character) return;
      const here = character.resolved_current_location_id === location.id
        || (character.current_home_location_id === location.id && isCharacterHome(character));
      if (here) ids.add(id);
    });
  });

  // 2. WORKPLACES INSIDE THE PROPERTY — an employee on shift is in that business's own
  //    space, not in the property's shared area.
  getLocationWorkplaces(location).forEach((workplace) => {
    (workplace.worker_character_ids || []).forEach((id) => {
      const character = list.find((c) => c.id === id);
      if (!character) return;
      if (character.resolved_current_location_id && !isAtLocation(character, location)) return;
      if (!isCharacterAtWork(character, location)) return;
      ids.add(id);
    });
  });

  // 3. A hospital patient is in their patient room.
  if (location.category === 'medical') {
    list.forEach((c) => {
      if (c.resolved_presence_status !== 'hospitalized') return;
      if (c.resolved_current_location_id && !isAtLocation(c, location)) return;
      ids.add(c.id);
    });
  }

  // 4. A confined person is in their cell or housing unit.
  if (location.category === 'jail_prison' || location.is_confinement_facility === true) {
    list.forEach((c) => {
      const confined = c.is_jailed === true
        || ['incarcerated', 'confined'].includes(c.resolved_presence_status);
      if (!confined) return;
      const facilityId = c.incarceration_facility_id || c.resolved_current_location_id;
      if (facilityId && facilityId !== location.id) return;
      ids.add(c.id);
    });
  }

  // 5. A student at their own school is in class or in their dorm room.
  if (location.category === 'school') {
    const enrolledIds = new Set((location.enrolled_students || []).map((s) => s?.character_id).filter(Boolean));
    list.forEach((c) => {
      if (!isAtLocation(c, location)) return;
      const enrolledHere = enrolledIds.has(c.id)
        || c.education_location_id === location.id
        || (c.education_enrollments || []).some((e) => (e?.in_person_location_id || e?.location_id) === location.id)
        || c.current_home_location_id === location.id;
      if (enrolledHere) ids.add(c.id);
    });
  }

  return ids;
}