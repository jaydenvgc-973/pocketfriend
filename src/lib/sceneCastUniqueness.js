/**
 * sceneCastUniqueness
 *
 * One person is ONE subject in a scene image.
 *
 * The same individual can reach the image cast more than once: as their own character
 * record, and again as a placeholder (a synthetic npc_ entry from a relative's name or a
 * venue staff key) — or as a stale duplicate record. When that person is the household's
 * caregiver on duty, the picture ends up with the caregiver rendered twice.
 *
 * The role is also never part of the name. A stored name like
 * "Gina (VGC Towers Babysitter)" turns the role into a caption, and a prompt name that
 * reads like a role can invite a second person to fill that role in the frame.
 *
 * This collapses the cast to distinct people and to a clean display name. It is the only
 * place the image cast is normalized, so every prompt block (strict people rule, focus
 * rule, name reference key, sealed bundles) reads the same list of distinct people.
 *
 * Pure — no DB reads, no side effects.
 */

const CAREGIVER_ROLE_RX = /babysit|caregiver|nanny|sitter/i;

/** Display name without a trailing role parenthetical: "Gina (VGC Towers Babysitter)" → "Gina". */
function cleanName(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  const stripped = text.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped || text;
}

/** Matching key: case, punctuation, spacing and role parentheticals do not matter. */
function nameKey(name) {
  return cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isCaregiver(person) {
  return person?.is_sitter === true || CAREGIVER_ROLE_RX.test(String(person?.occupation || ''));
}

/**
 * @param {Array} people - scene participants resolved for the image
 * @returns {Array} distinct people, each with a clean display name
 */
export function dedupeSceneCast(people = []) {
  const seenIds = new Set();
  const seenNames = new Set();
  let caregiverKept = false;
  const out = [];

  for (const person of people || []) {
    if (!person) continue;
    const name = cleanName(person.name || person.display_name);
    if (!name) continue;

    const id = person.id || null;
    if (id && seenIds.has(id)) continue;

    // The same person under a second identity is the same subject, not a second one.
    const key = nameKey(name);
    if (key && seenNames.has(key)) continue;

    // A household has exactly one caregiver on duty — never two caregivers in the frame.
    const caregiver = isCaregiver(person);
    if (caregiver && caregiverKept) continue;

    if (id) seenIds.add(id);
    if (key) seenNames.add(key);
    if (caregiver) caregiverKept = true;

    out.push({ ...person, name });
  }

  return out;
}