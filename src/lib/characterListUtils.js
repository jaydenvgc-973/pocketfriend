/**
 * Shared character list utilities for consistent ordering and filtering
 * Used by: MediaGallery, CharacterManager, and other character pickers
 */

/**
 * Fetch and sort characters for character pickers, including the user
 * Active characters appear first, then all others (excluding deleted)
 * User is included as a special profile entity with proper avatar loading
 * @param {Object} base44 - Base44 SDK client
 * @param {string} userEmail - Current user's email
 * @returns {Promise<Array>} Sorted character array with user as first item
 */
export async function fetchCharacterListForPicker(base44, userEmail) {
  if (!userEmail) return [];
  
  // Get current user profile and settings (which may contain avatar data)
  const [user, settingsList] = await Promise.all([
    base44.auth.me().catch(() => null),
    base44.entities.UserSettings.list().catch(() => []),
  ]);
  
  const settings = settingsList?.[0] || {};
  
  // owner_email is the sole ownership source of truth — created_by is permanently forbidden
  const all = await base44.entities.Character.filter({ 
    owner_email: userEmail 
  });
  
  const active = all.filter(c => c.status !== 'deleted');
  
  // Sort: active characters first (sorted by created_date desc), then others
  const activeChars = active
    .filter(c => c.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  const otherChars = active
    .filter(c => !c.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  
  // Include user as special entity at the start
  // Priority: user.avatar_url → generated avatar → reference image → fallback
  let userAvatarUrl = null;
  if (user?.avatar_url) {
    userAvatarUrl = user.avatar_url;
  } else if (settings?.generated_avatar_urls?.[0]) {
    userAvatarUrl = settings.generated_avatar_urls[0];
  } else if (user?.reference_image_urls?.[0]) {
    userAvatarUrl = user.reference_image_urls[0];
  }

  const userEntity = user ? {
    id: 'user',
    name: user.full_name || 'You',
    avatar_url: userAvatarUrl,
    reference_image_urls: user.reference_image_urls || [],
    generated_avatar_urls: user.generated_avatar_urls || [],
    appearance_notes: user.appearance_notes || '',
    age_range: user.age_range || '',
    gender: user.gender || '',
    ethnicities: user.ethnicities || [],
    is_user: true,
  } : null;
  
  return userEntity ? [userEntity, ...activeChars, ...otherChars] : [...activeChars, ...otherChars];
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