/**
 * HOUSING TRUTH — which SPACE someone actually lives in.
 *
 * One city can hold an apartment, a house and an encampment at once. The parent's own
 * venue types never decide whether a resident is housed: the space the character is
 * assigned inside it does. A resident of 142 Cherry Ln (an apartment) is housed even
 * though the city also contains a tent; a resident of Tent 1 is not housed even though
 * the city also contains apartments.
 *
 * A space saved before its kind was recorded is read from the residence type the user
 * configured for that space. A parent with no space assignment is unhoused only when it
 * is wholly an unhoused living space.
 */
const HOUSED_VENUE_TYPES = [
  'apartment', 'house', 'studio_apartment', 'condo', 'dormitory',
  'apartment_building', 'residential_building', 'residential_complex', 'mixed_use', 'building',
];

const UNHOUSED_TYPE_PATTERN = /tent|sleeping\s*area|sleeping\s*space|encampment|makeshift|bridge|sidewalk|street|alley|bench|cardboard|underpass|vacant|vehicle|\bvan\b|\bcar\b|shelter\s*space|spot/i;
const HOUSED_TYPE_PATTERN = /apartment|house|home|studio|condo|townhouse|duplex|loft|dorm|room|suite|bungalow|cabin|trailer|mobile/i;

/** The space this character is assigned inside this place, if any. */
export function residentialUnitFor(loc, character) {
  const id = character?.id;
  if (!loc || !id) return null;
  return (loc.residential_units || []).find((u) => (u.occupant_character_ids || []).includes(id)) || null;
}

/** True / false from the space's own record, or null when it records neither. */
function unitIsUnhoused(unit) {
  const saved = unit?.living_space_kind;
  if (saved === 'unhoused_living_space') return true;
  if (saved === 'residence') return false;
  const type = String(unit?.residence_type || '');
  if (UNHOUSED_TYPE_PATTERN.test(type)) return true;
  if (HOUSED_TYPE_PATTERN.test(type)) return false;
  return null;
}

export function isUnhousedPlace(loc, character = null) {
  const unit = residentialUnitFor(loc, character);
  if (unit) {
    const kind = unitIsUnhoused(unit);
    if (kind !== null) return kind;
  }
  const t = loc?.subtype, list = Array.isArray(t) ? t : [t];
  const unhoused = list.filter(Boolean).some((v) => String(v).toLowerCase() === 'unhoused_living_space');
  if (!unhoused) return false;
  // A parent that also holds conventional residences is not itself an unhoused place.
  const housed = list.filter(Boolean).some((v) => HOUSED_VENUE_TYPES.includes(String(v).toLowerCase()));
  return !housed;
}

export function homeIsStructuralPlace(loc, character = null) {
  if (!loc || isUnhousedPlace(loc, character)) return false;
  if (['home', 'hotel', 'shelter'].includes(loc.category || '')) return true;
  if ((loc.residential_units || []).length > 0) return true;
  const types = [...(loc.venue_types || []), ...(Array.isArray(loc.subtype) ? loc.subtype : [loc.subtype])].join(' ').toLowerCase().replace(/_/g, ' ');
  return /(^|\s)(house|apartment|condo|building|residence|dorm|townhouse|duplex|mobile home|trailer)(\s|$)/.test(types);
}