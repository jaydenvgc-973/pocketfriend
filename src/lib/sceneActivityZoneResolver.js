/**
 * sceneActivityZoneResolver
 *
 * WHERE AN ACTIVITY HAPPENS INSIDE A PROPERTY.
 *
 * A property is not one room. A residence keeps its apartments in `residential_units`, a
 * mixed-use building its businesses in `workplaces`, a mixed-use property its configured
 * `environments` — each already carrying the zones (and therefore the reference images)
 * Places assigned to it. An activity must be performed in the room of the space the scene
 * is actually in, never in a same-named room belonging to somebody else's space.
 *
 * The previous resolution had no idea which space the scene was in: it matched the
 * activity's room title against every zone on the whole property, so a residence whose
 * kitchen is called "Kitchen (Ashwood)" got another residence's "Kitchen" — the first
 * exact title in the property's zone list — and the picture showed that other kitchen.
 *
 * This module only READS the existing assignments. Nothing is created, moved, renamed,
 * reassigned or copied, and no new location data is introduced.
 *
 * Priority, per the activity:
 *   1. an appropriate zone of the space the scene is in;
 *   2. an appropriate SHARED facility of the property (a zone no space owns);
 *   3. nothing — the activity happens where the characters already are.
 */
import { getResidentialUnits } from '@/lib/residentialUnits';
import { getLocationWorkplaces, getWorkplaceById } from '@/lib/locationWorkspaces';

const norm = (value) => String(value ?? '').trim().toLowerCase();

// Words that name a kind of space but identify no particular one.
const GENERIC_WORDS = new Set(['room', 'rooms', 'area', 'floor', 'space', 'the', 'and', 'of', 'in']);

// Different places title the same kind of room differently. These are search terms for the
// activity's own room, used only INSIDE the space that is being resolved — they never
// decide which space a room belongs to.
const ROOM_SYNONYMS = {
  kitchen: ['kitchen', 'galley', 'scullery', 'cookhouse'],
  'living room': ['living', 'lounge', 'den', 'family room', 'sitting room', 'front room', 'great room', 'common room', 'rec room', 'tv room'],
  bedroom: ['bedroom', 'bed room', 'sleeping area', 'primary suite', 'master suite', 'bunk'],
  bathroom: ['bath', 'shower', 'powder room', 'washroom', 'restroom', 'toilet', 'en suite', 'ensuite', 'lavatory'],
  'dining area': ['dining', 'breakfast', 'eating area', 'mess hall'],
  garage: ['garage', 'carport'],
  study: ['study', 'office', 'desk'],
};

/** Every zone name a residential unit was given, in the user's own order. */
function unitZoneNames(unit) {
  const names = [...(unit?.zone_names || [])];
  if (unit?.zone_name && !names.some((n) => norm(n) === norm(unit.zone_name))) names.push(unit.zone_name);
  return names.filter(Boolean);
}

