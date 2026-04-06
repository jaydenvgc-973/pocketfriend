/**
 * Image generation constraints for diversity and character consistency
 */

export const TRAVEL_PAGE_DIVERSITY_PROMPT = `
CRITICAL DIVERSITY DIRECTIVE:
- 1% Caucasian/White individuals
- 99% representation: Latino, African American, Indian, Native American, and multicultural individuals
- Ensure diverse skin tones, facial features, body types, and cultural representation
- NO whitewashing. Maintain authentic diversity in all generated people.
`;

export const CHARACTER_PHOTO_CONSISTENCY_PROMPT = `
CHARACTER IDENTITY LOCK - 100% ACCURACY REQUIRED:
When generating a photo of this character sending/showing the image:
- Facial features: MUST match exactly
- Skin tone: MUST match exactly (no variation)
- Hair type, color, and style: MUST match exactly
- Body type: MUST match exactly
- This character must be INSTANTLY RECOGNIZABLE
- NO ARTISTIC INTERPRETATION - strict character consistency
`;

/**
 * Augment a travel/location image prompt with diversity constraints
 * @param {string} basePrompt - Original prompt
 * @returns {string} - Enhanced prompt with diversity directive
 */
export function addDiversityConstraints(basePrompt) {
  return `${basePrompt}

${TRAVEL_PAGE_DIVERSITY_PROMPT}`;
}

/**
 * Augment a character image prompt with appearance-lock constraints
 * @param {string} basePrompt - Original prompt
 * @param {Object} character - Character object with appearance info
 * @returns {string} - Enhanced prompt with character consistency directive
 */
export function addCharacterAppearanceConstraints(basePrompt, character) {
  const appearanceDetails = buildCharacterAppearanceDetails(character);
  
  return `${basePrompt}

${CHARACTER_PHOTO_CONSISTENCY_PROMPT}

CHARACTER SPECIFIC DETAILS:
${appearanceDetails}`;
}

/**
 * Build detailed appearance description from character data
 * @param {Object} character - Character object
 * @returns {string} - Appearance description
 */
export function buildCharacterAppearanceDetails(character) {
  const details = [];

  // Skin tone
  if (character.appearance_lock?.skin_tone) {
    details.push(`Skin tone: ${character.appearance_lock.skin_tone}`);
  }

  // Hair
  if (character.appearance_lock?.hair_type) {
    details.push(`Hair type: ${character.appearance_lock.hair_type}`);
  }
  if (character.appearance_lock?.hairstyle) {
    details.push(`Hairstyle: ${character.appearance_lock.hairstyle}`);
  }

  // Facial hair
  if (character.appearance_lock?.facial_hair) {
    details.push(`Facial hair: ${character.appearance_lock.facial_hair}`);
  }

  // Makeup
  if (character.appearance_lock?.makeup) {
    details.push(`Makeup: ${character.appearance_lock.makeup}`);
  }

  // Clothing
  if (character.appearance_lock?.clothing_style) {
    details.push(`Clothing style: ${character.appearance_lock.clothing_style}`);
  }

  // Body type
  if (character.appearance_lock?.overall_aesthetic) {
    details.push(`Overall aesthetic: ${character.appearance_lock.overall_aesthetic}`);
  }

  // Custom keywords
  if (character.appearance_lock?.custom_keywords?.length > 0) {
    details.push(`Key visual identifiers: ${character.appearance_lock.custom_keywords.join(', ')}`);
  }

  // Age appearance
  if (character.appearance_age) {
    details.push(`Apparent age: ${character.appearance_age} years old`);
  }

  // Ethnicity
  if (character.ethnicities?.length > 0) {
    details.push(`Ethnicity/cultural appearance: ${character.ethnicities.join(', ')}`);
  }

  return details.length > 0 ? details.join('\n') : 'Use any appearance that feels natural';
}

/**
 * Check if character image generation should enforce strict appearance consistency
 * @param {string} subjectType - "character" | "user" | "joint"
 * @param {boolean} isCharacterSendingImage - Is the character the one "sending" this photo?
 * @returns {boolean}
 */
export function shouldEnforceCharacterConsistency(subjectType, isCharacterSendingImage) {
  // If character is sending a photo of themselves in chat, enforce 100%
  return subjectType === 'character' && isCharacterSendingImage;
}