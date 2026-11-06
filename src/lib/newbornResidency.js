import { base44 } from "@/api/base44Client";

/**
 * assignNewbornToBirthParentHousehold
 *
 * A newborn's default residence is the birth parent's EXISTING household — never a
 * new home, never an unrelated property. The child's current_home_location_id is
 * already taken from that parent when the birth is recorded; this records the same
 * household in the dwelling units the Places page already organizes, using the unit
 * the birth parent actually occupies (apartment, room, suite).
 *
 * No unit is invented when the parent has none, and no residence is created.
 * The user can still move the child afterwards with the existing residential tools.
 */
export async function assignNewbornToBirthParentHousehold(birthParent, baby) {
  const homeId = birthParent?.current_home_location_id || birthParent?.resolved_current_location_id;
  if (!homeId || !baby?.id) return null;

  let location;
  try {
    location = await base44.entities.LocationReference.get(homeId);
  } catch {
    return null;
  }
  if (!location) return null;

  const units = location.residential_units || [];
  if (units.length === 0) return null; // the home itself is the assignment

  const unit = units.find(u => (u.occupant_character_ids || []).includes(birthParent.id));
  if (!unit) return null; // parent occupies no unit — nothing to inherit, nothing invented
  if ((unit.occupant_character_ids || []).includes(baby.id)) return unit.unit_name;

  await base44.entities.LocationReference.update(location.id, {
    residential_units: units.map(u => u.unit_id === unit.unit_id
      ? { ...u, occupant_character_ids: [...(u.occupant_character_ids || []), baby.id] }
      : u),
  });

  return unit.unit_name;
}