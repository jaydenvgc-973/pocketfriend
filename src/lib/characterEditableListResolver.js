/**
 * SHARED CHARACTER RESOLVER FOR SETTINGS MODULES
 * 
 * Enforces strict user scope isolation, character type filtering, and legacy fallbacks.
 * Use this across ALL Settings edit screens.
 * 
 * Rules:
 * - User scope comes FIRST (owner_user_id, owner_email, or assigned scope)
 * - Character type is resolved only AFTER scope validation
 * - Legacy records are safely resolved via fallback chain
 * - NO created_by primary filtering
 * - NO cross-account contamination
 */

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
  if (!allCharacters || !Array.isArray(allCharacters)) return [];
  if (!currentUserId && !currentUserEmail) return [];

  return allCharacters
    .filter(char => {
      // STEP 1: STRICT USER SCOPE VALIDATION (before anything else)
      if (!isCharacterOwnedByCurrentUser(char, currentUserId, currentUserEmail)) {
        return false;
      }

      // STEP 2: RESOLVE CHARACTER TYPE (only if scope is valid)
      const resolvedType = resolveCharacterType(char);

      // STEP 3: APPLY MODULE-LEVEL CHARACTER TYPE RULES
      return isCharacterEligibleForModule(resolvedType, moduleType);
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