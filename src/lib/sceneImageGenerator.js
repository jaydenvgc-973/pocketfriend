/**
 * Scene Image Generation Pipeline
 *
 * Handles image generation for scene pages with strict enforcement of:
 * - Avatar identity lock (characters must match avatars exactly)
 * - Zone-lock (images must belong to currently selected zone only)
 * - Residential privacy (home scenes show residents only)
 * 
 * CRITICAL: appearance_lock controls identity. Closet/current_outfit controls clothing.
 * Avatar/reference images are for identity ONLY — never for clothing.
 */

import { buildAppearanceLockBlock, enforceValidation } from './appearanceLockValidator.js';

/**
 * Validates and filters environment references to ONLY the active zone.
 * @param {Array} allEnvRefs - all available location images
 * @param {Array} activeZoneImages - images from currently selected zone
 * @param {string} activeZoneName - name of currently selected zone
 * @returns {Array} zone-locked images only
 */
export function enforceZoneLock(allEnvRefs, activeZoneImages, activeZoneName) {
  // STRICT: only accept images from active zone
  const validImages = allEnvRefs.filter(img => activeZoneImages.includes(img));
  
  console.log(
    `[sceneImageGenerator] ZONE-LOCK: zone="${activeZoneName}" | total refs=${allEnvRefs.length} | zone-locked=${validImages.length}`
  );

  // If no images in active zone, return empty — NO fallback to other zones
  if (validImages.length === 0) {
    console.warn(
      `[sceneImageGenerator] NO IMAGES IN ZONE "${activeZoneName}" — will generate without reference images`
    );
  }

  return validImages;
}

/**
 * Builds the identity lock enforcement block for image generation.
 * CRITICAL: Uses appearance_lock, NOT avatar appearance.
 * Avatar is identity reference only — appearance_lock defines exact traits.
 * Clothing must NEVER come from avatar/reference images.
 */
export function buildAvatarIdentityBlock(characters) {
  if (!characters || characters.length === 0) return '';
  
  // Build appearance lock block for each character from their appearance_lock fields
  let blocks = '';
  for (const char of characters) {
    blocks += buildAppearanceLockBlock(char);
  }
  
  return blocks;
}

/**
 * Constructs the full scene image generation prompt with all enforcement rules.
 * CRITICAL: Validates appearance_lock and outfit separation before returning.
 */
export function buildScenePrompt({
  envNote = '',
  locationName = '',
  zoneSuffix = '',
  timeOfDay = 'day',
  atmosphere = '',
  peopleConstraint = '',
  residentialConstraint = '',
  identityLock = '',
  avatarIdentityBlock = '',
  outfitSuffix = '',
  isResidential = false,
  characters = [],
}) {
  // Human presence purity enforcement for scene images
  const expectedCount = characters?.length || 0;
  const humanPurityEnforcement = `
⛔ HUMAN PRESENCE PURITY LAW: Only ${expectedCount} declared subject(s) may appear.
No background extras. No ambient patrons. No silhouettes. No reflections of undeclared people.
No location owners, workers, residents, or family members unless explicitly declared as a subject.
No partial bodies, cropped torsos, or over-the-shoulder framing implying an additional person.
LOCATION OWNER/RESIDENT FIREWALL: This location's associated people are EXCLUDED unless named.
${expectedCount === 0 ? 'ZERO HUMANS. No people of any kind. No bodies. No hands. No silhouettes.' : `EXACTLY ${expectedCount} person(s). No extras. No background occupants.`}
`;

  const basePrompt = `${envNote} Scene: ${locationName}${zoneSuffix}, ${timeOfDay} lighting.${atmosphere} ${peopleConstraint}${residentialConstraint}${humanPurityEnforcement}${identityLock}${avatarIdentityBlock}${outfitSuffix} Photorealistic.`;
  
  // CRITICAL: Validate each character's appearance_lock and outfit before returning prompt
  // Only validate characters that have an appearance_lock defined
  for (const char of characters) {
    if (char?.appearance_lock && Object.keys(char.appearance_lock).length > 0) {
      try {
        enforceValidation(char, basePrompt);
      } catch (err) {
        console.error(`[Scene] Validation failed for ${char?.name || 'unknown'}:`, err.message);
        throw err;
      }
    }
  }
  
  return basePrompt;
}