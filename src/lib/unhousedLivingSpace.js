/**
 * UNHOUSED LIVING SPACE — an established place to stay that is not housing.
 *
 * A character can have somewhere they regularly sleep, keep their things and return to
 * without that place being a home. This venue type is offered only under the Outdoor and
 * Generic categories, and it is always an outdoor setting: a tent or a makeshift shelter
 * gives some cover from the weather, it does not turn the arrangement into an indoor
 * residence.
 *
 * Nothing here creates a zone, assigns anyone, or changes a housing flag. It only reads
 * what Places already stores.
 */

export const UNHOUSED_LIVING_SPACE = 'unhoused_living_space';

// Zone OPTIONS for an encampment. Every one is a name the user can also type by hand —
// these are never created automatically, and a location may use none of them.
export const UNHOUSED_ZONE_PRESETS = [
  "Encampment Entrance",
  "Tent",
  "Tent 2",
  "Tent 3",
  "Under the Bridge",
  "Sidewalk",
  "Alley",
  "Vacant Lot",
  "Abandoned Parking Lot",
  "Market Street",
  "Fire Barrel",
  "Outdoor Gathering Area",
  "Makeshift Shelter",
  "Porta Potty",
];

/** True when this location is an Unhoused Living Space. Never inferred from its name. */
export function isUnhousedLivingSpace(location) {
  if (!location) return false;
  const types = Array.isArray(location.subtype) ? location.subtype : [location.subtype];
  return types.filter(Boolean).some((t) => String(t).toLowerCase() === UNHOUSED_LIVING_SPACE);
}

/**
 * Whether this zone's name establishes a facility that actually exists there.
 * A fire barrel and a portable toilet exist only when the user configured a zone for
 * them — the system never assumes either.
 */
export function zoneHasFireBarrel(zoneName) {
  return /fire|barrel/i.test(String(zoneName || ''));
}

export function zoneHasPortableToilet(zoneName) {
  return /porta|toilet|latrine|outhouse|restroom/i.test(String(zoneName || ''));
}