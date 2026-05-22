/**
 * UNIFIED TRAVEL PRESENCE RESOLVER
 *
 * Single source of truth for all character presence on the Travel page.
 * Handles: active_created_character, npc_fictitious, npc_family_member, internal family entities
 *
 * CANONICAL AUTHORITY RULE (2026-05-22):
 * Travel page, Travel map, and "who's coming" list MUST all use the exact same
 * presence resolution logic as the Homepage CharacterCard.
 *
 * Source of truth: resolveCharacterLocation() from locationResolutionEngine.js
 * This engine applies: sleep enforcement → work schedule → pre-sleep window →
 * home contradiction guard → housing resolver.
 *
 * The old behavior (reading resolved_current_location_id directly from DB) is
 * DEPRECATED for presence display. DB fields may be stale (e.g. a character the
 * DB still has at a bar who is now sleeping at home). The engine recomputes the
 * canonical state every render cycle, matching the Homepage exactly.
 */
import { resolveCharacterLocation } from '@/lib/locationResolutionEngine';


/**
 * Resolve all user-scoped presence entities for the Travel page.
 * 
 * @param {Object} params
 * @param {Object} params.currentUser - authenticated user
 * @param {Object} params.userSettings - UserSettings record (for user live presence)
 * @param {Array} params.activeCharacters - active_created_character records
 * @param {Array} params.npcFictitious - npc_fictitious records (from backend + RLS queries)
 * @param {Array} params.npcFamilyMembers - npc_family_member records
 * @param {Array} params.allCharacters - all characters in user scope
 * @param {Array} params.locations - location reference records
 * 
 * @returns {Array} normalized presence entities ready for map, popup, counts
 */
export function resolveTravelPresenceEntities({
  currentUser,
  userSettings = null,
  activeCharacters = [],
  npcFictitious = [],
  npcFamilyMembers = [],
  allCharacters = [],
  locations = [],
}) {
  const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
  const normalized = [];
  const seenIds = new Set();

  // DEBUG LOGGING
  const debugLog = (msg) => {
    console.log(`[travelPresenceResolver] ${msg}`);
  };

  debugLog(`Starting resolution: user=${currentUser?.id}, active=${activeCharacters.length}, npc_fict=${npcFictitious.length}, npc_fam=${npcFamilyMembers.length}, locs=${locations.length}`);

  // 0. Include USER as a presence entity when they are not Away
  // Source of truth: UserSettings.user_presence_status + user_current_location_id
  if (currentUser && userSettings) {
    const userPresenceStatus = userSettings.user_presence_status || 'away';
    const userLocationId = userSettings.user_current_location_id || null;
    const userLocationName = userSettings.user_current_location_name || null;
    // Do NOT gate on locationMap[userLocationId] — locations may not be fully loaded yet
    // or the specific location may not be in the local array. Trust UserSettings fields directly.
    console.log("[travelPresenceResolver] user presence check →", {
      user_presence_status: userPresenceStatus,
      user_current_location_id: userLocationId,
      user_current_location_name: userLocationName,
      settingsId: userSettings?.id,
    });
    const isUserPresent = userPresenceStatus === 'present' && !!userLocationId;

    if (isUserPresent) {
      const displayName = userSettings.fictional_world_name || currentUser.full_name || 'You';
      const avatarUrl = currentUser.generated_avatar_urls?.[0] || currentUser.reference_image_urls?.[0] || null;
      normalized.push({
        id: `user_${currentUser.id}`,
        display_name: displayName,
        name: displayName,
        character_type: 'user',
        avatar_url: avatarUrl,
        initials: displayName.charAt(0).toUpperCase(),
        resolved_current_location_id: userLocationId,
        resolved_current_location_name: userLocationName || locationMap[userLocationId]?.name || null,
        resolved_presence_status: 'present',
        residence_location_id: null,
        is_home_resident: false,
        is_currently_present: true,
        is_home: false,
        is_away: false,
        is_user: true,
        source_type: 'user_presence',
        effective_presence_type: 'user',
      });
      debugLog(`+ user: ${displayName} → ${userLocationName || locationMap[userLocationId]?.name}`);
    } else {
      debugLog(`user is Away or has no location — excluded from map`);
    }
  }

  // 1. Include explicit npc_family_member Character records
  npcFamilyMembers.forEach(char => {
    if (seenIds.has(char.id)) return;
    seenIds.add(char.id);
    const normalized_entity = {
      ...normalizeCharacterToPresenceEntity(char, locationMap),
      source_type: 'character_record',
      effective_presence_type: 'npc_family_member',
    };
    debugLog(`+ npc_family_member: ${char.name} (${char.id}) → ${normalized_entity.resolved_current_location_name || '[no location]'}`);
    normalized.push(normalized_entity);
  });

  // 2. Include npc_fictitious records (normal world NPCs)
  npcFictitious.forEach(char => {
    if (seenIds.has(char.id)) return;
    seenIds.add(char.id);
    const normalized_entity = {
      ...normalizeCharacterToPresenceEntity(char, locationMap),
      source_type: 'character_record',
      effective_presence_type: 'npc_fictitious',
    };
    debugLog(`+ npc_fictitious: ${char.name} (${char.id}) → ${normalized_entity.resolved_current_location_name || '[no location]'}`);
    normalized.push(normalized_entity);
  });

  // 3. Include active_created_character records
  activeCharacters.forEach(char => {
    if (seenIds.has(char.id)) return;
    seenIds.add(char.id);
    const normalized_entity = {
      ...normalizeCharacterToPresenceEntity(char, locationMap),
      source_type: 'character_record',
      effective_presence_type: 'active_created_character',
    };
    debugLog(`+ active_created: ${char.name} (${char.id}) → ${normalized_entity.resolved_current_location_name || '[no location]'}`);
    normalized.push(normalized_entity);
  });

  // 4. Internal family members from family_members[] arrays are metadata only
  // They should not be included as world-presence entities automatically.
  // They only appear on the world if they're explicit Character records (npc_family_member type).
  debugLog(`SKIPPING internal family synthesis: ${allCharacters.length} parent characters checked, 0 internal family entities created`);

  debugLog(`FINAL: ${normalized.length} presence entities resolved, ${normalized.filter(e => e.is_currently_present).length} present now`);
  return normalized;
}

