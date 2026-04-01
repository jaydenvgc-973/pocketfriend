/**
/**
 * spatialAwareness.js
 *
 * Utilities for detecting when multiple characters are at the same location
 * and generating shared-space context strings for AI prompts and UI.
 *
 * Covers: work, school/education, religion, gym, home, and any keyword-matched location.
 * Used by: Chat, character card logic, autonomy, and schedule checks.
 */

import { isCharacterAtWork, isCharacterAtSchool, isCharacterAtReligiousLocation, isCharacterAtGym } from './workScheduleUtils';

/**
 * Given a list of characters and a list of all locations,
 * returns a map of locationId → array of { id, name, role } who are "there" right now.
 *
 * Role values: 'worker' | 'student' | 'worshipper' | 'gym_member' | 'resident' | 'visitor'
 */
export function buildSpatialOccupancyMap(characters, locations) {
  const occupancy = {}; // locationId → [{ id, name, role }]

  const addOccupant = (locId, char, role) => {
    if (!locId) return;
    if (!occupancy[locId]) occupancy[locId] = [];
    if (!occupancy[locId].some(o => o.id === char.id)) {
      occupancy[locId].push({ id: char.id, name: char.name, role });
    }
  };

  for (const char of characters) {
    const activity = (char.current_activity || '').toLowerCase();

    // ── Work location ──────────────────────────────────────────────────────
    if (char.occupation_location_id) {
      const workLoc = locations.find(l => l.id === char.occupation_location_id);
      const workKeywords = ['work', 'at work', 'working', 'shift', 'on the clock', 'at the office', 'clocked in'];
      const activityImpliesWork = workKeywords.some(k => activity.includes(k));
      if (activityImpliesWork || isCharacterAtWork(char, workLoc || null)) {
        addOccupant(char.occupation_location_id, char, 'worker');
      }
    }

    // Additional occupation locations
    if (char.additional_occupation_locations?.length > 0) {
      for (const extra of char.additional_occupation_locations) {
        if (extra.location_id) {
          const extraLoc = locations.find(l => l.id === extra.location_id);
          if (isCharacterAtWork(char, extraLoc || null)) {
            addOccupant(extra.location_id, char, 'worker');
          }
        }
      }
    }

    // ── Education / School location ────────────────────────────────────────
    if (char.education_location_id) {
      const eduLoc = locations.find(l => l.id === char.education_location_id);
      const schoolResult = isCharacterAtSchool(char, eduLoc || null);
      if (schoolResult.attending) {
        addOccupant(char.education_location_id, char, 'student');
      }
    }

    // Additional education locations
    if (char.additional_education_locations?.length > 0) {
      for (const extra of char.additional_education_locations) {
        if (extra.location_id) {
          const extraLoc = locations.find(l => l.id === extra.location_id);
          const result = isCharacterAtSchool(char, extraLoc || null);
          if (result.attending) addOccupant(extra.location_id, char, 'student');
        }
      }
    }

    // ── Religion location ──────────────────────────────────────────────────
    const religionLoc = locations.find(l =>
      l.category === 'religion' && !l.is_default_generic
    );
    if (religionLoc) {
      const religiousResult = isCharacterAtReligiousLocation(char, religionLoc);
      if (religiousResult.attending) {
        addOccupant(religionLoc.id, char, 'worshipper');
      }
    }

    // ── Gym membership ─────────────────────────────────────────────────────
    const gymLoc = locations.find(l => l.category === 'gym' && l.gym_members?.includes(char.id));
    if (gymLoc && isCharacterAtGym(char, gymLoc)) {
      addOccupant(gymLoc.id, char, 'gym_member');
    }

    // ── Home / Residential ─────────────────────────────────────────────────
    const homeLoc = locations.find(l =>
      (l.category === 'home' || l.category === 'generic') &&
      l.resident_character_ids?.includes(char.id)
    );
    if (homeLoc) {
      const homeKeywords = ['home', 'apartment', 'house', 'winding down', 'morning routine', 'cooking', 'cleaning', 'resting', 'at home'];
      if (homeKeywords.some(k => activity.includes(k))) {
        addOccupant(homeLoc.id, char, 'resident');
      }
    }

    // ── Keyword-based location matching ────────────────────────────────────
    for (const loc of locations) {
      const keywords = loc.keywords || [];
      const locName = (loc.name || '').toLowerCase();
      const isMatch =
        keywords.some(kw => activity.includes(kw.toLowerCase())) ||
        activity.includes(locName);

      if (isMatch) {
        addOccupant(loc.id, char, 'visitor');
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
      others.forEach(o => companions.push({ ...o, locationId }));
    }
  }
  return companions;
}

/**
 * Builds a natural-language spatial context string for AI prompts.
 * e.g. "Alex and Jordan are also at Generic Park right now."
 * Includes roles: "Alex is also working at Downtown Gym right now."
 */
export function buildSpatialContextString(characterId, occupancyMap, locations) {
  const companions = getSharedSpaceCompanions(characterId, occupancyMap);
  if (companions.length === 0) return '';

  const grouped = {}; // locationId → [{ name, role }]
  for (const c of companions) {
    if (!grouped[c.locationId]) grouped[c.locationId] = [];
    grouped[c.locationId].push({ name: c.name, role: c.role });
  }

  const roleVerb = (role, locCategory) => {
    if (role === 'worker') return 'also working at';
    if (role === 'student') return 'also attending';
    if (role === 'worshipper') return 'also at';
    if (role === 'gym_member') return 'also at';
    if (role === 'resident') return 'also home at';
    return 'also at';
  };

  const parts = [];
  for (const [locId, people] of Object.entries(grouped)) {
    const loc = locations.find(l => l.id === locId);
    const locName = loc?.name || 'the same place';
    const locCategory = loc?.category || '';
    if (people.length === 1) {
      parts.push(`${people[0].name} is ${roleVerb(people[0].role, locCategory)} ${locName} right now`);
    } else {
      const names = people.map(p => p.name);
      const nameStr = names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      parts.push(`${nameStr} are also at ${locName} right now`);
    }
  }

  return parts.join('. ') + (parts.length > 0 ? '.' : '');
}

/**
 * Checks if two specific characters share any current location.
 * Returns { shared: bool, locationName: string | null, locationId: string | null }
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