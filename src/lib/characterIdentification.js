/**
 * Character Identification System
 * 
 * Characters are recognized by NAME, not by ID numbers.
 * System must not require users to reference ID numbers.
 * 
 * This enforces character identification by name across all systems.
 */

/**
 * Resolve a character by name (or ID as fallback)
 * Returns the character object if found
 */
export async function resolveCharacterByName(nameOrId, characters) {
  if (!nameOrId || !characters) return null;

  // First, try exact name match (case-insensitive)
  let found = characters.find(c => c.name?.toLowerCase() === nameOrId.toLowerCase());
  if (found) return found;

  // Try partial name match
  found = characters.find(c => c.name?.toLowerCase().includes(nameOrId.toLowerCase()));
  if (found) return found;

  // Fallback to ID (should rarely be needed)
  found = characters.find(c => c.id === nameOrId);
  if (found) return found;

  return null;
}

/**
 * Format character reference for display
 * Always shows name, optionally includes other context
 */
export function formatCharacterReference(character) {
  if (!character) return 'Unknown';
  return character.name || `Character (${character.id?.substring(0, 8)}...)`;
}

/**
 * Validate character classification
 */
export function validateCharacterClassification(character) {
  const validTypes = ['npc', 'active', 'default', 'protected', 'user_created', 'merged_alias'];
  const validStatuses = ['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'];

  return {
    typeValid: validTypes.includes(character.character_type),
    statusValid: validStatuses.includes(character.status),
    isActive: character.status === 'active',
    isCreated: character.character_type === 'user_created',
  };
}

/**
 * Classify characters correctly
 * 
 * Rules:
 * - Active Characters: All characters currently in use (status: active)
 * - Created Characters: User-created, account-specific, automatically active
 * - Default Characters: Provided by app, exist for all users, also active
 * - ALL created characters = active characters
 * - Default characters = active characters
 * - Created characters do NOT transfer between accounts (tied to user email)
 */
export function getCharacterClassification(character) {
  return {
    isActive: character.status === 'active',
    isCreated: character.character_type === 'user_created' && character.status === 'active',
    isDefault: character.character_type === 'default' && character.status === 'active',
    isProtected: character.is_protected === true,
    isNpc: character.character_type === 'npc',
    isMerged: character.character_type === 'merged_alias',
  };
}