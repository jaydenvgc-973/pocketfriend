/**
 * OUTFIT CONTEXT RESOLVER
 *
 * Safe integration layer — reads existing app state and returns the correct outfit.
 * This module does NOT own any truths. It only READS them from other systems:
 *   - Sleep state → from sleepUtils / character.resolved_presence_status
 *   - Work state  → from character.resolved_presence_status / workScheduleUtils
 *   - Location    → from locationResolutionEngine
 *   - Activity    → from character.current_activity
 *   - Time of day → from system clock
 *   - Jail uniform → from jailUniformResolver (only applied when confined/staff)
 *
 * Output: { outfit, category, reason, description }
 * All consumers (image gen, narrative, profile, scene) use this single result.
 */

import { resolveTargetCategory, buildOutfitPromptText, resolveCurrentOutfit } from './outfitRotationEngine.js';
import { buildJailUniformOutfitContext } from './jailUniformResolver.js';
import { resolveUniform, determineCharacterRoleAtLocation, buildUniformOutfitContext } from './uniformResolver.js';
import { adaptOutfitForWeather } from './weatherOutfitAdapter.js';

/**
 * Build a context object from a character's current app state.
 * This is a READ-ONLY operation — no writes, no side effects.
 *
 * @param {object} character - Full character record
 * @param {object} locationMap - Map of locationId → location record (for category lookup)
 * @returns {object} outfit_context matching the spec schema
 */
export function buildOutfitContext(character, locationMap = {}) {
  if (!character) return null;

  const now = new Date();
  const hour = now.getHours();

  const presenceStatus = character.resolved_presence_status || character.location_status || 'home';
  const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';

  // Pre-sleep window: within 60 minutes of scheduled sleep start
  let isInPreSleepWindow = false;
  if (!isAsleep && character.sleep_start_time) {
    const [sh, sm] = character.sleep_start_time.split(':').map(Number);
    const sleepMin = sh * 60 + sm;
    const nowMin = hour * 60 + now.getMinutes();
    const diff = sleepMin > nowMin ? sleepMin - nowMin : (sleepMin + 1440) - nowMin;
    if (diff <= 60 && diff >= 0) isInPreSleepWindow = true;
  }

  // Water/swim venue detection — only if character is actually there
  const currentLocationId = character.resolved_current_location_id || character.current_home_location_id;
  const currentLocation = currentLocationId ? locationMap[currentLocationId] : null;
  const locationCategory = currentLocation?.category || null;
  const WATER_VENUE_CATEGORIES = ['outdoor']; // pools/beaches are often tagged outdoor
  const WATER_VENUE_KEYWORDS = ['pool', 'beach', 'water park', 'hot tub', 'resort', 'lake', 'ocean'];
  const isAtWaterVenue = (() => {
    if (!currentLocation) return false;
    const locName = (currentLocation.name || '').toLowerCase();
    if (WATER_VENUE_KEYWORDS.some(k => locName.includes(k))) return true;
    const keywords = (currentLocation.keywords || []).join(' ').toLowerCase();
    if (WATER_VENUE_KEYWORDS.some(k => keywords.includes(k))) return true;
    const activity = (character.current_activity || '').toLowerCase();
    return /\b(swim|swimming|pool|beach|ocean|lake|water park|hot tub)\b/.test(activity);
  })();

  const atWorkShift = presenceStatus === 'at_work';

  const atHomeRelaxing = (presenceStatus === 'home') &&
    /\b(relax|relaxing|chilling|lounge|lounging|resting|watching|couch|home)\b/.test(
      (character.current_activity || '').toLowerCase()
    );

  // Time-of-day
  let timeOfDay = 'morning';
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';

  return {
    owner_id: character.id,
    is_awake: !isAsleep,
    is_asleep: isAsleep,
    is_in_pre_sleep_window: isInPreSleepWindow,
    current_activity: character.current_activity || 'idle',
    current_location_type: locationCategory || (presenceStatus === 'home' ? 'home' : null),
    time_of_day: timeOfDay,
    at_work_shift: atWorkShift,
    at_water_venue: isAtWaterVenue,
    at_home_relaxing: atHomeRelaxing,
    // manual_override is no longer stored on current_outfit or closet items.
    // It is resolved by reading today_category_outfit_overrides (rotation ON)
    // or manual_category_selections (rotation OFF) in resolveCurrentOutfit.
    manual_override: false,
  };
}

