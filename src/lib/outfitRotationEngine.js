/**
 * OUTFIT ROTATION ENGINE
 *
 * Single source of truth for "what should this character/user be wearing right now?"
 *
 * Priority order:
 *   1. Bath / shower / grooming state
 *   2. Sleepwear (within ~1hr of sleep time or during sleep window)
 *   3. Swimwear (pool, beach, water activity)
 *   4. Gym / workout
 *   5. Work attire (during active work schedule)
 *   6. Formal / event-specific
 *   7. Location-specific (church, school, etc.)
 *   8. Lounge / home relaxing
 *   9. Daily / casual (default)
 *
 * Rotation: within each category, cycles through available outfits
 * rather than always returning the first or previously-active one.
 */

// ── APPROVED OUTFIT CATEGORIES ──────────────────────────────────────────────────
// Only these categories participate in outfit rotation.
// Weather modifiers (cold_weather, hot_weather), Medical, and Travel are NOT categories.
// They are modifiers/overrides and must never receive rotation numbers or advance rotation.
export const OUTFIT_CATEGORIES = [
  // Home
  { value: "lounge",        label: "Lounge / Home",          emoji: "🛋️", group: "Home" },
  { value: "sleepwear",     label: "Sleepwear",              emoji: "😴", group: "Home" },
  { value: "bath",          label: "Bath / Robe",            emoji: "🛁", group: "Home" },
  // Daily Wear
  { value: "daily_casual",  label: "Daily Casual",           emoji: "👕", group: "Daily Wear" },
  { value: "work",          label: "Work",                   emoji: "👔", group: "Daily Wear" },
  { value: "school",        label: "School",                 emoji: "🎒", group: "Daily Wear" },
  { value: "outdoor",       label: "Outdoor / Errands",      emoji: "🌳", group: "Daily Wear" },
  { value: "nightlife",     label: "Nightlife / Party",      emoji: "🌃", group: "Daily Wear" },
  // Special Occasion
  { value: "formal",        label: "Formal",                 emoji: "🎩", group: "Special Occasion" },
  { value: "date_night",    label: "Date Night",             emoji: "💘", group: "Special Occasion" },
  { value: "church",        label: "Church / Religious",     emoji: "🛐", group: "Special Occasion" },
  { value: "special",       label: "Special / Statement",    emoji: "✨", group: "Special Occasion" },
  // Activity
  { value: "gym",           label: "Gym / Workout",          emoji: "🏋️", group: "Activity" },
  { value: "swimwear",      label: "Swimwear",               emoji: "🏊", group: "Activity" },
];

// ── ACTIVITY / LOCATION → CATEGORY MAPPING ─────────────────────────────────────
const ACTIVITY_CATEGORY_MAP = [
  // Bath / grooming — highest priority
  { activities: ['bathing', 'showering', 'shower', 'bath', 'hot tub', 'grooming', 'getting ready'], category: 'bath' },
  // Swimming / water
  { activities: ['swimming', 'pool', 'beach', 'water park', 'sunbathing', 'swim', 'snorkeling', 'surfing'], category: 'swimwear' },
  // Gym / workout
  { activities: ['gym', 'workout', 'working out', 'exercise', 'lifting', 'cardio', 'yoga', 'jogging', 'running', 'training', 'rehearsing_dance', 'rehearsing dance', 'dance rehearsal'], category: 'gym' },
  // Sleep
  { activities: ['sleeping', 'asleep', 'napping', 'sleep', 'nap', 'bed time', 'bedtime', 'going to sleep'], category: 'sleepwear' },
  // Church
  { activities: ['church', 'service', 'worship', 'mass', 'prayer', 'praying'], category: 'church' },
  // Formal / event
  { activities: ['wedding', 'funeral', 'gala', 'graduation', 'ceremony', 'black tie', 'formal event'], category: 'formal' },
  // Nightlife
  { activities: ['club', 'nightclub', 'party', 'going out', 'night out', 'bar hopping', 'lounge bar'], category: 'nightlife' },
  // Work
  { activities: ['working', 'at work', 'work shift', 'on the clock', 'office', 'shift'], category: 'work' },
  // School
  { activities: ['school', 'class', 'campus', 'lecture', 'study', 'college', 'university'], category: 'school' },
  // Lounge / home
  { activities: ['relaxing', 'relaxed', 'home', 'chilling', 'hanging at home', 'lounging', 'watching tv', 'cleaning', 'cooking at home'], category: 'lounge' },
  // Date
  { activities: ['date', 'date night', 'romantic dinner', 'anniversary'], category: 'date_night' },
];

