/**
 * UNIFIED CHARACTER RESOLVER
 * 
 * Enforces strict user scope isolation, character type filtering, and legacy fallbacks.
 * Use this across ALL character discovery:
 * - Settings modules
 * - Homepage character cards and NPC contacts
 * - Residency hydration
 * - Character listing and filtering
 * 
 * Rules:
 * - User scope comes FIRST (owner_user_id, owner_email, or assigned scope)
 * - Character type is resolved only AFTER scope validation
 * - Legacy records are safely resolved via fallback chain
 * - NO created_by primary filtering
 * - NO cross-account contamination
 * - Service-created records are included if user-owned
 */

/**
 * CORE RESOLVER: Get all user-scoped characters with resolved types.
 * This is the foundation for ALL character discovery.
 * 
 * @param {Array} allCharacters - raw character list from query
 * @param {string} currentUserId - logged-in user ID
 * @param {string} currentUserEmail - logged-in user email
 * @returns {Array} all characters owned by current user with resolved types
 */
export function resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail) {
  if (!allCharacters || !Array.isArray(allCharacters)) return [];
  if (!currentUserId && !currentUserEmail) return [];

  return allCharacters
    .filter(char => isCharacterOwnedByCurrentUser(char, currentUserId, currentUserEmail))
    .map(char => ({
      ...char,
      _resolvedType: resolveCharacterType(char),
      _displayName: resolveDisplayName(char),
      _avatarUrl: resolveAvatarUrl(char),
    }));
}

/**
 * Resolve which characters are eligible for editing in a given Settings module.
 * 
 * @param {Array} allCharacters - raw character list from query
 * @param {string} currentUserId - logged-in user ID
 * @param {string} currentUserEmail - logged-in user email
 * @param {string} moduleType - Settings module: "story", "photos", "emotions", "relationships", "traits", "religion", "locations", "work_school", "needs"
 * @returns {Array} filtered and validated characters eligible for editing
 */
export function getEditableCharactersForModule(allCharacters, currentUserId, currentUserEmail, moduleType) {
  const scoped = resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail);
  
  return scoped.filter(char => isCharacterEligibleForModule(char._resolvedType, moduleType));
}

/**
 * Get characters for homepage display.
 * 
 * @returns {Object} { activeCharacters, npcFictitious }
 */
export function getCharactersForHomepage(allCharacters, currentUserId, currentUserEmail) {
  const scoped = resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail);
  
  return {
    activeCharacters: scoped.filter(c => c._resolvedType === 'active_created_character'),
    npcFictitious: scoped.filter(c => c._resolvedType === 'npc_fictitious'),
  };
}

/**
 * Get settings character list with strict type ordering.
 * Order: user, active_created_character, npc_fictitious, npc_family_member
 * 
 * @returns {Array} ordered list suitable for Settings → Manage Characters
 */
export function getCharactersForSettingsList(allCharacters, currentUserId, currentUserEmail, currentUserObject) {
  const scoped = resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail);
  
  // Define sort order
  const typeOrder = {
    'user': 0,
    'active_created_character': 1,
    'npc_fictitious': 2,
    'npc_family_member': 3,
    'npc_regular': 4,
    'unknown': 5,
  };
  
  const userCharacters = scoped.filter(c => c._resolvedType === 'active_created_character' || c._resolvedType === 'npc_fictitious' || c._resolvedType === 'npc_family_member');
  
  // Sort by type order, then by name
  return userCharacters.sort((a, b) => {
    const aOrder = typeOrder[a._resolvedType] ?? 99;
    const bOrder = typeOrder[b._resolvedType] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a._displayName || '').localeCompare(b._displayName || '');
  });
}

/**
 * Check if a character belongs to the current user's scope.
 * Uses safe fallback chain to handle legacy records.
 */
function isCharacterOwnedByCurrentUser(character, currentUserId, currentUserEmail) {
  if (!character) return false;

  // Fallback chain for ownership (in order of reliability):
  
  // 1. owner_user_id (most explicit)
  if (character.owner_user_id && character.owner_user_id === currentUserId) {
    return true;
  }

  // 2. owner_email
  if (character.owner_email && character.owner_email === currentUserEmail) {
    return true;
  }

  // 3. created_by as last resort (only if it matches current user email)
  // BUT: if created_by exists AND differs from owner fields, prefer owner fields
  if (character.created_by === currentUserEmail && !character.owner_user_id && !character.owner_email) {
    return true;
  }

  // 4. Explicitly scoped to user (data_scope: "private_user" implies direct ownership)
  if (character.data_scope === 'private_user' && character.created_by === currentUserEmail) {
    return true;
  }

  // 5. Check assigned_user_id or profile_owner (legacy migrations)
  if (character.assigned_user_id === currentUserId) {
    return true;
  }
  if (character.profile_owner === currentUserEmail) {
    return true;
  }

  // If we can't confirm ownership, exclude (fail-safe for cross-account contamination)
  return false;
}

