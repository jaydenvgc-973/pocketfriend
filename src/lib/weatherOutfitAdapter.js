/**
 * weatherOutfitAdapter.js
 *
 * WEATHER-DEPENDENT CLOTHING LAYER ADAPTER
 *
 * WHAT THIS DOES:
 *   Adapts the VISIBLE outfit text based on weather, temperature, uniforms,
 *   workplace expectations, and social context — so characters naturally
 *   wear or remove outerwear and (in extreme heat) additional layers.
 *
 * WHAT THIS DOES NOT DO:
 *   - Does NOT change the selected outfit (the outfit object is untouched)
 *   - Does NOT replace outfit rotation or closet authority
 *   - Does NOT create a parallel clothing system
 *   - Does NOT write to any entity
 *   - Does NOT adapt uniforms (required attire stays regardless of temperature)
 *
 * ARCHITECTURE:
 *   The selected outfit remains the single source of truth for what a character
 *   OWNS and INTENDS to wear. This adapter only modifies which pieces from that
 *   outfit are CURRENTLY BEING WORN, based on real weather conditions.
 *
 *   outfit object (authority) → buildOutfitPromptText → [THIS ADAPTER] → visible text
 *
 * PROOF POINTS:
 *   1. Where weather modifies visible clothing → adaptOutfitForWeather()
 *   2. How outerwear is dynamically worn/removed → tempZone hot/cold logic
 *   3. How uniform requirements override weather → isUniformOutfit() early return
 *   4. How workplaces without uniforms determine attire → locationHasDressStandard()
 *   5. How updated appearance is shared consistently → called from clothing awareness
 *      AND image generation context builder (same adapter, same logic)
 *   6. Selected outfit remains single source of truth → outfit object never mutated
 */

// ── TEMPERATURE THRESHOLDS (°F) ──────────────────────────────────────────────
const HOT_THRESHOLD = 80;        // outerwear removed at/above this temp
const EXTREME_HEAT = 90;         // additional layer removal possible
const COLD_THRESHOLD = 50;       // cold weather — outerwear always kept

// ── CONTEXT-LOCKED CATEGORIES (never adapted) ────────────────────────────────
// Sleepwear, swimwear, and bath are situation-locked — weather doesn't change them.
const NEVER_ADAPT_CATEGORIES = ['sleepwear', 'swimwear', 'bath'];

// ── OUTERWEAR KEYWORDS ────────────────────────────────────────────────────────
// What counts as removable outerwear (as opposed to a base layer top).
const OUTERWEAR_KEYWORDS = [
  'coat', 'jacket', 'hoodie', 'sweater', 'cardigan', 'blazer', 'parka',
  'windbreaker', 'pullover', 'fleece', 'overcoat', 'trench', 'bomber',
  'denim jacket', 'vest', 'poncho', 'cape', 'peacoat', 'anorak',
];

// ── SHIRT REMOVAL: SOCIALLY APPROPRIATE LOCATIONS ─────────────────────────────
// Categories where removing a shirt may be acceptable in extreme heat.
const SHIRT_REMOVAL_OK_CATEGORIES = ['outdoor', 'home'];

// Name/keyword patterns for locations where shirt removal is acceptable.
const SHIRT_REMOVAL_OK_KEYWORDS = [
  'beach', 'pool', 'yard', 'garden', 'park', 'lake', 'private',
  'backyard', 'patio', 'deck', 'balcony', 'camp', 'campsite', 'cabin',
  'trail', 'hiking', 'fishing', 'boat', 'dock', 'pier', 'sunbathing',
];

// ── SHIRT REMOVAL: FORBIDDEN LOCATIONS ────────────────────────────────────────
// Categories where shirt removal is NEVER appropriate regardless of temperature.
const SHIRT_REMOVAL_FORBIDDEN_CATEGORIES = [
  'food_drink', 'religion', 'school', 'education', 'government', 'medical',
  'business', 'workplace', 'jail_prison',
];

// Name/keyword patterns for forbidden locations.
const SHIRT_REMOVAL_FORBIDDEN_KEYWORDS = [
  'restaurant', 'fine dining', 'upscale', 'cocktail lounge', 'bistro',
  'church', 'temple', 'mosque', 'synagogue', 'cathedral', 'chapel',
  'school', 'university', 'college', 'academy', 'campus',
  'hospital', 'clinic', 'medical center', 'courthouse', 'government',
  'city hall', 'dmv', 'post office', 'bank', 'corporate', 'office',
  'headquarters', 'conference', 'gala', 'wedding venue', 'funeral',
];

