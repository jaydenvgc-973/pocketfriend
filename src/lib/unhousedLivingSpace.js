/**
 * UNHOUSED LIVING SPACE — an established place to stay that is not housing.
 *
 * A character can have somewhere they regularly sleep, keep their things and return to
 * without that place being a home. This venue type is offered only under the Outdoor and
 * Generic categories, and it is always an outdoor setting: a tent or a makeshift shelter
 * gives some cover from the weather, it does not turn the arrangement into an indoor
 * residence.
 *
 * Nothing here creates a zone, assigns anyone, furnishes anything, or changes a housing
 * flag. It only reads what Places already stores.
 */

export const UNHOUSED_LIVING_SPACE = 'unhoused_living_space';

// Zone OPTIONS for an encampment. Every one is a name the user can also type by hand —
// these are never created automatically, and a location may use none of them. A Portable
// Toilet or Portable Restroom is a unit standing on its own: it is never a bathroom with
// running water, a shower, a bathtub or plumbing.
export const UNHOUSED_ZONE_PRESETS = [
  "Tent",
  "Under the Bridge",
  "Encampment",
  "Makeshift Shelter",
  "Sidewalk",
  "Street",
  "Alley",
  "Park Bench",
  "Vacant Lot",
  "Abandoned Parking Lot",
  "Outdoor Gathering Area",
  "Fire Barrel Area",
  "Portable Toilet",
  "Portable Restroom",
];

/** True when this location is an Unhoused Living Space. Never inferred from its name. */
export function isUnhousedLivingSpace(location) {
  if (!location) return false;
  const types = Array.isArray(location.subtype) ? location.subtype : [location.subtype];
  return types.filter(Boolean).some((t) => String(t).toLowerCase() === UNHOUSED_LIVING_SPACE);
}

// Venue types that describe a conventional residence. A property carrying one of these
// alongside Unhoused Living Space holds both kinds of living arrangement, so its own
// physical setting stays whatever the user chose.
export const HOUSED_VENUE_TYPES = [
  'apartment', 'house', 'studio_apartment', 'condo', 'dormitory',
  'apartment_building', 'residential_building', 'residential_complex', 'mixed_use', 'building',
];

/** True when this location also carries a conventional residential venue type. */
export function hasHousedVenueType(location) {
  if (!location) return false;
  const types = Array.isArray(location.subtype) ? location.subtype : [location.subtype];
  return types.filter(Boolean).some((t) => HOUSED_VENUE_TYPES.includes(String(t).toLowerCase()));
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

/**
 * The image rule for a space someone stays in without housing.
 *
 * The picture holds only what the place actually has. Sleeping happens on the ground, on
 * cardboard or a blanket, in a sleeping bag, inside a tent, on a bench, or in a chair —
 * whatever the zone and its reference images establish. A bed, a bedroom, a kitchen or a
 * living room is never added, and the conditions are never improved for the picture.
 */
export function buildUnhousedSpaceRule({ zoneName = '', sleeping = false } = {}) {
  const zone = String(zoneName || '').trim();
  const where = zone ? ` The space is ${zone}.` : '';
  const sleep = sleeping
    ? ' A person sleeping here sleeps on what this place actually has: the ground, cardboard, a blanket, a sleeping bag, a mattress, inside a tent, on a bench, or in a chair.'
    : '';
  return ` ⛔ THIS IS AN OUTDOOR PLACE SOMEONE STAYS, NOT A HOME INTERIOR.${where}${sleep} ⛔ Never a bed, never a bedroom, kitchen, living room, bathroom, hallway or upstairs, and never furniture or plumbing that is not in the reference images. Do not improve, furnish or tidy the conditions.`;
}