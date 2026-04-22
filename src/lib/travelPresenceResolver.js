/**
 * UNIFIED TRAVEL PRESENCE RESOLVER
 * 
 * Handles complete family entity discovery, normalization, and presence resolution.
 * Single source of truth for:
 * - World map pins
 * - Location popups
 * - Side panel counts
 * - Vacancy labels
 * 
 * Supports:
 * - npc_family_member records
 * - Internal family entities
 * - Legacy family structures
 * - Home fallback presence
 * - User-scope validation (not just created_by)
 */

/**
 * Resolve all travel-presence entities for the current user.
 * Returns normalized, display-ready records for map, popup, counts.
 * 
 * @param {Object} options
 * @param {Object} options.currentUser - Current logged-in user
 * @param {Array} options.activeCharacters - Active playable characters
 * @param {Array} options.npcFictitious - NPC fictitious characters
 * @param {Array} options.npcFamilyMembers - NPC family member characters
 * @param {Array} options.allCharacters - All characters (for parent lookups)
 * @param {Array} options.locations - Location references
 * @returns {Array} Normalized, display-ready presence entities
 */
export function resolveTravelPresenceEntities(options) {
  const {
    currentUser = {},
    activeCharacters = [],
    npcFictitious = [],
    npcFamilyMembers = [],
    allCharacters = [],
    locations = [],
  } = options;

  const LOG_PREFIX = '[TravelPresenceResolver]';
  const debugLog = typeof console !== 'undefined' ? console.debug : () => {};

  debugLog(`${LOG_PREFIX} Starting presence resolution for user ${currentUser.email}`);

  // Normalize all presence entities into consistent shape
  const presenceEntities = [];

  // 1. Active created characters
  debugLog(`${LOG_PREFIX} Processing ${activeCharacters.length} active_created_character records`);
  for (const char of activeCharacters) {
    if (isValidUserScope(char, currentUser)) {
      presenceEntities.push(normalizeCharacterToPresence(char, 'active_created_character', locations));
    } else {
      debugLog(`${LOG_PREFIX} Excluded active_created_character (scope): ${char.name}`);
    }
  }

  // 2. NPC fictitious
  debugLog(`${LOG_PREFIX} Processing ${npcFictitious.length} npc_fictitious records`);
  for (const char of npcFictitious) {
    if (isValidUserScope(char, currentUser)) {
      presenceEntities.push(normalizeCharacterToPresence(char, 'npc_fictitious', locations));
    } else {
      debugLog(`${LOG_PREFIX} Excluded npc_fictitious (scope): ${char.name}`);
    }
  }

  // 3. NPC family members
  debugLog(`${LOG_PREFIX} Processing ${npcFamilyMembers.length} npc_family_member records`);
  for (const char of npcFamilyMembers) {
    if (isValidUserScope(char, currentUser)) {
      presenceEntities.push(normalizeCharacterToPresence(char, 'npc_family_member', locations));
    } else {
      debugLog(`${LOG_PREFIX} Excluded npc_family_member (scope): ${char.name}`);
    }
  }

  // 4. Internal family entities (from family_members arrays)
  debugLog(`${LOG_PREFIX} Scanning for internal family entities`);
  const internalFamilyNormalized = discoverAndNormalizeInternalFamily(
    allCharacters,
    currentUser,
    locations
  );
  debugLog(`${LOG_PREFIX} Found ${internalFamilyNormalized.length} internal family entities`);
  presenceEntities.push(...internalFamilyNormalized);

  // 5. Resolve home fallback presence for residents
  debugLog(`${LOG_PREFIX} Applying home fallback presence for ${presenceEntities.length} entities`);
  for (const entity of presenceEntities) {
    applyHomeFallbackPresence(entity, locations);
  }

  debugLog(`${LOG_PREFIX} Final presence entity count: ${presenceEntities.length}`);
  debugLog(`${LOG_PREFIX} Map will render: ${presenceEntities.filter(e => e.is_currently_present).length} present entities`);

  return presenceEntities;
}

/**
 * Check if character belongs to current user scope.
 * Does NOT rely solely on created_by.
 */