const dedupe = (names = []) => {
  const seen = new Set();
  return names.filter((n) => {
    const key = norm(n);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The space the scene is actually inside — an apartment / room / cell, a workplace, or a
 * configured environment — with the zones that space owns. Null when the whole property is
 * the scene, which keeps the property-level behaviour exactly as it was.
 */
export function getOccupiedSpace(location, spaceId = null, activeZone = null) {
  if (!location) return null;

  if (spaceId) {
    const workplace = getWorkplaceById(location, spaceId);
    if (workplace) {
      return {
        spaceId,
        kind: 'workplace',
        label: workplace.name,
        zoneNames: dedupe(workplace.zone_names || []),
      };
    }
    const unit = getResidentialUnits(location).find((u) => u.unit_id === spaceId);
    if (unit) {
      return { spaceId, kind: 'unit', label: unit.unit_name, zoneNames: dedupe(unitZoneNames(unit)) };
    }
  }

  // No space was chosen: the zone the scene is standing in can name the space itself. A
  // scene inside "Kitchen (Ashwood)" is inside the space that owns that kitchen.
  const zone = norm(activeZone);
  if (!zone) return null;

  const unit = getResidentialUnits(location).find((u) => unitZoneNames(u).some((n) => norm(n) === zone));
  if (unit) {
    return { spaceId: unit.unit_id, kind: 'unit', label: unit.unit_name, zoneNames: dedupe(unitZoneNames(unit)) };
  }

  const workplace = getLocationWorkplaces(location).find((w) =>
    (w.zone_names || []).some((n) => norm(n) === zone)
  );
  if (workplace) {
    return {
      spaceId: `workspace:${workplace.workplace_id}`,
      kind: 'workplace',
      label: workplace.name,
      zoneNames: dedupe(workplace.zone_names || []),
    };
  }

  const environment = (location.environments || []).find((e) =>
    (e.zone_names || []).some((n) => norm(n) === zone)
  );
  if (environment) {
    return {
      spaceId: `environment:${environment.id}`,
      kind: 'environment',
      label: environment.name,
      zoneNames: dedupe(environment.zone_names || []),
    };
  }

  return null;
}

/**
 * The property's SHARED facilities: zones that belong to no apartment, room, workplace or
 * environment. A communal bathroom, a portable shower, a shared laundry, a common room —
 * all of them are exactly this. A room some space owns is never shared, so another
 * household's kitchen can never be reached this way.
 *
 * A property that declares internal spaces but has assigned no zones to any of them cannot
 * tell a shared room from a private one, so nothing is treated as shared there — the
 * activity simply happens where the characters already are rather than in a stranger's room.
 */
export function getSharedZoneNames(location) {
  if (!location) return [];
  const assigned = new Set();
  (location.residential_units || []).forEach((u) => unitZoneNames(u).forEach((n) => assigned.add(norm(n))));
  getLocationWorkplaces(location).forEach((w) => (w.zone_names || []).forEach((n) => assigned.add(norm(n))));
  (location.environments || []).forEach((e) => (e.zone_names || []).forEach((n) => assigned.add(norm(n))));

  const hasSpaces =
    (location.residential_units || []).length > 0 || getLocationWorkplaces(location).length > 0;
  if (hasSpaces && assigned.size === 0) return [];

  return (location.zones || [])
    .map((z) => z?.zone_name)
    .filter((n) => n && !assigned.has(norm(n)));
}

/** The search terms for the room this activity needs. */
function intentKeywords(action) {
  const words = new Set();
  const wanted = norm(action?.suggested_zone);
  if (wanted) {
    (ROOM_SYNONYMS[wanted] || []).forEach((w) => words.add(w));
    wanted
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w))
      .forEach((w) => words.add(w));
  }
  (action?.zone_hints || []).map(norm).filter(Boolean).forEach((h) => words.add(h));
  return [...words];
}

/** The zone among `names` that serves this activity, or null. */
function matchZone(names, action) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return null;

  const wanted = norm(action?.suggested_zone);
  if (wanted) {
    const exact = list.find((n) => norm(n) === wanted);
    if (exact) return exact;
  }

  // Hints are listed by the activity from most to least specific, so they are tried in that
  // order: a shower finds a shower before it settles for a bathroom, and only when no
  // shower exists anywhere does it accept the bathroom.
  const hints = (action?.zone_hints || []).map(norm).filter(Boolean);
  for (const hint of hints) {
    const hit = list.find((n) => norm(n).includes(hint));
    if (hit) return hit;
  }

  const keywords = intentKeywords(action).filter((k) => !hints.includes(k));
  return list.find((n) => keywords.some((k) => norm(n).includes(k))) || null;
}

/**
 * The zone this activity is performed in.
 *
 * Returns null when the scene is not inside a specific space — the caller keeps the
 * property-level resolution it has always used. Otherwise it always returns an answer:
 * `{ zone: name, source: 'space' | 'shared' }` when the activity moves to a room, and
 * `{ zone: null, source: 'current' }` when it happens where the characters already are
 * (no dedicated room here and no accessible shared one).
 */
export function resolveActivityZone(location, { spaceId = null, activeZone = null, action } = {}) {
  if (!location || !action) return null;

  const space = getOccupiedSpace(location, spaceId, activeZone);
  // A space with no zones of its own has nothing to scope to: property-level behaviour,
  // unchanged. (A jail cell, a legacy room with no assigned zones.)
  if (!space || space.zoneNames.length === 0) return null;

  const inSpace = matchZone(space.zoneNames, action);
  if (inSpace) return { zone: inSpace, source: 'space' };

  const shared = getSharedZoneNames(location).filter(
    (n) => !space.zoneNames.some((own) => norm(own) === norm(n))
  );
  const inShared = matchZone(shared, action);
  if (inShared) return { zone: inShared, source: 'shared' };

  // No dedicated room and no shared one: the activity is performed in the space they are
  // already in, using what is actually there. It is never redirected to another space.
  return { zone: null, source: 'current' };
}