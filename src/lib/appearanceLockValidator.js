/**
 * APPEARANCE LOCK VALIDATOR
 * 
 * Enforces that image generation prompts:
 * 1. Use ONLY appearance_lock for identity (face, hair, skin tone, etc.)
 * 2. Use ONLY closet/current_outfit for clothing
 * 3. Separate identity from outfit completely
 * 4. Validate that prompts contain exact appearance_lock fields before sending
 */

/**
 * Build the appearance lock block from character data
 * STRICT: Must include exact fields from appearance_lock
 * 
 * @param {object} character - Full character record
 * @returns {string} Appearance lock block for prompt injection
 */
export function buildAppearanceLockBlock(character) {
  if (!character) return '';
  
  const lock = character.appearance_lock || {};
  
  // CRITICAL: These fields MUST be present and EXACT
  const requiredFields = {
    skin_tone: lock.skin_tone,
    hair_type: lock.hair_type,
    hairstyle: lock.hairstyle,
    facial_hair: lock.facial_hair,
  };
  
  // Check: at least 3 of 4 core fields must exist
  const filledFields = Object.values(requiredFields).filter(Boolean).length;
  if (filledFields < 3) {
    console.warn(`[appearanceLock] Character ${character.id} missing core appearance_lock fields (${filledFields}/4)`);
  }
  
  const appearanceAge = lock.appearance_age ? ` appearance age ${lock.appearance_age}` : '';
  const customKeywords = lock.custom_keywords?.length > 0 ? ` ${lock.custom_keywords.join(', ')}` : '';
  
  // Build exact appearance string using literal field values
  const parts = [
    requiredFields.skin_tone ? `skin tone: ${requiredFields.skin_tone}` : null,
    requiredFields.hair_type ? `hair type: ${requiredFields.hair_type}` : null,
    requiredFields.hairstyle ? `hairstyle: ${requiredFields.hairstyle}` : null,
    requiredFields.facial_hair ? `facial hair: ${requiredFields.facial_hair}` : null,
    appearanceAge,
    customKeywords,
  ].filter(Boolean);
  
  if (parts.length === 0) return '';
  
  return `\n\n════════════════════════════════════════════════════════════════════════════════
APPEARANCE LOCK — CHARACTER IDENTITY (MANDATORY)
════════════════════════════════════════════════════════════════════════════════

This character has a locked visual identity. Use ONLY these exact descriptors:

${parts.join('\n')}

CRITICAL RULES:
✓ Must match these characteristics EXACTLY
✓ Do NOT infer appearance from name, personality, or narrative
✓ Do NOT substitute or approximate these features
✓ Do NOT let avatar image override these locked fields
✓ Identity is SEPARATE from clothing — clothing comes from outfit data only

This is the character's immutable visual identity. Every image must match.
════════════════════════════════════════════════════════════════════════════════`;
}

/**
 * Build outfit lock block from character's current_outfit
 * STRICT: Must use ONLY closet/outfit data, never avatar clothing
 * 
 * @param {object} outfit - Current outfit object from closet
 * @param {string} characterName - Character name for context
 * @returns {string} Outfit lock block for prompt injection
 */
