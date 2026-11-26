/**
 * venueZoneOptions.js — which rooms / zones a venue type makes available.
 *
 * Pure data plus two lookups. Every zone name here is an established name already used by
 * the matching category in ZONE_PRESETS — this does not invent a second room catalogue and
 * it never creates a zone. It only decides which existing zone OPTIONS the Rooms / Zones
 * picker offers for a Generic property, and which single venue type owns a space once the
 * user has actually configured it.
 */

import { ZONE_PRESETS } from "./locationFormConfig.js";

const Z = ZONE_PRESETS;

// Spaces of a building shell, and of a courtroom. Both are zone names the user can already
// type by hand; these are the options offered, never anything created automatically.
const BUILDING_SHELL = ["Lobby", "Hallway", "Elevator", "Stairwell", "Entrance"];
const COURTROOM = [
  "Courtroom",
  "Judge's Chambers",
  "Jury Room",
  "Gallery",
  "Holding Cell",
  "Reception",
  "Hallway",
  "Entrance",
];

export const VENUE_ZONE_OPTIONS = {
  // Settlement and outdoor spaces
  city: Z.outdoor,
  district: Z.outdoor,
  neighborhood: Z.outdoor,
  slums: Z.outdoor,
  campus: Z.outdoor,
  park: Z.outdoor,
  street: Z.outdoor,
  public_square_plaza: Z.outdoor,
  courtyard: Z.outdoor,
  // Buildings and residences
  building: [...BUILDING_SHELL, ...Z.home],
  residential_building: [...BUILDING_SHELL, ...Z.home],
  apartment_building: [...BUILDING_SHELL, ...Z.home],
  residential_complex: [...BUILDING_SHELL, ...Z.home],
  mixed_use: [...BUILDING_SHELL, ...Z.home, ...Z.business],
  apartment: Z.home,
  studio_apartment: Z.home,
  house: Z.home,
  condo: Z.home,
  dormitory: Z.home,
  // Commercial and employment
  business: Z.business,
  commercial_building: Z.business,
  store_retail: Z.business,
  office: Z.business,
  restaurant: Z.food_drink,
  cafe: Z.food_drink,
  // Medical
  hospital: Z.medical,
  medical_facility: Z.medical,
  clinic: Z.medical,
  health_center: Z.medical,
  // Government and correctional
  government_facility: Z.government,
  city_hall: Z.government,
  police_station: [...Z.government, "Holding Cell"],
  courthouse: COURTROOM,
  jail: Z.jail_prison,
  prison: Z.jail_prison,
};

function normalizeTypes(types) {
  const raw = Array.isArray(types) ? types : [types];
  return raw.filter(Boolean).map((t) => String(t).toLowerCase().replace(/[\s\-&]+/g, "_"));
}

/**
 * Every zone option the selected venue types make available, in selection order, without
 * duplicates. Adding another venue type only ever adds to this list. Falls back to the
 * plain Generic baseline when no venue type is selected.
 */
export function zoneOptionsForVenueTypes(types) {
  const options = [];
  const push = (list) => (list || []).forEach((z) => { if (!options.includes(z)) options.push(z); });
  normalizeTypes(types).forEach((t) => push(VENUE_ZONE_OPTIONS[t]));
  if (options.length === 0) push(Z.generic);
  return options;
}

/**
 * The selected venue types whose own spaces include this zone. Tells an ambiguous space
 * many venues share (a hallway, an office) apart from a distinctive one (a patient room,
 * a courtroom).
 */
export function venueTypesForZone(types, zoneName) {
  const zone = String(zoneName || "").trim().toLowerCase();
  if (!zone) return [];
  return normalizeTypes(types).filter((t) =>
    (VENUE_ZONE_OPTIONS[t] || []).some((z) => z.toLowerCase() === zone)
  );
}

/**
 * The venue narrowed to the one venue type that owns this space — only for a Generic
 * property carrying several venue types, and only when exactly one of them owns the space.
 * Ambiguous, unselected or unrecognized spaces return the venue unchanged, so the rest of
 * the property keeps the behaviour it already had.
 */
export function resolveZoneVenue(venue, activeZone) {
  if (!venue || String(venue.category || "").toLowerCase() !== "generic") return venue;
  const types = normalizeTypes(venue.subtype);
  if (types.length < 2 || !activeZone) return venue;
  const owners = venueTypesForZone(types, activeZone);
  if (owners.length !== 1) return venue;
  return { ...venue, subtype: [owners[0]] };
}