/**
 * Normalize a Character record into a presence entity shape.
 *
 * CANONICAL AUTHORITY: uses resolveCharacterLocation() — the same engine as the
 * Homepage CharacterCard. Applies sleep enforcement, work schedule, pre-sleep
 * return window, and home contradiction guard so Travel and Home are always in sync.
 *
 * Previously this read resolved_current_location_id directly from the DB record,
 * which caused divergence when the DB was stale (e.g. character at a bar in DB
 * but sleeping at home per schedule). That direct-read path is REMOVED.
 */
function normalizeCharacterToPresenceEntity(char, locationMap) {
  const homeLocId = char.current_home_location_id || char.home_location_id || null;

  // ── CANONICAL RESOLUTION — same engine as Homepage ───────────────────────
  const canonical = resolveCharacterLocation(char, locationMap);

  const resolvedLocId   = canonical.resolved_current_location_id || null;
  const resolvedLocName = canonical.resolved_current_location_name ||
                          (resolvedLocId ? locationMap[resolvedLocId]?.name : null) || null;
  const resolvedStatus  = canonical.resolved_presence_status || 'away';

  // Character is "currently present" if the resolver gave them a real location.
  // Sleeping characters get their home location — they ARE present (at home, asleep).
  // Only truly locationless characters (no home, no schedule, no visit) are absent.
  const isCurrentlyPresent = !!resolvedLocId;

  const isSleeping = resolvedStatus === 'sleeping' || resolvedStatus === 'napping';

  console.log(`[travelPresenceResolver:normalize] ${char.name} → loc="${resolvedLocName}" status="${resolvedStatus}" sleeping=${isSleeping} source="${canonical.resolved_source_reason}"`);

  return {
    id: char.id,
    display_name: char.display_name || char.primary_name || char.full_name || char.name || 'Unknown',
    name: char.name || 'Unknown',
    character_type: char.character_type,
    avatar_url: char.avatar_url || char.image_avatar_url,
    initials: resolveInitials(char),
    personality_summary: char.personality_summary,
    emotional_state: char.emotional_state,

    resolved_current_location_id: resolvedLocId,
    resolved_current_location_name: resolvedLocName,
    resolved_presence_status: resolvedStatus,
    resolved_source_reason: canonical.resolved_source_reason,
    residence_location_id: homeLocId,

    is_home_resident: !!homeLocId,
    is_currently_present: isCurrentlyPresent,
    is_home: isCurrentlyPresent && !!homeLocId && resolvedLocId === homeLocId,
    is_away: isCurrentlyPresent && !!homeLocId && !!resolvedLocId && resolvedLocId !== homeLocId,
    is_sleeping: isSleeping,
  };
}


/**
 * Resolve initials for display when avatar is missing.
 */
function resolveInitials(char) {
  const name = char.display_name || char.primary_name || char.full_name || char.name || '';
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

/**
 * Get all presence entities currently at a specific location.
 * Returns array of { display_name, avatar_url, initials, resolved_presence_status, is_home_resident, ... }
 */
export function getPresenceAtLocation(location, presenceEntities = []) {
  if (!location) return [];
  
  const here = presenceEntities.filter(entity => {
    // Entity must be currently present at this location
    if (!entity.is_currently_present) return false;
    if (entity.resolved_current_location_id !== location.id) return false;
    return true;
  });
  
  console.log(
    `[getPresenceAtLocation] "${location.name}":`,
    `total=${presenceEntities.length} |`,
    `present=${here.length} |`,
    `present: ${here.map(e => `${e.display_name}(is_present:${e.is_currently_present},loc:${e.resolved_current_location_id})`).join(', ')}`
  );
  
  return here;
}

/**
 * Check if a location appears empty (no residents or current occupants).
 */
export function isLocationEmpty(location, presenceEntities = []) {
  return getPresenceAtLocation(location, presenceEntities).length === 0;
}

/**
 * Return should this character be shown as a presence on the world map?
 */
export function shouldCharacterAppearOnMap(entity, location = null) {
  // Must have resolved location (be somewhere in the world)
  if (!entity.resolved_current_location_id) return false;
  
  // If location is specified, only show if they're there
  if (location && entity.resolved_current_location_id !== location.id) return false;
  
  // Show if present
  return entity.is_currently_present;
}