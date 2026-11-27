/**
 * SPACE DESCRIPTIONS — ONE RESOLVER FOR EVERY CONFIGURED SPACE.
 *
 * A property is not one appearance. The same city holds a bright apartment and a worn
 * house, a maintained clinic and a tired storefront. Each configured residence and
 * workspace may carry its own optional description, and each of its rooms may carry one
 * of its own — all of it stored on the space that already exists, never as a second
 * image collection and never copied from another space.
 *
 * THE HIERARCHY (most specific first):
 *   1. the exact room of this exact space  (unit/workspace zone_descriptions)
 *   2. the exact space                     (unit/workspace description)
 *   3. the shared zone's own description   (property zones[].zone_description)
 *   4. the parent location                 (location.description)
 *   5. nothing — the existing default context (category, venue type, zone, images)
 *
 * A description never changes what a place IS. It adds appearance, condition and
 * atmosphere only; the reference images stay the authority on layout and identity.
 */

const normalize = (name) => String(name || "").trim().toLowerCase();

export function uniqueUrls(urls = []) {
  return [...new Set((urls || []).filter(Boolean))];
}

/** This exact room's own description, when the space has one for that room. */
export function roomDescription(space, zoneName) {
  const key = normalize(zoneName);
  if (!key || !space) return "";
  const entry = (space.zone_descriptions || []).find(z => normalize(z?.zone_name) === key);
  return String(entry?.description || "").trim();
}

/** The space's own description — the apartment, house, unit or workspace. */
export function spaceDescription(space) {
  return String(space?.description || "").trim();
}

/** A property zone's own established description, shared by every space that uses it. */
export function zoneDescription(zones = [], zoneName) {
  const key = normalize(zoneName);
  if (!key) return "";
  const zone = (zones || []).find(z => normalize(z?.zone_name) === key);
  return String(zone?.zone_description || "").trim();
}

/**
 * Resolves the description an image of this space must be composed from.
 * Returns { text, source } — source is 'room' | 'space' | 'zone' | 'location' | 'none',
 * so a caller can tell whether the text is actually specific to the selected space.
 */
export function resolveSpaceDescription({ space = null, zoneName = "", zones = [], locationDescription = "" } = {}) {
  const room = roomDescription(space, zoneName);
  if (room) return { text: room, source: "room" };
  const own = spaceDescription(space);
  if (own) return { text: own, source: "space" };
  const zone = zoneDescription(zones, zoneName);
  if (zone) return { text: zone, source: "zone" };
  const parent = String(locationDescription || "").trim();
  if (parent) return { text: parent, source: "location" };
  return { text: "", source: "none" };
}

/** The reference images that belong to ONE room of this space (own first, then shared). */
export function spaceZoneImageUrls({ space = null, zoneName = "", zones = [] } = {}) {
  const key = normalize(zoneName);
  const own = (space?.zone_images || []).filter(i => i?.url && normalize(i.zone_name) === key).map(i => i.url);
  const shared = ((zones || []).find(z => normalize(z?.zone_name) === key)?.image_urls) || [];
  return uniqueUrls([...own, ...shared]);
}

/** Every reference image of this space — all of its own rooms, then their shared sets. */
export function spaceImageUrls({ space = null, zones = [] } = {}) {
  const own = (space?.zone_images || []).map(i => i?.url);
  const names = (space?.zone_names?.length ? space.zone_names : (space?.zone_name ? [space.zone_name] : []));
  const shared = (zones || [])
    .filter(z => names.some(n => normalize(n) === normalize(z?.zone_name)))
    .flatMap(z => z.image_urls || []);
  return uniqueUrls([...own, ...shared]);
}

/**
 * The room list with this room's description replaced or removed. Never touches another
 * room's entry and never creates one for a room the space does not have.
 */
export function withRoomDescription(space, zoneName, text) {
  const key = normalize(zoneName);
  const list = (space?.zone_descriptions || []).filter(z => normalize(z?.zone_name) !== key);
  const value = String(text || "");
  if (value.trim()) list.push({ zone_name: zoneName, description: value });
  return list;
}

/**
 * The prompt block that carries a space's own description into an image request.
 * Empty when there is nothing specific to say — the existing context then stands alone.
 */
export function buildSpaceDescriptionNote({ description = "", label = "this space", kind = "space" } = {}) {
  const text = String(description || "").trim();
  if (!text) return "";
  return ` ESTABLISHED ${kind.toUpperCase()} — AUTHORITATIVE FOR APPEARANCE: ${label} is: "${text}" ` +
    `Render this exact appearance, condition, furnishing and atmosphere, and keep it consistent picture after picture. ` +
    `It adds detail only: it never overrides the layout, structures and identity shown in the reference images, never moves this moment into another room or another place, and never changes what kind of place this is.`;
}