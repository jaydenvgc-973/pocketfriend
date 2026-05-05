/**
 * CHARACTER LOCATION ASSIGNMENT SYSTEM
 * 
 * Rules:
 * - All types can be assigned: active_created_character, npc_fictitious, npc_family_member
 * - Location display must hydrate IDs to names + avatars
 * - "Who lives here" must show names (never raw IDs)
 */

/**
 * Check if a character can be assigned to a residence
 * All types are eligible
 */
export function canAssignToResidence(character) {
  if (!character) return false;
  // All character types can be assigned to residences
  return ['active_created_character', 'npc_fictitious', 'npc_family_member'].includes(character.character_type);
}

/**
 * Check if a character can be assigned to work location
 * All types are eligible (with age restrictions if applicable)
 */
export function canAssignToWork(character) {
  if (!character) return false;
  // All character types can be assigned to work
  return ['active_created_character', 'npc_fictitious', 'npc_family_member'].includes(character.character_type);
}

/**
 * Check if a character can be assigned to school
 * All types are eligible
 */
export function canAssignToSchool(character) {
  if (!character) return false;
  // All character types can be assigned to school
  return ['active_created_character', 'npc_fictitious', 'npc_family_member'].includes(character.character_type);
}

/**
 * Get all characters eligible for location assignment (residence, work, school)
 * Includes all user-scoped characters of valid types
 */
export function getLocationAssignableCharacters(allCharacters, currentUserId, currentUserEmail, filterByType = null) {
  if (!allCharacters || !Array.isArray(allCharacters)) return [];
  
  // Filter to user scope and valid types
  const validTypes = ['active_created_character', 'npc_fictitious', 'npc_family_member'];
  
  return allCharacters.filter(char => {
    // Must be user-scoped
    if (!isCharacterOwnedByUser(char, currentUserId, currentUserEmail)) {
      return false;
    }
    
    // Must be valid type
    const charType = resolveCharacterType(char);
    if (!validTypes.includes(charType)) {
      return false;
    }
    
    // If filterByType specified, must match
    if (filterByType && charType !== filterByType) {
      return false;
    }
    
    return true;
  });
}

/**
 * Helper: Check ownership (same as resolver)
 */
function isCharacterOwnedByUser(character, currentUserId, currentUserEmail) {
  if (!character) return false;
  
  // owner_email is the sole ownership source of truth — created_by is permanently forbidden
  if (character.owner_user_id && character.owner_user_id === currentUserId) return true;
  if (character.owner_email && character.owner_email === currentUserEmail) return true;
  if (character.assigned_user_id === currentUserId) return true;
  if (character.profile_owner === currentUserEmail) return true;
  
  return false;
}

/**
 * Helper: Resolve character type (same as resolver)
 */
function resolveCharacterType(character) {
  if (!character) return 'unknown';
  
  const validTypes = ['active_created_character', 'npc_fictitious', 'npc_family_member', 'npc_regular', 'ambient'];
  if (character.character_type && validTypes.includes(character.character_type)) {
    return character.character_type;
  }
  
  // Infer from data
  if (character.is_family_member || character.relationship_type === 'family') {
    return 'npc_family_member';
  }
  
  if (character.fictional_relationships && !character.is_family_member) {
    return 'npc_fictitious';
  }
  
  if (character.backstory || character.personality_traits || character.emotional_state) {
    if (character.wake_up_time || character.sleep_start_time || character.hunger_value !== undefined) {
      return 'active_created_character';
    }
  }
  
  return 'npc_regular';
}