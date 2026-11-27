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

/* ── WHICH KIND OF LIVING ARRANGEMENT IS THIS SPACE? ──────────────────────────
 *
 * An apartment is a housed residence. A house is a housed residence. A tent, a sleeping
 * area, an encampment or a spot on the sidewalk is an unhoused arrangement. They are never
 * mixed just because they sit inside the same parent property: one city can hold both, and
 * every reader resolves each space from that space's own record.
 *
 * The order of authority is the space itself:
 *   1. the space's own recorded kind (living_space_kind),
 *   2. the residence type the user configured for that space (Apartment, House, Tent, Sleeping area),
 *   3. only for a space saved before either existed — the location's own kind, and only when
 *      the location is wholly an unhoused living space. A mixed parent never makes its
 *      spaces unhoused, and an unhoused parent never makes them apartments.
 */
export const RESIDENCE_KIND = 'residence';

const UNHOUSED_TYPE_PATTERN = /tent|sleeping\s*area|sleeping\s*space|encampment|makeshift|bridge|sidewalk|street|alley|bench|cardboard|underpass|vacant|vehicle|\bvan\b|\bcar\b|shelter\s*space|spot/i;
const HOUSED_TYPE_PATTERN = /apartment|house|home|studio|condo|townhouse|duplex|loft|dorm|room|suite|bungalow|cabin|trailer|mobile/i;

/** The kind of living arrangement one space is. Never inferred from its name. */
export function getUnitLivingSpaceKind(location, unit) {
  const saved = unit?.living_space_kind;
  if (saved === UNHOUSED_LIVING_SPACE || saved === RESIDENCE_KIND) return saved;
  const type = String(unit?.residence_type || '').trim();
  if (type) {
    if (UNHOUSED_TYPE_PATTERN.test(type)) return UNHOUSED_LIVING_SPACE;
    if (HOUSED_TYPE_PATTERN.test(type)) return RESIDENCE_KIND;
  }
  return isUnhousedLivingSpace(location) && !hasHousedVenueType(location)
    ? UNHOUSED_LIVING_SPACE
    : RESIDENCE_KIND;
}

/** True only when this space is an unhoused arrangement. */
export function isUnhousedResidenceUnit(location, unit) {
  return getUnitLivingSpaceKind(location, unit) === UNHOUSED_LIVING_SPACE;
}

export const LIVING_SPACE_GROUP_LABELS = {
  residence: 'Apartments & Homes',
  unhoused_living_space: 'Unhoused Living Spaces',
};

/** The spaces of a property, grouped by the kind of living arrangement each one is. */
export function getUnitGroups(location, units = []) {
  const groups = [
    { key: RESIDENCE_KIND, label: LIVING_SPACE_GROUP_LABELS[RESIDENCE_KIND], units: [] },
    { key: UNHOUSED_LIVING_SPACE, label: LIVING_SPACE_GROUP_LABELS[UNHOUSED_LIVING_SPACE], units: [] },
  ];
  for (const unit of units || []) {
    const group = groups.find((g) => g.key === getUnitLivingSpaceKind(location, unit));
    if (group) group.units.push(unit);
  }
  return groups.filter((g) => g.units.length > 0);
}

function sameZoneName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** The space whose own zones include this zone, if any. */
export function getUnitForZone(location, zoneName) {
  if (!zoneName) return null;
  return (location?.residential_units || []).find(
    (u) => sameZoneName(u.zone_name, zoneName) || (u.zone_names || []).some((n) => sameZoneName(n, zoneName))
  ) || null;
}

/**
 * Whether the space being looked at right now is an unhoused arrangement. The space's own
 * record decides; a mixed parent is never unhoused as a whole.
 */
export function isUnhousedSpaceAt(location, zoneName = null) {
  const unit = getUnitForZone(location, zoneName);
  if (unit) return isUnhousedResidenceUnit(location, unit);
  return isUnhousedLivingSpace(location) && !hasHousedVenueType(location);
}

/** Whether this character's own space at this location is an unhoused arrangement. */
export function isUnhousedSpaceForCharacter(location, characterId) {
  const unit = (location?.residential_units || []).find((u) => (u.occupant_character_ids || []).includes(characterId));
  if (unit) return isUnhousedResidenceUnit(location, unit);
  return isUnhousedLivingSpace(location) && !hasHousedVenueType(location);
}