/**
 * locationUtils.js
 *
 * Zone-aware utilities for matching saved LocationReference records to image
 * generation prompts and returning the correct room/zone reference images.
 *
 * Every location is broken into zones (e.g. Home → Kitchen, Gym → Locker Room).
 * Images are stored per-zone, so matching must identify both the location AND
 * the specific zone before returning reference images.
 */

// Zone-level keyword hints: maps common prompt words → zone names
const ZONE_HINTS = {
  // Home
  "living room": "living room",
  "lounge": "living room",
  "couch": "living room",
  "sofa": "living room",
  "tv": "living room",
  "kitchen": "kitchen",
  "cooking": "kitchen",
  "fridge": "kitchen",
  "stove": "kitchen",
  "bedroom": "bedroom",
  "bed": "bedroom",
  "sleeping": "bedroom",
  "closet": "bedroom",
  "bathroom": "bathroom",
  "shower": "bathroom",
  "mirror": "bathroom",
  "sink": "bathroom",
  "toilet": "bathroom",
  "dining room": "dining room",
  "dining table": "dining room",
  "eating": "dining room",
  "hallway": "hallway",
  "entryway": "entryway",
  "front door": "entryway",
  "backyard": "backyard",
  "patio": "backyard",
  "porch": "backyard",
  "exterior": "front exterior",
  "outside the house": "front exterior",
  "garage": "garage",
  "basement": "basement",
  "studio": "studio",
  // Gym
  "workout floor": "workout floor",
  "weights": "weight room",
  "weight room": "weight room",
  "treadmill": "cardio zone",
  "cardio": "cardio zone",
  "stretching": "stretching area",
  "locker room": "locker room",
  "locker": "locker room",
  "pool": "pool",
  "sauna": "sauna",
  // Workplace
  "desk": "desk / workspace",
  "office": "desk / workspace",
  "break room": "break room",
  "conference": "conference room",
  "reception": "reception",
  "parking lot": "parking lot",
  "rooftop": "rooftop",
  // Social
  "dance floor": "main floor",
  "bar area": "bar area",
  "vip": "vip section",
  "outdoor patio": "outdoor patio",
  "entrance": "entrance",
  // Food & Drink
  "dining area": "dining area",
  "counter": "counter / bar",
  "outdoor seating": "outdoor seating",
  // Medical
  "waiting room": "waiting area",
  "waiting area": "waiting area",
  "front desk": "front desk",
  "triage": "triage",
  "patient room": "patient room",
  "patient bed": "patient room",
  "operating room": "operating room",
  "surgery": "operating room",
  "recovery room": "recovery room",
  // Education
  "classroom": "classroom",
  "cafeteria": "cafeteria",
  "gym class": "gym",
  "courtyard": "courtyard",
  "library": "library",
  "auditorium": "auditorium",
};

/**
 * Resolve the best available display image URL for a location.
 *
 * CANONICAL RESOLVER — matches TravelLocationGrid exactly:
 *   1. First zone with image_urls → that zone's first image
 *   2. Top-level image_urls[0]
 *   3. null (no image exists)
 *
 * Every surface that displays a location image must use this function
 * so the same location shows the same image everywhere.
 *
 * @param {object} location - A LocationReference record
 * @returns {string|null} image URL or null
 */
export function resolveLocationImageUrl(location) {
  if (!location) return null;
  return location.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0]
    || location.image_urls?.[0]
    || null;
}

/**
 * Find the best matching zone within a single location record.
 * Returns the zone's image_urls or [] if no zone matches.
 *
 * @param {string} promptLower - Lowercased prompt text
 * @param {object} location - A LocationReference record with zones[]
 * @returns {string[]} image URLs for the best matching zone
 */
function findZoneImages(promptLower, location) {
  const zones = location.zones || [];
  if (zones.length === 0) {
    // Legacy fallback: use top-level image_urls if no zones exist
    return location.image_urls || [];
  }

  // 1. Exact zone name match
  for (const zone of zones) {
    if (zone.image_urls?.length > 0 && promptLower.includes(zone.zone_name.toLowerCase())) {
      return zone.image_urls;
    }
  }

  // 2. Zone hint keyword match
  for (const [keyword, targetZone] of Object.entries(ZONE_HINTS)) {
    if (promptLower.includes(keyword)) {
      const matched = zones.find(z =>
        z.image_urls?.length > 0 &&
        z.zone_name.toLowerCase().includes(targetZone.toLowerCase())
      );
      if (matched) return matched.image_urls;
    }
  }

  // 3. Fallback: return images from the first zone that has any images
  const firstWithImages = zones.find(z => z.image_urls?.length > 0);
  if (firstWithImages) return firstWithImages.image_urls;

  // 4. Last resort: legacy flat image_urls
  return location.image_urls || [];
}

