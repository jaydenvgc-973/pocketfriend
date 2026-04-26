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

  // 2. Scan location resident lists as fallback
  for (const loc of locationsData) {
    if (loc.category !== 'home' && loc.category !== 'generic') continue;
    const inResidents = (loc.resident_character_ids || []).includes(char.id);
    const inResidentsArr = (loc.residents || []).some(r => r.character_id === char.id);
    if (inResidents || inResidentsArr) {
      return { homeId: loc.id, homeName: loc.name };
    }
  }

  // 3. No home found — safe away state
  return { homeId: null, homeName: null };
}