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

import { isUnhousedLivingSpace } from "./unhousedLivingSpace.js";

const sameZone = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export function physicalSettingFor(location, zoneName) {
  if (!location) return null;
  if (isUnhousedLivingSpace(location)) return "outdoor";

  if (zoneName) {
    const workplace = (location.workplaces || []).find((w) =>
      (w.zone_names || []).some((n) => sameZone(n, zoneName))
    );
    if (workplace?.physical_setting) return workplace.physical_setting;

    const unit = (location.residential_units || []).find((u) => sameZone(u.zone_name, zoneName));
    if (unit?.physical_setting) return unit.physical_setting;
  }

  return location.physical_setting || null;
}