/**
 * Given a list of saved LocationReference records and a prompt/activity string,
 * returns the matching location and the zone-specific reference images.
 *
 * Matching strategy:
 * 1. Exact location name match → then find best zone within it
 * 2. Location keyword match → then find best zone
 * 3. Category-level match → then find best zone
 *
 * Character-specific locations are always prioritized over global ones.
 *
 * @param {string} prompt - The image generation prompt or activity string
 * @param {Array} locations - Array of LocationReference records
 * @param {string|null} characterId - Character ID for character-specific priority
 * @returns {{ location: object|null, imageUrls: string[], zoneName: string|null }}
 */
export function findMatchingLocation(prompt, locations, characterId = null) {
  if (!prompt || !locations || locations.length === 0) {
    return { location: null, imageUrls: [], zoneName: null };
  }

  const promptLower = prompt.toLowerCase();

  // Character-specific locations take priority
  const characterLocations = characterId
    ? locations.filter(l => l.location_type === 'character_specific' && l.character_id === characterId)
    : [];
  const globalLocations = locations.filter(l => l.location_type === 'global');
  const ordered = [...characterLocations, ...globalLocations];

  // 1. Exact location name match
  for (const loc of ordered) {
    if (promptLower.includes(loc.name.toLowerCase())) {
      const imgs = findZoneImages(promptLower, loc);
      if (imgs.length > 0) {
        const zone = (loc.zones || []).find(z => imgs === z.image_urls);
        return { location: loc, imageUrls: imgs, zoneName: zone?.zone_name || null };
      }
    }
  }

  // 2. Keyword match
  for (const loc of ordered) {
    if (loc.keywords?.length > 0) {
      const matched = loc.keywords.some(kw => promptLower.includes(kw.toLowerCase()));
      if (matched) {
        const imgs = findZoneImages(promptLower, loc);
        if (imgs.length > 0) {
          const zone = (loc.zones || []).find(z => imgs === z.image_urls);
          return { location: loc, imageUrls: imgs, zoneName: zone?.zone_name || null };
        }
      }
    }
  }

  // 3. Category-level fuzzy match
  const categoryKeywords = {
    home: ['home', 'apartment', 'house', 'living room', 'bedroom', 'kitchen', 'bathroom', 'backyard'],
    gym: ['gym', 'workout', 'weights', 'treadmill', 'locker room', 'fitness'],
    workplace: ['work', 'office', 'job', 'workplace', 'store', 'shop', 'desk'],
    social: ['bar', 'club', 'party', 'lounge', 'nightlife'],
    outdoor: ['park', 'outside', 'outdoors', 'trail', 'street'],
    food_drink: ['coffee', 'cafe', 'restaurant', 'diner', 'lunch', 'dinner'],
    medical: ['hospital', 'clinic', 'doctor', 'pharmacy', 'waiting room', 'patient'],
    education: ['school', 'class', 'college', 'campus', 'library', 'classroom'],
  };

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => promptLower.includes(kw))) {
      const catLoc = ordered.find(l => l.category === cat);
      if (catLoc) {
        const imgs = findZoneImages(promptLower, catLoc);
        if (imgs.length > 0) {
          const zone = (catLoc.zones || []).find(z => imgs === z.image_urls);
          return { location: catLoc, imageUrls: imgs, zoneName: zone?.zone_name || null };
        }
      }
    }
  }

  return { location: null, imageUrls: [], zoneName: null };
}

/**
 * Build a location context string for injection into the system prompt.
 * Lists known locations and their zones so the AI can describe them consistently.
 */
export function buildLocationContextString(locations, characterId) {
  if (!locations || locations.length === 0) return '';

  const charLocations = characterId
    ? locations.filter(l => l.location_type === 'character_specific' && l.character_id === characterId)
    : [];
  const globalLocations = locations.filter(l => l.location_type === 'global');

  let context = '\n\nKNOWN LOCATIONS WITH REFERENCE IMAGES (when generating images at these places, describe the specific room or zone consistently):';

  const formatLoc = (loc) => {
    const zones = (loc.zones || []).filter(z => z.image_urls?.length > 0);
    const zoneList = zones.length > 0 ? ` [zones: ${zones.map(z => z.zone_name).join(', ')}]` : '';
    return `\n- ${loc.name}${zoneList}${loc.description ? `: ${loc.description}` : ''}`;
  };

  if (charLocations.length > 0) {
    context += '\nPersonal spaces:';
    charLocations.forEach(loc => { context += formatLoc(loc); });
  }
  if (globalLocations.length > 0) {
    context += '\nShared locations:';
    globalLocations.forEach(loc => { context += formatLoc(loc); });
  }

  context += '\nWhen generating images at any of these locations, identify the room/zone and use it for visual consistency.';
  return context;
}