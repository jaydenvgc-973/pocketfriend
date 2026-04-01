/**
 * spatialAwareness.js
 * 
 * Utilities for detecting when multiple characters are at the same location
 * and generating shared-space context strings for AI prompts and UI.
 * 
 * Used by: Chat, character card logic, autonomy, and schedule checks.
 */

/**
 * Given a list of characters and a list of all locations,
 * returns a map of locationId → array of character names who are "there" right now.
 * 
 * Uses current_activity text to infer location, or checks occupation/home location IDs.
 */
export function buildSpatialOccupancyMap(characters, locations) {
  const occupancy = {}; // locationId → [{ id, name }]

  for (const char of characters) {
    const activity = (char.current_activity || '').toLowerCase();

    // Check if character is at their workplace
    if (char.occupation_location_id) {
      const workKeywords = ['work', 'at work', 'working', 'shift', 'on the clock', 'at the office', 'clocked in'];
      if (workKeywords.some(k => activity.includes(k))) {
        const locId = char.occupation_location_id;
        if (!occupancy[locId]) occupancy[locId] = [];
        occupancy[locId].push({ id: char.id, name: char.name, role: 'worker' });
      }
    }

    // Check matched locations by keyword
    for (const loc of locations) {
      const keywords = loc.keywords || [];
      const locName = (loc.name || '').toLowerCase();
      const isMatch =
        keywords.some(kw => activity.includes(kw.toLowerCase())) ||
        activity.includes(locName);

      if (isMatch) {
        if (!occupancy[loc.id]) occupancy[loc.id] = [];
        // Avoid duplicates
        if (!occupancy[loc.id].some(o => o.id === char.id)) {
          occupancy[loc.id].push({ id: char.id, name: char.name, role: 'visitor' });
        }
      }
    }
  }

  return occupancy;
}

/**
 * Given a character and the full occupancy map + locations,
 * returns an array of other characters who are at the same location.
 * Returns [] if none.
 */
export function getSharedSpaceCompanions(characterId, occupancyMap) {
  const companions = [];
  for (const [locationId, occupants] of Object.entries(occupancyMap)) {
    const isHere = occupants.some(o => o.id === characterId);
    if (isHere) {
      const others = occupants.filter(o => o.id !== characterId);
      others.forEach(o => {
        companions.push({ ...o, locationId });
      });
    }
  }
  return companions;
}

/**
 * Builds a natural-language spatial context string for AI prompts.
 * e.g. "Alex and Jordan are also at Generic Park right now."
 */
export function buildSpatialContextString(characterId, occupancyMap, locations) {
  const companions = getSharedSpaceCompanions(characterId, occupancyMap);
  if (companions.length === 0) return '';

  const grouped = {}; // locationId → [names]
  for (const c of companions) {
    if (!grouped[c.locationId]) grouped[c.locationId] = [];
    grouped[c.locationId].push(c.name);
  }

  const parts = [];
  for (const [locId, names] of Object.entries(grouped)) {
    const loc = locations.find(l => l.id === locId);
    const locName = loc?.name || 'the same place';
    const nameStr = names.length === 1 ? names[0]
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    parts.push(`${nameStr} ${names.length > 1 ? 'are' : 'is'} also at ${locName} right now`);
  }

  return parts.join('. ') + '.';
}

/**
 * Checks if two specific characters share any current location.
 * Returns { shared: bool, locationName: string | null }
 */
export function doCharactersShareLocation(charIdA, charIdB, occupancyMap, locations) {
  for (const [locationId, occupants] of Object.entries(occupancyMap)) {
    const hasA = occupants.some(o => o.id === charIdA);
    const hasB = occupants.some(o => o.id === charIdB);
    if (hasA && hasB) {
      const loc = locations.find(l => l.id === locationId);
      return { shared: true, locationName: loc?.name || 'unknown location', locationId };
    }
  }
  return { shared: false, locationName: null, locationId: null };
}

/**
 * Given a character's current_activity text and a list of locations,
 * tries to find the best matching location for that activity.
 * Returns the matched location or null.
 */
export function inferLocationFromActivity(activityText, locations) {
  if (!activityText) return null;
  const lower = activityText.toLowerCase();

  let bestMatch = null;
  let bestScore = 0;

  for (const loc of locations) {
    const locName = (loc.name || '').toLowerCase();
    const keywords = (loc.keywords || []).map(k => k.toLowerCase());

    let score = 0;
    if (lower.includes(locName)) score += 3;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = loc;
    }
  }

  return bestScore >= 1 ? bestMatch : null;
}