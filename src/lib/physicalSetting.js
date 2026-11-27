/**
 * PHYSICAL SETTING — is this space physically indoors or outdoors?
 *
 * A designation the user sets, independent of Location Category, Venue Type, Environment
 * and any parent location. A workspace connected to a building can operate outdoors; a
 * residence connected to a property can sit outside it. It is never inferred: an unset
 * space returns null and behaves exactly as it did before.
 *
 * The most specific established space wins: the business or residence that owns the zone,
 * then the location itself. An Unhoused Living Space is always outdoors.
 */

import { isUnhousedLivingSpace, hasHousedVenueType } from "./unhousedLivingSpace.js";

const sameZone = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export function physicalSettingFor(location, zoneName) {
  if (!location) return null;

  if (zoneName) {
    const workplace = (location.workplaces || []).find((w) =>
      (w.zone_names || []).some((n) => sameZone(n, zoneName))
    );
    if (workplace?.physical_setting) return workplace.physical_setting;

    // A living space's own setting is more specific than the property's: an apartment inside
    // a mixed property keeps its indoor setting, and an outdoor living space is outdoors by
    // the kind of arrangement it is, even before its own setting is recorded.
    const unit = (location.residential_units || []).find(
      (u) => sameZone(u.zone_name, zoneName) || (u.zone_names || []).some((n) => sameZone(n, zoneName))
    );
    if (unit?.physical_setting) return unit.physical_setting;
    if (unit?.living_space_kind === "unhoused_living_space") return "outdoor";
  }

  // Only a place that is wholly an unhoused living space is outdoors by its own kind. A
  // parent that also holds conventional residences keeps its own recorded setting: its
  // apartments and houses are not outdoor spaces.
  if (isUnhousedLivingSpace(location) && !hasHousedVenueType(location)) return "outdoor";

  return location.physical_setting || null;
}