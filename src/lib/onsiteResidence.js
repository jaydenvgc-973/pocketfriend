/**
 * ON-SITE RESIDENCE — a residential environment inside a business property.
 *
 * Pocketfriend already stores mixed-use environments on the location record itself
 * (`environments[]`, maintained by the Places page). A residential parent property uses
 * that same field to hold the workspaces inside it; this reads it the other way round:
 * a business property that contains a designated living space.
 *
 * Nothing here creates, assigns, infers or reclassifies anything. A residence exists only
 * when the user explicitly configured a residential environment on a non-home location.
 * The parent keeps its own category, operating hours, staff and operational zones.
 */

/** The residence environment configured on this property, or null. Never inferred. */
export function getOnSiteResidence(location) {
  if (!location || location.category === 'home') return null;
  const environments = Array.isArray(location.environments) ? location.environments : [];
  return environments.find((env) => env?.type === 'residential' && env?.id) || null;
}

/** Whether this property contains an On-Site Residence at all. */
export function hasOnSiteResidence(location) {
  return getOnSiteResidence(location) !== null;
}

/** The residence's own name, or null. */
export function getOnSiteResidenceName(location) {
  return getOnSiteResidence(location)?.name || null;
}

/**
 * Whether a zone belongs to the residence.
 * A zone the user never assigned to the residence is a business zone, exactly as before.
 */
export function isOnSiteResidenceZone(location, zoneName) {
  const residence = getOnSiteResidence(location);
  if (!residence || !zoneName) return false;
  const zone = String(zoneName).trim().toLowerCase();
  return (residence.zone_names || []).some((z) => String(z).trim().toLowerCase() === zone);
}

/** The residence's zones as the location already stores them, in Places order. */
export function getOnSiteResidenceZones(location) {
  const residence = getOnSiteResidence(location);
  if (!residence) return [];
  const assigned = new Set((residence.zone_names || []).map((z) => String(z).trim().toLowerCase()));
  return (location.zones || []).filter((z) => z?.zone_name && assigned.has(String(z.zone_name).trim().toLowerCase()));
}