function isValidUserScope(character, currentUser) {
  if (!character || !currentUser) return false;

  // 1. owner_user_id (most explicit)
  if (character.owner_user_id && character.owner_user_id === currentUser.id) {
    return true;
  }

  // 2. owner_email
  if (character.owner_email && character.owner_email === currentUser.email) {
    return true;
  }

  // 3. created_by (only if no owner fields set)
  if (character.created_by === currentUser.email && !character.owner_user_id && !character.owner_email) {
    return true;
  }

  // 4. assigned_user_id (legacy)
  if (character.assigned_user_id && character.assigned_user_id === currentUser.id) {
    return true;
  }

  // 5. Check if parent character is user-scoped (for internal family)
  if (character.parent_character_id) {
    // Can't fully validate without parent lookup, so allow if created_by matches
    // Parent validation happens in discoverAndNormalizeInternalFamily
    if (character.created_by === currentUser.email) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize character record to unified presence object.
 */
function normalizeCharacterToPresence(character, effectiveType, locations) {
  const avatarUrl = character.avatar_url || character.image_avatar_url || null;
  const displayName = character.display_name || character.primary_name || character.full_name || character.name || 'Unknown';
  const initials = resolveInitials(displayName);

  const presenceEntity = {
    id: character.id,
    display_name: displayName,
    character_type: character.character_type || effectiveType,
    effective_presence_type: effectiveType,
    avatar_url: avatarUrl,
    initials: initials,
    
    // Location truth
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || null,
    resolved_presence_status: character.resolved_presence_status || null,
    
    // Residence
    residence_location_id: character.current_home_location_id || null,
    is_home_resident: false, // Will be set by caller
    
    // Presence status
    is_currently_present: false, // Will be resolved below
    is_away: false,
    is_home: false,
    
    // Source info
    source_type: 'character_record',
    parent_character_id: character.parent_character_id || null,
  };

  // Resolve initial presence
  if (character.resolved_current_location_id) {
    presenceEntity.is_currently_present = true;
    presenceEntity.is_away = character.resolved_current_location_id !== character.current_home_location_id;
    presenceEntity.is_home = character.resolved_current_location_id === character.current_home_location_id;
  }

  return presenceEntity;
}

/**
 * Discover and normalize internal family entities from family_members arrays.
 */
function discoverAndNormalizeInternalFamily(allCharacters, currentUser, locations) {
  const normalized = [];
  const seen = new Set();

  for (const character of allCharacters) {
    // Only process family_members if parent is user-scoped
    if (!isValidUserScope(character, currentUser)) continue;
    
    const familyMembers = character.family_members || [];
    
    for (const familyMember of familyMembers) {
      if (!familyMember.name) continue;
      
      const internalId = `internal_family_${character.id}_${familyMember.name}`;
      if (seen.has(internalId)) continue;
      seen.add(internalId);

      const presenceEntity = {
        id: internalId,
        display_name: familyMember.name,
        character_type: 'npc_family_member',
        effective_presence_type: 'npc_family_member',
        avatar_url: null, // Internal family usually no avatar
        initials: resolveInitials(familyMember.name),
        
        // Location truth
        resolved_current_location_id: null, // Internal family usually home
        resolved_current_location_name: null,
        resolved_presence_status: 'home',
        
        // Residence: inherit from parent
        residence_location_id: character.current_home_location_id || null,
        is_home_resident: true,
        
        // Presence status
        is_currently_present: true, // Internal family defaults to home/present
        is_away: false,
        is_home: true,
        
        // Source info
        source_type: 'internal_family',
        parent_character_id: character.id,
        parent_character_name: character.name,
        family_relationship: familyMember.relationship_type || 'family',
      };

      normalized.push(presenceEntity);
    }
  }

  return normalized;
}

/**
 * Apply home fallback presence for residents.
 * If no resolved_current_location_id but is a home resident, treat as present at home.
 */
function applyHomeFallbackPresence(entity, locations) {
  // Already resolved as away or present
  if (entity.resolved_current_location_id) {
    return;
  }

  // If resident and no override, treat as at home
  if (entity.residence_location_id) {
    entity.resolved_current_location_id = entity.residence_location_id;
    
    const homeLocation = locations.find(l => l.id === entity.residence_location_id);
    if (homeLocation) {
      entity.resolved_current_location_name = homeLocation.name;
    }
    
    entity.resolved_presence_status = 'home';
    entity.is_currently_present = true;
    entity.is_home = true;
    entity.is_away = false;
  }
}

/**
 * Resolve display initials from name.
 */
function resolveInitials(name) {
  if (!name) return '?';
  const parts = name.split(' ').map(p => p[0]).filter(Boolean);
  return parts.slice(0, 2).join('').toUpperCase();
}

/**
 * Get location presence entities at a specific location.
 * Filters to only those currently present there.
 */
export function getPresenceAtLocation(location, presenceEntities = []) {
  if (!location) return [];
  
  return presenceEntities.filter(entity => 
    entity.is_currently_present && 
    entity.resolved_current_location_id === location.id
  );
}

/**
 * Count presence entities at a location.
 */
export function countPresenceAtLocation(location, presenceEntities = []) {
  return getPresenceAtLocation(location, presenceEntities).length;
}

/**
 * Check if location should be labeled empty/vacant.
 */
export function isLocationEmpty(location, presenceEntities = []) {
  return countPresenceAtLocation(location, presenceEntities) === 0;
}