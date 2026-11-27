/**
 * WHICH SPACE THE SCENE IS IN — published once, read by every picture.
 *
 * The Scenes page already knows the exact space on screen: the property, the unit or
 * workplace inside it, and the room. `useSceneSpaceImage` receives that space key on every
 * render, so it is the one place that publishes it here — no image path has to re-derive it
 * from the cast, the URL or a guess.
 *
 * This holds only the ID of the configured space (a residential unit or a workplace). It
 * is never a description and never a copy of a record: the description is resolved from
 * the live location each time a picture is drawn, so an edit takes effect immediately.
 */

let activeSpaceId = null;

export function setActiveSceneSpaceId(id) {
  activeSpaceId = id || null;
}

export function getActiveSceneSpaceId() {
  return activeSpaceId;
}

/**
 * The space key is `locationId|unitId|zone` — built by the Scenes page. Only the unit part
 * is read, so a zone name that itself contains a separator can never shift it.
 */
export function unitIdFromSpaceKey(spaceKey) {
  const parts = String(spaceKey || "").split("|");
  return parts.length >= 2 ? (parts[1] || null) : null;
}