// Location category → outfit category mapping
const LOCATION_CATEGORY_TO_OUTFIT = {
  gym: 'gym',
  religion: 'church',
  school: 'school',
  workplace: 'work',
  business: 'work',
  social: 'nightlife',
  home: 'lounge',
  outdoor: 'outdoor',
};

/**
 * Get a stable rotation index for a pool of outfits.
 * Uses the day-of-year so it changes daily but is deterministic for the same day.
 * Avoids always returning index 0 when multiple options exist.
 */
function getDailyRotationIndex(outfitPool, characterId = '') {
  if (outfitPool.length <= 1) return 0;
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  // Mix in characterId hash so different characters rotate differently
  const idHash = characterId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return (dayOfYear + idHash) % outfitPool.length;
}

/**
 * Pick an outfit from a category pool, rotating daily.
 * If outfits have rotation_number assigned, they are sorted by that number
 * and cycled in explicit sequence. Outfits without numbers fall back to
 * daily date-based rotation.
 */
// rotationEnabled: pass character.outfit_rotation_enabled (defaults true when undefined)
function pickFromPool(pool, currentOutfitId = null, characterId = '', rotationEnabled = true) {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  // MANUAL CATEGORY OVERRIDE — highest priority, rotation-safe.
  // If any outfit in this pool has manual_override=true, use it immediately.
  // This override was set by applyManualCategoryOverride and applies only to
  // this specific category. It does NOT affect other categories, rotation numbers,
  // or tomorrow's rotation sequence. Weather/medical/transition logic is unaffected.
  const manualOverride = pool.find(o => o.manual_override === true);
  if (manualOverride) return manualOverride;

  // ROTATION OFF: always return the selected outfit if it's in this pool
  if (!rotationEnabled && currentOutfitId) {
    const locked = pool.find(o => o.outfit_id === currentOutfitId);
    if (locked) return locked;
  }

  // ROTATION ON: if current outfit is in the pool and context matches, prefer it
  if (rotationEnabled && currentOutfitId) {
    const currentInPool = pool.find(o => o.outfit_id === currentOutfitId);
    if (currentInPool) return currentInPool;
  }

  // Sort candidates: numbered outfits first (by rotation_number ascending),
  // then unnumbered. Favorites are prioritized within each tier.
  const numbered = pool
    .filter(o => o.rotation_number != null && o.rotation_number !== "")
    .sort((a, b) => Number(a.rotation_number) - Number(b.rotation_number));
  const unnumbered = pool.filter(o => o.rotation_number == null || o.rotation_number === "");

  // If any outfits have explicit rotation numbers, use them as the ordered sequence
  if (numbered.length > 0) {
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const idHash = characterId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const idx = (dayOfYear + idHash) % numbered.length;
    const picked = numbered[idx];
    // Skip currently worn if alternatives exist
    if (rotationEnabled && picked?.outfit_id === currentOutfitId && numbered.length > 1) {
      return numbered[(idx + 1) % numbered.length];
    }
    return picked;
  }

  // Fallback: no rotation numbers — use daily rotation among favorites or all
  const favorites = unnumbered.filter(o => o.is_favorite);
  const candidates = favorites.length > 0 ? favorites : unnumbered;
  if (candidates.length === 1) return candidates[0];

  const idx = getDailyRotationIndex(candidates, characterId);
  const picked = candidates[idx];
  if (rotationEnabled && picked?.outfit_id === currentOutfitId && candidates.length > 1) {
    return candidates[(idx + 1) % candidates.length];
  }
  return picked;
}

/**
 * Determine the correct outfit category based on:
 * - presence status (sleep, work, gym, etc.)
 * - activity text (from latest message or current_activity)
 * - location category
 * - time of day
 * - sleep schedule
 */
