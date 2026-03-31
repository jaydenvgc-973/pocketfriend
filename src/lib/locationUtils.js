/**
 * locationUtils.js
 *
 * Utilities for matching known saved locations to image generation prompts
 * and building location context for the AI.
 */

/**
 * Given a list of saved LocationReference records and a prompt/activity string,
 * returns the best matching location (if any) and its reference images.
 *
 * Matching strategy:
 * 1. Exact name match (case-insensitive)
 * 2. Keyword match from location.keywords array
 * 3. Category-level fuzzy match
 *
 * @param {string} prompt - The image generation prompt or activity string
 * @param {Array} locations - Array of LocationReference records
 * @param {string|null} characterId - Character ID for character-specific location priority
 * @returns {{ location: object|null, imageUrls: string[] }}
 */
export function findMatchingLocation(prompt, locations, characterId = null) {
  if (!prompt || !locations || locations.length === 0) {
    return { location: null, imageUrls: [] };
  }

  const promptLower = prompt.toLowerCase();

  // Character-specific locations get priority
  const characterLocations = characterId
    ? locations.filter(l => l.location_type === 'character_specific' && l.character_id === characterId)
    : [];
  const globalLocations = locations.filter(l => l.location_type === 'global');
  const ordered = [...characterLocations, ...globalLocations];

  for (const loc of ordered) {
    if (!loc.image_urls || loc.image_urls.length === 0) continue;

    // 1. Exact name match
    if (promptLower.includes(loc.name.toLowerCase())) {
      return { location: loc, imageUrls: loc.image_urls };
    }

    // 2. Keyword match
    if (loc.keywords && loc.keywords.length > 0) {
      const matched = loc.keywords.some(kw => promptLower.includes(kw.toLowerCase()));
      if (matched) {
        return { location: loc, imageUrls: loc.image_urls };
      }
    }
  }

  // 3. Category-level match
  const categoryKeywords = {
    home: ['home', 'apartment', 'house', 'room', 'living room', 'bedroom', 'kitchen', 'bathroom', 'backyard'],
    workplace: ['work', 'office', 'job', 'workplace', 'store', 'shop'],
    social: ['bar', 'club', 'party', 'lounge'],
    outdoor: ['park', 'outside', 'outdoors', 'trail', 'street'],
    food_drink: ['coffee', 'cafe', 'restaurant', 'diner', 'lunch', 'dinner'],
    medical: ['hospital', 'clinic', 'doctor', 'pharmacy'],
    education: ['school', 'class', 'college', 'campus', 'library'],
  };

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    const matches = keywords.some(kw => promptLower.includes(kw));
    if (matches) {
      // Find the best location in this category (character-specific first)
      const catLocation = ordered.find(l => l.category === cat && l.image_urls?.length > 0);
      if (catLocation) {
        return { location: catLocation, imageUrls: catLocation.image_urls };
      }
    }
  }

  return { location: null, imageUrls: [] };
}

/**
 * Build a location context string for injection into the system prompt.
 * This tells the AI what known locations the character frequents.
 */
export function buildLocationContextString(locations, characterId) {
  if (!locations || locations.length === 0) return '';

  const charLocations = characterId
    ? locations.filter(l => l.location_type === 'character_specific' && l.character_id === characterId)
    : [];
  const globalLocations = locations.filter(l => l.location_type === 'global');

  let context = '\n\nKNOWN LOCATIONS WITH REFERENCE IMAGES (when generating images at these places, describe them consistently):';

  if (charLocations.length > 0) {
    context += '\nYour personal spaces:';
    for (const loc of charLocations) {
      context += `\n- ${loc.name}${loc.description ? `: ${loc.description}` : ''}`;
    }
  }
  if (globalLocations.length > 0) {
    context += '\nShared locations:';
    for (const loc of globalLocations) {
      context += `\n- ${loc.name}${loc.description ? `: ${loc.description}` : ''}`;
    }
  }

  context += '\nWhen describing images at any of these locations, reference their established visual style for consistency.';
  return context;
}