/**
 * Resolve the outfit category from context.
 * This is the authoritative priority order from the spec.
 *
 * @param {object} context - Output of buildOutfitContext()
 * @returns {string} category key (e.g. 'sleepwear', 'work', 'daily_casual')
 */
export function resolveCategoryFromContext(context) {
  if (!context) return 'daily_casual';

  // 1. (Manual overrides are resolved in outfitRotationEngine, not here)
  // 2. Asleep → sleepwear
  if (context.is_asleep) return 'sleepwear';

  // 3. Pre-sleep window → sleepwear
  if (context.is_in_pre_sleep_window) return 'sleepwear';

  // 4. Water venue → swimwear
  if (context.at_water_venue) return 'swimwear';

  // 5. Work shift → work
  if (context.at_work_shift) return 'work';

  // 6. Home + relaxing → lounge
  if (context.at_home_relaxing) return 'lounge';

  // 7. Location-based fallback
  if (context.current_location_type) {
    const locMap = {
      home: 'lounge',
      gym: 'gym',
      religion: 'church',
      school: 'school',
      workplace: 'work',
      business: 'work',
    };
    const mapped = locMap[context.current_location_type];
    if (mapped) return mapped;
  }

  // 8. Default: daily casual
  return 'daily_casual';
}

/**
 * Pick the best outfit from the closet for the resolved category.
 * Uses daily rotation — deterministic per day, avoids repeating the same outfit
 * if alternatives exist.
 *
 * @param {object} character - Full character record
 * @param {string} targetCategory - Resolved category
 * @returns {object|null} Outfit item or null
 */
export function pickOutfitFromCloset(character, targetCategory) {
  // DELEGATE to the canonical rotation engine.
  // The previous local implementation preferred `current_outfit` when rotation was ON,
  // which locked the character into a stale manual selection and prevented the daily /
  // per-transition re-read required by the Character Closet rules. The canonical
  // resolveCurrentOutfit handles rotation_number ordering, today_category_outfit_overrides
  // (rotation ON), manual_category_selections (rotation OFF), and never prefers
  // current_outfit while rotation is active. This is a pure delegation — no new logic.
  return resolveCurrentOutfit(character, '', null, targetCategory);
}

/**
 * Main entry point: resolve the complete outfit state for a character.
 *
 * Safe to call from anywhere — profile, scene, chat, image gen, narrative.
 * Always reads existing app state; never writes.
 *
 * PRIORITY:
 * 1. Jail/prison uniform (if confined inmate or assigned staff)
 * 2. Manual override (set today)
 * 3. Context-based category (work, sleep, water venue, etc.)
 * 4. Closet outfit
 * 5. Fallback
 *
 * @param {object} character - Full character record
 * @param {object} locationMap - Map of locationId → location record
 * @returns {{ outfit, category, reason, description, source }} resolved state
 */
export function resolveCharacterOutfit(character, locationMap = {}) {
  if (!character) return { outfit: null, category: null, reason: 'no_character', description: null };

  const context = buildOutfitContext(character, locationMap);
  const closet = character.character_closet || [];
  const hasCloset = closet.some(item => item.outfit_id);

  const currentLocationId = character.resolved_current_location_id || character.current_home_location_id;
  const currentLocation = currentLocationId ? locationMap[currentLocationId] : null;

  // NOTE: Manual category overrides (today_category_outfit_overrides / manual_category_selections)
  // are handled inside resolveCurrentOutfit / pickOutfitFromCloset via the outfitRotationEngine.
  // No separate manual_override branch is needed here — the engine already applies it.

  // ── PRIORITY 2-7: Global uniform resolver ──────────────────────────
  if (currentLocation) {
    const characterRole = determineCharacterRoleAtLocation(character, currentLocation);
    const resolvedUniform = resolveUniform(character, currentLocation, characterRole);
    
    if (resolvedUniform.uniform) {
      const uniformOutfit = buildUniformOutfitContext(resolvedUniform);
      if (uniformOutfit) {
        return uniformOutfit;
      }
    }
  }

  // ── LEGACY: PRIORITY for jail/prison (backward compatibility) ────────
  // New uniform system handles this, but fallback for old data
  if (currentLocation?.category === 'jail_prison') {
    const jailUniformOutfit = buildJailUniformOutfitContext(character, currentLocation, {});
    if (jailUniformOutfit.source === 'jail_uniform') {
      return jailUniformOutfit;
    }
  }

  // PRIORITY 3: Context-based category
  const targetCategory = resolveCategoryFromContext(context);

  if (!hasCloset) {
    // Graceful fallback for characters with no closet data yet
    const fallback = character.current_outfit?.label ? character.current_outfit : null;
    return {
      outfit: fallback,
      category: targetCategory || 'daily_casual',
      reason: fallback ? 'current_outfit_fallback' : 'no_closet',
      description: fallback ? buildOutfitPromptText(fallback) : null,
      source: 'fallback',
    };
  }

  // PRIORITY 4: Closet outfit
  const outfit = pickOutfitFromCloset(character, targetCategory);

  const reasonMap = {
    sleepwear: context.is_asleep ? 'sleep_state' : 'pre_sleep_window',
    swimwear: 'water_venue',
    work: 'work_shift',
    lounge: 'home_relaxing',
    gym: 'gym_context',
    church: 'religion_context',
  };
  const reason = reasonMap[targetCategory] || 'daily_context';

  return {
    outfit,
    category: targetCategory,
    reason,
    description: outfit ? buildOutfitPromptText(outfit) : null,
    source: 'closet',
  };
}