// ── ESTABLISHMENT DRESS STANDARDS (no uniform) ────────────────────────────────
// When a workplace has NO uniform, the establishment's dress expectations
// determine what's acceptable — not the job title.
const CASUAL_ESTABLISHMENT_KEYWORDS = [
  'beach bar', 'pool bar', 'dive bar', 'tiki bar', 'surf bar', 'outdoor bar',
  'tailgate', 'camp', 'tavern', 'pub', 'casual', 'relaxed', 'laid-back',
  'poolside', 'beachside', 'boardwalk', 'cabana', 'lifeguard',
];

const FORMAL_ESTABLISHMENT_KEYWORDS = [
  'upscale', 'fine dining', 'cocktail lounge', 'luxury', 'premium',
  'formal', 'exclusive', 'gourmet', 'steakhouse', 'country club',
  'private club', 'boutique', 'high-end', ' Michelin ',
];

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Determine if the current outfit is a uniform.
 * Uniforms are NEVER adapted — required attire stays regardless of temperature.
 *
 * Proof point 3: uniform requirements override weather.
 */
function isUniformOutfit(source, category) {
  if (category === 'uniform') return true;
  if (source && typeof source === 'string' && source.startsWith('uniform:')) return true;
  return false;
}

/**
 * Classify temperature into a comfort zone.
 * @param {object|null} weatherCache - UserSettings.daily_weather_cache
 * @returns {'extreme_heat'|'hot'|'cold'|'mild'|'unknown'}
 */
function classifyTemperature(weatherCache) {
  if (!weatherCache) return 'unknown';
  const high = weatherCache.high;
  if (high == null) return 'unknown';
  if (high >= EXTREME_HEAT) return 'extreme_heat';
  if (high >= HOT_THRESHOLD) return 'hot';
  if (high < COLD_THRESHOLD) return 'cold';
  return 'mild';
}

/**
 * Personality-based heat tolerance multiplier.
 * >1 = tolerates heat longer (removes layers later)
 * <1 = more sensitive to heat (removes layers sooner)
 *
 * Proof point: personality still applies — characters don't make identical decisions.
 */
function getHeatTolerance(character) {
  if (!character) return 1.0;
  let tolerance = 1.0;

  // Higher tolerance — more likely to keep layers or delay removal
  if (character.trait_uninhibited) tolerance += 0.15;
  if (character.trait_risk_taker) tolerance += 0.1;
  if (character.trait_ruffian) tolerance += 0.1;
  if (character.trait_masculine) tolerance += 0.05;
  if (character.trait_stubborn) tolerance += 0.05;

  // Lower tolerance — more likely to remove layers sooner
  if (character.trait_conscientious) tolerance -= 0.1;
  if (character.trait_polite) tolerance -= 0.1;
  if (character.trait_goody_two_shoes) tolerance -= 0.1;
  if (character.trait_parental) tolerance -= 0.05;
  if (character.trait_feminine) tolerance -= 0.05;
  if (character.trait_bougie) tolerance -= 0.1;
  if (character.trait_self_absorbed) tolerance -= 0.05; // image-conscious

  return Math.max(0.6, Math.min(1.5, tolerance));
}

/**
 * Check if shirt removal is socially appropriate for this location.
 * Never based on temperature alone — considers location category, name, and context.
 *
 * Proof point: heat adaptation considers current location and social expectations.
 */
function canRemoveShirtAtLocation(location) {
  if (!location) return false;
  const cat = (location.category || '').toLowerCase();
  const name = (location.name || '').toLowerCase();
  const keywords = (location.keywords || []).join(' ').toLowerCase();
  const searchable = `${name} ${keywords}`;

  // Forbidden locations — never appropriate
  if (SHIRT_REMOVAL_FORBIDDEN_CATEGORIES.includes(cat)) return false;
  if (SHIRT_REMOVAL_FORBIDDEN_KEYWORDS.some(k => searchable.includes(k))) return false;

  // Explicitly OK locations
  if (SHIRT_REMOVAL_OK_CATEGORIES.includes(cat)) return true;
  if (SHIRT_REMOVAL_OK_KEYWORDS.some(k => searchable.includes(k))) return true;

  // Home — OK (it's their private space)
  if (cat === 'home') return true;

  // Default: not appropriate
  return false;
}

/**
 * Determine the dress standard of a workplace that has NO uniform.
 * Returns: 'casual' | 'formal' | 'standard' | null
 *
 * Proof point 4: workplaces without uniforms determine acceptable attire
 * based on establishment expectations, not job title.
 */
