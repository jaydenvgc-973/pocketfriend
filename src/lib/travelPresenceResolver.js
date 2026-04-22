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
 * @param {Array} params.activeCharacters - active_created_character records
 * @param {Array} params.npcFictitious - npc_fictitious records (from backend + RLS queries)
 * @param {Array} params.npcFamilyMembers - npc_family_member records (from created_by + owner_email queries)
 * @param {Array} params.allCharacters - all characters in user scope (used to find internal family)
 * @param {Array} params.locations - location reference records
 * 
 * @returns {Array} normalized presence entities ready for map, popup, counts
 */
export function resolveTravelPresenceEntities({
  currentUser,
  activeCharacters = [],
  npcFictitious = [],
  npcFamilyMembers = [],
  allCharacters = [],
  locations = [],
}) {
  const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
  const normalized = [];
  const seenIds = new Set();

  // 1. Include explicit npc_family_member Character records
  npcFamilyMembers.forEach(char => {
    if (seenIds.has(char.id)) return;
    seenIds.add(char.id);
    normalized.push({
      ...normalizeCharacterToPresenceEntity(char, locationMap),
      source_type: 'character_record',
      effective_presence_type: 'npc_family_member',
    });
  });

  // 2. Include npc_fictitious records (normal world NPCs)
  npcFictitious.forEach(char => {
    if (seenIds.has(char.id)) return;
    seenIds.add(char.id);
    normalized.push({
      ...normalizeCharacterToPresenceEntity(char, locationMap),
      source_type: 'character_record',
      effective_presence_type: 'npc_fictitious',
    });
  });

  // 3. Include active_created_character records
  activeCharacters.forEach(char => {
    if (seenIds.has(char.id)) return;
    seenIds.add(char.id);
    normalized.push({
      ...normalizeCharacterToPresenceEntity(char, locationMap),
      source_type: 'character_record',
      effective_presence_type: 'active_created_character',
    });
  });

  // 4. Discover and normalize internal family entities from parent characters
  // These are family_members[] arrays on Character records
  allCharacters.forEach(parentChar => {
    if (!parentChar.family_members || !Array.isArray(parentChar.family_members)) return;
    
    parentChar.family_members.forEach((familyMember, idx) => {
      if (!familyMember.name) return;
      
      const syntheticId = `internal_family_${parentChar.id}_${idx}`;
      if (seenIds.has(syntheticId)) return;
      seenIds.add(syntheticId);

      // Internal family members inherit parent's home location unless assigned elsewhere
      const homeLocationId = parentChar.current_home_location_id;
      const isHomeResident = homeLocationId ? true : false;

      normalized.push({
        id: syntheticId,
        display_name: familyMember.name,
        name: familyMember.name,
        character_type: 'npc_family_member',
        effective_presence_type: 'npc_family_member',
        avatar_url: null,
        image_avatar_url: null,
        initials: familyMember.name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase(),
        
        // Presence truth: internal family defaults to parent's home
        resolved_current_location_id: homeLocationId,
        resolved_current_location_name: homeLocationId ? locationMap[homeLocationId]?.name : null,
        resolved_presence_status: 'home',
        residence_location_id: homeLocationId,
        
        is_home_resident: isHomeResident,
        is_currently_present: isHomeResident, // default to home unless proven away
        is_away: false,
        is_home: true,
        
        // Metadata
        source_type: 'internal_family',
        parent_character_id: parentChar.id,
        parent_character_name: parentChar.name || parentChar.display_name,
        relationship_type: familyMember.relationship_type,
      });
    });
  });

  return normalized;
}

/**
 * Normalize a Character record into a presence entity shape.
 * Handles missing fields, legacy names, and fallbacks.
 */
function normalizeCharacterToPresenceEntity(char, locationMap) {
  const homeLocId = char.current_home_location_id;
  const currentLocId = char.resolved_current_location_id;

  // Determine if home resident (assigned to live somewhere)
  const isHomeResident = !!homeLocId;

  // Resolve current location truth
  let resolvedLocId = currentLocId;
  let resolvedLocName = char.resolved_current_location_name;
  let resolvedStatus = char.resolved_presence_status || 'home';
  let isCurrentlyPresent = false;

  if (currentLocId) {
    // Character is explicitly at a location
    resolvedLocId = currentLocId;
    resolvedLocName = locationMap[currentLocId]?.name || char.resolved_current_location_name;
    isCurrentlyPresent = true;
  } else if (homeLocId && !char.travel_status?.includes('traveling')) {
    // HOME FALLBACK: No explicit location but assigned home and not traveling
    resolvedLocId = homeLocId;
    resolvedLocName = locationMap[homeLocId]?.name;
    resolvedStatus = 'home';
    isCurrentlyPresent = true;
  }

  return {
    id: char.id,
    display_name: char.display_name || char.primary_name || char.full_name || char.name || 'Unknown',
    name: char.name || 'Unknown',
    character_type: char.character_type,
    avatar_url: char.avatar_url || char.image_avatar_url,
    initials: resolveInitials(char),
    
    // Presence truth
    resolved_current_location_id: resolvedLocId,
    resolved_current_location_name: resolvedLocName,
    resolved_presence_status: resolvedStatus,
    residence_location_id: homeLocId,
    
    is_home_resident: isHomeResident,
    is_currently_present: isCurrentlyPresent,
    is_away: resolvedStatus === 'away' || (currentLocId && currentLocId !== homeLocId && !isHomeResident),
    is_home: resolvedStatus === 'home' || (!currentLocId && homeLocId),
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
  
  return presenceEntities.filter(entity => {
    // Entity must be currently present at this location
    if (!entity.is_currently_present) return false;
    if (entity.resolved_current_location_id !== location.id) return false;
    return true;
  });
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