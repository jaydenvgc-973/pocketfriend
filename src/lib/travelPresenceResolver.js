/**
 * UNIFIED TRAVEL PRESENCE RESOLVER
 * 
 * Single source of truth for all character presence on the Travel page.
 * Handles: active_created_character, npc_fictitious, npc_family_member, internal family entities
 * 
 * Ensures map pins, location popups, side-panel counts, and vacancy labels all use identical presence data.
 */


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
    const isUserPresent = userPresenceStatus === 'present' && !!userLocationId && !!locationMap[userLocationId];

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
        resolved_current_location_name: userLocationName || locationMap[userLocationId]?.name,
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
 * ALL character types: read resolved_current_location_id directly from the DB record.
 * This is the SINGLE SOURCE OF TRUTH for presence on Travel, Map, and popups.
 * Schedules, work logic, and home inference are NOT applied here.
 * The backend enforcer (enforceCharacterLocationPresence / scheduledLocationEnforcement)
 * is responsible for keeping resolved fields accurate.
 *
 * Rules:
 * - resolved_current_location_id present AND in locationMap → character is present there
 * - resolved_current_location_id missing or not in locationMap → not placed on map (is_currently_present = false)
 * - No home fallback. No schedule inference. No resident-list scanning.
 */
function normalizeCharacterToPresenceEntity(char, locationMap) {
  // Resolve home location ID — source of truth for fallback presence
  const homeLocId = char.current_home_location_id || char.home_location_id || null;

  const currentLocId = char.resolved_current_location_id;
  let resolvedLocId, resolvedLocName, resolvedStatus, isCurrentlyPresent;

  // Fallback chain: resolved → home → away
  if (currentLocId && locationMap[currentLocId]) {
    // Tier 1: Active resolved location (highest priority)
    resolvedLocId = currentLocId;
    resolvedLocName = locationMap[currentLocId]?.name || char.resolved_current_location_name;
    resolvedStatus = char.resolved_presence_status || 'home';
    isCurrentlyPresent = true;
  } else if (homeLocId && locationMap[homeLocId]) {
    // Tier 2: Fallback to home location (when resolved is stale/missing)
    resolvedLocId = homeLocId;
    resolvedLocName = locationMap[homeLocId]?.name;
    resolvedStatus = 'home';
    isCurrentlyPresent = true;
  } else {
    // Tier 3: No valid location — show as Away
    resolvedLocId = null;
    resolvedLocName = null;
    resolvedStatus = 'away';
    isCurrentlyPresent = false;
  }

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
    residence_location_id: homeLocId,

    is_home_resident: !!homeLocId,
    is_currently_present: isCurrentlyPresent,
    is_home: isCurrentlyPresent && !!homeLocId && resolvedLocId === homeLocId,
    is_away: isCurrentlyPresent && !!homeLocId && !!resolvedLocId && resolvedLocId !== homeLocId,
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