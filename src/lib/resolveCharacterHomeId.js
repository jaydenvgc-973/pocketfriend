/**
 * Sleep-eligibility check based on location capabilities, not just category.
 * Mirrors isValidSleepLocation in enforceCharacterLocationPresence.
 * A location is sleep-eligible if its category is inherently sleep-permitting
 * OR it contains a residential/community environment.
 */
const SLEEP_ELIGIBLE_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'generic',
  'jail_prison', 'transportation',
]);
const SLEEP_PERMITTING_ENV_TYPES = new Set(['residential', 'community']);

export function isSleepEligibleLocation(loc) {
  if (!loc) return false;
  if (SLEEP_ELIGIBLE_CATEGORIES.has(loc.category)) return true;
  if (Array.isArray(loc.environments)) {
    return loc.environments.some(env => SLEEP_PERMITTING_ENV_TYPES.has(env.type));
  }
  return false;
}

/**
 * Resolves the authoritative home location ID for a character.
 * Checks all known home field paths, then falls back to scanning
 * location resident lists (handles cases where DB field is empty
 * but Locations page shows the assignment).
 *
 * Returns { homeId, homeName } — both may be null for homeless characters.
 */
export function resolveCharacterHomeId(char, locationsData = []) {
  // 1. Check all character-level home fields
  const homeId =
    char.current_home_location_id ||
    char.home_location_id ||
    char.residence_id ||
    char.assigned_residence ||
    null;

  if (homeId) {
    const loc = locationsData.find(l => l.id === homeId);
    return { homeId, homeName: loc?.name || 'Home' };
  }

  // 2. Scan location resident lists as fallback — include sleep-eligible locations
  for (const loc of locationsData) {
    if (!isSleepEligibleLocation(loc)) continue;
    const inResidents = (loc.resident_character_ids || []).includes(char.id);
    const inResidentsArr = (loc.residents || []).some(r => r.character_id === char.id);
    if (inResidents || inResidentsArr) {
      return { homeId: loc.id, homeName: loc.name };
    }
  }

  // 3. No home found — safe away state
  return { homeId: null, homeName: null };
}