export function resolveTargetCategory(character, activityText = '', locationCategory = null) {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  const presenceStatus = character?.resolved_presence_status || character?.location_status || 'home';
  const currentActivity = (character?.current_activity || '').toLowerCase();
  const combined = `${activityText} ${currentActivity}`.toLowerCase();

  // ── PRIORITY 1: BATH STATE ──────────────────────────────────────────────────
  if (ACTIVITY_CATEGORY_MAP[0].activities.some(a => combined.includes(a))) return 'bath';

  // ── PRIORITY 2: SLEEP / PASS-OUT STATE ───────────────────────────────────────
  // passed_out = collapsed from exhaustion — treat same as sleepwear context for outfit purposes
  const isSleeping = presenceStatus === 'sleeping' || presenceStatus === 'napping' || presenceStatus === 'passed_out';
  if (isSleeping) return 'sleepwear';

  // Approaching sleep: within 60 minutes of sleep start
  if (character?.sleep_start_time) {
    const [sleepH, sleepM] = character.sleep_start_time.split(':').map(Number);
    const sleepMinutes = sleepH * 60 + sleepM;
    const nowMinutes = hour * 60 + minute;
    const diff = sleepMinutes > nowMinutes
      ? sleepMinutes - nowMinutes
      : (sleepMinutes + 1440) - nowMinutes; // overnight wrap
    if (diff <= 60 && diff >= 0) return 'sleepwear';
  }
  if (ACTIVITY_CATEGORY_MAP[3].activities.some(a => combined.includes(a))) return 'sleepwear';

  // ── PRIORITY 3: SWIMWEAR ──────────────────────────────────────────────────────
  if (ACTIVITY_CATEGORY_MAP[1].activities.some(a => combined.includes(a))) return 'swimwear';

  // ── PRIORITY 4: WORKOUT / GYM ────────────────────────────────────────────────
  if (presenceStatus === 'at_work' && character?.occupation_location_id) {
    // Will be handled by work logic — but check activity first
    const isGymActivity = ACTIVITY_CATEGORY_MAP[2].activities.some(a => combined.includes(a));
    if (isGymActivity && locationCategory !== 'workplace') return 'gym';
  }
  if (ACTIVITY_CATEGORY_MAP[2].activities.some(a => combined.includes(a))) return 'gym';
  if (locationCategory === 'gym') return 'gym';

  // ── PRIORITY 5: WORK ─────────────────────────────────────────────────────────
  if (presenceStatus === 'at_work') return 'work';
  if (ACTIVITY_CATEGORY_MAP[10].activities.some(a => combined.includes(a))) return 'work';
  if (locationCategory === 'workplace' || locationCategory === 'business') return 'work';

  // ── PRIORITY 6: FORMAL / EVENT ───────────────────────────────────────────────
  if (ACTIVITY_CATEGORY_MAP[5].activities.some(a => combined.includes(a))) return 'formal';

  // ── PRIORITY 7: LOCATION-SPECIFIC ────────────────────────────────────────────
  if (locationCategory) {
    const mapped = LOCATION_CATEGORY_TO_OUTFIT[locationCategory];
    if (mapped) return mapped;
  }
  if (ACTIVITY_CATEGORY_MAP[4].activities.some(a => combined.includes(a))) return 'church';
  if (ACTIVITY_CATEGORY_MAP[6].activities.some(a => combined.includes(a))) return 'nightlife';
  if (ACTIVITY_CATEGORY_MAP[8].activities.some(a => combined.includes(a))) return 'school';
  if (ACTIVITY_CATEGORY_MAP[11].activities.some(a => combined.includes(a))) return 'date_night';

  // ── PRIORITY 8: LOUNGE / HOME ────────────────────────────────────────────────
  if (presenceStatus === 'home') {
    // Late evening at home → lounge
    if (hour >= 19 || hour < 7) return 'lounge';
    // Daytime at home is less certain — prefer daily_casual but lounge is fine
    return 'lounge';
  }
  if (ACTIVITY_CATEGORY_MAP[9].activities.some(a => combined.includes(a))) return 'lounge';

  // ── PRIORITY 9: DAILY / CASUAL (default) ─────────────────────────────────────
  return 'daily_casual';
}

/**
 * Main function: pick the best current outfit for a character.
 * Returns the outfit object or null if none available.
 *
 * @param {object} character - Full character record
 * @param {string} activityText - Text from latest message or activity context
 * @param {string|null} locationCategory - Location category string (e.g. 'gym', 'home')
 * @returns {object|null} outfit object
 */
