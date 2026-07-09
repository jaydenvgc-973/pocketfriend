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

/**
 * BACKGROUND POPULATION DIVERSITY DIRECTIVE
 *
 * Canonical rule: Caucasian/White is NEVER the default appearance for any
 * automatically generated, unspecified, or background person.
 *
 * This directive is injected into EVERY image generation pathway as a global
 * rule that overrides training-data bias. It applies to background figures,
 * crowds, pedestrians, shoppers, coworkers, students, diners, patrons, visitors,
 * commuters, and all other incidental or unnamed people — NOT to explicitly
 * defined characters whose appearance is locked by reference images,
 * appearance_lock fields, or ethnicities fields.
 *
 * This is the application's established population generation rule. It is not
 * a prompt-specific workaround — it is a permanent, global directive.
 */
export const BACKGROUND_POPULATION_DIVERSITY_DIRECTIVE = `
════════════════════════════════════════════════════════════
⛔⛔⛔ BACKGROUND POPULATION DIVERSITY LAW — ABSOLUTE OVERRIDE ⛔⛔⛔
════════════════════════════════════════════════════════════

Caucasian/White is NEVER the default appearance for any automatically generated, unspecified, or background person.

This applies to: background figures, crowds, pedestrians, shoppers, coworkers, students, diners, patrons, visitors, commuters, and ALL other incidental or unnamed people in the scene.

When generating ANY person whose ethnicity is not explicitly defined by reference images, appearance lock, or character data:
✅ Distribute across diverse backgrounds: Black, Hispanic/Latino, Indian, Jamaican, African, Asian, Middle Eastern, Haitian, Mixed heritage, Indigenous, Pacific Islander, South Asian, and other culturally appropriate backgrounds.
✅ Vary skin tones, facial features, hair textures, and body types to reflect authentic real-world human diversity.
✅ Each background person should be a unique individual — do not make them all look the same.
✅ Reflect the natural diversity of a real public space — people of many backgrounds coexisting.

⛔ DO NOT collapse all background people to a single ethnicity.
⛔ DO NOT use training-data "generic person" defaults — those priors skew heavily Caucasian/White.
⛔ DO NOT render all background extras as White, fair-skinned, or European-featured.
⛔ DO NOT make every crowd member the same race.
⛔ DO NOT default to Caucasian when no ethnicity is specified — select from the diverse backgrounds listed above.

This rule overrides any training-data bias. Representation MUST reflect real-world diversity.
Explicitly defined characters (with reference images, appearance locks, or ethnicities) are NOT affected — their locked appearance is always preserved exactly.

════════════════════════════════════════════════════════════
`;

/**
 * Get the background population diversity directive.
 * Used by frontend image generation paths to append the canonical rule.
 * @returns {string} The directive string to append to image generation prompts.
 */
export function getBackgroundPopulationDiversityDirective() {
  return BACKGROUND_POPULATION_DIVERSITY_DIRECTIVE;
}

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