/**
 * Resolve character type safely, handling legacy records.
 * Only call after user scope is validated.
 */
function resolveCharacterType(character) {
  if (!character) return 'unknown';

  // If character_type is explicitly set and valid, use it
  const validTypes = ['active_created_character', 'npc_fictitious', 'npc_family_member', 'npc_regular', 'ambient'];
  if (character.character_type && validTypes.includes(character.character_type)) {
    return character.character_type;
  }

  // LEGACY FALLBACK: infer type from behavior/data if character_type is missing
  // Only do this after confirming the character belongs to current user

  // If it has full editable story, needs, photos, etc. → active_created_character
  if (hasFullEditableProfile(character)) {
    return 'active_created_character';
  }

  // If it's in "People in their world" and is standalone (not family) → npc_fictitious
  if (character.fictional_relationships && !character.is_family_member) {
    return 'npc_fictitious';
  }

  // If it's explicitly marked as family → npc_family_member
  if (character.is_family_member || character.relationship_type === 'family') {
    return 'npc_family_member';
  }

  // Default fallback: treat as regular_npc (safest, most restricted)
  return 'npc_regular';
}

/**
 * Check if character has full editable profile (legacy type resolution heuristic).
 */
function hasFullEditableProfile(character) {
  // Characters with these traits are likely active_created_character
  const hasProfileData = character.backstory || character.personality_traits || character.emotional_state;
  const hasSchedule = character.wake_up_time || character.sleep_start_time;
  const hasNeeds = character.hunger_value !== undefined || character.energy_value !== undefined;
  
  return hasProfileData && (hasSchedule || hasNeeds);
}

/**
 * Safely resolve display name for a character.
 */
function resolveDisplayName(character) {
  return character.display_name || character.primary_name || character.full_name || character.name || 'Unknown';
}

/**
 * Safely resolve avatar URL for a character.
 */
function resolveAvatarUrl(character) {
  return character.avatar_url || character.image_avatar_url || null;
}

/**
 * Resolve initials for fallback avatar display.
 */
function resolveInitials(character) {
  const name = resolveDisplayName(character);
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Determine if a resolved character type is eligible for a specific Settings module.
 */
function isCharacterEligibleForModule(resolvedType, moduleType) {
  // Most Settings modules: active_created_character + npc_fictitious
  const standardAllowed = ['active_created_character', 'npc_fictitious'];

  switch (moduleType) {
    // Special case: Needs editing is ONLY for active_created_character
    case 'needs':
      return resolvedType === 'active_created_character';

    // Standard modules: allow active_created + npc_fictitious
    case 'story':
    case 'photos':
    case 'emotions':
    case 'relationships':
    case 'traits':
    case 'religion':
    case 'locations':
    case 'work_school':
    case 'default_character':
    case 'profile':
      return standardAllowed.includes(resolvedType);

    // Fallback: deny unknown modules
    default:
      return false;
  }
}

/**
 * Helper: Hydrate a character ID to a displayable character object.
 * Used for residency lists, relationship displays, etc.
 * 
 * Returns { name, avatarUrl, type, fallback } suitable for UI rendering.
 */
export function hydrateCharacterReference(characterId, allCharacters, currentUserId, currentUserEmail) {
  const char = allCharacters.find(c => c.id === characterId);
  if (!char) {
    return null;
  }
  
  // Validate it's in current user scope
  if (!isCharacterOwnedByCurrentUser(char, currentUserId, currentUserEmail)) {
    return null;
  }
  
  return {
    id: char.id,
    name: resolveDisplayName(char),
    avatarUrl: resolveAvatarUrl(char),
    type: resolveCharacterType(char),
    initials: resolveInitials(char),
  };
}

/**
 * Helper: Get minimal character info for a character ID lookup.
 * Ensures the lookup result respects user scope.
 */
export function findCharacterInScope(characterId, allCharacters, currentUserId, currentUserEmail) {
  const char = allCharacters.find(c => c.id === characterId);
  if (!char) return null;
  
  // Validate it's in current user scope
  if (!isCharacterOwnedByCurrentUser(char, currentUserId, currentUserEmail)) {
    return null;
  }
  
  return char;
}