/**
 * Unified user identity-preserving image generation logic
 * Used by both Travel/Scene pages and Media Grid
 * Ensures consistent user visual identity across all image generation
 */

import { base44 } from "@/api/base44Client";

/**
 * Build user reference images with strict identity preservation
 * Priority: uploaded reference images > generated avatars > primary avatar
 * @param {Object} userChar - User character/profile entity
 * @returns {Array<string>} Prioritized reference image URLs
 */
export function buildUserReferenceImages(userChar) {
  if (!userChar) return [];
  
  const refs = [];
  
  // 1. HIGHEST PRIORITY: Uploaded reference images (strongest identity lock)
  if (userChar.reference_image_urls?.length > 0) {
    refs.push(...userChar.reference_image_urls.slice(0, 3));
  }
  
  // 2. MEDIUM PRIORITY: Generated avatars
  if (userChar.generated_avatar_urls?.length > 0) {
    refs.push(...userChar.generated_avatar_urls.slice(0, 2));
  }
  
  // 3. LOWEST PRIORITY: Primary avatar as fallback
  if (userChar.avatar_url && !refs.includes(userChar.avatar_url)) {
    refs.push(userChar.avatar_url);
  }
  
  return refs;
}

/**
 * Build appearance data for user identity preservation in prompts
 * @param {Object} userChar - User character/profile entity
 * @returns {Object} Appearance data (age, gender, ethnicities, notes)
 */
export function buildUserAppearanceData(userChar) {
  if (!userChar) return null;
  
  return {
    appearance_notes: userChar.appearance_notes || '',
    age_range: userChar.age_range || '',
    gender: userChar.gender || '',
    ethnicities: userChar.ethnicities || [],
  };
}

/**
 * Generate image with strict user identity preservation
 * Reusable by both Travel/Scene pages and Media Grid
 * 
 * @param {string} prompt - The user-facing scene prompt (without system instructions)
 * @param {Array<string>} characterReferenceImages - Reference images for other characters in scene
 * @param {Array<string>} locationImages - Location/zone reference images (optional)
 * @param {Object} currentUser - Current user profile
 * @param {Object} userAppearanceData - User appearance (age, gender, ethnicity)
 * @param {boolean} strictMode - If true, enforce maximum identity preservation (MANDATORY for user)
 * @returns {Promise<string>} Generated image URL
 */
export async function generateImageWithUserIdentity(
  prompt,
  characterReferenceImages = [],
  locationImages = [],
  currentUser,
  userAppearanceData,
  strictMode = true
) {
  if (!prompt || !currentUser) throw new Error("prompt and currentUser required");
  
  // Build user reference images with strict priority
  const userReferences = buildUserReferenceImages(currentUser);
  
  // Combine location + character refs + user refs (user gets 2–3 slots min)
  const locationCount = Math.min(locationImages.length, 2);
  const charCount = Math.min(characterReferenceImages.length, 2);
  const userCount = Math.min(userReferences.length, 3);
  
  const finalRefs = [
    ...locationImages.slice(0, locationCount),
    ...characterReferenceImages.slice(0, charCount),
    ...userReferences.slice(0, userCount),
  ].filter(Boolean);
  
  // Build identity lock note
  const identityLockNote = buildUserIdentityLockNote(userAppearanceData, strictMode);
  
  // Enhance prompt with identity constraints
  const enhancedPrompt = `${prompt}${identityLockNote}`;
  
  try {
    const response = await base44.integrations.Core.GenerateImage({
      prompt: enhancedPrompt,
      existing_image_urls: finalRefs.length > 0 ? finalRefs : undefined,
    });
    
    if (!response?.url) throw new Error("No image URL returned");
    return response.url;
  } catch (err) {
    console.error("[User Identity Generation]", err);
    throw err;
  }
}

/**
 * Build the identity lock note for strict user preservation
 * @private
 */
function buildUserIdentityLockNote(userAppearanceData, strictMode = false) {
  if (!userAppearanceData) return "";
  
  const parts = [];
  if (userAppearanceData.age_range) parts.push(`Age: ${userAppearanceData.age_range}`);
  if (userAppearanceData.gender) parts.push(`Gender: ${userAppearanceData.gender}`);
  if (userAppearanceData.ethnicities?.length > 0) parts.push(`Ethnicity: ${userAppearanceData.ethnicities.join(', ')}`);
  if (userAppearanceData.appearance_notes) parts.push(`Details: ${userAppearanceData.appearance_notes}`);

  const strictWarning = strictMode ? `
⚠️ STRICT IDENTITY LOCK FOR THIS PERSON ⚠️
Do NOT allow ANY deviation from the provided reference images.
Do NOT beautify, normalize, or substitute this person's appearance.
Do NOT drift into a "generic face" when additional subjects are present.
The reference images are the source of truth. Replicate them with maximum fidelity.
` : '';

  return `
════════════════════════════════════════════════════════════
USER IDENTITY LOCK — STRICT VISUAL CONSISTENCY
════════════════════════════════════════════════════════════
${parts.length > 0 ? parts.join('\n') : 'Use reference images as identity guide'}
${strictWarning}
WHAT IS LOCKED:
✓ Face shape and bone structure
✓ Skin tone and texture
✓ Hair color, texture, length, style
✓ Eyes (color, shape, spacing)
✓ Nose (shape, size, profile)
✓ Mouth and lips
✓ Body build and proportions
✓ Distinctive facial features

PROHIBITED:
✗ Swapping faces or using generic models
✗ Beautifying away unique characteristics
✗ Letting identity drift when other subjects are included
✗ Using a "more model-like" version

This is a specific real person. They must be recognizable and consistent.
════════════════════════════════════════════════════════════`;
}