/**
 * sceneBackgroundPopulation
 *
 * Background people of the venue the characters are in. This is NOT a new NPC
 * system: it reads the NPCs the Scene page already derives from the location's
 * category, zones, staff and venue definitions, and decides which of them are
 * ordinary background population for the CURRENT zone.
 *
 * Private and staff-only zones get none. A private residence gets none.
 */

// Zones where ordinary members of the public are not present. Staff-only areas may
// still contain their own employees (they arrive through the existing staff paths),
// but no random background crowd is added here.
const PRIVATE_OR_STAFF_ONLY_ZONE = /(patient room|private room|exam room|treatment room|icu|operating|bedroom|bathroom|restroom|shower|dressing|locker|changing room|cell\b|cell block|holding|storage|stockroom|stock room|supply room|office|break room|staff only|employees only|kitchen|backstage|utility|maintenance|garage|vault|safe room|interview room)/i;

export function isPrivateSceneZone(zoneName) {
  if (!zoneName) return false;
  return PRIVATE_OR_STAFF_ONLY_ZONE.test(String(zoneName));
}

/**
 * Whether this zone is a private living space.
 *
 * A school holds both shared school spaces and private student living quarters. The
 * private ones are the spaces the property's OWN housing assignments point at — the zone
 * a dorm room, studio apartment or apartment is shown as (Places > Dorm Rooms /
 * Apartments) — plus any zone that is a living space by its own name. Shared school zones
 * keep their ordinary ambient students and staff exactly as before: nothing here
 * reclassifies a zone, and no assignment is read as anything but itself.
 */
export function isPrivateResidentialZone(location, zoneName) {
  if (!location || !zoneName) return false;
  if (isPrivateSceneZone(zoneName)) return true;
  const zone = String(zoneName).trim().toLowerCase();
  if ((location.residential_units || []).some((u) => u?.zone_name && String(u.zone_name).trim().toLowerCase() === zone)) return true;
  return location.category === 'school' && /(dorm|studio|apartment|suite|residence|bedroom)/i.test(zone);
}

/**
 * The ordinary background people who would be here right now.
 * Only NPC placeholders already derived for this location are used — established
 * characters come through the authoritative presence system, never from here.
 */
export function buildBackgroundPopulation({ npcs = [], isHomeLocation = false, isRestrictedEnv = false, isPrivateSpace = false, activeZone = null, limit = 6 }) {
  if (isHomeLocation || isRestrictedEnv || isPrivateSpace) return [];
  if (isPrivateSceneZone(activeZone)) return [];
  return (npcs || [])
    .filter((n) => n && n.id && n.name && n.isNpc === true)
    .slice(0, limit)
    .map((n) => ({ id: n.id, name: n.name, role: n.role || n.npcType || 'person' }));
}

function describeOne(person) {
  if (!person) return '';
  const role = person.role ? String(person.role).toLowerCase() : '';
  return role ? `${person.name} (${role})` : person.name;
}

/** Prompt-ready description of the population, for the scene image. */
export function describeBackgroundPopulation(population = []) {
  return (population || []).filter(Boolean).map(describeOne).join(', ');
}