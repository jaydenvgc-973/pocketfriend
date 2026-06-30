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
import { resolveCurrentOutfit, buildOutfitPromptText, applyManualCategoryOverride } from './outfitRotationEngine.js';
import { resolveUniform, determineCharacterRoleAtLocation, buildUniformOutfitContext } from './uniformResolver.js';

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

// ── USER-SIDE FALLBACK CHAINS ─────────────────────────────────────────────────
function buildUserFallbackChain(targetCategory) {
  const chains = {
    sleepwear: ['sleepwear', 'lounge', 'daily_casual'],
    bath: ['bath', 'sleepwear', 'lounge'],
    swimwear: ['swimwear', 'gym', 'daily_casual'],
    gym: ['gym', 'outdoor', 'daily_casual'],
    work: ['work', 'formal', 'daily_casual'],
    formal: ['formal', 'work', 'daily_casual'],
    church: ['church', 'formal', 'daily_casual'],
    nightlife: ['nightlife', 'date_night', 'daily_casual'],
    date_night: ['date_night', 'nightlife', 'formal', 'daily_casual'],
    school: ['school', 'daily_casual'],
    lounge: ['lounge', 'daily_casual'],
    outdoor: ['outdoor', 'daily_casual'],
    special: ['special', 'formal', 'daily_casual'],
    daily_casual: ['daily_casual', 'outdoor', 'lounge'],
  };
  return chains[targetCategory] || ['daily_casual', 'lounge', 'outdoor'];
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
      const role = determineCharacterRoleAtLocation(character, currentLocation);
      const resolvedUniform = resolveUniform(character, currentLocation, role);
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
  const outfit = resolveCurrentOutfit(character, '', null, forcedCategory);
  if (!outfit) {
    // When rotation is ON, current_outfit is NOT authoritative — do not surface it.
    // Only use it when rotation is OFF (manual mode) and no closet outfits exist.
    const co = rotationEnabled ? null : character.current_outfit;
    return {
      outfit: co,
      category: forcedCategory || 'daily_casual',
      reason: rotationEnabled ? 'rotation_no_closet' : 'no_closet',
      description: co ? buildOutfitPromptText(co) : null,
      source: rotationEnabled ? 'none' : 'fallback',
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
export function resolveUserActiveOutfit(settings, user, options = {}) {
  const { specialOccasionCategory = null, locationCategory = null } = options;
  if (!settings) return { outfit: null, category: null, reason: 'no_settings', description: null, source: 'none' };

  const closet = settings.user_closet || [];
  const outfits = closet.filter(o => o.outfit_id);
  const rotationEnabled = settings.user_outfit_rotation_enabled === true;

  const presence = settings.user_presence_status || 'away';
  let targetCat = specialOccasionCategory;
  if (!targetCat) {
    targetCat = (presence === 'present' && locationCategory === 'home') ? 'lounge' : 'daily_casual';
  }

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

  const seed = settings.owner_email || 'user';

  if (rotationEnabled) {
    const overrideState = settings.user_today_category_outfit_overrides;
    if (overrideState?.date && overrideState?.overrides) {
      if (overrideState.date === getETTodayStr()) {
        const chain = buildUserFallbackChain(targetCat);
        for (const cat of chain) {
          const overrideId = overrideState.overrides[cat];
          if (overrideId) {
            const o = outfits.find(x => x.outfit_id === overrideId);
            if (o) return { outfit: o, category: cat, reason: 'today_override', description: buildOutfitTextFromOutfit(o), source: 'today_override' };
          }
        }
      }
    }
    const chain = buildUserFallbackChain(targetCat);
    for (const cat of chain) {
      const pool = outfits.filter(o => o.category === cat);
      if (!pool.length) continue;
      const picked = pool[getETDayIndex(seed) % pool.length];
      return { outfit: picked, category: cat, reason: specialOccasionCategory ? 'special_occasion' : (cat === 'lounge' ? 'home' : 'rotation'), description: buildOutfitTextFromOutfit(picked), source: 'rotation' };
    }
    const picked = outfits[getETDayIndex(seed) % outfits.length];
    return { outfit: picked, category: targetCat, reason: 'rotation_fallback', description: buildOutfitTextFromOutfit(picked), source: 'rotation' };
  }

  const manualSelections = settings.user_manual_category_selections;
  if (manualSelections) {
    const chain = buildUserFallbackChain(targetCat);
    for (const cat of chain) {
      const selectedId = manualSelections[cat];
      if (selectedId) {
        const o = outfits.find(x => x.outfit_id === selectedId);
        if (o) return { outfit: o, category: cat, reason: 'manual', description: buildOutfitTextFromOutfit(o), source: 'manual' };
      }
    }
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