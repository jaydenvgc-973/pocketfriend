/**
 * MAP COORDINATES ENGINE
 * Assigns and persists normalized (0-100) map positions for every location.
 * Positions are zone-based by location type, collision-avoided, and saved permanently.
 */

const MAP_TYPE_ZONES = {
  residential:   { xMin: 8,  xMax: 28, yMin: 15, yMax: 85 },
  home:          { xMin: 8,  xMax: 28, yMin: 15, yMax: 85 },
  friend_home:   { xMin: 8,  xMax: 28, yMin: 15, yMax: 85 },
  family_home:   { xMin: 8,  xMax: 28, yMin: 15, yMax: 85 },

  workplace:     { xMin: 35, xMax: 60, yMin: 10, yMax: 35 },
  school:        { xMin: 35, xMax: 60, yMin: 38, yMax: 55 },
  education:     { xMin: 35, xMax: 60, yMin: 38, yMax: 55 },
  hospital:      { xMin: 62, xMax: 82, yMin: 10, yMax: 28 },
  medical:       { xMin: 62, xMax: 82, yMin: 10, yMax: 28 },
  clinic:        { xMin: 62, xMax: 82, yMin: 30, yMax: 42 },

  grocery:       { xMin: 62, xMax: 82, yMin: 45, yMax: 60 },
  grocery_store: { xMin: 62, xMax: 82, yMin: 45, yMax: 60 },
  gym:           { xMin: 62, xMax: 82, yMin: 62, yMax: 78 },

  park:          { xMin: 35, xMax: 60, yMin: 62, yMax: 85 },
  outdoor:       { xMin: 35, xMax: 60, yMin: 62, yMax: 85 },
  church:        { xMin: 84, xMax: 95, yMin: 15, yMax: 35 },
  religion:      { xMin: 84, xMax: 95, yMin: 15, yMax: 35 },

  bar:           { xMin: 84, xMax: 95, yMin: 40, yMax: 58 },
  food_drink:    { xMin: 84, xMax: 95, yMin: 40, yMax: 78 },
  restaurant:    { xMin: 84, xMax: 95, yMin: 60, yMax: 78 },
  social:        { xMin: 84, xMax: 95, yMin: 40, yMax: 78 },

  community:     { xMin: 35, xMax: 60, yMin: 38, yMax: 55 },
  government:    { xMin: 62, xMax: 82, yMin: 30, yMax: 42 },
  public:        { xMin: 35, xMax: 60, yMin: 10, yMax: 35 },
  business:      { xMin: 35, xMax: 60, yMin: 10, yMax: 35 },

  generic:       { xMin: 30, xMax: 95, yMin: 10, yMax: 90 },
};

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function isTooClose(candidate, existing, minDistance = 7) {
  return existing.some((coord) => {
    const dx = coord.x - candidate.x;
    const dy = coord.y - candidate.y;
    return Math.sqrt(dx * dx + dy * dy) < minDistance;
  });
}

export function assignMapCoordinates(locationType, existingCoords = []) {
  const zone = MAP_TYPE_ZONES[locationType] ?? MAP_TYPE_ZONES.generic;

  for (let i = 0; i < 60; i++) {
    const candidate = {
      x: randomInRange(zone.xMin, zone.xMax),
      y: randomInRange(zone.yMin, zone.yMax),
    };
    if (!isTooClose(candidate, existingCoords)) {
      return candidate;
    }
  }

  // Crowded fallback — still zone-based
  return {
    x: randomInRange(zone.xMin, zone.xMax),
    y: randomInRange(zone.yMin, zone.yMax),
  };
}

/**
 * Ensures every location in the list has saved map coordinates.
 * Calls saveLocation for any that are missing.
 */
export async function ensureLocationsMapped(locations, saveLocation) {
  const existingCoords = locations
    .filter((l) => l.map_coordinates)
    .map((l) => l.map_coordinates);

  for (const location of locations) {
    if (!location.map_coordinates) {
      const coord = assignMapCoordinates(location.category || location.type || 'generic', existingCoords);
      existingCoords.push(coord);
      await saveLocation(location.id, { map_coordinates: coord });
    }
  }
}