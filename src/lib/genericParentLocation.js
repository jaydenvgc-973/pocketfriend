/**
 * GENERIC PARENT LOCATION — what the parent actually is, and what kinds of places it holds.
 *
 * A Generic location is a container. Its Parent Location Type says what the parent itself
 * is (a city, a neighborhood, a building, a property). Its Additional Categories say which
 * kinds of independently functioning child places may exist inside it. Neither one makes
 * the parent into one of those places: a city that contains a hospital is a city.
 *
 * This module only reads and describes what Places stores. It creates no place, assigns
 * nobody, and never reclassifies a record.
 */
import { SUBTYPE_OPTIONS } from './locationFormConfig';

/** What the parent itself is. `whole` is the parent's own navigation label. */
export const PARENT_LOCATION_TYPES = [
  { value: 'city', label: 'City', whole: 'Whole city' },
  { value: 'town', label: 'Town', whole: 'Whole town' },
  { value: 'village', label: 'Village', whole: 'Whole village' },
  { value: 'neighborhood', label: 'Neighborhood', whole: 'Whole neighborhood' },
  { value: 'district', label: 'District', whole: 'Whole district' },
  { value: 'slum', label: 'Slum', whole: 'Whole slum' },
  { value: 'country', label: 'Country', whole: 'Whole country' },
  { value: 'campus', label: 'Campus', whole: 'Whole campus' },
  { value: 'building', label: 'Building', whole: 'Whole building' },
  { value: 'property', label: 'Property', whole: 'Whole property' },
  { value: 'complex', label: 'Complex', whole: 'Whole complex' },
  { value: 'other', label: 'Other', whole: 'Whole location' },
];

/** Kinds of child places a Generic parent may contain. Every value is an existing category. */
export const ADDITIONAL_CATEGORY_OPTIONS = [
  { value: 'home', label: 'Home' },
  { value: 'workplace', label: 'Workplace' },
  { value: 'business', label: 'Business' },
  { value: 'medical', label: 'Medical' },
  { value: 'school', label: 'School / Education' },
  { value: 'grocery', label: 'Grocery Store' },
  { value: 'food_drink', label: 'Food & Drink' },
  { value: 'social', label: 'Social / Nightlife' },
  { value: 'outdoor', label: 'Outdoors' },
  { value: 'community', label: 'Community' },
  { value: 'government', label: 'Government' },
  { value: 'jail_prison', label: 'Jail / Prison' },
  { value: 'religion', label: 'Religion / Worship' },
  { value: 'public', label: 'Public' },
  { value: 'hotel', label: 'Hotel (Temp)' },
  { value: 'shelter', label: 'Shelter (Temp)' },
  { value: 'transportation', label: 'Transportation' },
  { value: 'gym', label: 'Gym' },
];

const CATEGORY_LABELS = Object.fromEntries(ADDITIONAL_CATEGORY_OPTIONS.map((c) => [c.value, c.label]));

const normalizeTypes = (types) => {
  const raw = Array.isArray(types) ? types : [types];
  return raw.filter(Boolean).map((t) => String(t).toLowerCase());
};

/**
 * The parent's own type. A saved value is authoritative. A record saved before this field
 * existed is read from the venue type it already carries, and otherwise described as a
 * property — never assumed to be a building.
 */
export function getParentLocationType(location) {
  if (!location || location.category !== 'generic') return null;
  const saved = location.parent_location_type;
  if (saved) {
    return PARENT_LOCATION_TYPES.find((t) => t.value === saved)
      || { value: saved, label: String(saved), whole: `Whole ${String(saved).replace(/_/g, ' ')}` };
  }
  const types = normalizeTypes(location.subtype);
  const direct = PARENT_LOCATION_TYPES.find((t) => types.includes(t.value));
  if (direct) return direct;
  if (types.includes('slums')) return PARENT_LOCATION_TYPES.find((t) => t.value === 'slum');
  if (types.some((t) => ['building', 'apartment_building', 'residential_building', 'residential_complex', 'mixed_use'].includes(t))) {
    return PARENT_LOCATION_TYPES.find((t) => t.value === 'building');
  }
  return PARENT_LOCATION_TYPES.find((t) => t.value === 'property');
}