function locationHasDressStandard(location) {
  if (!location) return null;
  const name = (location.name || '').toLowerCase();
  const keywords = (location.keywords || []).join(' ').toLowerCase();
  const searchable = `${name} ${keywords}`;
  const cat = (location.category || '').toLowerCase();

  // Explicitly casual establishments
  if (CASUAL_ESTABLISHMENT_KEYWORDS.some(k => searchable.includes(k))) return 'casual';

  // Explicitly formal establishments
  if (FORMAL_ESTABLISHMENT_KEYWORDS.some(k => searchable.includes(k))) return 'formal';

  // Category-based defaults for workplaces
  if (cat === 'food_drink' || cat === 'business' || cat === 'social') return 'standard';

  return null;
}

/**
 * Parse outfit object into structured pieces.
 */
function parseOutfitPieces(outfit) {
  if (!outfit) return null;
  return {
    top: outfit.top || null,
    bottom: outfit.bottom || null,
    shoes: outfit.shoes || null,
    outerwear: outfit.outerwear || null,
    accessories: outfit.accessories || null,
    fullDescription: outfit.full_description || null,
  };
}

/**
 * Check if a string is a "none" placeholder.
 */
function isNonePlaceholder(s) {
  if (!s) return true;
  return /^(n\/?a|none|-)$/i.test(String(s).trim());
}

/**
 * Check if outerwear text contains a recognizable outerwear keyword.
 */
