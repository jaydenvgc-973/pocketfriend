/**
 * activeOutfitResolver.js
 *
 * SINGLE AUTHORITY for "what is this character/user wearing right now?" — DISPLAY side.
 *
 * When Outfit Rotation is ON:
 *   - "Currently Wearing" is COMPUTED from the active outfit rules.
 *   - The manual `current_outfit` / `user_current_outfit` field is NOT the authority.
 *   - Priority: Uniform (character only) > Today's Special Occasion (StoryEvent) > Today's Home > Today's Daily Wear > fallback.
 *
 * When Outfit Rotation is OFF:
 *   - The manual `current_outfit` / `user_current_outfit` is the authority (existing behavior).
 *
 * The backend resolvers (resolveCharacterOutfitContext, resolveUserOutfitContext) mirror this
 * logic for image generation so the display and the simulation never disagree.
 *
 * TIMEZONE: All date comparisons use America/New_York (Eastern Time). UTC is forbidden.
 */
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { resolveCurrentOutfit, resolveTargetCategory, resolveGroupTodaySelection, getGroupForCategory, buildOutfitPromptText, applyManualCategoryOverride } from './outfitRotationEngine.js';
import { resolveUniform, buildUniformOutfitContext } from './uniformResolver.js';

// ── EASTERN TIME HELPERS ──────────────────────────────────────────────────────
function getETNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
function getETTodayStr() {
  const n = getETNow();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function getETDayIndex(seed = '') {
  const n = getETNow(); // ET-authoritative — UTC is forbidden
  const dayOfYear = Math.floor((n - new Date(n.getFullYear(), 0, 0)) / 86400000);
  const idHash = (seed || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return dayOfYear + idHash;
}

// ── SPECIAL OCCASION KEYWORDS (StoryEvent title/plot → category) ─────────────
const OCCASION_KEYWORDS = [
  { pattern: /\b(wedding|bridesmaid|groomsman|wedding guest|rehearsal dinner)\b/i, category: 'formal' },
  { pattern: /\b(funeral|memorial|viewing|wake|burial|celebration of life)\b/i, category: 'formal' },
  { pattern: /\b(gala|black tie|fundraiser|charity ball|red carpet|awards?|premiere)\b/i, category: 'formal' },
  { pattern: /\b(graduation|commencement|ceremony|prom)\b/i, category: 'formal' },
  { pattern: /\b(date night|romantic|anniversary|candlelit|valentine)\b/i, category: 'date_night' },
  { pattern: /\b(club|nightclub|party|birthday party|bar hop|night out)\b/i, category: 'nightlife' },
  { pattern: /\b(church|worship|mass|baptism|communion|service|bible study)\b/i, category: 'church' },
];

/**
 * Resolve the "Today's Special Occasion" category from StoryEvents.
 * Only returns a category when an event's title/plot contains a keyword that implies
 * a special outfit. Generic meet-ups do NOT trigger special occasion.
 */
export function resolveSpecialOccasionCategory(events, participantId, isUser = false) {
  if (!events || !events.length || !participantId) return null;
  const today = getETTodayStr();
  for (const ev of events) {
    if (!ev?.event_date || ev.event_date !== today) continue;
    const participates = isUser
      ? ev.user_participant?.user_id === participantId
      : ((ev.participant_character_ids || []).includes(participantId) || (ev.focus_character_ids || []).includes(participantId));
    if (!participates) continue;
    const text = `${ev.title || ''} ${ev.plot || ''} ${ev.additional_notes || ''}`;
    for (const k of OCCASION_KEYWORDS) {
      if (k.pattern.test(text)) return k.category;
    }
  }
  return null;
}

function buildOutfitTextFromOutfit(outfit) {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean)
    .map(p => {
      const t = String(p).trim();
      if (/^(n\/?a|none|-)$/i.test(t)) return null;
      if (/^(shirtless|no top|no shirt)$/i.test(t)) return 'No shirt / bare torso';
      return t;
    })
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return outfit.full_description?.trim() || null;
}

// ── CHARACTER ACTIVE OUTFIT (display authority) ──────────────────────────────
export function resolveCharacterActiveOutfit(character, options = {}) {
  const { specialOccasionCategory = null, locationMap = {} } = options;
  if (!character) return { outfit: null, category: null, reason: 'no_character', description: null, source: 'none' };

  // P1: UNIFORM (work/school/jail)
  const currentLocationId = character.resolved_current_location_id || character.current_home_location_id;
  const currentLocation = currentLocationId ? locationMap[currentLocationId] : null;
  if (currentLocation) {
    try {
      const resolvedUniform = resolveUniform(character, currentLocation);
      if (resolvedUniform?.uniform) {
        const u = buildUniformOutfitContext(resolvedUniform);
        if (u) {
          return { outfit: u, category: 'uniform', reason: 'uniform', description: u.description, source: 'uniform' };
        }
      }
    } catch (e) { /* non-blocking — fall through to closet */ }
  }

  // P2: SPECIAL OCCASION (StoryEvent) overrides the context-derived category
  const forcedCategory = specialOccasionCategory || null;
  const rotationEnabled = character.outfit_rotation_enabled !== false;

  // P3/P4: CLOSET via rotation engine
  // Rotation ON: consume the SAME Today group-selection that the Today's Rotation
  // display uses (so Currently Wearing matches the green Today Home / Daily Wear /
  // etc. card). When the Today group calculation has no scheduled outfit
  // (no_numbered / conflict / rotation_off / no_outfits) or the context is a
  // modifier category, preserve the resolver's existing fallback via the engine.
  let outfit = null;
  if (rotationEnabled) {
    const targetCat = forcedCategory || resolveTargetCategory(character, '', null);
    const group = getGroupForCategory(targetCat);
    if (group) {
      const todayPreview = resolveGroupTodaySelection(character, group);
      if (todayPreview?.state === 'scheduled') outfit = todayPreview.outfit;
    }
    if (!outfit) outfit = resolveCurrentOutfit(character, '', null, forcedCategory);
  } else {
    outfit = resolveCurrentOutfit(character, '', null, forcedCategory);
  }
  if (!outfit) {
    // Rotation ON: current_outfit is NEVER authoritative — return null, show nothing.
    // Rotation OFF: current_outfit is the authority only when closet is completely empty.
    const co = (!rotationEnabled && !(character.character_closet || []).filter(i => i.outfit_id).length)
      ? character.current_outfit
      : null;
    return {
      outfit: co,
      category: forcedCategory || 'daily_casual',
      reason: rotationEnabled ? 'rotation_no_match' : 'no_closet',
      description: co ? buildOutfitPromptText(co) : null,
      source: co ? 'fallback' : 'none',
    };
  }
  return {
    outfit,
    category: forcedCategory || outfit.category || 'daily_casual',
    reason: rotationEnabled ? (forcedCategory ? 'special_occasion' : 'rotation') : 'manual',
    description: buildOutfitPromptText(outfit),
    source: rotationEnabled ? (forcedCategory ? 'special_occasion' : 'rotation') : 'manual',
  };
}

// ── USER ACTIVE OUTFIT (display authority) ───────────────────────────────────
// Mirrors resolveCharacterActiveOutfit — builds a pseudo-character from user settings
// so the SAME resolveTargetCategory + resolveGroupTodaySelection + resolveCurrentOutfit
// pathway is used. This gives the user closet the SAME contextual outfit transitions
// as the character closet (gym→gym, workplace→work, religion→church, home→lounge, etc.)
// rather than the old simplified "home→lounge, everything else→daily_casual" check.
export function resolveUserActiveOutfit(settings, user, options = {}) {
  const { specialOccasionCategory = null, locationCategory = null } = options;
  if (!settings) return { outfit: null, category: null, reason: 'no_settings', description: null, source: 'none' };

  const closet = settings.user_closet || [];
  const outfits = closet.filter(o => o.outfit_id);
  const rotationEnabled = settings.user_outfit_rotation_enabled === true;

  // ── PSEUDO-CHARACTER ──────────────────────────────────────────────────────
  // Maps user settings to the fields that resolveTargetCategory, resolveGroupTodaySelection,
  // and resolveCurrentOutfit expect. This is the SAME pathway as the character closet —
  // no separate user-only outfit-resolution system.
  const pseudoChar = {
    id: settings.owner_email || 'user',
    character_closet: closet,
    outfit_rotation_enabled: rotationEnabled,
    today_category_outfit_overrides: settings.user_today_category_outfit_overrides,
    manual_category_selections: settings.user_manual_category_selections,
    current_outfit: settings.user_current_outfit,
    // User presence: 'present' at a home location maps to 'home'; everything else
    // is empty so resolveTargetCategory falls through to location-category resolution.
    resolved_presence_status: settings.user_presence_status === 'present' ? 'home' : '',
    resolved_current_location_id: settings.user_current_location_id || null,
    current_activity: '',
    sleep_start_time: null,
  };

  // P2: SPECIAL OCCASION (StoryEvent) overrides the context-derived category — same as character
  const forcedCategory = specialOccasionCategory || null;

  // P3: TARGET CATEGORY — same resolveTargetCategory as characters
  const targetCat = forcedCategory || resolveTargetCategory(pseudoChar, '', locationCategory);

  if (!outfits.length) {
    const co = settings.user_current_outfit;
    return {
      outfit: co,
      category: targetCat,
      reason: 'no_closet',
      description: co ? buildOutfitTextFromOutfit(co) : null,
      source: 'fallback',
    };
  }

  // P4: CLOSET via rotation engine — SAME group-level today selection as characters
  if (rotationEnabled) {
    const group = getGroupForCategory(targetCat);
    if (group) {
      const todayPreview = resolveGroupTodaySelection(pseudoChar, group);
      if (todayPreview?.state === 'scheduled' && todayPreview.outfit) {
        const o = todayPreview.outfit;
        return {
          outfit: o,
          category: todayPreview.isOverride ? targetCat : (forcedCategory || o.category || targetCat),
          reason: forcedCategory ? 'special_occasion' : (todayPreview.isOverride ? 'today_override' : 'rotation'),
          description: buildOutfitTextFromOutfit(o),
          source: todayPreview.isOverride ? 'today_override' : 'rotation',
        };
      }
    }
    // Fall back to resolveCurrentOutfit with the pseudo-character — same fallback as character
    const outfit = resolveCurrentOutfit(pseudoChar, '', locationCategory, forcedCategory);
    if (outfit) {
      return {
        outfit,
        category: forcedCategory || outfit.category || targetCat,
        reason: forcedCategory ? 'special_occasion' : 'rotation',
        description: buildOutfitTextFromOutfit(outfit),
        source: 'rotation',
      };
    }
    return { outfit: null, category: targetCat, reason: 'rotation_no_match', description: null, source: 'none' };
  }

  // Rotation OFF: SAME manual_category_selections → current_outfit path as characters
  const outfit = resolveCurrentOutfit(pseudoChar, '', locationCategory, forcedCategory);
  if (outfit) {
    return { outfit, category: forcedCategory || outfit.category || targetCat, reason: 'manual', description: buildOutfitTextFromOutfit(outfit), source: 'manual' };
  }
  const co = settings.user_current_outfit;
  if (co) return { outfit: co, category: co.category || targetCat, reason: 'current_outfit', description: buildOutfitTextFromOutfit(co), source: 'manual' };
  return { outfit: outfits[0], category: targetCat, reason: 'first_outfit', description: buildOutfitTextFromOutfit(outfits[0]), source: 'fallback' };
}

// ── MANUAL OVERRIDE WRITER (user) ─────────────────────────────────────────────
export function applyUserManualCategoryOverride(settings, targetCategory, newOutfitId) {
  const rotationEnabled = settings?.user_outfit_rotation_enabled === true;
  if (rotationEnabled) {
    const today = getETTodayStr();
    const existing = settings?.user_today_category_outfit_overrides || {};
    const overrides = (existing.date === today && existing.overrides) ? { ...existing.overrides } : {};
    overrides[targetCategory] = newOutfitId;
    return { user_today_category_outfit_overrides: { date: today, overrides } };
  }
  const existing = settings?.user_manual_category_selections || {};
  return { user_manual_category_selections: { ...existing, [targetCategory]: newOutfitId } };
}

// ── CLEAR MANUAL OVERRIDE FOR A SPECIFIC SLOT (user) ─────────────────────────
/**
 * Returns a patch that removes the today-override for a specific category slot.
 * Used by Deselect when rotation is ON — clears only that slot, not the whole day.
 */
export function clearUserCategoryOverride(settings, targetCategory) {
  const overrideState = settings?.user_today_category_outfit_overrides;
  const today = getETTodayStr();
  const existing = (overrideState?.date === today && overrideState?.overrides) ? { ...overrideState.overrides } : {};
  delete existing[targetCategory];
  return { user_today_category_outfit_overrides: { date: today, overrides: existing } };
}

/**
 * Returns the today's category→outfitId override map for the closet panel.
 * Only valid for today's date. Empty object if no overrides or stale date.
 */
export function getTodayUserOverrides(settings) {
  const overrideState = settings?.user_today_category_outfit_overrides;
  if (!overrideState?.date || overrideState.date !== getETTodayStr()) return {};
  return overrideState.overrides || {};
}

// ── CLEAR MANUAL OVERRIDE FOR A SPECIFIC SLOT (character) ────────────────────
/**
 * Returns a patch that removes the today-override for a specific category slot on a character.
 * Used by Deselect when rotation is ON — clears only that slot, not the whole day.
 */
export function clearCharacterCategoryOverride(character, targetCategory) {
  const existing = character?.today_category_outfit_overrides;
  const today = getETTodayStr();
  const overrides = (existing?.date === today && existing?.overrides) ? { ...existing.overrides } : {};
  delete overrides[targetCategory];
  return { today_category_outfit_overrides: { date: today, overrides } };
}

/**
 * Returns today's category→outfitId override map for the character closet panel.
 * Only valid for today's date. Empty object if no overrides or stale date.
 */
export function getTodayCharacterOverrides(character) {
  const existing = character?.today_category_outfit_overrides;
  if (!existing?.date || existing.date !== getETTodayStr()) return {};
  return existing.overrides || {};
}

// Re-export the character override writer for convenience.
export { applyManualCategoryOverride };

// ── REACT HOOKS ───────────────────────────────────────────────────────────────
export function useCharacterActiveOutfit(character) {
  const ownerEmail = character?.owner_email;
  const charId = character?.id;
  const locId = character?.resolved_current_location_id || character?.current_home_location_id;

  const { data: storyEvents = [] } = useQuery({
    queryKey: ['activeOutfit_events_char', ownerEmail],
    queryFn: () => ownerEmail
      ? base44.entities.StoryEvent.filter({ owner_email: ownerEmail }, '-event_date', 100).catch(() => [])
      : [],
    enabled: !!ownerEmail,
    staleTime: 60000,
  });

  const { data: locationMap = {} } = useQuery({
    queryKey: ['activeOutfit_loc_char', locId],
    queryFn: async () => {
      if (!locId) return {};
      const locs = await base44.entities.LocationReference.filter({ id: locId }, null, 1).catch(() => []);
      return locs?.[0] ? { [locId]: locs[0] } : {};
    },
    enabled: !!locId,
    staleTime: 60000,
  });

  const specialOccasionCategory = resolveSpecialOccasionCategory(storyEvents, charId, false);
  return resolveCharacterActiveOutfit(character, { specialOccasionCategory, locationMap });
}

export function useUserActiveOutfit(settings) {
  const ownerEmail = settings?.owner_email;

  const { data: user } = useQuery({
    queryKey: ['activeOutfit_user'],
    queryFn: () => base44.auth.me().catch(() => null),
    staleTime: 300000,
  });
  const userId = user?.id;

  const { data: storyEvents = [] } = useQuery({
    queryKey: ['activeOutfit_events_user', ownerEmail],
    queryFn: () => ownerEmail
      ? base44.entities.StoryEvent.filter({ owner_email: ownerEmail }, '-event_date', 100).catch(() => [])
      : [],
    enabled: !!ownerEmail,
    staleTime: 60000,
  });

  const locId = settings?.user_current_location_id;
  const { data: location = null } = useQuery({
    queryKey: ['activeOutfit_loc_user', locId],
    queryFn: async () => {
      if (!locId) return null;
      const locs = await base44.entities.LocationReference.filter({ id: locId }, null, 1).catch(() => []);
      return locs?.[0] || null;
    },
    enabled: !!locId,
    staleTime: 60000,
  });

  const specialOccasionCategory = resolveSpecialOccasionCategory(storyEvents, userId, true);
  const locationCategory = location?.category || null;
  return resolveUserActiveOutfit(settings, user, { specialOccasionCategory, locationCategory });
}