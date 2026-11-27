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
import { isUnhousedResidenceUnit } from '@/lib/unhousedLivingSpace';
import { isCharacterAtWork } from '@/lib/workScheduleUtils';
import { isCharacterHome } from '@/lib/travelAvailability';

// Presence states that mean the person is NOT in this property's shared area, whatever a
// stale location field says: a hospital bed, a cell, house arrest, the road, off-screen.
const AWAY_PRESENCE_STATUSES = new Set([
  'hospitalized', 'incarcerated', 'confined', 'house_arrest', 'traveling', 'rabbit_hole', 'deceased',
]);

/**
 * The ids of the people who are inside a separate occupied space of this property — or
 * otherwise not in its shared immediate area.
 * Empty for an ordinary venue or a single-household home.
 */
export function getPrivateSpaceOccupantIds(location, characters = [], presenceEntities = []) {
  const ids = new Set();
  if (!location?.id) return ids;
  const list = characters || [];

  // WHO IS ACTUALLY HERE IS THE RESOLVED PRESENCE — the same authority Who's Here and the
  // scene's participants already use. A record's own stored location field can lag behind
  // the schedule that put someone on shift, so it is only the fallback when the resolver
  // has no entity for that person at all.
  const resolvedLocation = new Map();
  const resolvedStatus = new Map();
  (presenceEntities || []).forEach((entity) => {
    if (!entity?.id) return;
    resolvedLocation.set(entity.id, entity.resolved_current_location_id);
    resolvedStatus.set(entity.id, entity.resolved_presence_status);
  });
  const locationOf = (character) => resolvedLocation.get(character.id) || character.resolved_current_location_id;
  const statusOf = (character) => resolvedStatus.get(character.id) || character.resolved_presence_status;
  const isHereNow = (character) => locationOf(character) === location.id;

  // 1. ASSIGNED SPACES — apartments, patient rooms, cells, dorm rooms, hotel rooms. The
  //    assignment Places already stores is the authority, and an ended stay is no
  //    assignment. Only an occupant who is actually at this property is inside it.
  //
  //    AN UNHOUSED LIVING SPACE IS NOT A ROOM INSIDE THE PROPERTY. A tent, an encampment
  //    or an outdoor sleeping area stands in the parent's own outdoor space, so the
  //    people staying there are part of that outdoor environment — they are never sealed
  //    inside a private interior. Choosing that space itself still selects exactly its
  //    occupants, through the unit the visit names. Their physical location is still what
  //    decides eligibility: someone at work, hospitalized, locked up or in another venue
  //    is elsewhere and never enters this pool.
  getResidentialUnits(location).forEach((unit) => {
    const unhoused = isUnhousedResidenceUnit(location, unit);
    getActiveUnitOccupantIds(location, unit, list).forEach((id) => {
      const character = list.find((c) => c.id === id);
      if (!character) return;
      const here = isHereNow(character)
        || (!resolvedLocation.has(character.id)
          && character.current_home_location_id === location.id && isCharacterHome(character));
      if (!here) return;
      // Staying in a tent is not being in the property's shared area — the person belongs
      // to the parent's outdoor environment and stays eligible there. A record that says
      // they are in a hospital bed, a cell or on the road is not there at all, so it is
      // still never part of that outdoor pool.
      if (unhoused && !AWAY_PRESENCE_STATUSES.has(statusOf(character))) return;
      ids.add(id);
    });
  });

  // 2. WORKPLACES INSIDE THE PROPERTY — an employee on shift is in that business's own
  //    space, not in the property's shared area. Authoritative presence outranks a
  //    recomputed shift: a record that already places them at work in this property means
  //    they are inside that business now, even when the shift window cannot be re-derived.
  getLocationWorkplaces(location).forEach((workplace) => {
    (workplace.worker_character_ids || []).forEach((id) => {
      const character = list.find((c) => c.id === id);
      if (!character) return;
      if (!isHereNow(character)) return;
      const atWorkHere = isCharacterAtWork(character, location) || statusOf(character) === 'at_work';
      if (!atWorkHere) return;
      ids.add(id);
    });
  });

  // 3. A hospital patient is in their patient room.
  if (location.category === 'medical') {
    list.forEach((c) => {
      if (statusOf(c) !== 'hospitalized') return;
      if (!isHereNow(c)) return;
      ids.add(c.id);
    });
  }

  // 4. A confined person is in their cell or housing unit.
  if (location.category === 'jail_prison' || location.is_confinement_facility === true) {
    list.forEach((c) => {
      const confined = c.is_jailed === true
        || ['incarcerated', 'confined'].includes(statusOf(c));
      if (!confined) return;
      const facilityId = c.incarceration_facility_id || locationOf(c);
      if (facilityId && facilityId !== location.id) return;
      ids.add(c.id);
    });
  }

  // 5. A student at their own school is in class or in their dorm room.
  if (location.category === 'school') {
    const enrolledIds = new Set((location.enrolled_students || []).map((s) => s?.character_id).filter(Boolean));
    list.forEach((c) => {
      if (!isHereNow(c)) return;
      const enrolledHere = enrolledIds.has(c.id)
        || c.education_location_id === location.id
        || (c.education_enrollments || []).some((e) => (e?.in_person_location_id || e?.location_id) === location.id)
        || c.current_home_location_id === location.id;
      if (enrolledHere) ids.add(c.id);
    });
  }

  return ids;
}