function isOuterwearPiece(text) {
  if (!text || isNonePlaceholder(text)) return false;
  const lower = String(text).toLowerCase();
  return OUTERWEAR_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Rebuild the outfit text from pieces, omitting removed pieces.
 * If full_description exists and nothing is removed, preserve it.
 */
function rebuildOutfitText(pieces, removeOuterwear, removeTop) {
  // If nothing removed and full_description exists, use it
  if (!removeOuterwear && !removeTop && pieces.fullDescription) {
    return pieces.fullDescription;
  }

  const parts = [];

  // Top
  if (removeTop) {
    parts.push('No shirt / bare torso');
  } else if (pieces.top && !isNonePlaceholder(pieces.top)) {
    const t = String(pieces.top).trim();
    parts.push(/^(shirtless|no top|no shirt)$/i.test(t) ? 'No shirt / bare torso' : t);
  }

  // Bottom
  if (pieces.bottom && !isNonePlaceholder(pieces.bottom)) {
    parts.push(String(pieces.bottom).trim());
  }

  // Shoes
  if (pieces.shoes && !isNonePlaceholder(pieces.shoes)) {
    parts.push(String(pieces.shoes).trim());
  }

  // Outerwear
  if (!removeOuterwear && pieces.outerwear && !isNonePlaceholder(pieces.outerwear)) {
    parts.push(String(pieces.outerwear).trim());
  }

  // Accessories
  if (pieces.accessories && !isNonePlaceholder(pieces.accessories)) {
    parts.push(String(pieces.accessories).trim());
  }

  return parts.length > 0 ? parts.join(', ') : (pieces.fullDescription || null);
}

// ── MAIN ADAPTER ──────────────────────────────────────────────────────────────

/**
 * adaptOutfitForWeather
 *
 * Takes the resolved outfit text + outfit object and returns the weather-adapted
 * visible text. The outfit object is NEVER mutated — only the text representation
 * changes to reflect which pieces are currently being worn.
 *
 * @param {object} params
 * @param {string} params.outfitText - Resolved outfit text (from buildOutfitPromptText)
 * @param {object} params.outfit - Outfit object (top, bottom, outerwear, etc.)
 * @param {string} params.source - Outfit source ('rotation', 'uniform:job_title', etc.)
 * @param {string} params.category - Outfit category ('uniform', 'daily_casual', etc.)
 * @param {object|null} params.weatherCache - UserSettings.daily_weather_cache
 * @param {object|null} params.location - LocationReference record
 * @param {object|null} params.character - Character record (for personality)
 * @param {boolean} params.isWorker - Whether character is a worker at this location
 * @returns {{ adaptedText: string, removedPieces: string[], reason: string, adapted: boolean }}
 */
export function adaptOutfitForWeather({
  outfitText,
  outfit,
  source,
  category,
  weatherCache,
  location,
  character,
  isWorker = false,
}) {
  const result = {
    adaptedText: outfitText,
    removedPieces: [],
    reason: 'no_adaptation',
    adapted: false,
  };

  if (!outfitText) return result;

  // ── RULE 4: Uniforms are NEVER adapted ──────────────────────────────────
  // Required attire stays regardless of temperature. Heat must never override
  // required uniforms (police, medical, school, restaurant, etc.).
  if (isUniformOutfit(source, category)) {
    result.reason = 'uniform_not_adapted';
    return result;
  }

  // ── Context-locked categories never adapt ────────────────────────────────
  if (NEVER_ADAPT_CATEGORIES.includes(category)) {
    result.reason = 'context_locked_category';
    return result;
  }

  // ── Check weather ──────────────────────────────────────────────────────────
  const tempZone = classifyTemperature(weatherCache);
  if (tempZone === 'unknown' || tempZone === 'mild') {
    result.reason = 'weather_mild_or_unknown';
    return result;
  }

  // ── Cold weather: outerwear stays (no removal) ────────────────────────────
  // If it's cold and the outfit has outerwear, it stays on. No adaptation needed.
  if (tempZone === 'cold') {
    result.reason = 'cold_weather_no_removal';
    return result;
  }

  // ── Hot / Extreme heat: adapt ──────────────────────────────────────────────
  const pieces = parseOutfitPieces(outfit);
  if (!pieces) {
    result.reason = 'no_outfit_pieces';
    return result;
  }

  const tolerance = getHeatTolerance(character);
  let removeOuterwear = false;
  let removeTop = false;
  const removedPieces = [];

  // ── Outerwear removal in hot weather ──────────────────────────────────────
  // Proof point 2: outerwear dynamically removed when hot.
  if (tempZone === 'hot' || tempZone === 'extreme_heat') {
    if (pieces.outerwear && isOuterwearPiece(pieces.outerwear)) {
      removeOuterwear = true;
      removedPieces.push(String(pieces.outerwear).trim());
    }
  }

  // ── Additional layer (shirt) removal in extreme heat ──────────────────────
  // Proof point 3: only when socially appropriate — never based on temperature alone.
  // Considers: location, activity, social expectations, workplace expectations,
  // character personality, and existing clothing.
  if (tempZone === 'extreme_heat') {
    // Personality adjusts the effective threshold
    // Higher tolerance → needs even higher temperature to remove shirt
    const effectiveHigh = (weatherCache?.high || EXTREME_HEAT) / tolerance;

    if (effectiveHigh >= EXTREME_HEAT) {
      let canRemoveShirt = false;

      // ── Workplace check: establishment dress expectations ──────────────
      // Proof point 4: workplaces without uniforms use dress expectations.
      const isAtWork = isWorker || (character?.resolved_presence_status === 'at_work');
      const hasUniformAtLocation = location?.uniforms && Object.keys(location.uniforms).length > 0;

      if (isAtWork) {
        // If the location has a uniform and the character is a worker, the uniform
        // resolver would have returned a uniform outfit — but double-check here.
        if (hasUniformAtLocation) {
          canRemoveShirt = false; // uniform takes priority (already handled, but safety net)
        } else {
          // No uniform — check establishment dress standard
          const standard = locationHasDressStandard(location);
          canRemoveShirt = standard === 'casual';
        }
      } else {
        // Non-work context: check if location is socially appropriate
        canRemoveShirt = canRemoveShirtAtLocation(location);
      }

      if (canRemoveShirt && pieces.top && !isNonePlaceholder(pieces.top)) {
        const t = String(pieces.top).trim();
        // Don't "remove" a top that's already shirtless
        if (!/^(shirtless|no top|no shirt)$/i.test(t)) {
          removeTop = true;
          removedPieces.push(t);
        }
      }
    }
  }

  // ── Build result ───────────────────────────────────────────────────────────
  if (!removeOuterwear && !removeTop) {
    result.reason = tempZone === 'extreme_heat'
      ? 'extreme_heat_no_removal_appropriate'
      : 'hot_no_outerwear_to_remove';
    return result;
  }

  result.adaptedText = rebuildOutfitText(pieces, removeOuterwear, removeTop);
  result.removedPieces = removedPieces;
  result.reason = removeTop ? 'extreme_heat_shirt_removed' : 'hot_outerwear_removed';
  result.adapted = true;

  return result;
}

/**
 * Build a short human-readable note about what was removed, for clothing awareness.
 * Returns null if nothing was adapted.
 */
export function buildWeatherAdaptationNote(adaptationResult) {
  if (!adaptationResult?.adapted || !adaptationResult.removedPieces?.length) return null;
  const pieces = adaptationResult.removedPieces;
  if (adaptationResult.reason === 'extreme_heat_shirt_removed') {
    return `Due to the heat, they have removed their ${pieces.join(' and ')}. They are currently not wearing these pieces from their outfit.`;
  }
  return `Due to the warm weather, they have taken off their ${pieces.join(' and ')}.`;
}