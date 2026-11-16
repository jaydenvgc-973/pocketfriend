/**
 * WORKSPACES INSIDE ONE LOCATION
 *
 * A mixed-use property keeps the businesses inside it in `workplaces` — already
 * maintained by the Places page: each one its own name, business type, zones and
 * employees. That is the same shape an apartment has inside a building: a space of
 * the property that can be visited on its own.
 *
 * These helpers only READ what Places stores. Nothing here creates, moves, reassigns
 * or infers an assignment, and living in a property never makes anyone an employee.
 *
 * A workspace travels through the existing unit pathway (the `unitId` a visit already
 * carries) under an explicit prefix, so it can never be mistaken for an apartment id.
 */
import { getUnitKind } from '@/lib/residentialUnits';

export const WORKSPACE_SPACE_PREFIX = 'workspace:';

export const toWorkspaceSpaceId = (workplaceId) => `${WORKSPACE_SPACE_PREFIX}${workplaceId}`;

export const isWorkspaceSpaceId = (spaceId) =>
  typeof spaceId === 'string' && spaceId.startsWith(WORKSPACE_SPACE_PREFIX);

/** The businesses configured inside this location, in the order Places lists them. */
export function getLocationWorkplaces(location) {
  return (location?.workplaces || []).filter((w) => w?.workplace_id && w?.name);
}

/** The workplace a visit's `unitId` points at, or null (apartment ids included). */
export function getWorkplaceById(location, spaceId) {
  if (!isWorkspaceSpaceId(spaceId)) return null;
  const workplaceId = spaceId.slice(WORKSPACE_SPACE_PREFIX.length);
  return getLocationWorkplaces(location).find((w) => w.workplace_id === workplaceId) || null;
}

/** The workplace's own space object, shaped like a unit for the existing switcher. */
export function getWorkplaceSpaces(location) {
  return getLocationWorkplaces(location).map((w) => ({
    workspace_id: w.workplace_id,
    name: w.name,
    unit_id: toWorkspaceSpaceId(w.workplace_id),
  }));
}

/**
 * THE ZONE THAT SHOWS THIS WORKPLACE.
 *
 * A workplace's zones are the rooms Places assigned to that business. The first one with
 * its own reference images is the workplace's opening space; a zone the user marked as
 * Part of Main Category is preferred. Another business's zone or an apartment is never
 * substituted.
 */
export function getWorkplaceZoneName(location, workplace) {
  if (!location || !workplace) return null;
  const assigned = new Set(workplace.zone_names || []);
  const zones = (location.zones || []).filter((z) => z?.zone_name && assigned.has(z.zone_name));
  const pick = zones.find((z) => z.is_primary_category === true && (z.image_urls || []).length > 0)
    || zones.find((z) => (z.image_urls || []).length > 0)
    || zones.find((z) => z.is_primary_category === true)
    || zones[0];
  return pick?.zone_name || null;
}

/**
 * The residential zone to return to when a visit leaves a workplace and moves back into
 * the property itself: a zone that belongs to no business. Purely a read of Places.
 */
export function getResidentialZoneName(location) {
  if (!location) return null;
  const workplaceZones = new Set(getLocationWorkplaces(location).flatMap((w) => w.zone_names || []));
  const zones = (location.zones || []).filter((z) => z?.zone_name && !workplaceZones.has(z.zone_name));
  const pick = zones.find((z) => z.is_primary_category === true && (z.image_urls || []).length > 0)
    || zones.find((z) => z.is_primary_category === true)
    || zones.find((z) => (z.image_urls || []).length > 0)
    || zones[0];
  return pick?.zone_name || null;
}

/** How the spaces of this property are grouped in a switcher (Apartments / Rooms / Cells). */
export function getSpaceGroupLabel(location) {
  return getUnitKind(location).plural;
}