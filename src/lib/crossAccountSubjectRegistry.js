/**
 * crossAccountSubjectRegistry
 *
 * Holds the characters from other accounts that are already known to the
 * character whose image is being generated (resolved through the existing
 * contact graph). Image-subject resolution reads this list so a known
 * cross-account character named in the prompt binds to their real identity
 * instead of being treated as an unknown named person.
 *
 * It is a pass-through cache only — it stores no records and decides nothing.
 */
let registry = [];

export function setCrossAccountSubjects(list) {
  registry = Array.isArray(list) ? list.filter(c => c && c.id) : [];
}

export function getCrossAccountSubjects() {
  return registry;
}