export function resolveCurrentOutfit(character, activityText = '', locationCategory = null) {
  if (!character) return null;

  const closet = character.character_closet || [];
  const outfits = closet.filter(item => item.type === 'outfit' || (!item.piece_id?.startsWith('piece_') && item.outfit_id));
  if (outfits.length === 0) return character.current_outfit || null;

  const currentOutfitId = character.current_outfit?.outfit_id || null;
  const rotationEnabled = character.outfit_rotation_enabled !== false;

  // ROTATION OFF: return the currently selected outfit directly (no category check)
  if (!rotationEnabled && currentOutfitId) {
    const locked = outfits.find(o => o.outfit_id === currentOutfitId);
    if (locked) return locked;
  }

  const targetCategory = resolveTargetCategory(character, activityText, locationCategory);
  const fallbackChain = buildFallbackChain(targetCategory);

  for (const cat of fallbackChain) {
    const pool = outfits.filter(o => o.category === cat);
    if (pool.length > 0) {
      return pickFromPool(pool, currentOutfitId, character.id, rotationEnabled);
    }
  }

  // Last resort: any outfit from closet
  return pickFromPool(outfits, currentOutfitId, character.id, rotationEnabled);
}

/**
 * Build a fallback chain for a given target category.
 * If the exact category isn't available, try sensible alternatives.
 */
function buildFallbackChain(targetCategory) {
  // Fallback chains — only reference approved rotation categories.
  // Weather (cold_weather, hot_weather), Travel, and Medical are NOT categories
  // and must never appear here. They are modifier/override systems only.
  const chains = {
    bath:         ['bath', 'sleepwear', 'lounge'],
    sleepwear:    ['sleepwear', 'lounge', 'daily_casual'],
    swimwear:     ['swimwear', 'gym', 'daily_casual'],
    gym:          ['gym', 'outdoor', 'daily_casual'],
    work:         ['work', 'formal', 'daily_casual'],
    formal:       ['formal', 'work', 'daily_casual'],
    church:       ['church', 'formal', 'work', 'daily_casual'],
    nightlife:    ['nightlife', 'date_night', 'special', 'daily_casual'],
    date_night:   ['date_night', 'nightlife', 'formal', 'daily_casual'],
    school:       ['school', 'daily_casual', 'work'],
    lounge:       ['lounge', 'daily_casual', 'sleepwear'],
    outdoor:      ['outdoor', 'daily_casual'],
    special:      ['special', 'formal', 'daily_casual'],
    daily_casual: ['daily_casual', 'outdoor', 'lounge'],
    // Legacy values — if an existing outfit has one of these categories saved in DB,
    // fall through to the nearest approved category. Never surface as selection options.
    cold_weather: ['outdoor', 'daily_casual'],
    hot_weather:  ['outdoor', 'daily_casual', 'swimwear'],
    travel:       ['outdoor', 'daily_casual'],
    medical:      ['lounge', 'daily_casual'],
  };
  return chains[targetCategory] || ['daily_casual', 'lounge', 'outdoor'];
}

/**
 * Build the outfit description string for prompt injection.
 * Returns a ready-to-use string like "white tee, black joggers, Air Force 1s"
 */