export function buildOutfitLockBlock(outfit, characterName = 'character') {
  if (!outfit) return '';
  
  const outfitDesc = outfit.full_description || 
    [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
      .filter(Boolean)
      .join(', ');
  
  if (!outfitDesc) return '';
  
  return `\n\n════════════════════════════════════════════════════════════════════════════════
OUTFIT LOCK — CLOTHING ONLY (MANDATORY)
════════════════════════════════════════════════════════════════════════════════

${characterName} must wear EXACTLY:

${outfitDesc}

CRITICAL RULES:
✓ Every piece listed MUST appear in the image
✓ Do NOT invent or substitute clothing items
✓ Do NOT use clothing from avatar/reference images
✓ Do NOT substitute similar styles
✓ Clothing is SEPARATE from identity — identity comes from appearance_lock only

This is the outfit data. It is the ONLY source of truth for what this character is wearing.
════════════════════════════════════════════════════════════════════════════════`;
}

/**
 * Validate that a prompt contains appearance_lock fields
 * Returns { valid, errors }
 * 
 * @param {object} character - Character with appearance_lock
 * @param {string} prompt - The generated prompt
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateAppearanceLockInPrompt(character, prompt) {
  if (!character || !prompt) {
    return { valid: false, errors: ['Missing character or prompt'] };
  }
  
  const lock = character.appearance_lock || {};
  const errors = [];
  
  // CHECK 1: Does prompt contain skin_tone?
  if (lock.skin_tone && !prompt.includes(lock.skin_tone)) {
    errors.push(`Missing skin tone "${lock.skin_tone}" in prompt`);
  }
  
  // CHECK 2: Does prompt contain hair_type?
  if (lock.hair_type && !prompt.includes(lock.hair_type)) {
    errors.push(`Missing hair type "${lock.hair_type}" in prompt`);
  }
  
  // CHECK 3: Does prompt contain hairstyle?
  if (lock.hairstyle && !prompt.includes(lock.hairstyle)) {
    errors.push(`Missing hairstyle "${lock.hairstyle}" in prompt`);
  }
  
  // CHECK 4: Does prompt contain facial_hair?
  if (lock.facial_hair && !prompt.includes(lock.facial_hair)) {
    errors.push(`Missing facial hair "${lock.facial_hair}" in prompt`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a prompt contains outfit fields
 * Returns { valid, errors }
 * 
 * @param {object} outfit - Current outfit object
 * @param {string} prompt - The generated prompt
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateOutfitInPrompt(outfit, prompt) {
  if (!outfit || !prompt) {
    return { valid: false, errors: ['Missing outfit or prompt'] };
  }
  
  const errors = [];
  const outfitPieces = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean);
  
  for (const piece of outfitPieces) {
    if (!prompt.includes(piece)) {
      errors.push(`Missing outfit piece "${piece}" in prompt`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Pre-flight validation: Ensure identity and outfit are properly separated
 * Returns { valid, errors, metadata }
 * 
 * @param {object} character - Character with appearance_lock and outfit
 * @param {string} prompt - Generated image prompt
 * @returns {object} Validation result
 */
export function validateIdentityOutfitSeparation(character, prompt) {
  if (!character || !prompt) {
    return { 
      valid: false, 
      errors: ['Missing character or prompt'],
      metadata: {}
    };
  }
  
  const errors = [];
  const warnings = [];
  
  // Validate appearance_lock presence
  const appearanceCheck = validateAppearanceLockInPrompt(character, prompt);
  if (!appearanceCheck.valid) {
    errors.push(...appearanceCheck.errors);
  }
  
  // Validate outfit presence (if outfit exists)
  if (character.current_outfit) {
    const outfitCheck = validateOutfitInPrompt(character.current_outfit, prompt);
    if (!outfitCheck.valid) {
      errors.push(...outfitCheck.errors);
    }
  } else {
    warnings.push('Character has no current_outfit defined');
  }
  
  // Check: Avatar clothing NOT bleeding into prompt
  if (character.avatar_url) {
    const avatarMentioned = prompt.includes('avatar') || prompt.includes('reference image');
    if (avatarMentioned) {
      warnings.push('Prompt references avatar clothing — ensure only identity, not outfit, comes from avatar');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata: {
      hasAppearanceLock: !!character.appearance_lock,
      hasOutfit: !!character.current_outfit,
      appearanceLockFields: Object.keys(character.appearance_lock || {}).length,
    },
  };
}

/**
 * CRITICAL: Block prompt if validation fails
 * Call this before sending ANY image generation request
 * 
 * @param {object} character - Character record
 * @param {string} prompt - Generated prompt
 * @throws Error if validation fails
 */
export function enforceValidation(character, prompt) {
  const validation = validateIdentityOutfitSeparation(character, prompt);
  
  if (!validation.valid) {
    const errorList = validation.errors.join('; ');
    console.error(`[VALIDATION FAILED] ${errorList}`);
    throw new Error(`Image prompt validation failed: ${errorList}`);
  }
  
  if (validation.warnings.length > 0) {
    console.warn(`[VALIDATION WARNING] ${validation.warnings.join('; ')}`);
  }
  
  return validation;
}