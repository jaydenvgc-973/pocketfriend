/**
 * childCaregiver
 *
 * One authority for reading the EXISTING child-supervision caregiver. The caregiver is
 * maintained by ensureChildCaregiverPresence: a npc_regular Character record with
 * is_sitter = true and sitter_assigned_to_location_id = the home it was assigned to.
 *
 * ON DUTY is the assignment itself. The caregiver is assigned only while children are
 * home and no adult who lives there has returned. A visiting adult never ends it, and
 * the caregiver is never a household guardian — it is the supervision, not the reason
 * supervision stops.
 *
 * HOUSEHOLD = the actual dwelling. In a multi-unit residence (residential_units on the
 * LocationReference) each apartment/unit is its own household: the adult occupants of
 * ONE unit supervise that unit's children, never the whole building. A resident who is
 * not assigned to any unit belongs to the property's own household.
 *
 * Read-only. Nothing here creates, assigns, or removes a caregiver.
 */
import { requiresSitter } from '@/lib/characterAgeSystem';

const PROPERTY_KEY = '__property__';

export function isCaregiverRecord(character) {
  if (!character) return false;
  return character.is_sitter === true || /babysit|caregiver|nanny|sitter/i.test(String(character.occupation || ''));
}

export function isCaregiverOnDuty(character, locationId) {
  if (!character || !locationId) return false;
  // The assignment IS the supervision, and presence resolution follows it
  // (locationResolutionEngine's child-supervision guard). A cleared assignment is not
  // on duty — that is how departure is expressed.
  return character.is_sitter === true && character.sitter_assigned_to_location_id === locationId;
}

/**
 * The dwelling a character actually lives in.
 * A unit occupant belongs to that unit's household; a resident with no unit belongs to
 * the property's own household. Two people are household members only when their
 * household keys match — neighbouring apartments never share one.
 */
export function resolveHousehold(location, characterId, characters = []) {
  if (!location || !characterId) return { key: null, unitId: null, unitName: null, memberIds: [] };

  const units = location.residential_units || [];
  const unit = units.find((u) => (u.occupant_character_ids || []).includes(characterId));
  if (unit) {
    return {
      key: `unit:${unit.unit_id}`,
      unitId: unit.unit_id,
      unitName: unit.unit_name || null,
      memberIds: unit.occupant_character_ids || [],
    };
  }

  const inAnyUnit = new Set();
  units.forEach((u) => (u.occupant_character_ids || []).forEach((id) => inAnyUnit.add(id)));
  const memberIds = (characters || [])
    .filter((c) => c?.id && c.current_home_location_id === location.id && !inAnyUnit.has(c.id))
    .map((c) => c.id);

  return { key: `${PROPERTY_KEY}:${location.id}`, unitId: null, unitName: null, memberIds };
}

/** Physically home right now — the same rule the supervision functions apply. */
function isPhysicallyHome(character, homeId) {
  return !character?.resolved_current_location_id || character.resolved_current_location_id === homeId;
}

/** An adult presence is a household member who does not themselves require supervision. */
function isHouseholdAdult(character) {
  return !requiresSitter(character).requiresSitter;
}

/** Adult members of this character's own household who are physically home right now. */
export function householdGuardiansHome(location, characterId, characters = []) {
  if (!location || !characterId) return [];
  const households = new Set(resolveHousehold(location, characterId, characters).memberIds);
  return (characters || []).filter((c) =>
    c?.id &&
    c.id !== characterId &&
    households.has(c.id) &&
    !isCaregiverRecord(c) &&
    isHouseholdAdult(c) &&
    isPhysicallyHome(c, location.id)
  );
}

/** Children of this household who need supervision and have no adult household member home. */
export function householdUnsupervisedChildren(location, characterId, characters = []) {
  if (!location || !characterId) return [];
  const households = new Set(resolveHousehold(location, characterId, characters).memberIds);
  return (characters || []).filter((c) =>
    c?.id &&
    c.current_home_location_id === location.id &&
    households.has(c.id) &&
    !isCaregiverRecord(c) &&
    requiresSitter(c).requiresSitter &&
    isPhysicallyHome(c, location.id) &&
    householdGuardiansHome(location, c.id, characters).length === 0
  );
}

/**
 * The children the caregiver on duty is actually responsible for: the children at this
 * home whose own household has no adult member present. Neighbouring units' children are
 * never attributed to this caregiver.
 */
export function supervisedChildren(location, caregiver, characters = []) {
  if (!location?.id || !caregiver) return [];
  return (characters || []).filter((c) =>
    c?.id &&
    c.id !== caregiver.id &&
    c.current_home_location_id === location.id &&
    !isCaregiverRecord(c) &&
    requiresSitter(c).requiresSitter &&
    isPhysicallyHome(c, location.id) &&
    householdGuardiansHome(location, c.id, characters).length === 0
  );
}