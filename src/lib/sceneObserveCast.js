/**
 * WHICH CHARACTERS ARE IN THE OBSERVED MOMENT — published once, read by the invitation
 * list.
 *
 * In an observed scene the observer chooses the cast on screen. That selection already
 * exists in the Scenes page; this only makes the same selection readable by the Invite
 * Character list, so familiarity is judged against the participants actually selected —
 * never against everyone who happens to be in the building.
 *
 * It holds no copy of a record and no relationship data: only the cast that is on
 * screen right now.
 */

let observeCast = [];

export function setSceneObserveCast(cast) {
  observeCast = Array.isArray(cast) ? cast : [];
}

export function getSceneObserveCast() {
  return observeCast;
}