/** The label for the whole parent in Travel and Scenes. Null for every non-Generic place. */
export function getWholeSpaceLabel(location) {
  const parent = getParentLocationType(location);
  return parent ? parent.whole : null;
}

/** The additional categories the user selected. Empty means no restriction was recorded. */
export function getAdditionalCategories(location) {
  return (location?.additional_categories || []).filter(Boolean);
}

/**
 * Whether this Generic parent may contain the given kind of child place. A record with no
 * recorded categories keeps every capability it already had — nothing is taken away.
 */
export function allowsAdditionalCategory(location, ...categories) {
  if (!location || location.category !== 'generic') return true;
  const selected = getAdditionalCategories(location);
  if (selected.length === 0) return true;
  return categories.some((c) => selected.includes(c));
}

/** Categories inferred from a legacy Generic record's own venue types, for unit labelling. */
function inferredCategories(location) {
  const types = normalizeTypes(location?.subtype);
  const cats = new Set();
  const has = (list) => types.some((t) => list.includes(t));
  if (has(['apartment', 'house', 'condo', 'studio', 'apartment_building', 'residential_building', 'residential_complex', 'mixed_use', 'dormitory', 'building'])) cats.add('home');
  if (has(['hospital', 'clinic', 'medical_facility', 'health_center', 'urgent_care'])) cats.add('medical');
  if (has(['jail', 'prison'])) cats.add('jail_prison');
  if (has(['unhoused_living_space', 'park', 'street', 'public_square_plaza', 'courtyard'])) cats.add('outdoor');
  return [...cats];
}

/** Every venue type the selected additional categories make available, grouped for display. */
export function venueTypeGroupsForCategories(categories = []) {
  return (categories || [])
    .map((category) => ({
      label: CATEGORY_LABELS[category] || category,
      types: SUBTYPE_OPTIONS[category] || [],
    }))
    .filter((group) => group.types.length > 0);
}

/** The same venue types as one flat list — what the picker offers in total. */
export function venueTypesForCategories(categories = []) {
  return [...new Set(venueTypeGroupsForCategories(categories).flatMap((g) => g.types))];
}

/**
 * How a Generic parent's internal spaces are named. The parent's whole-space row always
 * describes the PARENT (Whole city, Whole building, Whole property); the rows beneath it
 * are the spaces themselves, named for what the selected child categories make them.
 */
export function getGenericUnitKind(location) {
  const selected = getAdditionalCategories(location);
  const effective = selected.length > 0 ? selected : inferredCategories(location);
  const whole = getWholeSpaceLabel(location);
  if (effective.includes('medical') && !effective.includes('home')) {
    return {
      label: 'Room',
      plural: 'Patient Rooms',
      heading: 'Patient Room',
      none: whole,
      unassigned: 'No room assigned',
      placeholder: 'e.g. 204, ICU-3...',
      emptyHint: 'Patients at this facility can be assigned to a patient room.',
      contextNoun: 'property',
    };
  }
  if (effective.includes('jail_prison') && !effective.includes('home')) {
    return {
      label: 'Cell',
      plural: 'Cells',
      heading: 'Cell',
      none: whole,
      unassigned: 'No cell assigned',
      placeholder: 'e.g. B2, Cellblock C...',
      emptyHint: 'Incarcerated characters at this facility can be assigned to a cell.',
      contextNoun: 'property',
    };
  }
  return {
    label: 'Apartment',
    plural: 'Apartments',
    heading: 'Apartment',
    none: whole,
    unassigned: 'No apartment assigned',
    placeholder: 'e.g. Apartment 1, Unit 4B...',
    emptyHint: 'Add residents to this location first, then create each apartment or house they live in.',
    contextNoun: 'property',
  };
}