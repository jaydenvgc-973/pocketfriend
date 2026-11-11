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
 * The ordinary background people who would be here right now.
 * Only NPC placeholders already derived for this location are used — established
 * characters come through the authoritative presence system, never from here.
 */
export function buildBackgroundPopulation({ npcs = [], isHomeLocation = false, isRestrictedEnv = false, activeZone = null, limit = 6 }) {
  if (isHomeLocation || isRestrictedEnv) return [];
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