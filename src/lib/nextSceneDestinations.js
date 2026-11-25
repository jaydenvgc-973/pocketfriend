/**
 * NEXT SCENE DESTINATIONS — a property and the spaces already inside it.
 *
 * The destination list is not a list of properties only: a property may already contain
 * businesses (a residence with workspaces) or a designated living space (a business with
 * an on-site residence). Both are existing records on the location itself, read here so
 * they can be chosen directly instead of hunting through the parent's zones.
 *
 * Nothing here creates, reclassifies, or reassigns anything:
 * - a workspace comes from the property's own `workplaces` (Places),
 * - a residence comes from a residential `environments` entry the user configured,
 * - a parent keeps its category, hours, staff and residents.
 *
 * Each child resolves to the SAME parent location record plus its own space:
 * a workspace travels through the existing workspace unit pathway, a residence through
 * its existing zone and environment.
 */
import {
  getLocationWorkplaces,
  getWorkplaceZoneName,
  toWorkspaceSpaceId,
} from '@/lib/locationWorkspaces';
import { getOnSiteResidence, getOnSiteResidenceZones } from '@/lib/onsiteResidence';

const normalize = (name) => String(name || '').trim().toLowerCase();

/** The parent's own zones among the given names, in the property's order. */
function zonesAmong(location, names) {
  const wanted = new Set((names || []).map(normalize));
  return (location?.zones || [])
    .map((z) => z?.zone_name)
    .filter((n) => n && wanted.has(normalize(n)));
}

function workspaceChild(location, workplace) {
  const zoneName = getWorkplaceZoneName(location, workplace) || '';
  const zoneNames = zonesAmong(location, workplace.zone_names);
  return {
    key: toWorkspaceSpaceId(workplace.workplace_id),
    name: workplace.name,
    kind: 'workspace',
    kindLabel: 'Business',
    locationId: location.id,
    unitId: toWorkspaceSpaceId(workplace.workplace_id),
    zoneName,
    zoneNames: zoneNames.length > 0 ? zoneNames : (zoneName ? [zoneName] : []),
    environmentId: '',
  };
}

function residenceChild(location) {
  const residence = getOnSiteResidence(location);
  if (!residence) return null;
  const zones = getOnSiteResidenceZones(location);
  const primary = zones.find((z) => (z.image_urls || []).length > 0) || zones[0] || null;
  return {
    key: `residence:${residence.id}`,
    name: residence.name || 'On-Site Residence',
    kind: 'residence',
    kindLabel: 'Residence',
    locationId: location.id,
    unitId: '',
    zoneName: primary?.zone_name || '',
    zoneNames: zones.map((z) => z.zone_name).filter(Boolean),
    environmentId: residence.id,
  };
}

/** Every property with the spaces already established inside it. */
export function buildNextSceneDestinations(locations = []) {
  return (locations || [])
    .filter((l) => l?.id && l?.name)
    .map((location) => ({
      location,
      children: [
        ...getLocationWorkplaces(location).map((w) => workspaceChild(location, w)),
        residenceChild(location),
      ].filter(Boolean),
    }));
}

/**
 * Search the property names and the spaces inside them. A property that matches keeps all
 * its spaces; a space that matches keeps its property as the heading it belongs to.
 */
export function filterNextSceneDestinations(sections = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map(({ location, children }) => {
      if (normalize(location.name).includes(q)) return { location, children };
      const matching = children.filter((c) => normalize(c.name).includes(q));
      return matching.length > 0 ? { location, children: matching } : null;
    })
    .filter(Boolean);
}