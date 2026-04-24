/**
 * Scene Image Generation Pipeline
 *
 * Handles image generation for scene pages with strict enforcement of:
 * - Avatar identity lock (characters must match avatars exactly)
 * - Zone-lock (images must belong to currently selected zone only)
 * - Residential privacy (home scenes show residents only)
 */

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
 * Ensures characters match their avatars exactly.
 */
export function buildAvatarIdentityBlock(characters) {
  if (!characters || characters.length === 0) return '';
  
  return `\n\nAVATAR IDENTITY REQUIREMENT (NON-NEGOTIABLE):\nThe attached reference images are the EXACT identity source for each character.\nYou MUST preserve: face shape, facial structure, skin tone, hair texture, hair length, hairstyle, body type, apparent age, gender presentation.\nDo NOT alter these features. Do NOT reinterpret, beautify, age, or generalize. Match the avatar EXACTLY or do not render that character.`;
}

/**
 * Constructs the full scene image generation prompt with all enforcement rules.
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
}) {
  const basePrompt = `${envNote} Scene: ${locationName}${zoneSuffix}, ${timeOfDay} lighting.${atmosphere} ${peopleConstraint}${residentialConstraint}${identityLock}${avatarIdentityBlock}${outfitSuffix} Photorealistic.`;
  return basePrompt;
}