export function buildOutfitPromptText(outfit) {
  if (!outfit) return null;
  if (outfit.full_description) return outfit.full_description;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Get the activity-appropriate outfit category label for display or logging.
 */
export function getCategoryLabel(categoryValue) {
  return OUTFIT_CATEGORIES.find(c => c.value === categoryValue)?.label || categoryValue;
}

/**
 * CANONICAL SPEC CATEGORY ALIASES
 *
 * The spec uses 5 canonical names. These map to the existing category values
 * already used throughout the app. Both names resolve to the same data.
 *
 * Spec name        → Internal value
 * daily_wear       → daily_casual
 * work_attire      → work
 * loungewear       → lounge
 * sleepwear        → sleepwear  (same)
 * swimwear         → swimwear   (same)
 */
export const SPEC_CATEGORY_ALIAS = {
  daily_wear:   'daily_casual',
  work_attire:  'work',
  loungewear:   'lounge',
  sleepwear:    'sleepwear',
  swimwear:     'swimwear',
};

/**
 * Normalize a category value — accepts both spec aliases and internal values.
 * Safe for use anywhere category strings are compared.
 */
export function normalizeCategory(cat) {
  if (!cat) return 'daily_casual';
  return SPEC_CATEGORY_ALIAS[cat] || cat;
}

/**
 * applyManualCategoryOverride
 *
 * When rotation is enabled, the user may manually override the selected outfit
 * for ONE specific category without disturbing any other category or the rotation
 * sequence. This function merges the override into the character's closet data
 * by returning a patched `character_closet` array. The caller is responsible for
 * persisting it to the DB (e.g. Character.update).
 *
 * Rules:
 *   - Only the target category's currently-active outfit is replaced.
 *   - All other category outfits remain unchanged.
 *   - Rotation numbers are NOT renumbered, reordered, or reset.
 *   - The rotation counter (day-of-year index) is NOT advanced or reset.
 *   - Weather modifiers, medical overrides, and transition logic are unaffected.
 *   - Tomorrow's preview continues from the rotation sequence, not this override.
 *
 * @param {object} character - Full character record
 * @param {string} targetCategory - The category being overridden (e.g. 'lounge', 'work')
 * @param {string} newOutfitId - outfit_id of the replacement outfit
 * @returns {{ patched_closet: array, prev_outfit_id: string|null, new_outfit_id: string }}
 */
export function applyManualCategoryOverride(character, targetCategory, newOutfitId) {
  const closet = (character.character_closet || []).map(item => ({ ...item }));
  const normalizedCategory = normalizeCategory(targetCategory);
  let prevOutfitId = null;

  // Mark the new outfit as the manually-selected one for this category.
  // We store a `manual_override: true` flag on the outfit itself so
  // resolveCurrentOutfit can prefer it when resolving this category.
  // This flag does NOT advance rotation_number or alter any other outfit.
  for (const item of closet) {
    if (item.category !== normalizedCategory) continue;
    if (item.outfit_id === newOutfitId) {
      // Flag the chosen outfit as manually overridden for today
      item.manual_override = true;
      item.manual_override_set_at = new Date().toISOString();
    } else if (item.manual_override) {
      // Clear any previous manual override on other outfits in this category
      prevOutfitId = item.outfit_id;
      item.manual_override = false;
      item.manual_override_set_at = null;
    }
  }

  return { patched_closet: closet, prev_outfit_id: prevOutfitId, new_outfit_id: newOutfitId };
}

/**
 * resolveOutfitForDate — date-aware outfit resolver
 *
 * Resolves the outfit a character would wear on a SPECIFIC date (today, tomorrow, etc.)
 * using the canonical rotation algorithm with the given date as the rotation anchor.
 *
 * This is the ONLY correct way to get tomorrow's outfit — never fake it with ID manipulation.
 *
 * @param {object} character - Full character record
 * @param {Date} date - The target date (e.g. new Date() for today, tomorrow's date for tomorrow)
 * @param {string} activityText - Activity context (optional)
 * @param {string|null} locationCategory - Location category (optional)
 * @returns {object|null} outfit object for that date, or null
 */
export function resolveOutfitForDate(character, date, activityText = '', locationCategory = null) {
  if (!character) return null;

  const closet = character.character_closet || [];
  const outfits = closet.filter(item => item.type === 'outfit' || (!item.piece_id?.startsWith('piece_') && item.outfit_id));
  if (outfits.length === 0) return character.current_outfit || null;

  const rotationEnabled = character.outfit_rotation_enabled !== false;
  const targetCategory = resolveTargetCategory(character, activityText, locationCategory);
  const fallbackChain = buildFallbackChain(targetCategory);

  // Date-specific rotation index: same algorithm as getDailyRotationIndex but uses the supplied date
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const idHash = (character.id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);

  function pickForDate(pool) {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];

    const numbered = pool
      .filter(o => o.rotation_number != null && o.rotation_number !== "")
      .sort((a, b) => Number(a.rotation_number) - Number(b.rotation_number));
    const unnumbered = pool.filter(o => o.rotation_number == null || o.rotation_number === "");

    if (numbered.length > 0) {
      const idx = (dayOfYear + idHash) % numbered.length;
      return numbered[idx];
    }

    const favorites = unnumbered.filter(o => o.is_favorite);
    const candidates = favorites.length > 0 ? favorites : unnumbered;
    if (candidates.length === 1) return candidates[0];
    return candidates[(dayOfYear + idHash) % candidates.length];
  }

  for (const cat of fallbackChain) {
    const pool = outfits.filter(o => o.category === cat);
    if (pool.length > 0) return pickForDate(pool);
  }

  return pickForDate(outfits);
}