import { isPrivateResidentialZone } from "@/lib/sceneBackgroundPopulation";

/**
 * THE SPACE A SCENES PICTURE IS ACTUALLY TAKEN IN.
 *
 * A property is not one room. A residence keeps its apartments in `residential_units`, a
 * university its studios and dorm rooms, a hospital its patient rooms, a prison its cells,
 * a mixed-use building its businesses — all existing Places assignments. Opening such a
 * property at facility level (no specific space chosen) must not silently land the scene
 * inside one of those private rooms just because that zone happens to be first in the list.
 *
 * This resolves the zone a scene is really in, using only existing data:
 *   - a zone the user actually chose is honored exactly, private or not;
 *   - otherwise a property organized into private spaces opens in one of its shared spaces
 *     (common room, lobby, hallway, campus, cafeteria, street …), never in a private one;
 *   - if the property has no shared zone at all, no room is asserted and the property's own
 *     images are the facility view.
 *
 * Nothing is created, moved, renamed or reassigned.
 */
export function isFacilityLevelProperty(location) {
  if (!location) return false;
  return (location.residential_units || []).length > 0 || (location.workplaces || []).length > 0;
}

function pickZone(list) {
  return list.find((z) => z?.zone_name && z.is_primary_category === true && (z.image_urls || []).length > 0)
    || list.find((z) => z?.zone_name && z.is_primary_category === true)
    || list.find((z) => z?.zone_name && (z.image_urls || []).length > 0)
    || list.find((z) => z?.zone_name)
    || null;
}

export function resolveSceneZone(location, requestedZone = null) {
  if (!location) return requestedZone || null;
  const zones = (location.zones || []).filter((z) => z?.zone_name);
  if (zones.length === 0) return null;

  // A zone the scene was actually given — a chosen apartment's own zone, a zone picked in
  // the dropdown, the zone a venue setup set — is the space, exactly as it is.
  if (requestedZone && zones.some((z) => z.zone_name === requestedZone)) return requestedZone;

  if (isFacilityLevelProperty(location)) {
    const shared = zones.filter((z) => !isPrivateResidentialZone(location, z.zone_name));
    // The property as a whole shows one of its shared spaces.
    if (shared.length > 0) return pickZone(shared)?.zone_name || null;
    // Every zone is someone's private space: no single one of them is the facility.
    return null;
  }

  return pickZone(zones)?.zone_name || null;
}