/**
 * Build a narrative hint for the outfit — used by chat/narrative systems.
 * Returns a short, natural-language description suitable for injecting into prompts.
 * Never forces clothing to be the main subject — only a supporting detail.
 *
 * @param {object} resolvedOutfit - Output of resolveCharacterOutfit()
 * @param {object} character - Character record (for sleep/location state)
 * @returns {string|null} Narrative hint or null if not relevant
 */
export function buildOutfitNarrativeHint(resolvedOutfit, character, weatherCache = null, locationRecord = null) {
  if (!resolvedOutfit?.outfit && !resolvedOutfit?.category) return null;
  if (!resolvedOutfit.description && !resolvedOutfit.category) return null;

  const { category, reason, source } = resolvedOutfit;

  // ── WEATHER ADAPTATION ──────────────────────────────────────────────────
  // Apply weather adaptation to the description so narrative hints reflect
  // what the character is actually wearing right now.
  // Uniforms are never adapted (adapter checks isUniformOutfit).
  let adaptedDescription = resolvedOutfit.description;
  if (weatherCache && resolvedOutfit.description && resolvedOutfit.outfit) {
    const isWorkerAtLoc = locationRecord?.worker_character_ids?.includes(character?.id) || false;
    const adaptation = adaptOutfitForWeather({
      outfitText: resolvedOutfit.description,
      outfit: resolvedOutfit.outfit,
      source: resolvedOutfit.source || source,
      category,
      weatherCache,
      location: locationRecord,
      character,
      isWorker: isWorkerAtLoc,
    });
    if (adaptation?.adapted) {
      adaptedDescription = adaptation.adaptedText;
    }
  }

  // Uniform — required by role/job/location — highest explicit priority in hint text
  if (source?.startsWith('uniform:') || category === 'uniform') {
    if (adaptedDescription) return `wearing required uniform: ${adaptedDescription}`;
    return 'in their required uniform for this role';
  }

  // Asleep — stay grounded in sleep, not clothing
  if (reason === 'sleep_state') {
    if (adaptedDescription) return `settled in for sleep in ${adaptedDescription}`;
    return 'already in sleepwear for the night';
  }

  // Pre-sleep — winding down
  if (reason === 'pre_sleep_window') {
    if (adaptedDescription) return `changed into ${adaptedDescription} for the night`;
    return 'changed into sleepwear as the evening winds down';
  }

  // Work attire — reinforce professional context
  if (category === 'work' && adaptedDescription) {
    return `dressed for work in ${adaptedDescription}`;
  }

  // Lounge at home — softer, relaxed
  if (category === 'lounge' && adaptedDescription) {
    return `relaxed at home in ${adaptedDescription}`;
  }

  // Swimwear — context-locked
  if (category === 'swimwear' && adaptedDescription) {
    return `wearing ${adaptedDescription}`;
  }

  // Daily casual — only mention if description exists, keep it light
  if (category === 'daily_casual' && adaptedDescription) {
    return `dressed casually in ${adaptedDescription}`;
  }

  return null;
}