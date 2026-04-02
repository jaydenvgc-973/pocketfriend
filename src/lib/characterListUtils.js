/**
 * Shared character list utilities for consistent ordering and filtering
 * Used by: MediaGallery, CharacterManager, and other character pickers
 */

/**
 * Fetch and sort characters for character pickers
 * Active characters appear first, then all others (excluding deleted)
 * @param {Object} base44 - Base44 SDK client
 * @param {string} userEmail - Current user's email
 * @returns {Promise<Array>} Sorted character array
 */
export async function fetchCharacterListForPicker(base44, userEmail) {
  if (!userEmail) return [];
  
  // Fetch all non-deleted characters created by user
  const all = await base44.entities.Character.filter({ 
    created_by: userEmail 
  });
  
  const active = all.filter(c => c.status !== 'deleted');
  
  // Sort: active characters first (sorted by created_date desc), then others
  const activeChars = active
    .filter(c => c.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  const otherChars = active
    .filter(c => !c.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  return [...activeChars, ...otherChars];
}

/**
 * Get display info for a character in pickers
 * Handles active status badging and visual indicators
 */
export function getCharacterDisplayInfo(character) {
  return {
    id: character.id,
    name: character.name,
    avatar_url: character.avatar_url,
    is_active: character.is_active_character || false,
    status: character.status,
  };
}